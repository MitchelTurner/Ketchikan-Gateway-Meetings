import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';
import { formatDate } from '../util';

/** What the web says about a meeting, gathered before transcription. */
export interface MeetingContext {
  /** Officials, staff and other people likely to speak, spelled as published. */
  people: { name: string; role: string; source?: string }[];
  /** Agenda item titles with their ordinance/resolution numbers. */
  agenda: string[];
  /** Place names, organizations and project names that come up. */
  terms: string[];
  /** News coverage. Every URL here was returned by a search or fetch in this run. */
  articles: { title: string; url: string; outlet: string; date: string; summary: string }[];
}

const SYSTEM = `You research a Ketchikan Gateway Borough public meeting so that an automated transcript of it can be checked and put in context.

Use web search and web fetch. Look for:
1. The members of the body that met (Assembly, Planning Commission, etc.), the Mayor, Borough Manager, Borough Clerk, Borough Attorney and department heads, as of the meeting date (the meeting may be years old; use the minutes, agenda or coverage from that time, not today's roster), with names spelled exactly as the Borough publishes them. Prefer kgbak.us.
2. The agenda for this meeting: item titles and ordinance/resolution numbers. The Borough posts agendas on kgbak.us and ketchikan.granicus.com (AgendaViewer.php).
3. News coverage of this meeting and of the issues on its agenda: previews before it and reports after it, from Ketchikan Daily News, KRBD, Alaska Public Media, Alaska Beacon, Anchorage Daily News and similar outlets. Only include an article if it is about this meeting or an item on its agenda.

Report only what your sources say. Never invent a name, a URL, a date or an article. If you cannot find something, leave that list empty.

Finish with one JSON object in a \`\`\`json fence, nothing after it:
{
  "people": [{ "name": "...", "role": "Assembly Member", "source": "URL where you found it" }],
  "agenda": ["Ordinance 2041 – ..."],
  "terms": ["Ward Cove", "Gravina Access"],
  "articles": [{ "title": "...", "url": "...", "outlet": "KRBD", "date": "2026-10-07", "summary": "Two sentences on what it reports." }]
}`;

const EMPTY: MeetingContext = { people: [], agenda: [], terms: [], articles: [] };

@Injectable()
export class ResearchService {
  private log = new Logger(ResearchService.name);
  private client?: Anthropic;
  private get anthropic() {
    return (this.client ??= new Anthropic({ apiKey: config.anthropicKey }));
  }

  get model() {
    return config.researchModel;
  }

  async research(meeting: { title: string; body: string; meetingDate: Date | null; sourceUrl: string }): Promise<MeetingContext> {
    const agendaUrl = granicusAgendaUrl(meeting.sourceUrl);
    const user = [
      `Meeting: ${meeting.title}`,
      `Body: ${meeting.body}`,
      `Date: ${formatDate(meeting.meetingDate) || 'unknown'}`,
      `Video: ${meeting.sourceUrl}`,
      agendaUrl ? `Agenda (may be empty): ${agendaUrl}` : '',
      `Borough website: https://www.kgbak.us/`,
    ]
      .filter(Boolean)
      .join('\n');

    const tools: Anthropic.ToolUnion[] = [
      { type: 'web_search_20260209', name: 'web_search', max_uses: 12, ...domains() },
      { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8, ...domains() },
    ];
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }];
    const seenUrls = new Set<string>();
    let res: Anthropic.Message | undefined;

    // Server tools stop with pause_turn after a long search loop. Resend to resume.
    for (let turn = 0; turn < 5; turn++) {
      res = await this.anthropic.messages
        .stream({
          model: this.model,
          max_tokens: 32000,
          system: SYSTEM,
          output_config: { effort: 'medium' },
          tools,
          messages,
        })
        .finalMessage();
      for (const b of res.content) if (b.type !== 'text') collectUrls(b, seenUrls);
      if (res.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: res.content });
    }
    if (!res) return EMPTY;
    if (res.stop_reason === 'refusal') throw new Error('Claude declined the research request');

    // Citations on the final text point at pages Claude actually read.
    for (const b of res.content) if (b.type === 'text') for (const c of b.citations ?? []) if ('url' in c) seenUrls.add(normUrl(c.url));

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const ctx = normalizeContext(lastJson(text));
    const before = ctx.articles.length;
    ctx.articles = ctx.articles.filter((a) => seenUrls.has(normUrl(a.url)));
    if (ctx.articles.length < before) this.log.warn(`Dropped ${before - ctx.articles.length} article(s) whose URL no search returned`);
    return mergeKnownNames(ctx);
  }
}

