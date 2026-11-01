/**
 * Votes at one meeting are cast by the same people. A tally that adds up to
 * fewer (or more) than the others is a missed name, unless someone sat out.
 */

export interface VoteAction {
  item?: string;
  outcome?: string;
  vote?: string;
}

export interface VoteRead {
  /** Yes + no + abstain. Abstaining still counts as voting. */
  total: number | null;
  /** People the tally itself says sat the vote out. */
  satOut: number;
  /** The transcript says this count is incomplete or may be wrong. */
  partial: boolean;
  /** The mayor voted only to break a tie, so this roll call can be one person larger. */
  tieBreak: boolean;
  /** A show of hands for direction, not a vote of the whole body. */
  direction: boolean;
}

const WORD: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};

function wordNum(raw: string): number | null {
  const t = raw.toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return WORD[t] ?? null;
}

function norm(s: string): string {
  return s.replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim();
}

function sitOutCount(text: string): number {
  const m = text.match(/\b(one|two|three|four|\d+)\s+(?:members?\s+)?(?:had left|left|absent|excused|recus\w*|sat out)/i);
  if (m) return wordNum(m[1]) ?? 0;
  if (/\bone member (?:had left|left|was absent|recus)/i.test(text)) return 1;
  return 0;
}

/** Read a tally. Ordinance numbers in the item title are ignored. */
export function readVote(vote = '', outcome = ''): VoteRead {
  const blob = norm(`${outcome} ${vote}`);
  const partial = /unclear|misheard|as heard|votes heard|vote heard|name unclear|cut off|not clearly|not stated|no vote count|no formal vote|does not clearly|partly unclear/i.test(blob);
  const tieBreak = /mayor broke|broke the tie|broke a \d|tie-break|tie break/i.test(blob);
  const direction = /\b\d+\s+hands\b|members agreeing|four-hands|four hands/i.test(blob);
  const satOut = sitOutCount(blob);
  let yes: number | null = null;
  let no = 0;
  let abstain = 0;
  const split = blob.match(/(?<!\d)(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?(?!\d)/);
  if (split) {
    const a = Number(split[1]);
    const b = Number(split[2]);
    const c = split[3] ? Number(split[3]) : 0;
    if (a <= 15 && b <= 15 && c <= 15) {
      yes = a;
      no = b;
      abstain = c;
    }
  }
  if (yes === null) {
    const to = blob.match(/\b(\d+)\s+to\s+(\d+)\b/);
    if (to && Number(to[1]) <= 15 && Number(to[2]) <= 15) {
      yes = Number(to[1]);
      no = Number(to[2]);
    }
  }
  if (yes === null) {
    const y = blob.match(/\b(one|two|three|four|five|six|seven|eight|nine|\d+)\s+yes\b/i);
    if (y) {
      yes = wordNum(y[1]);
      const n = blob.match(/\b(one|two|three|four|five|six|seven|eight|nine|\d+)\s+no\b/i);
      no = n ? (wordNum(n[1]) ?? 0) : 0;
    }
  }
  if (yes !== null && abstain === 0) {
    const a = blob.match(/\b(one|two|three|four|\d+)\s+abst/i);
    if (a) abstain = wordNum(a[1]) ?? 0;
  }
  let total = yes === null ? null : yes + no + abstain;
  if (total !== null && (total < 2 || total > 15)) total = null;
  if (direction) return { total: null, satOut, partial, tieBreak, direction: true };
  return { total, satOut, partial, tieBreak, direction: false };
}

function actionExplains(text: string, shortfall: number): boolean {
  if (shortfall <= 0) return false;
  if (!/conflict of interest|\brecus|unable to vote|did not (?:take part|vote)|\babsent\b|\bexcused\b|had left|left the (?:meeting|dais|room)|stepped aside|sat out/i.test(text)) return false;
  if (/no conflict|has no conflict|ruled no conflict/i.test(text) && !/unable to vote|barred from/i.test(text)) return false;
  const n = sitOutCount(text);
  return shortfall <= (n || 1);
}

/** A caveat that names both the reason someone sat out and this same tally. */
function proseExcuses(vote: string, prose: string): boolean {
  const tally = norm(vote).match(/\d+\s*-\s*\d+(?:\s*-\s*\d+)?/);
  if (!tally) return false;
    const key = tally[0].replace(/\s+/g, '');
    const parts = prose.split(/(?<=[.!?])\s+/);
    for (let i = 0; i < parts.length; i++) {
      const window = norm(`${parts[i]} ${parts[i + 1] ?? ''}`);
      const tight = window.replace(/\s+/g, '');
      if (!new RegExp(`(?<!\\d)${key}(?!\\d)`).test(tight)) continue;
      if (!/conflictofinterest|recus|unabletovote|didnottakepart|didnotvote|hadleft|leftbefore|absent|excused|steppedaside|satout/i.test(tight)) continue;
      if (/noconflict|hasnoconflict|rulednoconflict/i.test(tight) && !/unabletovote|barredfrom/i.test(tight)) continue;
      return true;
    }
  return false;
}

function fits(read: VoteRead, head: number, vote: string, item: string, outcome: string, prose: string): boolean {
  if (read.total == null) return true;
  if (read.total === head) return true;
  if (read.satOut && read.total + read.satOut === head) return true;
  if (read.tieBreak && (read.total === head || read.total === head + 1)) return true;
  const own = `${item} ${outcome} ${vote}`;
  if (/student member/i.test(own) && (read.total === head || read.total === head + 1)) return true;
  const short = head - read.total;
  // A vote on whether someone has a conflict usually leaves that person out.
  if (short === 1 && /conflict of interest/i.test(own)) return true;
  if (actionExplains(own, short)) return true;
  if (short > 0 && proseExcuses(vote, prose)) return true;
  return false;
}

/**
 * The number of people voting that night: the count that shows up most often.
 * A tie goes to the larger count. A partial roll call, a mayor's tie-break,
 * and a show of hands do not set it.
 */
export function meetingHeadcount(actions: VoteAction[]): number | null {
  const counts = new Map<number, number>();
  for (const a of actions) {
    const read = readVote(a.vote ?? '', a.outcome ?? '');
    if (read.total == null || read.partial || read.tieBreak || read.direction) continue;
    if (read.total < 3 || read.total > 12) continue;
    counts.set(read.total, (counts.get(read.total) ?? 0) + 1);
  }
  if (!counts.size) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

/** A short clause when this tally does not match the rest of the meeting. Empty when it does. */
export function voteNote(action: VoteAction, head: number | null, prose = ''): string {
  if (!head) return '';
  const vote = action.vote ?? '';
  const read = readVote(vote, action.outcome ?? '');
  if (read.total == null || read.direction) return '';
  if (fits(read, head, vote, action.item ?? '', action.outcome ?? '', prose)) return '';
  if (read.partial && new RegExp(`\\b${head}\\b`).test(vote)) return '';
  return read.total < head ? `short of the ${head} on the other votes` : `more than the ${head} on the other votes`;
}

/** Shown on the meeting when subscriber email is waiting on a mismatched tally. */
export const VOTE_HOLD = 'Email held: a vote count does not match the rest of this meeting.';

/** True when any tally does not fit the headcount of that meeting. */
export function voteMismatch(actions: VoteAction[], prose = ''): boolean {
  return reviewVotes(actions, prose).notes.some(Boolean);
}

export function reviewVotes(actions: VoteAction[], prose = ''): { headcount: number | null; notes: string[] } {
  const headcount = meetingHeadcount(actions);
  return { headcount, notes: actions.map((a) => voteNote(a, headcount, prose)) };
}

/** Summary, caveats, and discussion, where a conflict disclosure usually lives. */
export function voteProse(d: { summary?: string; caveats?: string[]; discussion?: { topic?: string; gist?: string }[] }): string {
  return [
    d.summary ?? '',
    ...(d.caveats ?? []),
    ...(d.discussion ?? []).map((x) => `${x.topic ?? ''} ${x.gist ?? ''}`),
  ].join(' ');
}
