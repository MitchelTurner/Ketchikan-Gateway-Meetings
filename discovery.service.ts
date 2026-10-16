import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { config } from '../config';
import { MediaService, VideoMeta } from '../media/media.service';
import { PrismaService } from '../prisma.service';
import { Q_PROCESS } from '../queues';
import { detectBody, parseDateFromText } from '../util';
import { detectVideos, listEmbeds, VideoRef } from './video-detect';

@Injectable()
export class DiscoveryService {
  private log = new Logger(DiscoveryService.name);

  constructor(
    private prisma: PrismaService,
    private media: MediaService,
    @InjectQueue(Q_PROCESS) private processQ: Queue,
  ) {}

  async fetchArchiveHtml(): Promise<string> {
    const res = await fetch(config.archiveUrl, {
      headers: { 'User-Agent': config.userAgent, Accept: 'text/html' },
    });
    if (!res.ok) throw new Error(`Archive page returned ${res.status}`);
    return res.text();
  }

  /** What the archive page contains — for figuring out the Borough's video host. */
  async inspect() {
    const html = await this.fetchArchiveHtml();
    return {
      archiveUrl: config.archiveUrl,
      detected: detectVideos(html, config.archiveUrl),
      embeds: listEmbeds(html, config.archiveUrl),
      htmlBytes: html.length,
    };
  }

  async findVideos(): Promise<VideoRef[]> {
    const html = await this.fetchArchiveHtml();
    const refs = detectVideos(html, config.archiveUrl);
    const out = new Map<string, VideoRef>();
    for (const r of refs) {
      if (r.platform === 'youtube-list') {
        for (const v of await this.media.expandList(r.url)) if (!out.has(v.url)) out.set(v.url, v);
      } else if (!out.has(r.url)) out.set(r.url, r);
    }
    if (out.size === 0) {
      this.log.warn(`No videos detected on ${config.archiveUrl}. Embeds seen: ${listEmbeds(html, config.archiveUrl).join(', ') || 'none'}`);
    }
    return [...out.values()];
  }

  async discover(): Promise<{ found: number; added: number; queued: number }> {
    const refs = await this.findVideos();
    let added = 0;
    let queued = 0;
    const since = config.processSince;

    for (const ref of refs) {
      const exists = await this.prisma.meeting.findUnique({ where: { sourceUrl: ref.url }, select: { id: true } });
      if (exists) continue;

      let meta: VideoMeta = {};
      try {
        meta = await this.media.getMetadata(ref.url);
      } catch (err) {
        this.log.warn(`Metadata failed for ${ref.url}: ${(err as Error).message.split('\n')[0]}`);
      }
      // A stream that's live or scheduled isn't a finished recording yet; catch it next run.
      if (meta.liveStatus === 'is_live' || meta.liveStatus === 'is_upcoming') continue;

      const title = meta.title || ref.label || ref.url;
      // Titles usually carry the actual meeting date; upload date can lag a day or more.
      const meetingDate = parseDateFromText(title) ?? parseDateFromText(ref.label) ?? meta.date ?? null;
      const skip = !meetingDate || meetingDate < since;

      const m = await this.prisma.meeting.create({
        data: {
          sourceUrl: ref.url,
          platform: ref.platform,
          title,
          body: detectBody(title),
          meetingDate,
          durationSec: meta.durationSec,
          status: skip ? 'SKIPPED' : 'DISCOVERED',
        },
      });
      added++;
      if (!skip) {
        await this.enqueueProcess(m.id);
        queued++;
      }
    }
    this.log.log(`Discovery: ${refs.length} videos on page, ${added} new, ${queued} queued`);
    return { found: refs.length, added, queued };
  }

  enqueueProcess(meetingId: string) {
    return this.processQ.add(
      'process',
      { meetingId },
      {
        jobId: `process-${meetingId}-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 15 * 60_000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    );
  }
}
