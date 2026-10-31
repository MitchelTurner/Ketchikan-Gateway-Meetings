import { Body, Controller, Get, Header, HttpCode, Logger, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MeetingDigest, normalizeDigest } from '../analysis/analysis.service';
import { emptyRecording } from '../analysis/empty-recording';
import { config } from '../config';
import { confirmEmail, confirmExpiresAt, confirmStillOpen, CONFIRM_HOURS } from '../email/confirm';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma.service';
import { BODIES, esc, randomToken, shortDate } from '../util';
import { timestampUrl } from '../email/render';
import type { DeepDiveArticle } from '../topics/deep-dive.service';
import {
  BADGES, badgeFor, communityGoal, confirmedReaders, ensureRefCode, FOUNDING_READERS, inviteUrl, readerNumber, REF_PATTERN, referralCount,
} from '../referrals';
import {
  bodyCheckboxes, ComingGroup, comingContext, comingIsPast, comingWho, Growth, inviteKit, meetingPage, NoteHit, noteDetailPage, noteHref, notesSearchPage, page, signupPage, signupRemember, stepList, topicCheckboxes, topicPage,
  buildTopicsBoard, topicsIndexPage, WeekBrief, weekSentence, WorkHit,
} from './page';
import { readCookie } from './stats.service';

const VALID_BODIES = new Set(BODIES.map((b) => b.name));

/** A recap readers should see. A microphone-check file is not one. */
function publicDigest(data: unknown): MeetingDigest | null {
  const d = normalizeDigest(data);
  return d && !emptyRecording(d) ? d : null;
}

const MIC_CHECK = 'This recording is only a microphone check, so there is no recap.';
const normBodies = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v ? [v] : []).map(String).filter((b) => VALID_BODIES.has(b));

