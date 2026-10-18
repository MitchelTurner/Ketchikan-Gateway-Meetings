import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { MeetingDigest } from '../analysis/analysis.service';
import { config } from '../config';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma.service';
import { BODIES, esc, formatDate, randomToken } from '../util';
import { bodyCheckboxes, noteDetailPage, notesSearchPage, page, signupPage } from './page';

const VALID_BODIES = new Set(BODIES.map((b) => b.name));
const normBodies = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v ? [v] : []).map(String).filter((b) => VALID_BODIES.has(b));

@Controller()
export class PublicController {
  constructor(private prisma: PrismaService, private email: EmailService) {}

  @Get('health')
  health() {
    return { ok: true };
  }

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  home() {
    return signupPage();
  }

  /** Published recaps — the same notes subscribers get by email, after review. */
  @Get('notes')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async notes(@Query('q') q?: string, @Query('body') body?: string) {
    const query = String(q ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const bodyName = VALID_BODIES.has(String(body ?? '')) ? String(body) : '';
    const meetings = await this.prisma.meeting.findMany({
      where: {
        analysis: { is: { approvedAt: { not: null } } },
        ...(bodyName ? { body: bodyName } : {}),
      },
      include: { analysis: true },
      orderBy: [{ meetingDate: 'desc' }, { createdAt: 'desc' }],
      take: query ? 1000 : 40,
    });
    const hits = [];
    for (const m of meetings) {
      const digest = asDigest(m.analysis?.data);
      if (!digest) continue;
      const plain = notePlain(m.title, m.body, digest);
      if (query && !plain.toLowerCase().includes(query.toLowerCase())) continue;
      hits.push({
        id: m.id,
        title: m.title,
        body: m.body,
        date: formatDate(m.meetingDate),
        headline: digest.headline,
        snippet: snippet(query ? plain : digest.summary, query),
      });
      if (hits.length >= 40) break;
    }
    return notesSearchPage(query, bodyName, hits);
  }

  @Get('notes/:id')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async note(@Param('id') id: string) {
    const m = await this.prisma.meeting.findUnique({ where: { id }, include: { analysis: true } });
    const digest = m?.analysis?.approvedAt ? asDigest(m.analysis.data) : null;
    if (!m || !digest) {
      return page('Note not found', `<h1>That note isn't up yet</h1><p>Recaps appear here after they've been reviewed and emailed. <a href="/notes">Back to search</a>.</p>`);
    }
    return noteDetailPage(m, digest);
  }

  /** Double opt-in: always answers the same way so the form can't be used to probe who's subscribed. */
  @Post('subscribe')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async subscribe(@Body() body: { email?: string; bodies?: string | string[] }) {
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return page('Check your email address', `<h1>That email doesn't look right</h1><p><a href="/">Go back</a> and try again.</p>`);
    }
    const bodies = normBodies(body.bodies);
    const existing = await this.prisma.subscriber.findUnique({ where: { email } });
    if (existing?.status !== 'CONFIRMED') {
      const sub = existing
        ? await this.prisma.subscriber.update({ where: { email }, data: { status: 'PENDING', bodies, token: randomToken() } })
        : await this.prisma.subscriber.create({ data: { email, bodies, token: randomToken() } });
      const url = `${config.publicBaseUrl}/confirm/${sub.token}`;
      await this.email.send({
        to: email,
        subject: `Confirm your ${config.newsletterName} subscription`,
        html: `<p>Tap to confirm you want ${esc(config.newsletterName)} emails:</p><p><a href="${esc(url)}">${esc(url)}</a></p><p>If you didn't sign up, ignore this and you won't hear from us.</p><p style="color:#5b6675;font-size:12px">${esc(config.mailingAddress)}</p>`,
        text: `Confirm your subscription: ${url}\n\nIf you didn't sign up, ignore this.\n\n${config.mailingAddress}`,
      });
    }
    return page('Check your inbox', `<h1>Check your inbox</h1><p>We sent a confirmation link to <strong>${esc(email)}</strong>. Recaps start once you tap it.</p>`);
  }

