import type { Segment } from './transcription.service';

/**
 * YouTube auto-captions repeat a sliding window of words in every cue.
 * Keep only the words that were not already in the previous cue.
 * A hand-written caption file has no overlap, so each cue is kept whole.
 */
export function parseYoutubeVtt(vtt: string): Segment[] {
  const cues = readCues(vtt);
  const out: Segment[] = [];
  let prev: string[] = [];
  for (const cue of cues) {
    const words = cue.text.split(' ').filter(Boolean);
    if (!words.length) continue;
    const fresh = words.slice(overlap(prev, words)).join(' ').trim();
    if (fresh && !/^\[(music|applause|laughter)\]$/i.test(fresh)) {
      out.push({ start: cue.start, end: cue.end, text: fresh });
    }
    prev = words;
  }
  return out;
}

/**
 * A real meeting transcript, not a few lines of intro music.
 * A track that ends well before the video does is treated as unfinished.
 */
export function usableCaptions(segments: Segment[], durationSec?: number | null): boolean {
  const text = segments.map((s) => s.text).join(' ').trim();
  if (text.length < 800) return false;
  if (durationSec && durationSec > 180) {
    const end = segments[segments.length - 1]?.end ?? 0;
    if (end < durationSec * 0.45) return false;
  }
  return true;
}

function readCues(vtt: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  for (const block of vtt.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const time = lines.find((l) => l.includes('-->'));
    if (!time) continue;
    const m = time.match(/((?:\d{1,2}:)?\d{1,2}:\d{2}\.\d{2,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}\.\d{2,3})/);
    if (!m) continue;
    const text = lines
      .filter((l) => l !== time && !/^\d+$/.test(l))
      .join(' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    out.push({ start: stamp(m[1]), end: stamp(m[2]), text });
  }
  return out;
}

function overlap(prev: string[], next: string[]): number {
  const max = Math.min(prev.length, next.length);
  for (let n = max; n > 0; n--) {
    const same = prev.slice(-n).every((w, i) => w.toLowerCase() === next[i].toLowerCase());
    if (same) return n;
  }
  return 0;
}

function stamp(value: string): number {
  const parts = value.split(':');
  const last = parts.pop() ?? '0.0';
  const [sec, ms = '0'] = last.split('.');
  const min = parts.pop() ?? '0';
  const hour = parts.pop() ?? '0';
  const milli = ms.length === 2 ? Number(ms) * 10 : Number(ms);
  return Number(hour) * 3600 + Number(min) * 60 + Number(sec) + milli / 1000;
}
