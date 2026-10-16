import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { config } from '../config';
import { VideoRef } from '../discovery/video-detect';

const run = promisify(execFile);
const BIG = { maxBuffer: 512 * 1024 * 1024 };

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

  private async ytdlp(args: string[], timeoutMs = 30 * 60_000): Promise<string> {
    const { stdout } = await run(config.ytdlpPath, [...(await this.cookieArgs()), '--no-warnings', ...args], {
      ...BIG,
      timeout: timeoutMs,
    });
    return stdout;
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
    const j = JSON.parse(await this.ytdlp(['-J', '--no-playlist', '--skip-download', url], 5 * 60_000));
    let date: Date | undefined;
    const ts = j.release_timestamp ?? j.timestamp;
    if (ts) date = new Date(ts * 1000);
    else if (/^\d{8}$/.test(j.upload_date ?? '')) {
      const d = j.upload_date as string;
      date = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), 12));
    }
    return {
      title: j.title,
      date,
      durationSec: j.duration ? Math.round(j.duration) : undefined,
      liveStatus: j.live_status,
    };
  }

  /** Downloads audio only, as small mono 16 kHz MP3 (~15 MB/hour). Returns the file path. */
  async downloadAudio(url: string, dir: string): Promise<string> {
    await this.ytdlp(
      [
        '-f', 'bestaudio/best',
        '-x', '--audio-format', 'mp3',
        '--postprocessor-args', 'ExtractAudio:-ac 1 -ar 16000 -b:a 32k',
        '--no-playlist',
        '-o', path.join(dir, 'audio.%(ext)s'),
        url,
      ],
      3 * 60 * 60_000,
    );
    return path.join(dir, 'audio.mp3');
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