function domains(): { allowed_domains?: string[] } {
  const list = config.researchDomains;
  return list.length ? { allowed_domains: list } : {};
}

/** ketchikan.granicus.com/MediaPlayer.php?view_id=1&clip_id=2 → the AgendaViewer page for that clip. */
export function granicusAgendaUrl(sourceUrl: string): string | null {
  try {
    const u = new URL(sourceUrl);
    const clip = u.searchParams.get('clip_id');
    if (!u.hostname.endsWith('granicus.com') || !clip) return null;
    const view = u.searchParams.get('view_id');
    return `https://${u.hostname}/AgendaViewer.php?${view ? `view_id=${view}&` : ''}clip_id=${clip}`;
  } catch {
    return null;
  }
}

/** Every URL that appears in a tool block, however the result is shaped. */
function collectUrls(block: unknown, out: Set<string>) {
  for (const m of JSON.stringify(block).matchAll(/https?:\/\/[^\s"'<>\\]+/g)) out.add(normUrl(m[0]));
}

function normUrl(url: string): string {
  return url.replace(/#.*$/, '').replace(/[),.;]+$/, '').replace(/\/$/, '').replace(/^http:/, 'https:').toLowerCase();
}

function lastJson(text: string): unknown {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  const candidates = fences.length ? [fences[fences.length - 1][1]] : [text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* fall through */
    }
  }
  return null;
}

export function normalizeContext(data: unknown): MeetingContext {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ...EMPTY };
  const d = data as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const recs = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)) : [];
  const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  return {
    people: recs(d.people)
      .map((p) => ({ name: str(p.name), role: str(p.role), ...(str(p.source) ? { source: str(p.source) } : {}) }))
      .filter((p) => p.name),
    agenda: strs(d.agenda),
    terms: strs(d.terms),
    articles: recs(d.articles)
      .map((a) => ({ title: str(a.title), url: str(a.url), outlet: str(a.outlet), date: str(a.date), summary: str(a.summary) }))
      .filter((a) => a.title && /^https?:\/\//.test(a.url)),
  };
}

/** KNOWN_NAMES lets you pin spellings the web gets wrong or doesn't have. */
function mergeKnownNames(ctx: MeetingContext): MeetingContext {
  const have = new Set(ctx.people.map((p) => p.name.toLowerCase()));
  for (const p of config.knownNames) if (!have.has(p.name.toLowerCase())) ctx.people.push(p);
  return ctx;
}

/** Names and terms for the transcription service to listen for. */
export function vocabulary(ctx: MeetingContext | null | undefined): string[] {
  const people = ctx?.people ?? config.knownNames;
  const words = [...people.map((p) => p.name), ...(ctx?.terms ?? [])];
  return [...new Set(words.map((w) => w.trim()).filter((w) => w && w.split(/\s+/).length <= 6))].slice(0, 200);
}

/** Reference block for the recap prompt. */
export function formatContext(ctx: MeetingContext): string {
  const out: string[] = [];
  if (ctx.people.length) out.push('People (official spellings):', ...ctx.people.map((p) => `- ${p.name}${p.role ? ` — ${p.role}` : ''}`), '');
  if (ctx.agenda.length) out.push('Agenda:', ...ctx.agenda.map((a) => `- ${a}`), '');
  if (ctx.terms.length) out.push(`Local terms: ${ctx.terms.join(', ')}`, '');
  if (ctx.articles.length)
    out.push(
      'News coverage:',
      ...ctx.articles.map((a) => `- [${a.outlet}${a.date ? `, ${a.date}` : ''}] ${a.title}\n  URL: ${a.url}\n  ${a.summary}`),
    );
  return out.join('\n').trim();
}
