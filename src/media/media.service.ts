import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { config } from '../config';
import {
  granicusDownloadUrl,
  granicusPlayerTitle,
  granicusSiteOrigin,
  VideoRef,
} from '../discovery/video-detect';

const run = promisify(execFile);
const BIG = { maxBuffer: 512 * 1024 * 1024 };
// CloudFront in front of archive-video.granicus.com rejects the app's identifying
// user agent. Page fetches still use config.userAgent.
const GRANICUS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface VideoMeta {
  title?: string;
  date?: Date;
  durationSec?: number;
  liveStatus?: string; // is_live | is_upcoming | was_live | not_live
}

/** Wraps yt-dlp and ffmpeg (both installed in the Docker image). */
@Injectable()
export class MediaService {
  private log = new Logger(MediaService.name);
  private cookiesPath: string | null | undefined;

  private async cookieArgs(): Promise<string[]> {
    if (this.cookiesPath === undefined) {
      this.cookiesPath = null;
      if (config.ytdlpCookiesB64) {
        this.cookiesPath = path.join(os.tmpdir(), 'ytdlp-cookies.txt');
        await fs.writeFile(this.cookiesPath, Buffer.from(config.ytdlpCookiesB64, 'base64'));
      }
    }
    return this.cookiesPath ? ['--cookies', this.cookiesPath] : [];
  }

  private async ytdlp(args: string[], timeoutMs = 30 * 60_000, extra: string[] = []): Promise<string> {
    const { stdout } = await run(config.ytdlpPath, [...(await this.cookieArgs()), '--no-warnings', ...extra, ...args], {
      ...BIG,
      timeout: timeoutMs,
    });
    return stdout;
  }

