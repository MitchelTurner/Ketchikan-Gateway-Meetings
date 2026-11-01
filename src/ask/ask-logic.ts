/** Included questions each Alaska month for a confirmed reader, and for someone paying $10 a month. */
export const ASK_FREE_PER_MONTH = 3;
export const ASK_PAID_PER_MONTH = 20;
export const ASK_PRICE_LABEL = '$10 a month';
/** Short form for “You're on the $10 plan.” */
export const ASK_PLAN_LABEL = '$10 plan';

const STOP = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'what', 'when', 'where', 'who', 'why', 'how', 'did', 'does', 'was', 'were',
  'are', 'have', 'has', 'had', 'about', 'into', 'they', 'their', 'them', 'its', 'not', 'but', 'you', 'your', 'any', 'can', 'could',
  'would', 'should', 'just', 'than', 'then', 'there', 'here', 'meeting', 'meetings', 'said', 'say',
]);

export interface AskGate {
  askAccess: 'free' | 'paid';
  stripeSubscriptionId: string | null;
  askBlockedSubId: string | null;
}

/**
 * A live subscription turns Ask on, unless that same subscription was revoked
 * (refund, dispute, or fraud warning). An old canceled subscription must not
 * turn off a newer one.
 */
export function accessAfterSubscription(gate: AskGate, sub: { id: string; active: boolean }): AskGate | null {
  if (sub.active && gate.askBlockedSubId !== sub.id) {
    return { askAccess: 'paid', stripeSubscriptionId: sub.id, askBlockedSubId: null };
  }
  if (!sub.active && (gate.stripeSubscriptionId === null || gate.stripeSubscriptionId === sub.id)) {
    return { askAccess: 'free', stripeSubscriptionId: sub.id, askBlockedSubId: gate.askBlockedSubId };
  }
  return null;
}

/** Paid questions stop. The same subscription id cannot turn them back on. */
export function accessAfterRevoke(gate: AskGate): AskGate {
  return {
    askAccess: 'free',
    stripeSubscriptionId: gate.stripeSubscriptionId,
    askBlockedSubId: gate.stripeSubscriptionId ?? 'revoked',
  };
}

export function capFor(paid: boolean): number {
  return paid ? ASK_PAID_PER_MONTH : ASK_FREE_PER_MONTH;
}

/** Midnight on the 1st, in the newsroom's time zone, as a UTC instant. */
export function monthStart(timeZone: string, now = new Date()): Date {
  const parts = zonedParts(timeZone, now);
  const utcMidnight = Date.UTC(parts.year, parts.month - 1, 1, 0, 0, 0);
  const start = new Date(utcMidnight - zoneOffsetMs(timeZone, new Date(utcMidnight)));
  return new Date(utcMidnight - zoneOffsetMs(timeZone, start));
}

function zonedParts(timeZone: string, date: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: n('year'), month: n('month'), day: n('day'), hour: n('hour'), minute: n('minute'), second: n('second') };
}

/** Local clock minus UTC, so Alaska (behind UTC) is negative. */
function zoneOffsetMs(timeZone: string, date: Date): number {
  const p = zonedParts(timeZone, date);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

export function questionTokens(question: string): string[] {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 2 && !STOP.has(w));
  return [...new Set(words)].slice(0, 12);
}

export interface RecapCard {
  id: string;
  title: string;
  body: string;
  date: string;
  when: number;
  platform: string;
  sourceUrl: string;
  headline: string;
  summary: string;
  actions: { item: string; outcome: string; vote?: string; t: number }[];
  discussion: { topic: string; gist: string; t: number }[];
  publicComment: { who: string; topic: string; gist: string; t: number }[];
  text: string;
}

export function scoreText(tokens: string[], text: string): number {
  const hay = text.toLowerCase();
  let score = 0;
  for (const word of tokens) if (hay.includes(word)) score += word.length >= 6 ? 3 : 1;
  return score;
}

/**
 * The recaps most likely to answer the question. The meeting the reader opened
 * is always included. A vague question still gets the newest recaps.
 */
export function pickRecaps(cards: RecapCard[], question: string, pinId?: string | null, limit = 5): RecapCard[] {
  const tokens = questionTokens(question);
  const ranked = cards
    .map((card) => ({ card, score: scoreText(tokens, card.text) }))
    .sort((a, b) => b.score - a.score || b.card.when - a.card.when);
  const picked: RecapCard[] = [];
  const pin = pinId ? cards.find((card) => card.id === pinId) : undefined;
  if (pin) picked.push(pin);
  for (const row of ranked) {
    if (picked.length >= limit) break;
    if (row.score <= 0) continue;
    if (picked.some((card) => card.id === row.card.id)) continue;
    picked.push(row.card);
  }
  if (picked.length < 3) {
    const newest = [...cards].sort((a, b) => b.when - a.when);
    for (const card of newest) {
      if (picked.length >= Math.min(4, limit)) break;
      if (!picked.some((item) => item.id === card.id)) picked.push(card);
    }
  }
  return picked.slice(0, limit);
}

export function recapExcerpt(card: RecapCard): string {
  const line = (t: number) => `t=${Math.max(0, Math.floor(t))}`;
  const actions = card.actions
    .slice(0, 6)
    .map((a) => `- ${a.item} — ${a.outcome}${a.vote ? ` (${a.vote})` : ''} ${line(a.t)}`)
    .join('\n');
  const discussion = card.discussion
    .slice(0, 4)
    .map((x) => `- ${x.topic}: ${x.gist} ${line(x.t)}`)
    .join('\n');
  const comments = card.publicComment
    .slice(0, 3)
    .map((x) => `- ${x.who} on ${x.topic}: ${x.gist} ${line(x.t)}`)
    .join('\n');
  return [
    `Meeting id: ${card.id}`,
    `Body: ${card.body}`,
    `Date: ${card.date || 'unknown'}`,
    `Headline: ${card.headline}`,
    `Summary: ${card.summary.replace(/\s+/g, ' ').slice(0, 700)}`,
    actions ? `Decisions:\n${actions}` : '',
    discussion ? `Discussion:\n${discussion}` : '',
    comments ? `Public comment:\n${comments}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface AskCite {
  meetingId: string;
  t: number;
}

/** Claude's JSON, limited to meetings we actually handed it. */
export function parseAskAnswer(raw: string, allowed: Set<string>): { answer: string; cites: AskCite[] } | null {
  const text = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const row = data as { answer?: unknown; cites?: unknown };
  const answer = typeof row.answer === 'string' ? row.answer.trim() : '';
  if (!answer || answer.length > 4000) return null;
  const cites = Array.isArray(row.cites) ? row.cites : [];
  const clean: AskCite[] = [];
  for (const cite of cites) {
    if (!cite || typeof cite !== 'object') continue;
    const meetingId = String((cite as { meetingId?: unknown }).meetingId ?? '');
    const t = Number((cite as { t?: unknown }).t);
    if (!allowed.has(meetingId) || !Number.isFinite(t) || t < 0 || t >= 24 * 3600) continue;
    const seconds = Math.floor(t);
    if (clean.some((item) => item.meetingId === meetingId && item.t === seconds)) continue;
    clean.push({ meetingId, t: seconds });
    if (clean.length >= 6) break;
  }
  return { answer, cites: clean };
}

export function invoiceSubscriptionId(invoice: {
  parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
}): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription;
  if (!subscription) return null;
  return typeof subscription === 'string' ? subscription : subscription.id;
}
