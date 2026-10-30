import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';
import { Agenda, fetchAgenda } from '../enrichment/agenda';
import { correctNames, loadRoster, officials, Person, ROSTER_SOURCES } from '../enrichment/names';
import { findBackground, findLocalNews, leadSentence, NewsArticle } from '../enrichment/news';
import { formatTranscript, Segment } from '../transcription/transcription.service';
import { formatDate } from '../util';

export interface NewsNote {
  outlet: string;
  title: string;
  url: string;
  note: string;
}

export interface SourceLink {
  label: string;
  url: string;
}

export interface BackgroundLink {
  outlet: string;
  title: string;
  url: string;
  date: string;
}

export interface MeetingDigest {
  headline: string;
  summary: string;
  actions: { item: string; outcome: string; vote?: string; t: number }[];
  discussion: { topic: string; gist: string; t: number }[];
  publicComment: { who: string; topic: string; gist: string; t: number }[];
  upcoming: { item: string; when?: string }[];
  news: NewsNote[];
  /** Short subject phrases ("Herring Cove", "Ordinance 2123") used to look up background and earlier recaps. */
  topics: string[];
  background: { topic: string; links: BackgroundLink[] }[];
  /** What the names were checked against and what changed. Absent on recaps written before the check existed. */
  factCheck?: { corrections: string[]; sources: SourceLink[] };
  caveats: string[];
}

const SYSTEM = `You write a short, neutral recap of a Ketchikan Gateway Borough public meeting for residents who subscribe by email.

You work from the automated transcript. A roster of official spellings and, when available, the published meeting agenda and local news excerpts are also provided. Rules:
- The transcript is the record of what the meeting did. Never infer motives, never editorialize, never predict outcomes.
- The transcript is machine-generated: names, numbers and ordinance/resolution numbers may be misheard. Use a roster or agenda spelling when the transcript is clearly that person (a called name that is a sound or two off). Do not give a name to someone the transcript does not identify. Otherwise describe the role ("an Assembly member", "a resident", "Borough staff"). "Speaker A" labels are not names; never print them.
- The agenda is the official list of what was scheduled. Use it for exact item titles, ordinance and resolution numbers, dollar amounts, and the names of people and businesses in an item. It does not say what passed: outcomes and votes come from the transcript only.
- Local news may correct a garbled name or number and may add a short fact the audio left unclear. When you use a news fact, name the outlet in the sentence. If news and the transcript disagree, keep the transcript and say so in caveats. Do not add facts that are in none of the transcript, agenda, or excerpts.
- Each news article you actually used goes in "news" with the outlet, title, the excerpt URL, and a one-sentence note. Leave "news" empty if you used none. Do not list the agenda there; it is linked separately.
- "topics": 2 to 5 of the meeting's main subjects as short search phrases a local news site would use: a place, project, ordinance or resolution number, or organization ("Herring Cove", "Ordinance 2123", "Ward Cove landslide"). Not generic words like "budget" or "public comment", and not people's names.
- If a vote count, motion outcome, or dollar figure is unclear, say so plainly rather than guessing, and add a caveat.
- Every item gets "t": the start time in seconds of the transcript line where it happens, copied from the [Ns] markers.
- Write in plain language a busy resident can skim. No jargon without a short explanation.
- Public comment: summarize each speaker's point fairly in one sentence, including people you'd disagree with.`;

// Sonnet 5.5 rejects tool_choice "tool" and "any". A JSON schema response is the
// supported way to get this object back. Every object needs additionalProperties: false.
const obj = (properties: Record<string, unknown>, required: string[], description?: string) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
  ...(description ? { description } : {}),
});

