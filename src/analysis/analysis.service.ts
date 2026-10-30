import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { config } from '../config';
import { formatContext, MeetingContext } from '../research/research.service';
import { formatTranscript, Segment } from '../transcription/transcription.service';
import { formatDate } from '../util';

export interface MeetingDigest {
  headline: string;
  summary: string;
  actions: { item: string; outcome: string; vote?: string; t: number }[];
  discussion: { topic: string; gist: string; t: number }[];
  publicComment: { who: string; topic: string; gist: string; t: number }[];
  upcoming: { item: string; when?: string }[];
  /** Context from news coverage. Not from the meeting itself. */
  background: { point: string; sources: string[] }[];
  /** Transcript spellings replaced with the published spelling. */
  nameCorrections: { heard: string; corrected: string }[];
  caveats: string[];
}

const SYSTEM = `You write a short, neutral recap of a Ketchikan Gateway Borough public meeting for residents who subscribe by email.

You work only from the automated transcript provided. Rules:
- Report only what the transcript shows. Never infer motives, never editorialize, never predict outcomes.
- The transcript is machine-generated: names, numbers and ordinance/resolution numbers may be misheard. Use a person's name only when it is clearly stated in the transcript (e.g. the chair calling on them, or roll call). Otherwise describe the role ("an Assembly member", "a resident", "Borough staff"). "Speaker A" labels are not names; never print them.
- If a vote count, motion outcome, or dollar figure is unclear, say so plainly rather than guessing, and add a caveat.
- Every item gets "t": the start time in seconds of the transcript line where it happens, copied from the [Ns] markers.
- Write for every resident, including people who have never been to a meeting: about an 8th-grade reading level, short sentences, everyday words. The first time a process term appears ("first reading", "consent agenda", "mill rate", "variance"), explain it in a few words. When the transcript makes it clear, say what a decision means for residents: what it costs, where it is, when it takes effect. Never guess.
- The headline is what people see in search results and their inbox. Name the body and the concrete subject the way a resident would search for it, lead with the most consequential decision, and use active voice: "Assembly approves $4.2 million for harbor repairs", not "Ordinance 2041 adopted". No ordinance numbers or acronyms in the headline.
- Public comment: summarize each speaker's point fairly in one sentence, including people you'd disagree with.

You may also get <reference> material gathered from the web: the official roster, the agenda, and news articles.
- Names: the transcription often misspells names. When a transcript name sounds like a roster name and the role fits (e.g. the transcript has "Member Jonsen" and the roster lists Assembly Member "Johnson"), use the roster spelling and list it in nameCorrections. Do not attach a name to a statement just because the roster has it; the transcript must still show who is speaking.
- Agenda: use it to get ordinance/resolution numbers and item titles right when the transcript clearly refers to that item. Outcomes and votes come only from the transcript.
- News: put useful context from the articles in "background", one point per item, each citing the article URL(s) it came from, exactly as listed. Never present something from an article as having been said or decided at this meeting. If an article contradicts the transcript, say so in caveats.`;

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
      headline: { type: 'string', description: 'Under 70 characters. Body + the most consequential concrete outcome, active voice, words a resident would search for.' },
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
      background: {
        type: 'array',
        description: 'Up to 5 points of context from the reference news articles. Empty if there are none.',
        items: obj(
          {
            point: { type: 'string', description: 'One or two sentences, attributed ("KRBD reported ...").' },
            sources: { type: 'array', items: { type: 'string' }, description: 'Article URLs from the reference, exactly as given.' },
          },
          ['point', 'sources'],
        ),
      },
      nameCorrections: {
        type: 'array',
        description: 'Names the transcript misspelled that you corrected from the reference roster.',
        items: obj({ heard: { type: 'string' }, corrected: { type: 'string' } }, ['heard', 'corrected']),
      },
      caveats: { type: 'array', items: { type: 'string' }, description: 'Audio gaps, unclear votes, likely misheard names.' },
    },
    ['headline', 'summary', 'actions', 'discussion', 'publicComment', 'upcoming', 'background', 'nameCorrections', 'caveats'],
  ),
};

@Injectable()
export class AnalysisService {
  private client?: Anthropic;
  private get anthropic() {
    return (this.client ??= new Anthropic({ apiKey: config.anthropicKey }));
  }

  get model() {
    return config.anthropicModel;
  }

  async analyze(
    meeting: { title: string; body: string; meetingDate: Date | null },
    segments: Segment[],
    context?: MeetingContext | null,
  ): Promise<MeetingDigest> {
    const transcript = formatTranscript(segments);
    const reference = context ? formatContext(context) : '';
    const res = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: 'medium', format: DIGEST_FORMAT },
      messages: [
        {
          role: 'user',
          content: `Meeting: ${meeting.title}\nBody: ${meeting.body}\nDate: ${formatDate(meeting.meetingDate) || 'unknown'}\n\n${reference ? `<reference>\n${reference}\n</reference>\n\n` : ''}<transcript>\n${transcript}\n</transcript>`,
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
    // A background point may only link to an article the research step found.
    const known = new Set((context?.articles ?? []).map((a) => a.url));
    digest.background = digest.background
      .map((b) => ({ ...b, sources: b.sources.filter((u) => known.has(u)) }))
      .filter((b) => b.sources.length);
    return digest;
  }
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
    background: records(d.background)
      .map((x) => ({ point: text(x.point), sources: Array.isArray(x.sources) ? x.sources.map(text).filter((u) => /^https?:\/\//.test(u)) : [] }))
      .filter((x) => x.point && x.sources.length),
    nameCorrections: records(d.nameCorrections)
      .map((x) => ({ heard: text(x.heard), corrected: text(x.corrected) }))
      .filter((x) => x.heard && x.corrected && x.heard !== x.corrected),
    caveats: Array.isArray(d.caveats) ? d.caveats.map(text).filter(Boolean) : [],
  };
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
