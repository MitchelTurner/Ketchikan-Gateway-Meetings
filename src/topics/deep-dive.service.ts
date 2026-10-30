import Anthropic from '@anthropic-ai/sdk';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { normalizeDigest } from '../analysis/analysis.service';
import { config } from '../config';
import { EmailService } from '../email/email.service';
import { renderDiveHtml, renderDiveSubject, renderDiveText, DiveRenderInput } from '../email/dive-render';
import { PrismaService } from '../prisma.service';
import { Q_EMAIL } from '../queues';
import { normalizeContext } from '../research/research.service';
import { esc, formatDate, shortDate, sign } from '../util';

/** One topic, told across every meeting that touched it. */
export interface DeepDiveArticle {
  headline: string;
  dek: string;
  whyItMatters: string;
  latest: string;
  timeline: { meetingId: string; date: string; body: string; what: string; t: number; milestone: boolean }[];
  residents: { who: string; gist: string; meetingId: string; t: number }[];
  whatsNext: { item: string; when?: string }[];
  background: { point: string; sources: string[] }[];
  caveats: string[];
}

const SYSTEM = `You write a deep dive on one issue in the Ketchikan Gateway Borough for residents who asked to follow it by email.

You get the topic, the meeting that just produced a big development, and notes from every meeting that touched the topic, oldest first, each labeled [M1], [M2]…, plus any local news coverage.

Write for every resident, including people who have never been to a meeting: about an 8th-grade reading level, short sentences, everyday words, and explain process terms ("second reading", "mill rate", "conditional use permit") in a few words. Report only what the notes and articles say. Never infer motives, never predict outcomes, never take a side. Keep votes, dollar figures and dates exactly as given; if something is unclear, say so and add a caveat.

- headline: under 70 characters, names the issue and the new development in words a resident would search for.
- dek: one sentence under the headline.
- whyItMatters: one short paragraph on what is at stake for residents (cost, place, timing), only from the notes.
- latest: one short paragraph on what happened at the meeting that triggered this.
- timeline: the story so far, oldest first, one entry per meeting that moved it forward. "meeting" is the label ([M3] → "M3"), "t" comes from that meeting's notes.
- residents: up to 6 points residents made in public comment across meetings, fairly summarized, including views you might disagree with.
- whatsNext: scheduled votes, hearings, deadlines.
- background: context from the news articles only, each citing its URL exactly as listed. Never present news as something said at a meeting.`;

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', additionalProperties: false, properties, required });
const DIVE_FORMAT: Anthropic.JSONOutputFormat = {
  type: 'json_schema',
  schema: obj(
    {
      headline: { type: 'string' },
      dek: { type: 'string' },
      whyItMatters: { type: 'string' },
      latest: { type: 'string' },
      timeline: { type: 'array', items: obj({ meeting: { type: 'string' }, what: { type: 'string' }, t: { type: 'number' } }, ['meeting', 'what', 't']) },
      residents: {
        type: 'array',
        items: obj({ who: { type: 'string' }, gist: { type: 'string' }, meeting: { type: 'string' }, t: { type: 'number' } }, ['who', 'gist', 'meeting', 't']),
      },
      whatsNext: { type: 'array', items: obj({ item: { type: 'string' }, when: { type: 'string' } }, ['item', 'when']) },
      background: { type: 'array', items: obj({ point: { type: 'string' }, sources: { type: 'array', items: { type: 'string' } } }, ['point', 'sources']) },
      caveats: { type: 'array', items: { type: 'string' } },
    },
    ['headline', 'dek', 'whyItMatters', 'latest', 'timeline', 'residents', 'whatsNext', 'background', 'caveats'],
  ),
};