const DIGEST_FORMAT: Anthropic.JSONOutputFormat = {
  type: 'json_schema',
  schema: obj(
    {
      headline: { type: 'string', description: 'One line, under 90 characters, the most consequential thing that happened.' },
      summary: { type: 'string', description: '2–3 short paragraphs, plain text, separated by blank lines.' },
      actions: {
        type: 'array',
        description: 'Formal actions: motions, ordinances, resolutions, appointments, approvals, in meeting order.',
        items: obj(
          {
            item: { type: 'string' },
            outcome: { type: 'string', description: 'e.g. "Approved", "Failed", "Postponed to Nov 3", "Unclear from audio"' },
            vote: { type: 'string', description: 'e.g. "6–1" or "unanimous". Empty string if the transcript does not state one.' },
            t: { type: 'number' },
          },
          ['item', 'outcome', 'vote', 't'],
        ),
      },
      discussion: {
        type: 'array',
        description: 'Up to 6 notable discussions that did not end in a formal action.',
        items: obj(
          { topic: { type: 'string' }, gist: { type: 'string' }, t: { type: 'number' } },
          ['topic', 'gist', 't'],
        ),
      },
      publicComment: {
        type: 'array',
        items: obj(
          {
            who: { type: 'string', description: 'Name if clearly stated, else "A resident" etc.' },
            topic: { type: 'string' },
            gist: { type: 'string' },
            t: { type: 'number' },
          },
          ['who', 'topic', 'gist', 't'],
        ),
      },
      upcoming: {
        type: 'array',
        description: 'Things scheduled or promised for future meetings, hearings, deadlines.',
        items: obj(
          {
            item: { type: 'string' },
            when: { type: 'string', description: 'When it happens, or an empty string if the transcript does not say.' },
          },
          ['item', 'when'],
        ),
      },
      news: {
        type: 'array',
        description: 'Local news articles actually used. Empty if none were used.',
        items: obj(
          {
            outlet: { type: 'string' },
            title: { type: 'string' },
            url: { type: 'string', description: 'One of the excerpt URLs. Empty string if none.' },
            note: { type: 'string', description: 'One sentence on what this article adds. Empty string if unused.' },
          },
          ['outlet', 'title', 'url', 'note'],
        ),
      },
      topics: {
        type: 'array',
        description: '2 to 5 short search phrases for the main subjects: places, projects, ordinance numbers, organizations.',
        items: { type: 'string' },
      },
      caveats: { type: 'array', items: { type: 'string' }, description: 'Audio gaps, unclear votes, likely misheard names, disagreements with news.' },
    },
    ['headline', 'summary', 'actions', 'discussion', 'publicComment', 'upcoming', 'news', 'topics', 'caveats'],
  ),
};

@Injectable()
export class AnalysisService {
  private log = new Logger(AnalysisService.name);
  private client?: Anthropic;
  private get anthropic() {
    return (this.client ??= new Anthropic({ apiKey: config.anthropicKey }));
  }

  get model() {
    return config.anthropicModel;
  }