/** This browser asked for the email. Not a login. Cleared when they unsubscribe. */
function rememberSignup(res: Response, req: Request, on: boolean): void {
  const secure = String(req.headers['x-forwarded-proto'] ?? '').startsWith('https') ? '; Secure' : '';
  const maxAge = on ? 365 * 24 * 3600 : 0;
  res.append('Set-Cookie', `kgb_signed=${on ? '1' : ''}; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

@Controller()
export class PublicController {
  private log = new Logger(PublicController.name);
  constructor(private prisma: PrismaService, private email: EmailService) {}

  @Get('robots.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  robots() {
    const base = process.env.PUBLIC_BASE_URL ? config.publicBaseUrl : '';
    return `User-agent: *\nDisallow: /admin\nDisallow: /confirm/\nDisallow: /preferences/\nDisallow: /unsubscribe/\n${base ? `Sitemap: ${base}/sitemap.xml\n` : ''}`;
  }

  /** Written recaps and public topics, so search engines find them without crawling the index pages. */
  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  async sitemap() {
    const base = process.env.PUBLIC_BASE_URL ? config.publicBaseUrl : '';
    const notes = await this.prisma.meeting.findMany({
      where: { analysis: { is: { hiddenAt: null } } },
      select: { id: true, updatedAt: true, analysis: { select: { data: true } } },
      orderBy: { meetingDate: 'desc' },
      take: 5000,
    });
    const topics = await this.prisma.topic.findMany({
      where: { status: { not: 'ARCHIVED' }, meetings: { some: {} } },
      select: { slug: true, updatedAt: true },
    });
    const urls = [
      `<url><loc>${esc(base)}/</loc><changefreq>daily</changefreq></url>`,
      `<url><loc>${esc(base)}/notes</loc><changefreq>daily</changefreq></url>`,
      `<url><loc>${esc(base)}/topics</loc><changefreq>weekly</changefreq></url>`,
      ...topics.map((t) => `<url><loc>${esc(base)}/topics/${esc(t.slug)}</loc><lastmod>${t.updatedAt.toISOString().slice(0, 10)}</lastmod></url>`),
      ...notes.flatMap((n) => {
        const d = publicDigest(n.analysis?.data);
        return d ? [`<url><loc>${esc(base + noteHref(n.id, d.headline))}</loc><lastmod>${n.updatedAt.toISOString().slice(0, 10)}</lastmod></url>`] : [];
      }),
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  }

  @Get('health')
  health() {
    return { ok: true };
  }

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  async home(@Req() req: Request) {
    const [recent, work, archiveCount, growth, week, coming] = await Promise.all([
      this.publishedHits('', '', 5),
      this.workHits(),
      this.prisma.meeting.count(),
      this.growth(req),
      this.weekBrief(),
      this.comingUp(),
    ]);
    return signupPage(recent, work, archiveCount, shortDate(config.processSince, false) || 'the last two weeks', await this.topicOptions(), growth, week, coming);
  }

  /**
   * Meetings from the last seven days. When the Borough did not meet, the seven days
   * ending on the newest written recap, so the paragraph still says what happened.
   */
  private async weekBrief(): Promise<WeekBrief | null> {
    const meetings = await this.prisma.meeting.findMany({
      where: { analysis: { is: { hiddenAt: null } }, meetingDate: { not: null } },
      include: { analysis: true },
      orderBy: [{ meetingDate: 'desc' }, { createdAt: 'desc' }],
      take: 15,
    });
    const rows = meetings.flatMap((m) => {
      const digest = m.meetingDate ? publicDigest(m.analysis?.data) : null;
      const sentence = digest ? weekSentence(digest.headline) : '';
      return digest && m.meetingDate && sentence ? [{ at: m.meetingDate, href: noteHref(m.id, digest.headline), sentence }] : [];
    });
    if (!rows.length) return null;
    const today = zonedNoon(config.timezone);
    const inLastWeek = rows.filter((r) => dayStamp(r.at) >= dayStamp(today) - 6 * 86400000);
    const current = inLastWeek.length > 0;
    const picked = current ? inLastWeek : rows.filter((r) => dayStamp(r.at) >= dayStamp(rows[0].at) - 6 * 86400000);
    const items = picked.slice(0, 5).sort((a, b) => a.at.getTime() - b.at.getTime());
    return { current, span: spanLabel(items.map((r) => r.at)), items: items.map(({ href, sentence }) => ({ href, sentence })) };
  }

  /** The next hearings and deadlines named in the newest written recaps, grouped by the meeting that set them. */
  private async comingUp(): Promise<ComingGroup[]> {
    const meetings = await this.prisma.meeting.findMany({
      where: { analysis: { is: { hiddenAt: null } } },
      include: { analysis: true },
      orderBy: [{ meetingDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 8,
    });
    const today = zonedNoon(config.timezone);
    const groups: ComingGroup[] = [];
    for (const m of meetings) {
      const digest = publicDigest(m.analysis?.data);
      if (!digest) continue;
      const seen = new Set<string>();
      const items: ComingGroup['items'] = [];
      for (const upcoming of digest.upcoming) {
        const item = upcoming.item.replace(/\s+/g, ' ').trim();
        const key = item.toLowerCase();
        if (!key || seen.has(key)) continue;
        const when = (upcoming.when ?? '').replace(/\s+/g, ' ').trim();
        if (comingIsPast(when, m.meetingDate, today)) continue;
        seen.add(key);
        items.push({ item, when });
        if (items.length >= 4) break;
      }
      if (!items.length) continue;
      groups.push({
        headline: digest.headline,
        href: noteHref(m.id, digest.headline),
        who: comingWho(m.title, m.body),
        date: shortDate(m.meetingDate, false),
        context: comingContext(digest.summary),
        items,
      });
      if (groups.length >= 3) break;
    }
    return groups;
  }

  /** Readers so far, the next goal, and the invite this visitor came in on (link first, then the remembered cookie). */
  private async growth(req: Request): Promise<Growth> {
    const readers = await confirmedReaders(this.prisma);
    return { readers, goal: communityGoal(readers), ref: inviteCode(req) };
  }

  /** Written recaps, newest first. Review still gates email; hidden recaps stay off this list. */
  @Get('notes')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async notes(@Query('q') q?: string, @Query('body') body?: string) {
    const query = String(q ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const bodyName = VALID_BODIES.has(String(body ?? '')) ? String(body) : '';
    return notesSearchPage(query, bodyName, await this.publishedHits(query, bodyName, 40));
  }

  private topicOptions() {
    return this.prisma.topic.findMany({ where: { status: 'APPROVED' }, select: { slug: true, name: true }, orderBy: { name: 'asc' } });
  }

  /** Any topic still on the site, including ones waiting for approval. Archived names are dropped. */
  private followableSlugs() {
    return this.prisma.topic.findMany({ where: { status: { not: 'ARCHIVED' } }, select: { slug: true, name: true } });
  }

  private async normTopics(v: unknown): Promise<string[]> {
    const wanted = (Array.isArray(v) ? v : v ? [v] : []).map(String);
    if (!wanted.length) return [];
    const valid = new Set((await this.followableSlugs()).map((t) => t.slug));
    return [...new Set(wanted.filter((t) => valid.has(t)))];
  }

  /** Signup lists approved topics. Preferences also keeps any issue this reader already follows. */
  private async topicChoices(selected: string[]) {
    const approved = await this.topicOptions();
    const known = new Set(approved.map((t) => t.slug));
    const extra = selected.filter((s) => !known.has(s));
    if (!extra.length) return approved;
    const more = (await this.followableSlugs()).filter((t) => extra.includes(t.slug));
    return [...approved, ...more].sort((a, b) => a.name.localeCompare(b.name));
  }

  @Get('topics')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async topics(@Query('q') q?: string) {
    const query = String(q ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const topics = await this.prisma.topic.findMany({
      where: { status: { not: 'ARCHIVED' }, meetings: { some: {} } },
      include: { meetings: { include: { meeting: { select: { meetingDate: true, analysis: { select: { hiddenAt: true, data: true } } } } } } },
    });
    const rows = topics.flatMap((t) => {
      const visible = t.meetings.filter((l) => !l.meeting.analysis?.hiddenAt && !emptyRecording(normalizeDigest(l.meeting.analysis?.data)));
      if (!visible.length) return [];
      const latest = [...visible].sort((a, b) => (b.meeting.meetingDate?.getTime() ?? 0) - (a.meeting.meetingDate?.getTime() ?? 0))[0];
      return [{
        slug: t.slug,
        name: t.name,
        description: t.description,
        meetings: visible.length,
        latest: latest?.summary ?? '',
        dates: visible.flatMap((l) => (l.meeting.meetingDate ? [l.meeting.meetingDate] : [])),
      }];
    });
    return topicsIndexPage(buildTopicsBoard(rows, zonedNoon(config.timezone)), query);
  }

  @Get('topics/:slug')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async topic(@Param('slug') slug: string) {
    const topic = await this.prisma.topic.findUnique({
      where: { slug },
      include: {
        meetings: { include: { meeting: { include: { analysis: { select: { approvedAt: true, hiddenAt: true, data: true } } } } } },
        deepDives: { where: { status: 'SENT' }, orderBy: { approvedAt: 'desc' }, take: 1 },
      },
    });
    if (!topic || topic.status === 'ARCHIVED') {
      return page('Topic not found', `<h1>That topic isn't here</h1><p><a href="/topics">See every topic</a>.</p>`);
    }
    const byId = new Map(topic.meetings.map((l) => [l.meetingId, l.meeting]));
    const rows = topic.meetings
      .filter((l) => !l.meeting.analysis?.hiddenAt && !emptyRecording(normalizeDigest(l.meeting.analysis?.data)))
      .sort((a, b) => (a.meeting.meetingDate?.getTime() ?? 0) - (b.meeting.meetingDate?.getTime() ?? 0))
      .map((l) => {
        const digest = publicDigest(l.meeting.analysis?.data);
        return {
          meetingId: l.meetingId,
          body: l.meeting.body,
          date: shortDate(l.meeting.meetingDate, false),
          summary: l.summary,
          milestone: l.milestone,
          why: l.why,
          href: digest ? noteHref(l.meetingId, digest.headline) : `/meetings/${l.meetingId}`,
          videoHref: timestampUrl(l.meeting.sourceUrl, l.meeting.platform, l.t),
        };
      });
    const d = topic.deepDives[0];
    const dive = d
      ? {
          article: d.data as unknown as DeepDiveArticle,
          date: d.approvedAt ?? d.createdAt,
          videoAt: (meetingId: string, t: number) => {
            const m = byId.get(meetingId);
            return m ? timestampUrl(m.sourceUrl, m.platform, t) : `/meetings/${meetingId}`;
          },
        }
      : null;
    return topicPage(topic, rows, dive, await this.topicOptions());
  }

  /**
   * Newest meetings, plus a few more of each body so a filter is not an empty list.
   * The default docket is the newest handful; the rest appear when that body is chosen.
   */
  private async workHits(): Promise<WorkHit[]> {
    const meetings = await this.prisma.meeting.findMany({
      where: { status: { not: 'SKIPPED' }, NOT: { analysis: { is: { hiddenAt: { not: null } } } } },
      include: { transcript: { select: { id: true } }, analysis: true },
      orderBy: [{ meetingDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 200,
    });
    const mapped = meetings.map((m) => {
      const digest = publicDigest(m.analysis?.data);
      return {
        id: m.id,
        title: m.title,
        body: m.body,
        date: shortDate(m.meetingDate),
        status: m.status,
        headline: digest?.headline ?? '',
        summary: digest?.summary.split(/\n\s*\n/)[0] ?? '',
      };
    });
    const featured = new Set(mapped.slice(0, 12).map((m) => m.id));
    const perBody = new Map<string, number>();
    const kept = mapped.filter((m) => {
      const n = perBody.get(m.body) ?? 0;
      if (!featured.has(m.id) && n >= 8) return false;
      perBody.set(m.body, n + 1);
      return true;
    });
    return kept.map((m) => ({ ...m, featured: featured.has(m.id) }));
  }

  @Get('meetings/:id')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async meeting(@Param('id') id: string) {
    const m = await this.prisma.meeting.findUnique({ where: { id }, include: { transcript: true, analysis: true } });
    if (!m || m.analysis?.hiddenAt) return page('Not found', `<h1>That meeting isn't here</h1><p><a href="/">Back home</a></p>`);
    const segments = Array.isArray(m.transcript?.segments)
      ? (m.transcript.segments as { start?: number; speaker?: string; text?: string }[])
      : [];
    const raw = normalizeDigest(m.analysis?.data);
    const empty = !!raw && emptyRecording(raw);
    return meetingPage(m, empty ? null : raw, Boolean(m.analysis?.approvedAt), segments, empty ? MIC_CHECK : '');
  }

  /** Written recaps that aren't hidden, newest meeting date first. A query searches within that order. */
  private async publishedHits(query: string, bodyName: string, limit: number): Promise<NoteHit[]> {
    const meetings = await this.prisma.meeting.findMany({
      where: {
        analysis: { is: { hiddenAt: null } },
        ...(bodyName ? { body: bodyName } : {}),
      },
      include: { analysis: true },
      orderBy: [{ meetingDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: query ? 1000 : limit,
    });
    const hits: NoteHit[] = [];
    for (const m of meetings) {
      const digest = publicDigest(m.analysis?.data);
      if (!digest) continue;
      const plain = notePlain(m.title, m.body, digest);
      if (query && !plain.toLowerCase().includes(query.toLowerCase())) continue;
      hits.push({
        id: m.id,
        title: m.title,
        body: m.body,
        date: shortDate(m.meetingDate),
        headline: digest.headline,
        snippet: snippet(query ? plain : digest.summary, query),
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  /** The slug only makes the URL readable; the id finds the note. */
  @Get(['notes/:id', 'notes/:id/:slug'])
  @Header('Content-Type', 'text/html; charset=utf-8')
  async note(@Param('id') id: string, @Req() req: Request) {
    const m = await this.prisma.meeting.findUnique({ where: { id }, include: { analysis: true } });
    const raw = m?.analysis && !m.analysis.hiddenAt ? normalizeDigest(m.analysis.data) : null;
    if (m && raw && emptyRecording(raw)) return meetingPage(m, null, false, [], MIC_CHECK);
    if (!m || !raw) {
      return page('Note not found', `<h1>That note isn't up yet</h1><p>Recaps appear here once they've been written. <a href="/notes">Back to search</a>.</p>`);
    }
    return noteDetailPage(m, raw, { growth: await this.growth(req), draft: !m.analysis?.approvedAt });
  }

  /**
   * Double opt-in. An address that's already confirmed gets the same "check your inbox"
   * reply as a new signup, without another email. A send failure gets its own page —
   * saying the message went out would be false.
   */
  @Post('subscribe')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async subscribe(
    @Body() body: { email?: string; bodies?: string | string[]; topics?: string | string[]; topicOnly?: string; ref?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return page('Check your email address', `<h1>That email doesn't look right</h1><p><a href="/">Go back</a> and try again.</p>`);
    }
    const bodies = normBodies(body.bodies);
    const topics = await this.normTopics(body.topics);
    const recaps = body.topicOnly !== '1';
    const existing = await this.prisma.subscriber.findUnique({ where: { email } });
    if (existing?.status === 'CONFIRMED' && topics.length) {
      // Don't change a confirmed subscriber's mail from a public form; send them their own settings link.
      const url = `${config.publicBaseUrl}/preferences/${existing.token}`;
      try {
        await this.email.send({
          to: email,
          subject: `Choose your ${config.newsletterName} topics`,
          html: `<p>You're already subscribed. Pick the topics you want to follow here:</p><p><a href="${esc(url)}">${esc(url)}</a></p><p style="color:#5b6675;font-size:12px">${esc(config.mailingAddress)}</p>`,
          text: `You're already subscribed. Pick your topics: ${url}\n\n${config.mailingAddress}`,
        });
      } catch (err) {
        this.log.error(`Preferences email failed: ${(err as Error).message}`);
      }
    }
    if (existing?.status !== 'CONFIRMED') {
      // Credit goes to a confirmed reader's link, never your own, and the first invite a person used keeps it.
      const code = REF_PATTERN.test(String(body.ref ?? '')) ? String(body.ref) : inviteCode(req);
      const inviter = code ? await this.prisma.subscriber.findFirst({ where: { refCode: code }, select: { id: true, email: true, confirmedAt: true } }) : null;
      const referredById = inviter?.confirmedAt && inviter.email !== email ? inviter.id : null;
      const expires = confirmExpiresAt();
      const sub = existing
        ? await this.prisma.subscriber.update({
            where: { email },
            data: { status: 'PENDING', bodies, topics, recaps, token: randomToken(), confirmExpiresAt: expires, ...(existing.referredById || !referredById ? {} : { referredById }) },
          })
        : await this.prisma.subscriber.create({ data: { email, bodies, topics, recaps, token: randomToken(), confirmExpiresAt: expires, referredById } });
      try {
        const url = `${config.publicBaseUrl}/confirm/${sub.token}`;
        const message = confirmEmail({ url, siteUrl: config.publicBaseUrl, mailingAddress: config.mailingAddress });
        await this.email.send({ to: email, subject: message.subject, html: message.html, text: message.text });
      } catch (err) {
        this.log.error(`Confirmation email failed: ${(err as Error).message}`);
        res.status(502);
        return page(
          "Email didn't send",
          `<h1>We couldn't send the confirmation</h1><p>Your address is saved, but the confirmation email didn't go out. Recaps start after that message arrives, so <a href="/">try again</a> in a few minutes.</p>`,
        );
      }
    }
    rememberSignup(res, req, true);
    return page(
      'Check your inbox',
      `<h1>Check your inbox</h1><p>We sent a confirmation link to <strong>${esc(email)}</strong>. Recaps start once you tap it.</p>${stepList(2)}<p class="hint">Nothing there? Check spam or promotions, or <a href="/">sign up again</a>.</p>${signupRemember(true)}`,
    );
  }

  @Get('confirm/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async confirm(@Param('token') token: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    let sub = await this.prisma.subscriber.findUnique({ where: { token } });
    if (!sub) return page('Link expired', `<h1>That link didn't work</h1><p><a href="/">Sign up again</a>.</p>`);
    if (sub.status !== 'CONFIRMED' && !confirmStillOpen(sub.confirmExpiresAt)) {
      return page('Link expired', `<h1>That link expired</h1><p>Confirmation links last ${CONFIRM_HOURS} hours. <a href="/">Sign up again</a>.</p>`);
    }
    if (sub.status !== 'CONFIRMED') {
      const firstTime = !sub.confirmedAt;
      sub = await this.prisma.subscriber.update({ where: { id: sub.id }, data: { status: 'CONFIRMED', confirmedAt: sub.confirmedAt ?? new Date() } });
      if (firstTime && sub.referredById) await this.thankInviter(sub.referredById);
    }
    const readerNo = await readerNumber(this.prisma, sub.confirmedAt!);
    rememberSignup(res, req, true);
    return page(
      'Subscribed',
      `<h1>You're subscribed</h1>${stepList(3)}
<div class="reader-no"><span>You are reader</span><strong>#${readerNo.toLocaleString('en-US')}</strong><span>of ${esc(config.newsletterName)}</span></div>
<p>The next recap arrives after the next Borough meeting is posted. Meanwhile, <a href="/notes">read the latest recaps</a>.</p>
${await this.kit(sub)}${signupRemember(true)}`,
      true,
    );
  }

  /** Personal invite link and badges for a subscriber's own pages. */
  private async kit(sub: { id: string; refCode: string | null; confirmedAt: Date | null }): Promise<string> {
    if (!sub.confirmedAt) return '';
    const [code, count, readerNo] = await Promise.all([
      ensureRefCode(this.prisma, sub),
      referralCount(this.prisma, sub.id),
      readerNumber(this.prisma, sub.confirmedAt),
    ]);
    return inviteKit({ url: inviteUrl(code), count, readerNo, badges: BADGES, foundingLimit: FOUNDING_READERS });
  }

  /** Tells a reader their invite worked. Only on a new confirmation, and never blocks it. */
  private async thankInviter(inviterId: string) {
    if (!config.emailReady) return;
    try {
      const inviter = await this.prisma.subscriber.findUnique({ where: { id: inviterId } });
      if (!inviter || inviter.status !== 'CONFIRMED') return;
      const count = await referralCount(this.prisma, inviter.id);
      const badge = badgeFor(count);
      const earned = badge && badge.at === count ? badge : null;
      const url = `${config.publicBaseUrl}/preferences/${inviter.token}#invite`;
      const headline = earned ? `You're now a ${earned.name}` : 'A neighbor joined through your link';
      const merchHtml = earned?.merch
        ? `<p>You've earned a ${esc(earned.merch)}. Reply to this email with a shipping address and we'll mail it.</p>`
        : '';
      const merchText = earned?.merch ? `\n\nYou've earned a ${earned.merch}. Reply with a shipping address and we'll mail it.` : '';
      await this.email.send({
        to: inviter.email,
        subject: `${headline} · ${config.newsletterName}`,
        html: `<p style="font-size:18px"><strong>${esc(headline)}.</strong></p><p>Someone you invited just confirmed their subscription to ${esc(config.newsletterName)}. That's ${count} neighbor${count === 1 ? '' : 's'} reading because of you.</p>${merchHtml}<p><a href="${esc(url)}">See your badges and invite link</a></p><p style="color:#5b6675;font-size:12px">We never tell you who signed up. ${esc(config.mailingAddress)}</p>`,
        text: `${headline}. Someone you invited just confirmed. That's ${count} neighbor${count === 1 ? '' : 's'} reading because of you.${merchText}\n\nYour badges and invite link: ${url}\n\n${config.mailingAddress}`,
      });
    } catch (err) {
      this.log.warn(`Invite thank-you not sent: ${(err as Error).message}`);
    }
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
  async unsubscribe(@Param('token') token: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.prisma.subscriber.updateMany({ where: { token }, data: { status: 'UNSUBSCRIBED' } });
    rememberSignup(res, req, false);
    return page('Unsubscribed', `<h1>You're unsubscribed</h1><p>You won't get any more recaps. <a href="/">Changed your mind?</a></p>${signupRemember(false)}`);
  }

  @Get('preferences/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async prefsForm(@Param('token') token: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sub = await this.prisma.subscriber.findUnique({ where: { token } });
    if (!sub) return page('Not found', `<h1>That link didn't work</h1>`);
    const on = sub.status !== 'UNSUBSCRIBED';
    if (on) rememberSignup(res, req, true);
    return page(
      'Your email',
      `<h1>Your subscription</h1>${sub.status === 'CONFIRMED' ? await this.kit(sub) : ''}<h2 class="section">What you get</h2><form method="post" action="/preferences/${esc(token)}">
<label class="check" style="display:flex;gap:10px;align-items:center;font-size:15px"><input type="checkbox" name="recaps" value="1"${sub.recaps ? ' checked' : ''}> A recap after each meeting</label>
${bodyCheckboxes(sub.bodies)}${topicCheckboxes(await this.topicChoices(sub.topics), sub.topics)}<button type="submit">Save</button></form>${on ? signupRemember(true) : ''}`,
      true,
    );
  }

  @Post('preferences/:token')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async prefsSave(
    @Param('token') token: string,
    @Body() body: { bodies?: string | string[]; topics?: string | string[]; recaps?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sub = await this.prisma.subscriber.findUnique({ where: { token }, select: { status: true } });
    await this.prisma.subscriber.updateMany({
      where: { token },
      data: { bodies: normBodies(body.bodies), topics: await this.normTopics(body.topics), recaps: body.recaps === '1' },
    });
    const on = !!sub && sub.status !== 'UNSUBSCRIBED';
    if (on) rememberSignup(res, req, true);
    return page('Saved', `<h1>Saved</h1><p>Your choices are updated.</p>${on ? signupRemember(true) : ''}`);
  }
}

/** Noon UTC on the calendar day in the given zone, so it lines up with meeting dates stored at UTC noon. */
function zonedNoon(timeZone: string, date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(Date.UTC(num('year'), num('month') - 1, num('day'), 12));
}

function dayStamp(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function spanLabel(dates: Date[]): string {
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first) return '';
  if (!last || fmt(first) === fmt(last)) return fmt(first);
  if (dates.length === 2) return `${fmt(first)} and ${fmt(last)}`;
  if (first.getUTCMonth() === last.getUTCMonth() && first.getUTCFullYear() === last.getUTCFullYear()) {
    return `${fmt(first).replace(/ \d+$/, '')} ${first.getUTCDate()}–${last.getUTCDate()}`;
  }
  return `${fmt(first)}–${fmt(last)}`;
}

function notePlain(title: string, body: string, d: MeetingDigest): string {
  return [
    title,
    body,
    d.headline,
    d.summary,
    ...(d.actions ?? []).flatMap((a) => (a ? [a.item, a.outcome, a.vote] : [])),
    ...(d.discussion ?? []).flatMap((x) => (x ? [x.topic, x.gist] : [])),
    ...(d.publicComment ?? []).flatMap((x) => (x ? [x.who, x.topic, x.gist] : [])),
    ...(d.upcoming ?? []).flatMap((x) => (x ? [x.item, x.when] : [])),
    ...(d.caveats ?? []),
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

function inviteCode(req: Request): string | undefined {
  const fromLink = typeof req.query.r === 'string' ? req.query.r : '';
  if (REF_PATTERN.test(fromLink)) return fromLink;
  const remembered = readCookie(req.headers.cookie, 'kgb_ref');
  return REF_PATTERN.test(remembered) ? remembered : undefined;
}
