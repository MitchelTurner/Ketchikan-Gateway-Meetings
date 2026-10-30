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
 * Text of the published agenda, or null when the clip has none. An unpublished
 * agenda comes back as a short HTML notice instead of a PDF.
 */
export async function fetchAgenda(sourceUrl: string, userAgent: string): Promise<Agenda | null> {
  const url = agendaUrl(sourceUrl);
  if (!url) return null;
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: 'application/pdf,text/html' },
    signal: AbortSignal.timeout(60_000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Agenda returned ${res.status}`);
  if (!/pdf/i.test(res.headers.get('content-type') || '')) return null;
  const size = Number(res.headers.get('content-length') || 0);
  if (size > MAX_BYTES) throw new Error(`Agenda packet is ${Math.round(size / 1e6)} MB`);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agenda-'));
  try {
    const file = path.join(dir, 'agenda.pdf');
    await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
    const { stdout } = await run('pdftotext', ['-l', String(PAGES), '-enc', 'UTF-8', file, '-'], {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 60_000,
    });
    const text = tidy(stdout);
    return text ? { url, text } : null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
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