  async analyze(meeting: MeetingInfo, segments: Segment[]): Promise<MeetingDigest> {
    const transcript = formatTranscript(segments);
    const [roster, articles, agenda] = await Promise.all([
      loadRoster(config.userAgent).catch((err: Error) => {
        this.log.warn(`Roster fetch failed: ${err.message}`);
        return [] as Person[];
      }),
      findLocalNews({
        body: meeting.body,
        title: meeting.title,
        meetingDate: meeting.meetingDate,
        userAgent: config.userAgent,
      }),
      fetchAgenda(meeting, config.userAgent).catch((err: Error) => {
        this.log.warn(`Agenda fetch failed: ${err.message}`);
        return null;
      }),
    ]);
    this.log.log(
      `Recap context: ${roster.length} roster names, ${agenda ? `agenda (${agenda.text.length} chars)` : 'no agenda'}, ${articles.length} news article(s)`,
    );
    const res = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: 'medium', format: DIGEST_FORMAT },
      messages: [
        {
          role: 'user',
          content: userPrompt(meeting, transcript, roster, agenda, articles),
        },
      ],
    });
    if (res.stop_reason === 'max_tokens') throw new Error('Digest was cut off at max_tokens');
    if (res.stop_reason === 'refusal') throw new Error('Claude refused to write the digest');
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!parsed) throw new Error(`Claude returned no digest (stop_reason: ${res.stop_reason})`);
    const digest = normalizeDigest(parsed);
    if (!digest) throw new Error('Claude returned a digest without a headline and summary');
    const allowed = new Set(articles.map((a) => a.url));
    digest.news = digest.news.filter((n) => allowed.has(n.url) && n.note);
    if (!digest.news.length) {
      digest.news = articles.slice(0, 3).map((a) => ({
        outlet: a.outlet,
        title: a.title,
        url: a.url,
        note: leadSentence(a.excerpt),
      }));
    }
    const agendaOwner = meeting.body === 'School Board' && !agenda?.url.includes('granicus.com') ? 'School District' : 'Borough';
    if (agenda) {
      digest.news.unshift({
        outlet: `${agendaOwner} agenda`,
        title: 'Published agenda for this meeting',
        url: agenda.url,
        note: 'The official item list, with item titles, ordinance numbers and amounts.',
      });
    }

    const background = await findBackground({
      topics: digest.topics,
      meetingDate: meeting.meetingDate,
      exclude: new Set(digest.news.map((n) => n.url)),
      userAgent: config.userAgent,
    }).catch((err: Error) => {
      this.log.warn(`Background search failed: ${err.message}`);
      return [];
    });
    digest.background = background.map((b) => ({
      topic: b.topic,
      links: b.articles.map((a) => ({ outlet: a.outlet, title: a.title, url: a.url, date: a.published ? formatDate(a.published) : '' })),
    }));

    // Only elected and appointed members are rewritten here. Staff, agenda and news spellings reach Claude through the prompt.
    const named = applyNames(digest, officials(roster));
    named.digest.factCheck = {
      corrections: named.changes,
      sources: [
        ...ROSTER_SOURCES.map((s) => ({ label: `${s.label} roster`, url: s.url })),
        ...(agenda ? [{ label: `${agendaOwner} agenda for this meeting`, url: agenda.url }] : []),
      ],
    };
    return named.digest;
  }
}

export interface MeetingInfo {
  title: string;
  body: string;
  meetingDate: Date | null;
  sourceUrl: string;
}

function userPrompt(meeting: MeetingInfo, transcript: string, people: Person[], agenda: Agenda | null, articles: NewsArticle[]): string {
  const list = (group: Person[]) => group.map((p) => `- ${p.full}`).join('\n');
  const staff = people.filter((p) => p.group === 'staff');
  const roster = people.length
    ? `Elected and appointed members:\n${list(officials(people))}${staff.length ? `\n\nBorough staff:\n${list(staff)}` : ''}`
    : 'No official roster could be loaded.';
  const agendaText = agenda ? `Source: ${agenda.url}\n${agenda.text}` : 'No published agenda was found for this meeting.';
  const coverage = articles.length
    ? articles
        .map(
          (a) =>
            `Outlet: ${a.outlet}\nTitle: ${a.title}\nURL: ${a.url}\nDate: ${a.published ? a.published.toISOString().slice(0, 10) : 'unknown'}\nExcerpt: ${a.excerpt}`,
        )
        .join('\n\n')
    : 'No local news articles were found near this meeting date.';
  return `Meeting: ${meeting.title}\nBody: ${meeting.body}\nDate: ${formatDate(meeting.meetingDate) || 'unknown'}\n\nOfficial spellings. Use one when the transcript is clearly that person:\n${roster}\n\n<agenda>\n${agendaText}\n</agenda>\n\n<local-news>\n${coverage}\n</local-news>\n\n<transcript>\n${transcript}\n</transcript>`;
}

