import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const run = promisify(execFile);

export interface Agenda {
  url: string;
  text: string;
}

/** The agenda and item memos are up front; the rest of the packet is attachments. */
const PAGES = 8;
const MAX_CHARS = 20_000;
const MAX_BYTES = 80 * 1024 * 1024;

/** Granicus serves each clip's agenda at AgendaViewer.php with the same view and clip ids. */
export function agendaUrl(sourceUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (!u.hostname.endsWith('granicus.com') || !/\/MediaPlayer\.php$/i.test(u.pathname)) return null;
  const clip = u.searchParams.get('clip_id');
  if (!clip) return null;
  const view = u.searchParams.get('view_id');
  return `https://${u.hostname}/AgendaViewer.php?${view ? `view_id=${view}&` : ''}clip_id=${clip}`;
}

/**
 * The School Board posts agendas in a public Drive folder: one folder per school
 * year ("2026-2027 School Board Meetings"), then one per meeting
 * ("30. October 21, 2026 Regular Meeting") holding "1. Agenda 10-21-2026.pdf"
 * and the item attachments.
 */
const SCHOOL_BOARD_AGENDAS = '1npPJZFTLTjyr3s99l0yG0X-0t6RL8vpF';

export interface AgendaMeeting {
  sourceUrl: string;
  body: string;
  meetingDate: Date | null;
}

/** Text of the published agenda, or null when none is posted. */
export async function fetchAgenda(meeting: AgendaMeeting, userAgent: string): Promise<Agenda | null> {
  const granicus = agendaUrl(meeting.sourceUrl);
  if (granicus) {
    const text = await pdfText(granicus, userAgent);
    if (text) return { url: granicus, text };
  }
  if (meeting.body === 'School Board' && meeting.meetingDate) return schoolBoardAgenda(meeting.meetingDate, userAgent);
  return null;
}

async function schoolBoardAgenda(date: Date, userAgent: string): Promise<Agenda | null> {
  const day = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const years = (await driveFolder(SCHOOL_BOARD_AGENDAS, userAgent)).filter((f) => /school board meetings/i.test(f.title));
  for (const year of years) {
    const meeting = (await driveFolder(year.id, userAgent)).find((f) => f.title.replace(/\s+/g, ' ').includes(day));
    if (!meeting) continue;
    const files = await driveFolder(meeting.id, userAgent);
    const agenda = files.find((f) => /agenda/i.test(f.title) && /\.pdf$/i.test(f.title));
    if (!agenda) return null;
    const text = await pdfText(`https://drive.google.com/uc?export=download&id=${agenda.id}`, userAgent);
    if (!text) return null;
    const attachments = files.filter((f) => f !== agenda).map((f) => `- ${f.title}`);
    return {
      url: `https://drive.google.com/drive/folders/${meeting.id}`,
      text: attachments.length ? `${text}\n\nAttachments posted with the agenda:\n${attachments.join('\n')}` : text,
    };
  }
  return null;
}

interface DriveEntry {
  id: string;
  title: string;
}

/** Drive's embedded folder view lists a public folder without an API key. */
async function driveFolder(id: string, userAgent: string): Promise<DriveEntry[]> {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${id}`, {
    headers: { 'User-Agent': userAgent },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Drive folder ${id} returned ${res.status}`);
  const html = await res.text();
  const out: DriveEntry[] = [];
  for (const m of html.matchAll(/<a href="[^"]*\/(?:folders|file\/d)\/([\w-]+)[^"]*"[^>]*>[\s\S]*?<div class="flip-entry-title">([^<]+)<\/div>/g)) {
    out.push({ id: m[1], title: decodeEntities(m[2]).trim() });
  }
  return out;
}

/** First pages of a PDF as text. Null when the URL serves something else, like Granicus's "not published" notice. */
async function pdfText(url: string, userAgent: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: 'application/pdf,text/html' },
    signal: AbortSignal.timeout(60_000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Agenda returned ${res.status}`);
  const size = Number(res.headers.get('content-length') || 0);
  if (size > MAX_BYTES) throw new Error(`Agenda packet is ${Math.round(size / 1e6)} MB`);
  const body = Buffer.from(await res.arrayBuffer());
  // Drive serves PDFs as application/octet-stream, so check the file itself.
  if (body.subarray(0, 5).toString('latin1') !== '%PDF-') return null;

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agenda-'));
  try {
    const file = path.join(dir, 'agenda.pdf');
    await fs.writeFile(file, body);
    const { stdout } = await run('pdftotext', ['-l', String(PAGES), '-enc', 'UTF-8', file, '-'], {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 60_000,
    });
    return tidy(stdout) || null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function tidy(s: string): string {
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line && !/^Page \d+ of \d+$/i.test(line) && !/Borough Assembly Packet$/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, MAX_CHARS);
}
