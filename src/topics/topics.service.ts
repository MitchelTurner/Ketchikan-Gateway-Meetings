import Anthropic from '@anthropic-ai/sdk';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { normalizeDigest } from '../analysis/analysis.service';
import { emptyRecording } from '../analysis/empty-recording';
import { config } from '../config';
import { PrismaService } from '../prisma.service';
import { Q_CONTROL } from '../queues';
import { formatDate, slugify } from '../util';

const SYSTEM = `You follow the issues that run through Ketchikan Gateway Borough public meetings: budgets, specific projects, contracts, land and zoning cases, school matters, ordinances that come back meeting after meeting.

You get one meeting's recap and the list of topics already being followed. Do three things:
1. matches: every followed topic this meeting touched in a meaningful way (a vote, a report, a discussion, public comment). Skip passing mentions.
2. suggestions: issues in this meeting that are not on the list but are likely to come back at future meetings and that residents would want to follow. A good topic is specific enough to have a story ("Ketchikan harbor repairs", "School district budget", "Ward Cove cruise dock") and broad enough to last months. Not a single routine item, not a person, not "public comment". Never suggest anything on the "do not suggest" list or a near-duplicate of a followed topic.
3. For each match or suggestion, decide whether this meeting was a milestone: a final vote, an ordinance adopted or failed, a budget passed, a contract awarded, a public hearing held, a major new proposal introduced, or a reversal. First readings, staff updates and discussion without action are not milestones.

Each "summary" is one or two plain sentences on what happened on that topic at this meeting. "t" is copied from the recap item it comes from.`;

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', additionalProperties: false, properties, required });
const hit = {
  summary: { type: 'string' },
  t: { type: 'number' },
  milestone: { type: 'boolean' },
  why: { type: 'string', description: 'Why it is a milestone, or an empty string.' },
};

const TAG_FORMAT: Anthropic.JSONOutputFormat = {
  type: 'json_schema',
  schema: obj(
    {
      matches: { type: 'array', items: obj({ slug: { type: 'string' }, ...hit }, ['slug', 'summary', 't', 'milestone', 'why']) },
      suggestions: {
        type: 'array',
        items: obj(
          { name: { type: 'string', description: 'Short, plain name, 2–6 words.' }, description: { type: 'string', description: 'One sentence: what this issue is.' }, ...hit },
          ['name', 'description', 'summary', 't', 'milestone', 'why'],
        ),
      },
    },
    ['matches', 'suggestions'],
  ),
};

@Injectable()
export class TopicsService {
  private log = new Logger(TopicsService.name);
  private client?: Anthropic;
  private get anthropic() {
    return (this.client ??= new Anthropic({ apiKey: config.anthropicKey }));
  }

  constructor(
    private prisma: PrismaService,
    @InjectQueue(Q_CONTROL) private controlQ: Queue,
  ) {}