@Injectable()
export class DeepDiveService {
  private log = new Logger(DeepDiveService.name);
  private client?: Anthropic;
  private get anthropic() {
    return (this.client ??= new Anthropic({ apiKey: config.anthropicKey }));
  }

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    @InjectQueue(Q_EMAIL) private emailQ: Queue,
  ) {}

  /** Drafts the deep dive for a milestone, then sends it for review (or straight out with AUTO_SEND). */
  async write(topicId: string, triggerMeetingId: string): Promise<string | null> {
    const existing = await this.prisma.deepDive.findUnique({ where: { topicId_triggerMeetingId: { topicId, triggerMeetingId } } });
    if (existing) return existing.id;
    const topic = await this.prisma.topic.findUniqueOrThrow({ where: { id: topicId } });
    if (topic.status !== 'APPROVED') return null;

    const links = await this.prisma.meetingTopic.findMany({
      where: { topicId },
      include: { meeting: { include: { analysis: true, research: true } } },
    });
    // The newest 30 meetings carry the story; older ones are summarized by what came after.
    const rows = links
      .filter((l) => l.meeting.analysis)
      .sort((a, b) => (a.meeting.meetingDate?.getTime() ?? 0) - (b.meeting.meetingDate?.getTime() ?? 0))
      .slice(-30);
    if (!rows.some((r) => r.meetingId === triggerMeetingId)) return null;

    const labels = new Map(rows.map((r, i) => [`M${i + 1}`, r.meeting]));
    const notes = rows.map((r, i) => {
      const d = normalizeDigest(r.meeting.analysis?.data);
      const items = d
        ? [
            ...d.actions.map((a) => `  decision [t=${a.t}]: ${a.item} — ${a.outcome}${a.vote ? ` (${a.vote})` : ''}`),
            ...d.discussion.map((x) => `  discussion [t=${x.t}]: ${x.topic}: ${x.gist}`),
            ...d.publicComment.map((x) => `  public comment [t=${x.t}]: ${x.who} on ${x.topic}: ${x.gist}`),
            ...d.upcoming.map((x) => `  coming up: ${x.item}${x.when ? ` (${x.when})` : ''}`),
          ]
        : [];
      return [
        `[M${i + 1}] ${r.meeting.body}, ${formatDate(r.meeting.meetingDate) || 'date unknown'}${r.meetingId === triggerMeetingId ? '  ← THIS MEETING TRIGGERED THE DEEP DIVE' : ''}`,
        `  On this topic [t=${r.t}]${r.milestone ? ' (milestone)' : ''}: ${r.summary}`,
        ...items,
      ].join('\n');
    });
    const articles = new Map<string, { title: string; outlet: string; date: string; summary: string }>();
    for (const r of rows) for (const a of normalizeContext(r.meeting.research?.data).articles) articles.set(a.url, a);

    const res = await this.anthropic.messages
      .stream({
        model: config.anthropicModel,
        max_tokens: 32000,
        system: SYSTEM,
        output_config: { effort: 'medium', format: DIVE_FORMAT },
        messages: [
          {
            role: 'user',
            content: [
              `Topic: ${topic.name}`,
              `About: ${topic.description}`,
              '',
              `<meetings>\n${notes.join('\n\n')}\n</meetings>`,
              articles.size
                ? `\n<news>\n${[...articles].map(([url, a]) => `- [${a.outlet}${a.date ? `, ${a.date}` : ''}] ${a.title}\n  URL: ${url}\n  ${a.summary}`).join('\n')}\n</news>`
                : '',
            ].join('\n'),
          },
        ],
      })
      .finalMessage();
    if (res.stop_reason !== 'end_turn') throw new Error(`Deep dive stopped: ${res.stop_reason}`);
    const raw = JSON.parse(res.content.map((b) => (b.type === 'text' ? b.text : '')).join('') || '{}');
    const milestones = new Set(rows.filter((r) => r.milestone).map((r) => r.meetingId));
    const article = toArticle(raw, labels, articles, milestones);
    if (!article.headline) throw new Error('Deep dive came back without a headline');

    const dive = await this.prisma.deepDive.create({
      data: { topicId, triggerMeetingId, model: config.anthropicModel, data: article as any },
    });
    this.log.log(`Deep dive drafted: ${topic.name} — ${article.headline}`);
    if (config.autoSend && config.emailReady) await this.approve(dive.id);
    else if (config.emailReady) await this.sendReview(dive.id).catch((err) => this.log.error(`Deep dive review email failed: ${err.message}`));
    return dive.id;
  }

  approvePath(diveId: string) {
    return `/admin/dives/${diveId}/approve?sig=${sign(`approve-dive:${diveId}`)}`;
  }

  private async sendReview(diveId: string) {
    const input = await this.renderInput(diveId, null);
    const n = await this.audience(input.topic.slug);
    input.banner = `<div style="background:#fff7e0;border:1px solid #e8c766;border-radius:8px;padding:14px 16px;margin-bottom:16px;font-size:14px;line-height:1.5">
<strong>Deep dive preview — not sent yet.</strong><br>Goes to ${n} subscriber${n === 1 ? '' : 's'} following ${esc(input.topic.name)}.
<a href="${esc(config.publicBaseUrl + this.approvePath(diveId))}" style="color:#0b5d7a;font-weight:600">Approve and send</a>.</div>`;
    await this.email.send({
      to: config.adminEmail,
      subject: `[Review] ${renderDiveSubject(input)}`,
      html: renderDiveHtml(input),
      text: `Approve: ${config.publicBaseUrl}${this.approvePath(diveId)}\n\n${renderDiveText(input)}`,
    });
  }

  private audience(slug: string) {
    return this.prisma.subscriber.count({ where: { status: 'CONFIRMED', topics: { has: slug } } });
  }

  /** Publishes the deep dive on its topic page and emails everyone following the topic. */
  async approve(diveId: string) {
    const dive = await this.prisma.deepDive.update({
      where: { id: diveId },
      data: { approvedAt: new Date(), status: 'SENDING' },
      include: { topic: true },
    });
    const subs = await this.prisma.subscriber.findMany({
      where: { status: 'CONFIRMED', topics: { has: dive.topic.slug } },
      select: { id: true },
    });
    await this.prisma.topicSend.createMany({ data: subs.map((s) => ({ deepDiveId: diveId, subscriberId: s.id })), skipDuplicates: true });
    await this.emailQ.addBulk(
      subs.map((s) => ({
        name: 'send-dive',
        data: { deepDiveId: diveId, subscriberId: s.id },
        opts: { jobId: `dive-${diveId}-${s.id}`, attempts: 4, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 1000 },
      })),
    );
    await this.prisma.deepDive.update({ where: { id: diveId }, data: { status: 'SENT' } });
    await this.prisma.topic.update({ where: { id: dive.topicId }, data: { updatedAt: new Date() } });
    this.log.log(`Queued ${subs.length} deep-dive emails for ${dive.topic.name}`);
  }

  async reject(diveId: string) {
    await this.prisma.deepDive.update({ where: { id: diveId }, data: { status: 'REJECTED' } });
  }

  async sendOne(deepDiveId: string, subscriberId: string) {
    const rec = await this.prisma.topicSend.findUnique({ where: { deepDiveId_subscriberId: { deepDiveId, subscriberId } } });
    if (rec?.status === 'sent') return;
    const sub = await this.prisma.subscriber.findUniqueOrThrow({ where: { id: subscriberId } });
    if (sub.status !== 'CONFIRMED') return;
    const input = await this.renderInput(deepDiveId, sub.token);
    try {
      const providerId = await this.email.send({
        to: sub.email,
        subject: renderDiveSubject(input),
        html: renderDiveHtml(input),
        text: renderDiveText(input),
        unsubscribeUrl: input.unsubscribeUrl,
      });
      await this.prisma.topicSend.update({ where: { deepDiveId_subscriberId: { deepDiveId, subscriberId } }, data: { status: 'sent', providerId, error: null } });
    } catch (err) {
      await this.prisma.topicSend.update({
        where: { deepDiveId_subscriberId: { deepDiveId, subscriberId } },
        data: { status: 'failed', error: (err as Error).message.slice(0, 1000) },
      });
      throw err;
    }
  }

  async renderInput(diveId: string, subscriberToken: string | null): Promise<DiveRenderInput> {
    const dive = await this.prisma.deepDive.findUnique({ where: { id: diveId }, include: { topic: true } });
    if (!dive) throw new NotFoundException();
    const base = config.publicBaseUrl;
    const meetings = await this.prisma.meeting.findMany({
      where: { id: { in: (dive.data as unknown as DeepDiveArticle).timeline.map((x) => x.meetingId).concat(dive.triggerMeetingId) } },
      select: { id: true, sourceUrl: true, platform: true },
    });
    return {
      topic: dive.topic,
      article: dive.data as unknown as DeepDiveArticle,
      meetings: new Map(meetings.map((m) => [m.id, m])),
      baseUrl: base,
      newsletterName: config.newsletterName,
      mailingAddress: config.mailingAddress,
      unsubscribeUrl: subscriberToken ? `${base}/unsubscribe/${subscriberToken}` : `${base}/`,
      preferencesUrl: subscriberToken ? `${base}/preferences/${subscriberToken}` : `${base}/`,
    };
  }
}