  /** MediaPlayer.php is not a yt-dlp URL. The player page links the MP3. */
  private async resolvePlayable(url: string): Promise<{ url: string; extra: string[]; title?: string }> {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.endsWith('granicus.com') && /\/MediaPlayer\.php$/i.test(u.pathname)) {
      const res = await fetch(url, { headers: { 'User-Agent': config.userAgent, Accept: 'text/html' } });
      if (!res.ok) throw new Error(`Granicus player returned ${res.status} for ${url}`);
      const html = await res.text();
      const file = granicusDownloadUrl(html);
      if (!file) throw new Error(`No audio file on Granicus player ${url}`);
      return { url: file, extra: this.granicusHeaderArgs(file), title: granicusPlayerTitle(html) };
    }
    if (host === 'archive-video.granicus.com' || host.endsWith('.granicus.com')) {
      return { url, extra: this.granicusHeaderArgs(url) };
    }
    return { url, extra: [] };
  }

  private granicusHeaderArgs(fileUrl: string): string[] {
    const origin = granicusSiteOrigin(fileUrl);
    return ['--referer', `${origin}/`, '--add-header', `Origin:${origin}`, '--user-agent', GRANICUS_UA];
  }

  /** Expands a YouTube channel or playlist into individual videos (most recent first). */
  async expandList(url: string): Promise<VideoRef[]> {
    const targets = url.includes('/playlist?') ? [url] : [`${url}/streams`, `${url}/videos`];
    const out: VideoRef[] = [];
    for (const target of targets) {
      try {
        const json = JSON.parse(
          await this.ytdlp(['--flat-playlist', '-J', '--playlist-end', String(config.channelListLimit), target], 5 * 60_000),
        );
        for (const e of json.entries ?? []) {
          if (e?.id && /^[\w-]{11}$/.test(e.id)) {
            out.push({ url: `https://www.youtube.com/watch?v=${e.id}`, platform: 'youtube', label: e.title });
          }
        }
      } catch (err) {
        this.log.debug(`No entries from ${target}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
    return out;
  }

  async getMetadata(url: string): Promise<VideoMeta> {
    const playable = await this.resolvePlayable(url);
    const j = JSON.parse(await this.ytdlp(['-J', '--no-playlist', '--skip-download', playable.url], 5 * 60_000, playable.extra));
    let date: Date | undefined;
    const ts = j.release_timestamp ?? j.timestamp;
    if (ts) date = new Date(ts * 1000);
    else if (/^\d{8}$/.test(j.upload_date ?? '')) {
      const d = j.upload_date as string;
      date = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), 12));
    }
    const fileTitle = typeof j.title === 'string' ? j.title : undefined;
    return {
      title: playable.title || fileTitle,
      date,
      durationSec: j.duration ? Math.round(j.duration) : undefined,
      liveStatus: j.live_status,
    };
  }

  /**
   * English captions already on a YouTube video, hand-written or auto-generated.
   * Returns the VTT text, or null when YouTube has none.
   */
  async youtubeCaptions(url: string): Promise<string | null> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'caps-'));
    try {
      await this.ytdlp(
        [
          '--skip-download',
          '--write-subs',
          '--write-auto-subs',
          '--sub-langs', 'en.*',
          '--sub-format', 'vtt',
          '--convert-subs', 'vtt',
          '--no-playlist',
          '-o', path.join(dir, 'cap.%(ext)s'),
          url,
        ],
        3 * 60_000,
      );
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.vtt'));
      let best = '';
      for (const file of files) {
        const text = await fs.readFile(path.join(dir, file), 'utf8');
        if (text.length > best.length) best = text;
      }
      return best || null;
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  /** Downloads audio only, as small mono 16 kHz MP3 (~15 MB/hour). Returns the file path. */
  async downloadAudio(url: string, dir: string): Promise<string> {
    const playable = await this.resolvePlayable(url);
    const out = path.join(dir, 'audio.mp3');
    await this.ytdlp(
      [
        '-f', 'bestaudio/best',
        '-x', '--audio-format', 'mp3',
        '--postprocessor-args', 'ExtractAudio:-ac 1 -ar 16000 -b:a 32k',
        '--no-playlist',
        '-o', path.join(dir, 'audio.%(ext)s'),
        playable.url,
      ],
      3 * 60 * 60_000,
      playable.extra,
    );
    await this.normalizeAudio(dir, out);
    return out;
  }

  /**
   * yt-dlp leaves an already-MP3 file untouched, so Granicus audio stays at
   * 48 kHz stereo. Re-encode anything that isn't the small speech file.
   */
  private async normalizeAudio(dir: string, out: string): Promise<void> {
    const files = (await fs.readdir(dir)).filter((f) => f.startsWith('audio.'));
    if (!files.length) throw new Error('yt-dlp did not produce an audio file');
    const srcName = files.find((f) => f === 'audio.mp3') ?? files[0];
    const src = path.join(dir, srcName);
    const shape = await this.audioShape(src);
    if (srcName === 'audio.mp3' && shape.rate === 16000 && shape.channels === 1) return;
    const raw = path.join(dir, `raw-audio${path.extname(srcName) || '.bin'}`);
    await fs.rename(src, raw);
    await run(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-ac', '1', '-ar', '16000', '-b:a', '32k', out],
      BIG,
    );
  }

  private async audioShape(file: string): Promise<{ rate?: number; channels?: number }> {
    try {
      const { stdout } = await run('ffprobe', [
        '-v', 'error', '-select_streams', 'a:0',
        '-show_entries', 'stream=sample_rate,channels', '-of', 'csv=p=0', file,
      ]);
      const [rate, channels] = stdout.trim().split(',').map((n) => parseInt(n, 10));
      return { rate, channels };
    } catch {
      return {};
    }
  }

  /** Splits audio into chunks (for APIs with upload size limits). Returns [{ file, offsetSec }]. */
  async splitAudio(file: string, chunkSec: number): Promise<{ file: string; offsetSec: number }[]> {
    const dir = path.dirname(file);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'segment', '-segment_time', String(chunkSec),
      '-c', 'copy', path.join(dir, 'chunk_%03d.mp3')], BIG);
    const chunks = (await fs.readdir(dir)).filter((f) => f.startsWith('chunk_')).sort();
    const out: { file: string; offsetSec: number }[] = [];
    let offset = 0;
    for (const c of chunks) {
      const full = path.join(dir, c);
      out.push({ file: full, offsetSec: offset });
      offset += await this.durationOf(full);
    }
    return out;
  }

  async durationOf(file: string): Promise<number> {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    return parseFloat(stdout.trim()) || 0;
  }
}
