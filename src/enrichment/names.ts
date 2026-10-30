/**
 * Official spellings for people the transcript is likely to mishear.
 * Live roster pages override the fallback list when they can be fetched.
 */

/**
 * "official" names (elected and appointed members) are corrected automatically
 * in the recap. "staff" names only help transcription and Claude: the
 * directory has surnames like Brown, King and Lane that would rewrite ordinary words.
 */
export type PersonGroup = 'official' | 'staff';

export interface Person {
  first: string;
  last: string;
  full: string;
  group: PersonGroup;
}

export interface RosterSource {
  label: string;
  url: string;
}

interface Roster extends RosterSource {
  group: PersonGroup;
  parse: (html: string) => string[];
  /** That page's list as of Oct 2026, used only when the page can't be read or lists too few. */
  fallback: string[];
}

const ROSTERS: Roster[] = [
  {
    label: 'Borough Assembly',
    url: 'https://www.kgbak.us/173/Mayor-and-Assembly',
    group: 'official',
    parse: (html) => [...matches(html, /<h3[^>]*>([^<]{3,80})<\/h3>/gi)],
    fallback: ['Austin Otos', 'Rodney Dial', 'Dan Ortiz', 'Bridget Mattson', 'Sharli Arntzen', 'Jaimie Palmer', 'Kathy Bolling', 'Glen Thompson'],
  },
  {
    label: 'School Board',
    url: 'https://www.kgbsd.org/en-US/school-board',
    group: 'official',
    parse: (html) => [...matches(html, /<li>\s*<strong>([^<]{3,80})<\/strong>/gi)],
    fallback: ['Melissa Reed', 'Lindsey Johnson', 'Shari Montgomery', 'Jordan Tabb', 'Ali Ginter', 'Marissa Medford', 'Frances Klein', 'Chloe Hall'],
  },
  {
    label: 'Planning Commission',
    url: 'https://www.kgbak.us/1175/Planning-Commission',
    group: 'official',
    parse: (html) => [...matches(html, /Email\s+([A-Z][^<(]{3,60}?)\s*(?:<|\()/g)],
    fallback: ['Jos Govaars', 'Trevor Shaw', 'Mitchel Turner', 'Diane Gubatayao', 'Darlene Dollimont-Svenson', 'Robb Arnold', 'Janalee Gage'],
  },
  {
    label: 'Borough staff directory',
    url: 'https://www.kgbak.us/directory.aspx',
    group: 'staff',
    parse: (html) => [...matches(html, /<a[^>]+href="[^"]*\/directory\/employee\?eid=\d+"[^>]*>\s*([^<]{3,60}?)\s*<\/a>/gi)],
    fallback: [],
  },
];

export const ROSTER_SOURCES: RosterSource[] = ROSTERS.map(({ label, url }) => ({ label, url }));

function* matches(html: string, re: RegExp): Generator<string> {
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) yield decode(m[1]);
}

const NICKNAMES = [
  ['ali', 'alexandra'],
  ['kathy', 'katherine', 'kathryn'],
  ['dan', 'daniel'],
  ['shari', 'sherry', 'sherri'],
  ['rod', 'rodney'],
  ['glen', 'glenn'],
  ['jamie', 'jaimie'],
  ['liz', 'elizabeth'],
  ['matt', 'matthew'],
];

/** Words that show up capitalized and are not people's names. */
const STOP = new Set(
  `the ketchikan borough assembly school board planning commission public south north new old howling mountain herring ward rotary special regular annual coming what also local federal volunteer gateway alaska city port point beach fire department district comment approved resolution ordinance elementary healthcare insurance finance policy committee harbor cove disaster declaration election member members mayor chair president clerk treasurer commissioner governor senator representative manager staff contact us state building cliff desk phone agenda packet meeting october november december january february march april may june july august september monday tuesday wednesday thursday friday saturday sunday`.split(
    ' ',
  ),
);

let cache: { until: number; people: Person[] } | null = null;

export function person(first: string, last: string, group: PersonGroup = 'official'): Person {
  const f = clean(first);
  const l = clean(last);
  return { first: f, last: l, full: `${f} ${l}`, group };
}

export function officials(people: Person[]): Person[] {
  return people.filter((p) => p.group === 'official');
}

export function peopleFromNames(names: string[], group: PersonGroup = 'official'): Person[] {
  const out: Person[] = [];
  for (const name of names) {
    const parts = name
      .replace(/&nbsp;/g, ' ')
      .replace(/[,;:]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ');
    if (parts.length < 2) continue;
    const last = parts[parts.length - 1];
    const first = parts[0];
    if (!looksLikeName(first) || !looksLikeName(last)) continue;
    if (STOP.has(first.toLowerCase()) || STOP.has(last.toLowerCase())) continue;
    out.push(person(first, last, group));
  }
  return dedupe(out);
}

const FIRST = "[A-Z][a-z'’]{2,}";
const LAST = "[A-Z](?:[a-z'’]+|-[A-Z][a-z'’]+)+";

export async function loadRoster(userAgent: string): Promise<Person[]> {
  if (cache && Date.now() < cache.until) return cache.people;
  let unreachable = false;
  const lists = await Promise.all(
    ROSTERS.map(async (r) => {
      const backup = peopleFromNames(r.fallback, r.group);
      try {
        const parsed = peopleFromNames(r.parse(await getText(r.url, userAgent)), r.group);
        // A redesign that drops most names shouldn't shrink the list the recap checks against.
        return parsed.length >= Math.max(1, Math.ceil(backup.length / 2)) ? parsed : backup;
      } catch {
        unreachable = true;
        return backup;
      }
    }),
  );
  // An official who is also in the staff directory keeps the official entry.
  const people = dedupe(lists.flat());
  // kgbak.us times out now and then; don't hold a fallback-only list for long.
  cache = { until: Date.now() + (unreachable ? 15 * 60_000 : 6 * 3600_000), people };
  return people;
}

/** Officials first, then staff, as exact spellings for AssemblyAI to favor. */
export function transcriptionTerms(people: Person[], max = 150): string[] {
  const sorted = [...officials(people), ...people.filter((p) => p.group === 'staff')];
  return [...new Set(sorted.map((p) => p.full))].slice(0, max);
}

export function correctNames(text: string, people: Person[]): { text: string; changes: string[] } {
  if (!text || !people.length) return { text, changes: [] };
  const changes: string[] = [];
  let out = replaceFullNames(text, people, changes);
  out = replaceTitledLast(out, people, changes);
  out = replaceStandaloneLast(out, people, changes);
  return { text: out, changes: unique(changes) };
}

/** "Member Sherry Montgomery" must pair Sherry with Montgomery, not Member with Sherry. */
const NOT_FIRST = `(?!(?:${[...STOP].map((w) => w[0].toUpperCase() + w.slice(1)).join('|')})\\b)`;

function replaceFullNames(text: string, people: Person[], changes: string[]): string {
  return text.replace(new RegExp(`\\b${NOT_FIRST}(${FIRST})\\s+(${LAST})\\b`, 'g'), (span, first: string, last: string) => {
    const lastStem = stem(last);
    if (STOP.has(first.toLowerCase()) || STOP.has(lastStem.toLowerCase())) return span;
    const hit = bestPerson(first, lastStem, people);
    if (!hit) return span;
    const canonical = `${hit.first} ${hit.last}`;
    if (canonical.toLowerCase() === `${first} ${lastStem}`.toLowerCase()) return span;
    changes.push(`${first} ${lastStem} → ${canonical}`);
    return canonical + possessive(last);
  });
}

function replaceTitledLast(text: string, people: Person[], changes: string[]): string {
  return text.replace(
    new RegExp(`\\b(Mayor|Member|Chair|President|Commissioner|Clerk|Ms|Mr|Mrs|Dr)\\.?\\s+(${LAST})\\b`, 'g'),
    (span, title: string, last: string) => {
      const lastStem = stem(last);
      const hit = bestLast(lastStem, people);
      if (!hit || hit.last.toLowerCase() === lastStem.toLowerCase()) return span;
      changes.push(`${lastStem} → ${hit.last}`);
      return `${title} ${hit.last}${possessive(last)}`;
    },
  );
}

/**
 * A bare surname. Skipped after a first name that didn't match the roster
 * ("Tom Reid" is someone else) and at the start of a sentence ("Read the
 * proclamation" is not "Reed"), unless it opens a list of roster surnames
 * ("Bowling, Mattson, Ortez and Palmer voted yes").
 */
function replaceStandaloneLast(text: string, people: Person[], changes: string[]): string {
  const known = new Set(people.map((p) => p.last.toLowerCase()));
  return text.replace(new RegExp(`\\b(${LAST})\\b`, 'g'), (span, token: string, offset: number) => {
    const before = text.slice(Math.max(0, offset - 40), offset);
    if (/[A-Z][a-z'’]+\s+$/.test(before) && !/[.!?:;]\s+$/.test(before)) return span;
    if (/(^|[.!?:;"“(—–-]|\n)\s*$/.test(before) && !opensNameList(text.slice(offset + token.length, offset + token.length + 60), known)) {
      return span;
    }
    const tokenStem = stem(token);
    if (STOP.has(tokenStem.toLowerCase())) return span;
    const hit = bestLast(tokenStem, people);
    if (!hit || hit.last.toLowerCase() === tokenStem.toLowerCase()) return span;
    changes.push(`${tokenStem} → ${hit.last}`);
    return hit.last + possessive(token);
  });
}

function opensNameList(after: string, known: Set<string>): boolean {
  const m = after.match(new RegExp(`^(?:,\\s*|\\s+and\\s+)(${LAST})\\b`));
  return !!m && known.has(stem(m[1]).toLowerCase());
}

function bestPerson(first: string, last: string, people: Person[]): Person | null {
  let best: { p: Person; score: number } | null = null;
  let second = 99;
  for (const p of people) {
    const ld = editDistance(last.toLowerCase(), p.last.toLowerCase());
    const fd = editDistance(first.toLowerCase(), p.first.toLowerCase());
    if (!lastOk(last, p.last, ld) || !firstOk(first, p.first, fd, ld)) continue;
    const score = ld * 2 + (sameName(first, p.first) ? 0 : fd);
    if (!best || score < best.score) {
      second = best ? best.score : 99;
      best = { p, score };
    } else if (score < second) second = score;
  }
  if (!best || second === best.score) return null;
  return best.p;
}

function bestLast(token: string, people: Person[]): Person | null {
  if (people.some((p) => p.last.toLowerCase() === token.toLowerCase())) return null;
  const hits = people.filter((p) => {
    const ld = editDistance(token.toLowerCase(), p.last.toLowerCase());
    return ld > 0 && lastOk(token, p.last, ld);
  });
  const spellings = new Set(hits.map((p) => p.last.toLowerCase()));
  if (spellings.size !== 1) return null;
  return hits[0];
}

function lastOk(token: string, canonical: string, distance: number): boolean {
  if (distance === 0 || distance === 1) return true;
  if (distance === 2 && token.length >= 7 && canonical.length >= 7 && token.slice(0, 4).toLowerCase() === canonical.slice(0, 4).toLowerCase()) {
    return true;
  }
  const a = token.toLowerCase().replace(/^[a-z]-/, '');
  const b = canonical.toLowerCase().replace(/^[a-z]-/, '');
  return a.length >= 6 && (canonical.toLowerCase().endsWith(a) || token.toLowerCase().endsWith(b));
}

function firstOk(token: string, canonical: string, distance: number, lastDistance: number): boolean {
  if (distance === 0 || sameName(token, canonical)) return true;
  if (distance === 1 && token.length >= 4) return true;
  return lastDistance === 0 && distance <= 2 && token.length >= 4;
}

function stem(token: string): string {
  return token.replace(/['’]s$/i, '');
}

function possessive(token: string): string {
  const m = token.match(/['’]s$/i);
  return m ? m[0] : '';
}

function sameName(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return true;
  return NICKNAMES.some((group) => group.includes(x) && group.includes(y));
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 9;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let corner = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? corner : 1 + Math.min(corner, prev[j], prev[j - 1]);
      corner = next;
    }
  }
  return prev[b.length];
}

function looksLikeName(part: string): boolean {
  return new RegExp(`^(?:${FIRST}|${LAST})$`).test(part);
}

function clean(part: string): string {
  return part.replace(/[.’']/g, (ch) => (ch === '.' ? '' : "'")).replace(/\s+/g, ' ').trim();
}

function dedupe(people: Person[]): Person[] {
  const seen = new Set<string>();
  const out: Person[] = [];
  for (const p of people) {
    const key = p.full.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getText(url: string, userAgent: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: 'text/html' },
    signal: AbortSignal.timeout(30_000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}
