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

/** Which public body a meeting belongs to, from its title. Edit to taste. */
export const BODIES: { name: string; pattern: RegExp }[] = [
  { name: 'Assembly', pattern: /assembly/i },
  { name: 'Planning Commission', pattern: /planning\s*(commission|&\s*zoning|and\s*zoning)|\bP\s*&\s*Z\b/i },
  { name: 'School Board', pattern: /school\s*board/i },
  { name: 'Service Area Boards', pattern: /service\s*area/i },
  { name: 'Other', pattern: /.*/ },
];
export function detectBody(title: string): string {
  return BODIES.find((b) => b.pattern.test(title))!.name;
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
