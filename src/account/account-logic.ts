/** How long a sign-in link works. The email states this number. */
export const LOGIN_HOURS = 2;

/** Comments one reader can post in an Alaska day. */
export const COMMENT_DAY_CAP = 8;

export const COMMENT_MAX = 1000;

export function loginExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + LOGIN_HOURS * 60 * 60 * 1000);
}

/** A missing expiry does not sign anyone in. The link has to carry a future time. */
export function loginStillOpen(expiresAt: Date | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() > now.getTime();
}

/** Confirmed readers, and people who unsubscribed after confirming, can use the account. */
export function sessionOpen(reader: { status: string; confirmedAt: Date | null }): boolean {
  if (reader.status === 'CONFIRMED') return true;
  return reader.status === 'UNSUBSCRIBED' && Boolean(reader.confirmedAt);
}

const ID = '[a-z0-9]{8,40}';

/**
 * Where a sign-in link may return. Anything else, including another site, becomes the account page.
 */
export function safeNext(value: unknown): string {
  const next = String(value ?? '').trim();
  if (next === '/account' || next === '/ask' || next === '/notes') return next;
  if (new RegExp(`^/ask\\?m=${ID}$`, 'i').test(next)) return next;
  if (new RegExp(`^/notes/${ID}(?:/[a-z0-9-]{1,80})?$`, 'i').test(next)) return next;
  return '/account';
}

/** The public comment name. Empty when it should not be saved or shown as a chosen name. */
export function cleanDisplayName(raw: unknown): string {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 40) return '';
  if (name.includes('@') || name.includes('http') || name.includes('/')) return '';
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .'\u2019-]{1,39}$/u.test(name)) return '';
  return name;
}

export function cleanComment(raw: unknown): string {
  const body = String(raw ?? '').replace(/\r\n/g, '\n').trim().slice(0, COMMENT_MAX);
  if (!body.replace(/\s+/g, '')) return '';
  return body;
}

/** Midnight in `timeZone`, as a UTC instant. */
export function dayStart(timeZone: string, now = new Date()): Date {
  const parts = zonedParts(timeZone, now);
  const utcMidnight = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
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

function zoneOffsetMs(timeZone: string, date: Date): number {
  const p = zonedParts(timeZone, date);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}