  /**
   * Links a meeting to the topics it touched and records new suggestions.
   * A milestone on an approved topic queues a deep dive, except for backfilled
   * meetings: an old vote is not news.
   */
  async tagMeeting(meetingId: string, opts: { allowDeepDive: boolean }): Promise<void> {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({ where: { id: meetingId }, include: { analysis: true } });
    const digest = normalizeDigest(meeting.analysis?.data);
    if (!digest || emptyRecording(digest)) {
      // A microphone check is not an issue. Mark it tagged so the next boot does not ask again.
      if (digest && !meeting.topicsAt) await this.prisma.meeting.update({ where: { id: meetingId }, data: { topicsAt: new Date() } });
      return;
    }
    const topics = await this.prisma.topic.findMany({ orderBy: { name: 'asc' } });
    const followed = topics.filter((t) => t.status !== 'ARCHIVED');
    const archived = topics.filter((t) => t.status === 'ARCHIVED');

    const recap = {
      headline: digest.headline,
      summary: digest.summary,
      actions: digest.actions,
      discussion: digest.discussion,
      publicComment: digest.publicComment,
      upcoming: digest.upcoming,
    };
    const res = await this.anthropic.messages.create({
      model: config.anthropicModel,
      max_tokens: 8000,
      system: SYSTEM,
      output_config: { effort: 'low', format: TAG_FORMAT },
      messages: [
        {
          role: 'user',
          content: [
            `Meeting: ${meeting.body}, ${formatDate(meeting.meetingDate) || 'date unknown'}`,
            '',
            'Followed topics (slug — name: description):',
            ...(followed.length ? followed.map((t) => `- ${t.slug} — ${t.name}: ${t.description}`) : ['(none yet)']),
            '',
            `Do not suggest: ${archived.map((t) => t.name).join('; ') || '(nothing)'}`,
            '',
            `<recap>\n${JSON.stringify(recap, null, 1)}\n</recap>`,
          ].join('\n'),
        },
      ],
    });
    if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') throw new Error(`Topic tagging stopped: ${res.stop_reason}`);
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    const out = JSON.parse(text || '{}') as {
      matches?: { slug: string; summary: string; t: number; milestone: boolean; why: string }[];
      suggestions?: { name: string; description: string; summary: string; t: number; milestone: boolean; why: string }[];
    };

    const bySlug = new Map(topics.map((t) => [t.slug, t]));
    const links: { topicId: string; summary: string; t: number; milestone: boolean; why: string }[] = [];
    for (const m of out.matches ?? []) {
      const topic = bySlug.get(m.slug);
      if (topic && topic.status !== 'ARCHIVED') links.push({ topicId: topic.id, ...pick(m) });
    }
    for (const s of out.suggestions ?? []) {
      const slug = slugify(s.name);
      if (!slug) continue;
      let topic = bySlug.get(slug);
      if (topic?.status === 'ARCHIVED') continue;
      if (!topic) {
        topic = await this.prisma.topic.create({ data: { slug, name: s.name.trim(), description: s.description.trim() } });
        bySlug.set(slug, topic);
      }
      links.push({ topicId: topic.id, ...pick(s) });
    }

    await this.prisma.$transaction([
      this.prisma.meetingTopic.deleteMany({ where: { meetingId } }),
      ...dedupe(links).map((l) => this.prisma.meetingTopic.create({ data: { meetingId, ...l, why: l.why || null } })),
      this.prisma.meeting.update({ where: { id: meetingId }, data: { topicsAt: new Date() } }),
    ]);

    if (!opts.allowDeepDive) return;
    const byId = new Map([...bySlug.values()].map((t) => [t.id, t]));
    for (const l of dedupe(links)) {
      if (l.milestone && byId.get(l.topicId)?.status === 'APPROVED') await this.queueDeepDive(l.topicId, meetingId);
    }
  }

  queueDeepDive(topicId: string, triggerMeetingId: string) {
    return this.controlQ.add(
      'deep-dive',
      { topicId, triggerMeetingId },
      { jobId: `dive-${topicId}-${triggerMeetingId}`, attempts: 3, backoff: { type: 'exponential', delay: 10 * 60_000 }, removeOnComplete: 200, removeOnFail: 200 },
    );
  }

  /** Tags every recapped meeting that hasn't been tagged yet, oldest first, without deep dives. */
  async tagUntagged(): Promise<number> {
    const rows = await this.prisma.meeting.findMany({
      where: { topicsAt: null, analysis: { isNot: null } },
      select: { id: true },
      orderBy: { meetingDate: 'asc' },
    });
    let done = 0;
    for (const r of rows) {
      try {
        await this.tagMeeting(r.id, { allowDeepDive: false });
        done++;
      } catch (err) {
        this.log.warn(`Topic tagging failed for ${r.id}: ${(err as Error).message}`);
      }
    }
    if (rows.length) this.log.log(`Tagged ${done}/${rows.length} meetings with topics`);
    return done;
  }

  /** Suggestions ranked by how many meetings raised them, then approved topics. */
  async adminList() {
    const topics = await this.prisma.topic.findMany({
      where: { status: { not: 'ARCHIVED' } },
      include: { meetings: { select: { milestone: true } }, deepDives: { select: { id: true, status: true, createdAt: true, data: true }, orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    return topics
      .map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        description: t.description,
        status: t.status,
        meetings: t.meetings.length,
        milestones: t.meetings.filter((m) => m.milestone).length,
        dives: t.deepDives.map((d) => ({ id: d.id, status: d.status, createdAt: d.createdAt, headline: String((d.data as { headline?: string })?.headline ?? '') })),
      }))
      .sort((a, b) => (a.status === b.status ? b.meetings - a.meetings : a.status === 'SUGGESTED' ? -1 : 1));
  }

  approved() {
    return this.prisma.topic.findMany({ where: { status: 'APPROVED' }, orderBy: { name: 'asc' } });
  }
}

function pick(x: { summary: string; t: number; milestone: boolean; why: string }) {
  return {
    summary: String(x.summary ?? '').trim(),
    t: Number.isFinite(x.t) ? x.t : 0,
    milestone: Boolean(x.milestone),
    why: String(x.why ?? '').trim(),
  };
}

/** The model can list the same topic as a match and a suggestion; keep the milestone if either says so. */
function dedupe<T extends { topicId: string; milestone: boolean }>(links: T[]): T[] {
  const out = new Map<string, T>();
  for (const l of links) {
    const prev = out.get(l.topicId);
    if (!prev) out.set(l.topicId, l);
    else if (l.milestone && !prev.milestone) out.set(l.topicId, l);
  }
  return [...out.values()];
}