function applyNames(d: MeetingDigest, people: Person[]): { digest: MeetingDigest; changes: string[] } {
  const changes: string[] = [];
  const fix = (s: string) => {
    const r = correctNames(s, people);
    changes.push(...r.changes);
    return r.text;
  };
  return {
    changes: [...new Set(changes)],
    digest: {
      headline: fix(d.headline),
      summary: fix(d.summary),
      actions: d.actions.map((a) => ({ ...a, item: fix(a.item), outcome: fix(a.outcome), ...(a.vote ? { vote: fix(a.vote) } : {}) })),
      discussion: d.discussion.map((x) => ({ ...x, topic: fix(x.topic), gist: fix(x.gist) })),
      publicComment: d.publicComment.map((x) => ({ ...x, who: fix(x.who), topic: fix(x.topic), gist: fix(x.gist) })),
      upcoming: d.upcoming.map((x) => ({ ...x, item: fix(x.item), ...(x.when ? { when: fix(x.when) } : {}) })),
      news: d.news.map((n) => ({ ...n, note: fix(n.note) })),
      topics: d.topics,
      background: d.background,
      caveats: d.caveats.map(fix),
    },
  };
}

/**
 * Model output is usually the right shape. A null list entry, or a summary sent
 * as an array of paragraphs, used to throw while rendering the public pages.
 */
export function normalizeDigest(data: unknown): MeetingDigest | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const headline = text(d.headline);
  const summary = typeof d.summary === 'string'
    ? d.summary
    : Array.isArray(d.summary)
      ? d.summary.map(text).filter(Boolean).join('\n\n')
      : '';
  if (!headline || !summary.trim()) return null;
  return {
    headline,
    summary,
    actions: records(d.actions)
      .map((a) => ({ item: text(a.item), outcome: text(a.outcome), ...(text(a.vote) ? { vote: text(a.vote) } : {}), t: seconds(a.t) }))
      .filter((a) => a.item || a.outcome),
    discussion: records(d.discussion)
      .map((x) => ({ topic: text(x.topic), gist: text(x.gist), t: seconds(x.t) }))
      .filter((x) => x.topic || x.gist),
    publicComment: records(d.publicComment)
      .map((x) => ({ who: text(x.who) || 'A resident', topic: text(x.topic), gist: text(x.gist), t: seconds(x.t) }))
      .filter((x) => x.topic || x.gist),
    upcoming: records(d.upcoming)
      .map((x) => ({ item: text(x.item), ...(text(x.when) ? { when: text(x.when) } : {}) }))
      .filter((x) => x.item),
    news: records(d.news)
      .map((n) => ({ outlet: text(n.outlet) || 'Local news', title: text(n.title), url: text(n.url), note: text(n.note) }))
      .filter((n) => n.title && n.url.startsWith('http') && n.note),
    topics: Array.isArray(d.topics) ? [...new Set(d.topics.map(text).filter((t) => t.length >= 3 && t.length <= 60))].slice(0, 5) : [],
    background: records(d.background)
      .map((b) => ({
        topic: text(b.topic),
        links: records(b.links)
          .map((l) => ({ outlet: text(l.outlet) || 'Local news', title: text(l.title), url: text(l.url), date: text(l.date) }))
          .filter((l) => l.title && l.url.startsWith('http')),
      }))
      .filter((b) => b.topic && b.links.length),
    ...(d.factCheck && typeof d.factCheck === 'object' && !Array.isArray(d.factCheck)
      ? {
          factCheck: {
            corrections: arr((d.factCheck as Record<string, unknown>).corrections).map(text).filter(Boolean),
            sources: records((d.factCheck as Record<string, unknown>).sources)
              .map((s) => ({ label: text(s.label), url: text(s.url) }))
              .filter((s) => s.label && s.url.startsWith('http')),
          },
        }
      : {}),
    caveats: Array.isArray(d.caveats) ? d.caveats.map(text).filter(Boolean) : [],
  };
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function seconds(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function records(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
}
