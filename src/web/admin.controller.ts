import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException, Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Header, HttpCode, Injectable,
  NotFoundException, Param, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { renderDiveHtml } from '../email/dive-render';
import { DeepDiveService } from '../topics/deep-dive.service';
import { TopicsService } from '../topics/topics.service';
import { Queue } from 'bullmq';
import { config } from '../config';
import { DiscoveryService } from '../discovery/discovery.service';
import { renderHtml } from '../email/render';
import { isBackfill, PipelineService } from '../pipeline/pipeline.service';
import { PrismaService } from '../prisma.service';
import { Q_CONTROL } from '../queues';
import { normalizeDigest } from '../analysis/analysis.service';
import { esc, formatDate, shortDate, verify } from '../util';
import { adminLoginPage, AdminOverview, adminOverviewPage, adminPostPage, AdminPostRow, adminPostsPage, PostFilter } from './admin-page';
import { adminMeetingsPage, adminTopicsPage, adminTranscriptPage, noteHref, page } from './page';
import { badgeFor, FOUNDING_READERS } from '../referrals';
import { isAdminToken, readCookie, StatsService } from './stats.service';

const MONTH = 30 * 24 * 3600;

function tokenCookie(req: Request, value: string, maxAge = MONTH, path = '/'): string {
  const secure = String(req.headers['x-forwarded-proto'] ?? '').startsWith('https') ? '; Secure' : '';
  return `admin_token=${encodeURIComponent(value)}; HttpOnly; Path=${path}; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

@Injectable()
class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const header = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const query = typeof req.query.token === 'string' ? req.query.token : '';
    const ok = isAdminToken(header || query || readCookie(req.headers.cookie, 'admin_token'));
    // One browser visit with ?token= signs that browser in.
    if (ok && query) res.setHeader('Set-Cookie', tokenCookie(req, query));
    // A browser gets the sign-in form; the 403 that follows is dropped because the redirect already went out.
    if (!ok && req.method === 'GET' && String(req.headers.accept ?? '').includes('text/html')) {
      res.redirect(303, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    return ok;
  }
}

const FLASH: Record<string, string> = {
  saved: 'Saved. The site shows the new version now.',
  published: 'Published on the site. No email was sent.',
  sent: 'Published. The email is on its way to subscribers.',
  hidden: 'Hidden. It is off every public page.',
  unhidden: 'Back on the site.',
  rewriting: 'Rewriting with Claude. The post comes back as a draft in a few minutes.',
  discover: 'Checking the archive for new meetings.',
  'already-published': 'That post was already published.',
};

const isFilter = (v: unknown): v is PostFilter => v === 'drafts' || v === 'published' || v === 'hidden' || v === 'all';

@Controller('admin')
export class AdminController {
  constructor(
    private prisma: PrismaService,
    private discovery: DiscoveryService,
    private pipeline: PipelineService,
    private topics: TopicsService,
    private dives: DeepDiveService,
    private pageStats: StatsService,
    @InjectQueue(Q_CONTROL) private controlQ: Queue,
  ) {}

  @Get('login')
  @Header('Content-Type', 'text/html; charset=utf-8')
  loginForm(@Query('next') next?: string) {
    return adminLoginPage(safeNext(next));
  }

  @Post('login')
  async login(@Body() body: { token?: string; next?: string }, @Req() req: Request, @Res() res: Response) {
    const token = String(body.token ?? '');
    if (!isAdminToken(token)) {
      await new Promise((r) => setTimeout(r, 600));
      res.status(401).type('html').send(adminLoginPage(safeNext(body.next), "That token didn't match."));
      return;
    }
    res.setHeader('Set-Cookie', tokenCookie(req, token));
    res.redirect(303, safeNext(body.next));
  }

  @Get('logout')
  logout(@Req() req: Request, @Res() res: Response) {
    res.setHeader('Set-Cookie', [tokenCookie(req, '', 0), tokenCookie(req, '', 0, '/admin')]);
    res.redirect(303, '/');
  }

  @Get()
  @UseGuards(AdminGuard)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async overview(@Query('done') done?: string) {
    const day = 86_400_000;
    const now = Date.now();
    const d30 = new Date(now - 30 * day);
    const [daily, top, referrers, mobileShare, prev, subs, newThisWeek, meetingStatus, drafts, failed, suggested, diveDrafts, sends, published, hidden] =
      await Promise.all([
        this.pageStats.daily(30),
        this.pageStats.topPages(d30),
        this.pageStats.referrers(d30),
        this.pageStats.mobileShare(d30),
        this.prisma.$queryRaw<{ views: number; visits: number }[]>`
          SELECT count(*)::int AS views, count(DISTINCT visitor)::int AS visits FROM "PageView"
          WHERE "createdAt" >= ${new Date(now - 60 * day)} AND "createdAt" < ${d30}`,
        this.prisma.subscriber.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.subscriber.count({ where: { status: 'CONFIRMED', confirmedAt: { gte: new Date(now - 7 * day) } } }),
        this.prisma.meeting.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.meeting.findMany({
          where: { analysis: { is: { approvedAt: null, hiddenAt: null } } },
          select: { id: true, title: true, meetingDate: true, analysis: { select: { data: true } } },
          orderBy: [{ meetingDate: { sort: 'desc', nulls: 'last' } }],
        }),
        this.prisma.meeting.count({ where: { status: 'FAILED' } }),
        this.prisma.topic.count({ where: { status: 'SUGGESTED' } }),
        this.prisma.deepDive.count({ where: { status: 'DRAFT' } }),
        this.prisma.emailSend.groupBy({ by: ['status'], where: { createdAt: { gte: d30 } }, _count: { _all: true } }),
        this.prisma.analysis.count({ where: { approvedAt: { not: null }, hiddenAt: null } }),
        this.prisma.analysis.count({ where: { hiddenAt: { not: null } } }),
      ]);
    const growth = await this.growthStats(d30);
    const sum = (k: 'views' | 'visits') => daily.reduce((t, d) => t + d[k], 0);
    const views30 = sum('views');
    const visits30 = sum('visits');
    const today = daily[daily.length - 1] ?? { views: 0, visits: 0 };
    const before = prev[0] ?? { views: 0, visits: 0 };
    const change = (now: number, then: number): { note: string; tone?: 'up' | 'down' } => {
      if (!then) return { note: 'Counting started this month' };
      const pct = Math.round(((now - then) / then) * 100);
      return { note: `${pct >= 0 ? '+' : ''}${pct}% on the 30 days before`, tone: pct > 0 ? 'up' : pct < 0 ? 'down' : undefined };
    };
    const subCount = (s: string) => subs.find((r) => r.status === s)?._count._all ?? 0;
    const current = drafts.filter((m) => !isBackfill(m));
    const older = drafts.length - current.length;

    const pageMeetings = await this.prisma.meeting.findMany({
      where: { id: { in: top.filter((p) => p.kind === 'note' || p.kind === 'meeting').map((p) => p.ref ?? '') } },
      select: { id: true, title: true, body: true, meetingDate: true, analysis: { select: { data: true } } },
    });
    const topicNames = await this.prisma.topic.findMany({
      where: { slug: { in: top.filter((p) => p.kind === 'topic').map((p) => p.ref ?? '') } },
      select: { slug: true, name: true },
    });
    const byMeeting = new Map(pageMeetings.map((m) => [m.id, m]));
    const byTopic = new Map(topicNames.map((t) => [t.slug, t.name]));
    const fixed: Record<string, [string, string]> = {
      home: ['Front page', '/'],
      notes: ['Recaps (list and search)', '/notes'],
      topics: ['Topics index', '/topics'],
    };
    const topPages = top.map((p) => {
      const base = { views: p.views, visits: p.visits };
      if (fixed[p.kind]) return { ...base, label: fixed[p.kind][0], sub: 'Section page', href: fixed[p.kind][1] };
      if (p.kind === 'topic') return { ...base, label: byTopic.get(p.ref ?? '') ?? p.ref ?? '', sub: 'Topic page', href: `/topics/${p.ref}` };
      const m = byMeeting.get(p.ref ?? '');
      const headline = normalizeDigest(m?.analysis?.data)?.headline;
      return {
        ...base,
        label: headline || m?.title || 'A meeting that no longer exists',
        sub: `${p.kind === 'note' ? 'Recap' : 'Meeting page'}${m ? ` · ${m.body} · ${shortDate(m.meetingDate, false)}` : ''}`,
        href: m ? `/admin/posts/${m.id}` : '#',
      };
    });

    const attention: AdminOverview['attention'] = current.slice(0, 6).map((m) => ({
      label: normalizeDigest(m.analysis?.data)?.headline || m.title,
      sub: `Draft · ${shortDate(m.meetingDate, false)}`,
      href: `/admin/posts/${m.id}`,
    }));
    if (current.length > 6) attention.push({ label: `${current.length - 6} more recent drafts`, sub: 'Posts', href: '/admin/posts?filter=drafts' });
    if (older) attention.push({ label: `${older} draft${older === 1 ? '' : 's'} of older meetings`, sub: 'Not emailed', href: '/admin/posts?filter=drafts' });
    if (failed) attention.push({ label: `${failed} meeting${failed === 1 ? '' : 's'} stopped before finishing`, sub: 'Retried automatically', href: '/admin/meetings?status=FAILED' });
    if (suggested) attention.push({ label: `${suggested} suggested topic${suggested === 1 ? '' : 's'}`, sub: 'Approve or archive', href: '/admin/topics' });
    if (diveDrafts) attention.push({ label: `${diveDrafts} deep dive draft${diveDrafts === 1 ? '' : 's'}`, sub: 'Waiting to send', href: '/admin/topics' });

    const pipelineOrder = ['DISCOVERED', 'RESEARCHING', 'DOWNLOADING', 'TRANSCRIBING', 'ANALYZING', 'AWAITING_APPROVAL', 'SENDING', 'SENT', 'PUBLISHED', 'FAILED', 'SKIPPED'];
    const v = change(visits30, before.visits);
    const pv = change(views30, before.views);
    return adminOverviewPage({
      flash: done ? FLASH[done] : undefined,
      cards: [
        { label: 'Visits · 30 days', value: visits30.toLocaleString('en-US'), ...v },
        { label: 'Page views · 30 days', value: views30.toLocaleString('en-US'), ...pv },
        { label: 'Today', value: today.views.toLocaleString('en-US'), note: `${today.visits} visit${today.visits === 1 ? '' : 's'}` },
        { label: 'Subscribers', value: subCount('CONFIRMED').toLocaleString('en-US'), note: `+${newThisWeek} this week`, tone: newThisWeek ? 'up' : undefined },
        { label: 'Published posts', value: published.toLocaleString('en-US'), note: hidden ? `${hidden} hidden` : undefined },
        { label: 'Drafts waiting', value: drafts.length.toLocaleString('en-US'), note: older ? `${older} of them older meetings` : undefined },
      ],
      daily,
      topPages,
      referrers,
      mobileShare,
      attention,
      pipeline: meetingStatus
        .map((r) => ({ status: r.status as string, count: r._count._all }))
        .sort((a, b) => pipelineOrder.indexOf(a.status) - pipelineOrder.indexOf(b.status)),
      subscribers: { confirmed: subCount('CONFIRMED'), pending: subCount('PENDING'), unsubscribed: subCount('UNSUBSCRIBED'), newThisWeek },
      email: {
        ready: config.emailReady,
        sent30: sends.find((r) => r.status === 'sent')?._count._all ?? 0,
        failed30: sends.find((r) => r.status === 'failed')?._count._all ?? 0,
      },
      backfillDrafts: older,
      growth,
    });
  }

  private async growthStats(since: Date): Promise<AdminOverview['growth']> {
    const [newReaders30, invited30, invitedAll, readersEver, shareVisits, top] = await Promise.all([
      this.prisma.subscriber.count({ where: { confirmedAt: { gte: since } } }),
      this.prisma.subscriber.count({ where: { confirmedAt: { gte: since }, referredById: { not: null } } }),
      this.prisma.subscriber.count({ where: { confirmedAt: { not: null }, referredById: { not: null } } }),
      this.prisma.subscriber.count({ where: { confirmedAt: { not: null } } }),
      this.pageStats.shareVisits(since),
      this.prisma.subscriber.groupBy({
        by: ['referredById'],
        where: { confirmedAt: { not: null }, referredById: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { referredById: 'desc' } },
        take: 10,
      }),
    ]);
    const people = await this.prisma.subscriber.findMany({ where: { id: { in: top.map((t) => t.referredById!) } }, select: { id: true, email: true } });
    const email = new Map(people.map((p) => [p.id, p.email]));
    return {
      newReaders30,
      invited30,
      invitedAll,
      readersEver,
      foundingLeft: Math.max(0, FOUNDING_READERS - readersEver),
      shareVisits,
      inviters: top.map((t) => ({ email: email.get(t.referredById!) ?? '(removed)', count: t._count._all, badge: badgeFor(t._count._all)?.name ?? '' })),
    };
  }

  @Get('posts')
  @UseGuards(AdminGuard)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async posts(@Query('filter') f?: string, @Query('q') q?: string, @Query('done') done?: string) {
    const meetings = await this.prisma.meeting.findMany({
      where: { analysis: { isNot: null } },
      select: {
        id: true, title: true, body: true, meetingDate: true, status: true,
        analysis: { select: { approvedAt: true, hiddenAt: true, editedAt: true, data: true } },
      },
      orderBy: [{ meetingDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    const views = await this.pageStats.postViews(meetings.map((m) => m.id));
    const all: AdminPostRow[] = meetings.map((m) => {
      const a = m.analysis!;
      const headline = normalizeDigest(a.data)?.headline ?? '';
      const state = a.hiddenAt ? 'hidden' : a.approvedAt ? 'published' : 'draft';
      return {
        id: m.id,
        headline,
        title: m.title,
        body: m.body,
        date: shortDate(m.meetingDate, false),
        status: m.status,
        state,
        edited: Boolean(a.editedAt),
        views: views.get(m.id) ?? 0,
        publicHref: state === 'published' ? noteHref(m.id, headline) : `/meetings/${m.id}`,
      };
    });
    const query = String(q ?? '').trim().slice(0, 120);
    const matched = query ? all.filter((r) => `${r.headline} ${r.title} ${r.body}`.toLowerCase().includes(query.toLowerCase())) : all;
    const counts: Record<PostFilter, number> = {
      drafts: matched.filter((r) => r.state === 'draft').length,
      published: matched.filter((r) => r.state === 'published').length,
      hidden: matched.filter((r) => r.state === 'hidden').length,
      all: matched.length,
    };
    const filter: PostFilter = isFilter(f) ? f : counts.drafts ? 'drafts' : 'all';
    const stateFor: Record<PostFilter, string> = { drafts: 'draft', published: 'published', hidden: 'hidden', all: '' };
    const rows = filter === 'all' ? matched : matched.filter((r) => r.state === stateFor[filter]);
    return adminPostsPage(rows, filter, query, counts, done ? FLASH[done] : '');
  }

  @Get('posts/:id')
  @UseGuards(AdminGuard)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async post(@Param('id') id: string, @Query('done') done?: string) {
    const m = await this.prisma.meeting.findUnique({ where: { id }, include: { analysis: true, transcript: { select: { id: true } } } });
    if (!m?.analysis) throw new NotFoundException();
    const a = m.analysis;
    const digest = normalizeDigest(a.data);
    const [views, subscribers] = await Promise.all([
      this.pageStats.postViews([id]),
      this.prisma.subscriber.count({ where: { status: 'CONFIRMED', recaps: true, OR: [{ bodies: { isEmpty: true } }, { bodies: { has: m.body } }] } }),
    ]);
    const state = a.hiddenAt ? 'hidden' : a.approvedAt ? 'published' : 'draft';
    return adminPostPage({
      id,
      title: m.title,
      body: m.body,
      date: formatDate(m.meetingDate),
      status: m.status,
      error: m.error,
      state,
      headline: digest?.headline ?? '',
      summary: digest?.summary ?? '',
      views: views.get(id) ?? 0,
      publicHref: state === 'published' && digest ? noteHref(id, digest.headline) : `/meetings/${id}`,
      approvedAt: a.approvedAt,
      hiddenAt: a.hiddenAt,
      editedAt: a.editedAt,
      createdAt: a.createdAt,
      backfill: isBackfill(m),
      subscribers,
      emailReady: config.emailReady,
      nameCorrections: digest?.nameCorrections ?? [],
      checkedAgainst: digest?.checkedAgainst ?? [],
      caveats: digest?.caveats ?? [],
      hasTranscript: Boolean(m.transcript),
      sourceUrl: m.sourceUrl,
      flash: done ? FLASH[done] : undefined,
    });
  }

  @Post('posts/:id')
  @UseGuards(AdminGuard)
  async savePost(@Param('id') id: string, @Body() body: { headline?: string; summary?: string }, @Res() res: Response) {
    const a = await this.prisma.analysis.findUnique({ where: { meetingId: id } });
    if (!a) throw new NotFoundException();
    const headline = String(body.headline ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const summary = String(body.summary ?? '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!headline || !summary) throw new BadRequestException('A post needs a headline and a summary');
    const data = a.data && typeof a.data === 'object' && !Array.isArray(a.data) ? (a.data as Record<string, unknown>) : {};
    await this.prisma.analysis.update({ where: { meetingId: id }, data: { data: { ...data, headline, summary } as any, editedAt: new Date() } });
    res.redirect(303, `/admin/posts/${encodeURIComponent(id)}?done=saved`);
  }

  /** Website only, whatever the meeting's date. */
  @Post('posts/:id/publish')
  @UseGuards(AdminGuard)
  async publishPost(@Param('id') id: string, @Res() res: Response) {
    const a = await this.prisma.analysis.findUnique({ where: { meetingId: id } });
    if (!a) throw new NotFoundException();
    if (!a.approvedAt) await this.pipeline.publishOnly(id);
    res.redirect(303, `/admin/posts/${encodeURIComponent(id)}?done=${a.approvedAt ? 'already-published' : 'published'}`);
  }

  /** The normal approval: older meetings are published, current ones emailed. */
  @Post('posts/:id/approve')
  @UseGuards(AdminGuard)
  async approvePost(@Param('id') id: string, @Res() res: Response) {
    const m = await this.prisma.meeting.findUnique({ where: { id }, include: { analysis: true } });
    if (!m?.analysis) throw new NotFoundException();
    if (m.analysis.approvedAt) return res.redirect(303, `/admin/posts/${encodeURIComponent(id)}?done=already-published`);
    if (!isBackfill(m) && !config.emailReady) throw new BadRequestException("Email isn't connected yet; publish on the site instead");
    await this.pipeline.approve(id);
    res.redirect(303, `/admin/posts/${encodeURIComponent(id)}?done=${isBackfill(m) ? 'published' : 'sent'}`);
  }

  @Post('posts/:id/hide')
  @UseGuards(AdminGuard)
  async hidePost(@Param('id') id: string, @Res() res: Response) {
    await this.prisma.analysis.update({ where: { meetingId: id }, data: { hiddenAt: new Date() } });
    res.redirect(303, `/admin/posts/${encodeURIComponent(id)}?done=hidden`);
  }

  @Post('posts/:id/unhide')
  @UseGuards(AdminGuard)
  async unhidePost(@Param('id') id: string, @Res() res: Response) {
    await this.prisma.analysis.update({ where: { meetingId: id }, data: { hiddenAt: null } });
    res.redirect(303, `/admin/posts/${encodeURIComponent(id)}?done=unhidden`);
  }

  @Post('posts/:id/rewrite')
  @UseGuards(AdminGuard)
  async rewritePost(@Param('id') id: string, @Res() res: Response) {
    await this.rerun(id, true);
    res.redirect(303, '/admin/posts?done=rewriting');
  }

  @Get('topics')
  @UseGuards(AdminGuard)
  async topicList(@Req() req: Request) {
    const rows = await this.topics.adminList();
    if (!String(req.headers.accept ?? '').includes('text/html')) return rows;
    return adminTopicsPage(
      rows.map((t) => ({
        ...t,
        dives: t.dives.map((d) => ({
          ...d,
          previewHref: `/admin/dives/${d.id}/preview`,
          approveHref: this.dives.approvePath(d.id),
        })),
      })),
    );
  }

  @Post('topics/:id/approve')
  @UseGuards(AdminGuard)
  async approveTopic(@Param('id') id: string, @Res() res: Response) {
    await this.prisma.topic.update({ where: { id }, data: { status: 'APPROVED' } });
    res.redirect(303, '/admin/topics');
  }

  @Post('topics/:id/archive')
  @UseGuards(AdminGuard)
  async archiveTopic(@Param('id') id: string, @Res() res: Response) {
    await this.prisma.topic.update({ where: { id }, data: { status: 'ARCHIVED' } });
    res.redirect(303, '/admin/topics');
  }

  /** Writes a deep dive from the topic's most recent meeting, without waiting for a milestone. */
  @Post('topics/:id/dive')
  @UseGuards(AdminGuard)
  async diveNow(@Param('id') id: string, @Res() res: Response) {
    const last = await this.prisma.meetingTopic.findFirst({
      where: { topicId: id },
      orderBy: { meeting: { meetingDate: 'desc' } },
      select: { meetingId: true },
    });
    if (!last) throw new NotFoundException('No meetings on this topic yet');
    await this.topics.queueDeepDive(id, last.meetingId);
    res.redirect(303, '/admin/topics');
  }

  @Post('topics/scan')
  @UseGuards(AdminGuard)
  async scanTopics(@Res() res: Response) {
    await this.controlQ.add('tag-topics', {}, { removeOnComplete: 20, removeOnFail: 20 });
    res.redirect(303, '/admin/topics');
  }

  @Get('dives/:id/preview')
  @UseGuards(AdminGuard)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async divePreview(@Param('id') id: string) {
    return renderDiveHtml(await this.dives.renderInput(id, null));
  }

  // Signed link from the review email, like recap approval: GET shows a button, POST sends.
  @Get('dives/:id/approve')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async diveApproveForm(@Param('id') id: string, @Query('sig') sig: string) {
    if (!verify(`approve-dive:${id}`, sig)) throw new ForbiddenException();
    const d = await this.prisma.deepDive.findUnique({ where: { id }, include: { topic: true } });
    if (!d) throw new NotFoundException();
    if (d.status !== 'DRAFT') return page('Already handled', `<h1>Already ${esc(d.status.toLowerCase())}</h1><p><a href="/admin/topics">Topics</a></p>`);
    const n = await this.prisma.subscriber.count({ where: { status: 'CONFIRMED', topics: { has: d.topic.slug } } });
    const headline = String((d.data as { headline?: string }).headline ?? '');
    return page('Send deep dive', `<h1>Send this deep dive?</h1><p><strong>${esc(headline)}</strong><br>Goes to ${n} subscriber${n === 1 ? '' : 's'} following ${esc(d.topic.name)}, and replaces the story on its topic page.</p>
<p><a href="/admin/dives/${esc(id)}/preview">Read it first</a></p>
<form method="post" action="/admin/dives/${esc(id)}/approve?sig=${esc(sig)}"><button type="submit">Approve and send</button></form>
<form method="post" action="/admin/dives/${esc(id)}/reject?sig=${esc(sig)}"><button type="submit" style="background:#fff;color:#141412;border:1px solid #c9c2b2">Don't send</button></form>`);
  }

  @Post('dives/:id/approve')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async diveApprove(@Param('id') id: string, @Query('sig') sig: string) {
    if (!verify(`approve-dive:${id}`, sig)) throw new ForbiddenException();
    const d = await this.prisma.deepDive.findUnique({ where: { id } });
    if (!d) throw new NotFoundException();
    if (d.status === 'DRAFT') await this.dives.approve(id);
    return page('Sending', `<h1>Sending</h1><p>The deep dive is on its way and on the topic page.</p>`);
  }

  @Post('dives/:id/reject')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async diveReject(@Param('id') id: string, @Query('sig') sig: string) {
    if (!verify(`approve-dive:${id}`, sig)) throw new ForbiddenException();
    const d = await this.prisma.deepDive.findUnique({ where: { id } });
    if (d?.status === 'DRAFT') await this.dives.reject(id);
    return page('Not sent', `<h1>Not sent</h1><p>The draft is kept but won't go out. <a href="/admin/topics">Topics</a></p>`);
  }

  /** Shows what the scraper sees on the archive page. Run this first after deploying. */
  @Get('inspect')
  @UseGuards(AdminGuard)
  inspect() {
    return this.discovery.inspect();
  }

  @Post('discover')
  @UseGuards(AdminGuard)
  async discover(@Req() req: Request, @Res() res: Response) {
    await this.controlQ.add('discover', {}, { removeOnComplete: 50 });
    if (fromBrowser(req)) return res.redirect(303, '/admin?done=discover');
    res.json({ queued: true });
  }

  @Get('meetings')
  @UseGuards(AdminGuard)
  async meetings(@Query('status') status: string | undefined, @Req() req: Request) {
    const meetings = await this.prisma.meeting.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: [{ meetingDate: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      select: {
        id: true, title: true, body: true, meetingDate: true, status: true, error: true, sourceUrl: true,
        transcript: { select: { id: true } },
        analysis: { select: { id: true } },
      },
    });
    const rows = meetings.map((m) => ({
      id: m.id,
      title: m.title,
      body: m.body,
      meetingDate: m.meetingDate,
      status: m.status,
      error: m.error,
      sourceUrl: m.sourceUrl,
      hasTranscript: Boolean(m.transcript),
      hasAnalysis: Boolean(m.analysis),
    }));
    if (!String(req.headers.accept ?? '').includes('text/html')) return rows;
    return adminMeetingsPage(
      rows.map((m) => ({
        id: m.id,
        title: m.title,
        body: m.body,
        date: formatDate(m.meetingDate),
        status: m.status,
        error: m.error,
        hasTranscript: m.hasTranscript,
        hasAnalysis: m.hasAnalysis,
        approveHref: m.status === 'AWAITING_APPROVAL' && m.hasAnalysis ? this.pipeline.approvePath(m.id) : undefined,
      })),
    );
  }

  /** Re-run (or force-run a SKIPPED meeting). Finished stages are reused. */
  @Post('meetings/:id/process')
  @UseGuards(AdminGuard)
  async process(@Param('id') id: string, @Query('reanalyze') reanalyze?: string) {
    await this.rerun(id, reanalyze === 'true');
    return { queued: true };
  }

  private async rerun(id: string, reanalyze: boolean) {
    const existing = await this.prisma.meeting.findUnique({ where: { id }, select: { id: true, meetingDate: true } });
    if (!existing) throw new NotFoundException();
    if (reanalyze) {
      // News coverage often lands days after the meeting; look again.
      await this.prisma.analysis.deleteMany({ where: { meetingId: id } });
      await this.prisma.research.deleteMany({ where: { meetingId: id } });
      await this.prisma.meetingTopic.deleteMany({ where: { meetingId: id } });
      await this.prisma.meeting.update({ where: { id }, data: { topicsAt: null } });
    }
    await this.prisma.meeting.update({ where: { id }, data: { status: 'DISCOVERED', error: null } });
    await this.discovery.enqueueProcess(id, existing.meetingDate);
  }

  @Get('meetings/:id/preview')
  @UseGuards(AdminGuard)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async preview(@Param('id') id: string) {
    try {
      return renderHtml(await this.pipeline.renderInput(id, null));
    } catch (err) {
      if (err instanceof NotFoundException) {
        return page('No recap yet', `<h1>No recap yet</h1><p>This meeting doesn't have a written recap to preview.</p>`);
      }
      throw err;
    }
  }

  @Get('meetings/:id/transcript')
  @UseGuards(AdminGuard)
  async transcript(@Param('id') id: string, @Req() req: Request) {
    const t = await this.prisma.transcript.findUnique({ where: { meetingId: id }, include: { meeting: true } });
    if (!t) throw new NotFoundException();
    if (!String(req.headers.accept ?? '').includes('text/html')) return t;
    const segments = Array.isArray(t.segments) ? (t.segments as { start?: number; speaker?: string; text?: string }[]) : [];
    return adminTranscriptPage(t.meeting, t.provider, segments);
  }

  // Signed link from the review email. GET shows a button; POST sends (so link-scanners can't trigger a send).
  @Get('meetings/:id/approve')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async approveForm(@Param('id') id: string, @Query('sig') sig: string) {
    if (!verify(`approve:${id}`, sig)) throw new ForbiddenException();
    const m = await this.prisma.meeting.findUnique({ where: { id }, include: { analysis: true } });
    if (!m) throw new NotFoundException();
    if (m.analysis?.approvedAt) return page('Already approved', `<h1>Already approved</h1><p>${esc(m.title)} went out ${esc(m.analysis.approvedAt.toISOString())}.</p>`);
    if (isBackfill(m)) {
      return page('Publish recap', `<h1>Publish this recap?</h1><p><strong>${esc(m.title)}</strong><br>An older meeting: it goes on the public notes page and is not emailed.</p>
<form method="post" action="/admin/meetings/${esc(id)}/approve?sig=${esc(sig)}"><button type="submit">Publish</button></form>`);
    }
    const n = await this.prisma.subscriber.count({ where: { status: 'CONFIRMED', recaps: true, OR: [{ bodies: { isEmpty: true } }, { bodies: { has: m.body } }] } });
    return page('Approve recap', `<h1>Send this recap?</h1><p><strong>${esc(m.title)}</strong><br>Goes to ${n} subscriber${n === 1 ? '' : 's'}.</p>
<form method="post" action="/admin/meetings/${esc(id)}/approve?sig=${esc(sig)}"><button type="submit">Approve and send</button></form>`);
  }

  @Post('meetings/:id/approve')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async approve(@Param('id') id: string, @Query('sig') sig: string) {
    if (!verify(`approve:${id}`, sig)) throw new ForbiddenException();
    const a = await this.prisma.analysis.findUnique({ where: { meetingId: id } });
    if (!a) throw new NotFoundException();
    if (!a.approvedAt) await this.pipeline.approve(id);
    const m = await this.prisma.meeting.findUnique({ where: { id } });
    if (m && isBackfill(m)) return page('Published', `<h1>Published</h1><p>The recap is on the <a href="/notes">notes page</a>. No email was sent.</p>`);
    return page('Sending', `<h1>Sending</h1><p>The recap is on its way to subscribers.</p>`);
  }

  /** Publishes every drafted recap older than EMAIL_SINCE on /notes. Sends no email. */
  @Post('publish-backfill')
  @UseGuards(AdminGuard)
  async publishBackfill(@Req() req: Request, @Res() res: Response) {
    const published = await this.pipeline.publishBackfill();
    if (fromBrowser(req)) return res.redirect(303, `/admin/posts?filter=published&done=published`);
    res.json({ published });
  }

  @Get('stats')
  @UseGuards(AdminGuard)
  async stats() {
    const [subs, meetings] = await Promise.all([
      this.prisma.subscriber.groupBy({ by: ['status'], _count: true }),
      this.prisma.meeting.groupBy({ by: ['status'], _count: true }),
    ]);
    return { subscribers: subs, meetings };
  }
}

/** Only paths inside the dashboard, so the sign-in form can't be used to bounce people elsewhere. */
function safeNext(next: unknown): string {
  const v = String(next ?? '');
  return /^\/admin(\/|\?|$)/.test(v) && !v.startsWith('/admin/login') ? v : '/admin';
}

function fromBrowser(req: Request): boolean {
  return String(req.headers.accept ?? '').includes('text/html');
}