  @Get('confirm/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async confirm(@Param('token') token: string) {
    const sub = await this.prisma.subscriber.findUnique({ where: { token } });
    if (!sub) return page('Link expired', `<h1>That link didn't work</h1><p><a href="/">Sign up again</a>.</p>`);
    if (sub.status !== 'CONFIRMED') {
      await this.prisma.subscriber.update({ where: { id: sub.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
    }
    return page('Subscribed', `<h1>You're subscribed</h1><p>The next recap will arrive after the next Borough meeting is posted.</p>`);
  }

  // GET shows a button rather than acting, so email link-scanners can't unsubscribe people.
  @Get('unsubscribe/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  unsubscribeForm(@Param('token') token: string) {
    return page('Unsubscribe', `<h1>Unsubscribe?</h1><p>You'll stop getting meeting recaps.</p>
<form method="post" action="/unsubscribe/${esc(token)}"><button type="submit">Unsubscribe</button></form>`);
  }

  // Also the RFC 8058 one-click target.
  @Post('unsubscribe/:token')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async unsubscribe(@Param('token') token: string) {
    await this.prisma.subscriber.updateMany({ where: { token }, data: { status: 'UNSUBSCRIBED' } });
    return page('Unsubscribed', `<h1>You're unsubscribed</h1><p>You won't get any more recaps. <a href="/">Changed your mind?</a></p>`);
  }

  @Get('preferences/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async prefsForm(@Param('token') token: string) {
    const sub = await this.prisma.subscriber.findUnique({ where: { token } });
    if (!sub) return page('Not found', `<h1>That link didn't work</h1>`);
    return page('Your meetings', `<h1>Which meetings?</h1><form method="post" action="/preferences/${esc(token)}">${bodyCheckboxes(sub.bodies)}<button type="submit">Save</button></form>`);
  }

  @Post('preferences/:token')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async prefsSave(@Param('token') token: string, @Body() body: { bodies?: string | string[] }) {
    await this.prisma.subscriber.updateMany({ where: { token }, data: { bodies: normBodies(body.bodies) } });
    return page('Saved', `<h1>Saved</h1><p>Your meeting choices are updated.</p>`);
  }
}

function asDigest(data: unknown): MeetingDigest | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<MeetingDigest>;
  if (typeof d.headline !== 'string' || typeof d.summary !== 'string') return null;
  return {
    headline: d.headline,
    summary: d.summary,
    actions: Array.isArray(d.actions) ? d.actions : [],
    discussion: Array.isArray(d.discussion) ? d.discussion : [],
    publicComment: Array.isArray(d.publicComment) ? d.publicComment : [],
    upcoming: Array.isArray(d.upcoming) ? d.upcoming : [],
    caveats: Array.isArray(d.caveats) ? d.caveats : [],
  };
}

function notePlain(title: string, body: string, d: MeetingDigest): string {
  return [
    title,
    body,
    d.headline,
    d.summary,
    ...d.actions.flatMap((a) => [a.item, a.outcome, a.vote]),
    ...d.discussion.flatMap((x) => [x.topic, x.gist]),
    ...d.publicComment.flatMap((x) => [x.who, x.topic, x.gist]),
    ...d.upcoming.flatMap((x) => [x.item, x.when]),
    ...d.caveats,
  ]
    .filter((s) => typeof s === 'string' && s)
    .join('\n');
}

/** A short extract, with the query marked when it appears. `snippet` is already escaped HTML when it contains <mark>. */
function snippet(text: string, q: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const window = 220;
  if (!q) return esc(clean.slice(0, window)) + (clean.length > window ? '…' : '');
  const i = clean.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(clean.slice(0, window)) + (clean.length > window ? '…' : '');
  const start = Math.max(0, i - 80);
  const end = Math.min(clean.length, i + q.length + 120);
  return (
    (start > 0 ? '…' : '') +
    esc(clean.slice(start, i)) +
    `<mark>${esc(clean.slice(i, i + q.length))}</mark>` +
    esc(clean.slice(i + q.length, end)) +
    (end < clean.length ? '…' : '')
  );
}
