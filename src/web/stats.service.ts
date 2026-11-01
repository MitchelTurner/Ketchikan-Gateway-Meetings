import { Injectable, Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { PrismaService } from '../prisma.service';
import { REF_PATTERN, SHARE_CHANNELS } from '../referrals';
import { requestIsHttps } from './https';

const BOTS =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|curl|wget|python|httpx|axios|node-fetch|undici|go-http|java\/|okhttp|headless|lighthouse|monitor|uptime|pingdom|scan|fetch|feed|rss/i;

export interface DayCount {
  day: string; // YYYY-MM-DD in the newsroom's time zone
  views: number;
  visits: number;
}

export interface PageCount {
  kind: string;
  ref: string | null;
  views: number;
  visits: number;
}

/** Which public page a path is, or null for pages that aren't counted. */
export function classify(path: string): { kind: string; ref: string | null } | null {
  const p = path.replace(/\/+$/, '') || '/';
  if (p === '/') return { kind: 'home', ref: null };
  if (p === '/notes') return { kind: 'notes', ref: null };
  if (p === '/topics') return { kind: 'topics', ref: null };
  if (p === '/about' || p === '/boards' || p === '/testify') return { kind: p.slice(1), ref: null };
  let m = /^\/notes\/([^/]+)(?:\/[^/]*)?$/.exec(p);
  if (m) return { kind: 'note', ref: decodeURIComponent(m[1]) };
  m = /^\/meetings\/([^/]+)$/.exec(p);
  if (m) return { kind: 'meeting', ref: decodeURIComponent(m[1]) };
  m = /^\/topics\/([^/]+)$/.exec(p);
  if (m) return { kind: 'topic', ref: decodeURIComponent(m[1]) };
  return null;
}

export function isAdminToken(given: string): boolean {
  let want = '';
  try {
    want = config.adminToken;
  } catch {
    return false;
  }
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function readCookie(header: unknown, name: string): string {
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1 || part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

/** Today's date in the newsroom's zone, e.g. 2026-10-30. */
function localDay(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: config.timezone });
}

@Injectable()
export class StatsService {
  private log = new Logger(StatsService.name);

  constructor(private prisma: PrismaService) {}

  /** Express middleware. Records after the response, so a slow insert never delays a page. */
  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const r = typeof req.query.r === 'string' ? req.query.r : '';
      if (req.method === 'GET' && REF_PATTERN.test(r) && !req.path.startsWith('/admin')) {
        // Remembered so a reader who browses a few recaps before signing up still credits the neighbor who invited them.
        const secure = requestIsHttps(req) ? '; Secure' : '';
        res.append('Set-Cookie', `kgb_ref=${encodeURIComponent(r)}; Path=/; SameSite=Lax; Max-Age=${30 * 24 * 3600}${secure}`);
      }
      if (req.method === 'GET') {
        res.on('finish', () => {
          if (res.statusCode !== 200 || !String(res.getHeader('content-type') ?? '').includes('text/html')) return;
          this.record(req).catch((err) => this.log.warn(`Page view not saved: ${(err as Error).message}`));
        });
      }
      next();
    };
  }

  private async record(req: Request) {
    const page = classify(req.path);
    if (!page) return;
    const ua = String(req.headers['user-agent'] ?? '');
    if (!ua || BOTS.test(ua)) return;
    if (req.headers.purpose === 'prefetch' || req.headers['sec-purpose']) return;
    if (isAdminToken(readCookie(req.headers.cookie, 'admin_token'))) return;
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '';
    let salt = '';
    try {
      salt = config.signingSecret;
    } catch {
      salt = 'kgb';
    }
    const visitor = createHash('sha256').update(`${salt}|${localDay()}|${ip}|${ua}`).digest('hex').slice(0, 20);
    await this.prisma.pageView.create({
      data: {
        kind: page.kind,
        ref: page.ref,
        path: req.path.slice(0, 300),
        referrer: outsideHost(req),
        visitor,
        mobile: /Mobi|Android|iPhone|iPad/i.test(ua),
        via: viaOf(req),
      },
    });
  }

  /** Views and visits (one person on one day) per local day, oldest first, with empty days filled in. */
  async daily(days: number): Promise<DayCount[]> {
    const since = new Date(Date.now() - (days + 1) * 86_400_000);
    const rows = await this.prisma.$queryRaw<{ day: string; views: number; visits: number }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${config.timezone}, 'YYYY-MM-DD') AS day,
             count(*)::int AS views, count(DISTINCT visitor)::int AS visits
      FROM "PageView" WHERE "createdAt" >= ${since} GROUP BY 1`;
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const out: DayCount[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = localDay(new Date(Date.now() - i * 86_400_000));
      const r = byDay.get(day);
      out.push({ day, views: r?.views ?? 0, visits: r?.visits ?? 0 });
    }
    return out;
  }

  async topPages(since: Date, limit = 12): Promise<PageCount[]> {
    return this.prisma.$queryRaw<PageCount[]>`
      SELECT kind, ref, count(*)::int AS views, count(DISTINCT visitor)::int AS visits
      FROM "PageView" WHERE "createdAt" >= ${since}
      GROUP BY kind, ref ORDER BY views DESC LIMIT ${limit}`;
  }

  async referrers(since: Date, limit = 10): Promise<{ host: string; views: number }[]> {
    return this.prisma.$queryRaw<{ host: string; views: number }[]>`
      SELECT referrer AS host, count(*)::int AS views
      FROM "PageView" WHERE "createdAt" >= ${since} AND referrer IS NOT NULL
      GROUP BY referrer ORDER BY views DESC LIMIT ${limit}`;
  }

  async mobileShare(since: Date): Promise<number> {
    const [r] = await this.prisma.$queryRaw<{ total: number; mobile: number }[]>`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE mobile)::int AS mobile
      FROM "PageView" WHERE "createdAt" >= ${since}`;
    return r?.total ? r.mobile / r.total : 0;
  }

  async shareVisits(since: Date): Promise<{ via: string; views: number; visits: number }[]> {
    return this.prisma.$queryRaw<{ via: string; views: number; visits: number }[]>`
      SELECT via, count(*)::int AS views, count(DISTINCT visitor)::int AS visits
      FROM "PageView" WHERE "createdAt" >= ${since} AND via IS NOT NULL
      GROUP BY via ORDER BY views DESC`;
  }

  /** All-time views for each meeting's recap and draft pages. */
  async postViews(meetingIds: string[]): Promise<Map<string, number>> {
    if (!meetingIds.length) return new Map();
    const rows = await this.prisma.pageView.groupBy({
      by: ['ref'],
      where: { kind: { in: ['note', 'meeting'] }, ref: { in: meetingIds } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.ref ?? '', r._count._all]));
  }
}

function viaOf(req: Request): string | null {
  if (typeof req.query.r === 'string' && REF_PATTERN.test(req.query.r)) return 'invite';
  const via = typeof req.query.via === 'string' ? req.query.via : '';
  return (SHARE_CHANNELS as readonly string[]).includes(via) ? via : null;
}

function outsideHost(req: Request): string | null {
  const raw = String(req.headers.referer ?? '');
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
    const own = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(':')[0].replace(/^www\./, '').toLowerCase();
    return host && host !== own ? host.slice(0, 120) : null;
  } catch {
    return null;
  }
}
