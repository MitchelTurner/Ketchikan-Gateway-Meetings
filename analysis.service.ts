import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { config } from '../config';
import { formatTranscript, Segment } from '../transcription/transcription.service';
import { formatDate } from '../util';

export interface MeetingDigest {
  headline: string;
  summary: string;
  actions: { item: string; outcome: string; vote?: string; t: number }[];
  discussion: { topic: string; gist: string; t: number }[];
  publicComment: { who: string; topic: string; gist: string; t: number }[];
  upcoming: { item: string; when?: string }[];
  caveats: string[];
}

const SYSTEM = `You write a short, neutral recap of a Ketchikan Gateway Borough public meeting for residents who subscribe by email.

You work only from the automated transcript provided. Rules:
- Report only what the transcript shows. Never infer motives, never editorialize, never predict outcomes.
- The transcript is machine-generated: names, numbers and ordinance/resolution numbers may be misheard. Use a person's name only when it is clearly stated in the transcript (e.g. the chair calling on them, or roll call). Otherwise describe the role ("an Assembly member", "a resident", "Borough staff"). "Speaker A" labels are not names; never print them.
- If a vote count, motion outcome, or dollar figure is unclear, say so plainly rather than guessing, and add a caveat.
- Every item gets "t": the start time in seconds of the transcript line where it happens, copied from the [Ns] markers.
- Write in plain language a busy resident can skim. No jargon without a short explanation.
- Public comment: summarize each speaker's point fairly in one sentence, including people you'd disagree with.`;

const TOOL: Anthropic.Tool = {
  name: 'meeting_digest',
  description: 'Record the structured recap of the meeting.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'One line, under 90 characters, the most consequential thing that happened.' },
      summary: { type: 'string', description: '2–3 short paragraphs, plain text, separated by blank lines.' },
      actions: {
        type: 'array',
        description: 'Formal actions: motions, ordinances, resolutions, appointments, approvals, in meeting order.',
        items: {
          type: 'object',
          properties: {
            item: { type: 'string' },
            outcome: { type: 'string', description: 'e.g. "Approved", "Failed", "Postponed to Nov 3", "Unclear from audio"' },
            vote: { type: 'string', description: 'e.g. "6–1" or "unanimous"; omit if not stated' },
            t: { type: 'number' },
          },
          required: ['item', 'outcome', 't'],
        },
      },
      discussion: {
        type: 'array',
        description: 'Up to 6 notable discussions that did not end in a formal action.',
        items: {
          type: 'object',
          properties: { topic: { type: 'string' }, gist: { type: 'string' }, t: { type: 'number' } },
          required: ['topic', 'gist', 't'],
        },
      },
      publicComment: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            who: { type: 'string', description: 'Name if clearly stated, else "A resident" etc.' },
            topic: { type: 'string' },
            gist: { type: 'string' },
            t: { type: 'number' },
          },
          required: ['who', 'topic', 'gist', 't'],
        },
      },
      upcoming: {
        type: 'array',
        description: 'Things scheduled or promised for future meetings, hearings, deadlines.',
        items: {
          type: 'object',
          properties: { item: { type: 'string' }, when: { type: 'string' } },
          required: ['item'],
        },
      },
      caveats: { type: 'array', items: { type: 'string' }, description: 'Audio gaps, unclear votes, likely misheard names.' },
    },
    required: ['headline', 'summary', 'actions', 'discussion', 'publicComment', 'upcoming', 'caveats'],
  },
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

  async analyze(meeting: { title: string; body: string; meetingDate: Date | null }, segments: Segment[]): Promise<MeetingDigest> {
    const transcript = formatTranscript(segments);
    const res = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 8000,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [
        {
          role: 'user',
          content: `Meeting: ${meeting.title}\nBody: ${meeting.body}\nDate: ${formatDate(meeting.meetingDate) || 'unknown'}\n\n<transcript>\n${transcript}\n</transcript>`,
        },
      ],
    });
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!block) throw new Error(`Claude returned no digest (stop_reason: ${res.stop_reason})`);
    if (res.stop_reason === 'max_tokens') throw new Error('Digest was cut off at max_tokens');
    return block.input as MeetingDigest;
  }
}