/** Maps [M3] labels back to meetings and drops anything the model could not have sourced. */
function toArticle(
  raw: any,
  labels: Map<string, { id: string; meetingDate: Date | null; body: string }>,
  articles: Map<string, unknown>,
  milestones: Set<string>,
): DeepDiveArticle {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const arr = (v: unknown): any[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  const meeting = (label: unknown) => labels.get(str(label).replace(/[\[\]\s]/g, '').toUpperCase());
  return {
    headline: str(raw?.headline),
    dek: str(raw?.dek),
    whyItMatters: str(raw?.whyItMatters),
    latest: str(raw?.latest),
    timeline: arr(raw?.timeline).flatMap((x) => {
      const m = meeting(x.meeting);
      return m && str(x.what)
        ? [{ meetingId: m.id, date: shortDate(m.meetingDate, false), body: m.body, what: str(x.what), t: num(x.t), milestone: milestones.has(m.id) }]
        : [];
    }),
    residents: arr(raw?.residents).flatMap((x) => {
      const m = meeting(x.meeting);
      return m && str(x.gist) ? [{ who: str(x.who) || 'A resident', gist: str(x.gist), meetingId: m.id, t: num(x.t) }] : [];
    }),
    whatsNext: arr(raw?.whatsNext)
      .map((x) => ({ item: str(x.item), ...(str(x.when) ? { when: str(x.when) } : {}) }))
      .filter((x) => x.item),
    background: arr(raw?.background)
      .map((x) => ({ point: str(x.point), sources: (Array.isArray(x.sources) ? x.sources : []).map(str).filter((u: string) => articles.has(u)) }))
      .filter((x) => x.point && x.sources.length),
    caveats: (Array.isArray(raw?.caveats) ? raw.caveats : []).map(str).filter(Boolean),
  };
}
