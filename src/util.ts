import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { config } from './config';

export const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const randomToken = () => randomBytes(24).toString('base64url');

export function sign(value: string): string {
  return createHmac('sha256', config.signingSecret).update(value).digest('base64url');
}
export function verify(value: string, sig: string | undefined): boolean {
  if (!sig) return false;
  const a = Buffer.from(sign(value));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Which public body a meeting belongs to, from its title. First match wins.
 * City patterns sit ahead of the catch-all. Port and Harbors is before
 * City Committees because those titles also say "advisory board".
 */
export const BODIES: { name: string; pattern: RegExp }[] = [
  { name: 'Assembly', pattern: /assembly/i },
  { name: 'Planning Commission', pattern: /planning\s*(commission|&\s*zoning|and\s*zoning)|\bP\s*&\s*Z\b/i },
  { name: 'School Board', pattern: /school\s*board/i },
  { name: 'Service Area Boards', pattern: /service\s*area/i },
  { name: 'City Council', pattern: /city\s*council/i },
  { name: 'Port and Harbors', pattern: /port\s*(?:&|and\s+)?\s*harbou?rs/i },
  { name: 'City Committees', pattern: /advisory\s*(?:board|committee)|ad\s*hoc\s*committee|grant\s*committee|cooperative\s*relations/i },
  { name: 'Other', pattern: /.*/ },
];

/** Body used for a City of Ketchikan video whose title names no specific board. */
export const CITY_FALLBACK_BODY = 'City Committees';

const CITY_BODY_NAMES = new Set(['City Council', 'Port and Harbors', 'City Committees']);

export function isCityBody(name: string): boolean {
  return CITY_BODY_NAMES.has(name);
}

export function detectBody(title: string, fallback = 'Other'): string {
  return BODIES.find((b) => b.name !== 'Other' && b.pattern.test(title))?.name ?? fallback;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Pulls a meeting date out of text like "Assembly – October 6, 2026", "10/06/26" or "2026-10-06". */
export function parseDateFromText(text?: string | null): Date | null {
  if (!text) return null;
  const mk = (y: number, m: number, d: number) => {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    return new Date(Date.UTC(y, m - 1, d, 12));
  };
  let m = text.match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/);
  if (m) return mk(+m[1], +m[2], +m[3]);
  m = text.match(/\b(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})\b/);
  if (m) return mk(+m[3], +m[1], +m[2]);
  m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
  if (m) return mk(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]);
  return null;
}

export function hms(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${Number(mm)}:${ss}`;
}

export function formatDate(d: Date | null | undefined): string {
  if (!d) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** "Wed, Oct 21, 2026", the one date format used in lists. */
export function shortDate(d: Date | null | undefined, weekday = true): string {
  if (!d) return '';
  return d.toLocaleDateString('en-US', {
    ...(weekday ? { weekday: 'short' as const } : {}),
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const DATE_IN_TITLE = new RegExp(
  [
    String.raw`\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b`,
    String.raw`\b\d{1,2}[-./]\d{1,2}[-./]\d{2,4}\b`,
    String.raw`\b20\d{2}[-./]\d{1,2}[-./]\d{1,2}\b`,
  ].join('|'),
  'gi',
);

/**
 * What the archive title says beyond the body and the date, as separate items.
 * "Assembly - Special Meeting to X, followed by Regular Assembly Meeting – Oct 20, 2026"
 * → ["Special Meeting to X", "Regular Assembly Meeting"]. "School Board – Oct 21, 2026" → [].
 */
export function meetingParts(title: string, body: string): string[] {
  let t = title.replace(DATE_IN_TITLE, ' ');
  const name = body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  t = t.replace(new RegExp(`^\\s*${name}\\b`, 'i'), ' ');
  return t
    .split(/,?\s*\bfollowed by\b\s*|\s+[-–—|:]\s+|^\s*[-–—|:]\s*|\s*[-–—|:]\s*$/i)
    .map((s) => s.replace(/\s+/g, ' ').replace(/^[\s,–—:|-]+|[\s,–—:|-]+$/g, '').replace(/\s+of$/i, '').trim())
    .filter((s) => s && s.toLowerCase() !== body.toLowerCase() && !/^(recurring\s+)?(quarterly\s+)?meeting$/i.test(s));
}

/** "assembly-approves-4m-harbor-bond" for readable, keyword-bearing URLs. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+[^-]*$/, (m) => (m.length > 20 ? '' : m));
}
