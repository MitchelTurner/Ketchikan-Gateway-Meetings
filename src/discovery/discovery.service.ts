import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { config } from '../config';
import { MediaService, VideoMeta } from '../media/media.service';
import { PrismaService } from '../prisma.service';
import { Q_PROCESS } from '../queues';
import { detectBody, parseDateFromText } from '../util';
import {
  detectVideos,
  granicusPublisherUrls,
  isGranicusPublisher,
  listEmbeds,
  meetingTitle,
  parseGranicusArchive,
  VideoRef,
} from './video-detect';

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

  /** What the archive page contains, including clips inside a Granicus publisher frame. */
  async inspect() {
    const html = await this.fetchArchiveHtml();
    return {
      archiveUrl: config.archiveUrl,
      detected: await this.collectRefs(html, config.archiveUrl, false),
      embeds: listEmbeds(html, config.archiveUrl),
      htmlBytes: html.length,
    };
  }

  async findVideos(): Promise<VideoRef[]> {
    const html = await this.fetchArchiveHtml();
    const out = await this.collectRefs(html, config.archiveUrl, true);
    if (out.length === 0) {
      this.log.warn(`No videos detected on ${config.archiveUrl}. Embeds seen: ${listEmbeds(html, config.archiveUrl).join(', ') || 'none'}`);
    }
    return out;
  }

  private async fetchHtml(url: string): Promise<string> {
    const res = await fetch(url, { headers: { 'User-Agent': config.userAgent, Accept: 'text/html' } });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return res.text();
  }

  /**
   * Direct video links on the page, plus every finished clip on a Granicus
   * ViewPublisher frame. MP4 links on that frame are the same meetings and are
   * not recorded separately.
   */
  private async collectRefs(html: string, pageUrl: string, expandLists: boolean): Promise<VideoRef[]> {
    const out = new Map<string, VideoRef>();
    const add = (r: VideoRef) => {
      const existing = out.get(r.url);
      if (!existing) out.set(r.url, r);
      else if (!existing.label && r.label) existing.label = r.label;
    };

    for (const r of detectVideos(html, pageUrl)) {
      if (r.platform === 'file' && /archive-video\.granicus\.com/i.test(r.url)) continue;
      if (r.platform === 'youtube-list' && expandLists) {
        for (const v of await this.media.expandList(r.url)) add(v);
      } else add(r);
    }

    const pages: { url: string; html: string }[] = [];
    if (isGranicusPublisher(pageUrl)) pages.push({ url: pageUrl, html });
    for (const pub of granicusPublisherUrls(html, pageUrl)) {
      if (pub === pageUrl || pages.some((p) => p.url === pub)) continue;
      try {
        pages.push({ url: pub, html: await this.fetchHtml(pub) });
      } catch (err) {
        this.log.warn(`Granicus publisher failed: ${(err as Error).message.split('\n')[0]}`);
      }
    }
    for (const page of pages) {
      const clips = parseGranicusArchive(page.html, page.url);
      this.log.log(`Granicus ${page.url}: ${clips.length} clips`);
      for (const clip of clips) out.set(clip.url, clip);
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

      // The archive row already has the meeting date. Don't ask yt-dlp about the
      // hundreds of older clips that will only be stored as SKIPPED.
      const labelDate = parseDateFromText(ref.label);
      let meta: VideoMeta = {};
      if (!labelDate) {
        try {
          meta = await this.media.getMetadata(ref.url);
        } catch (err) {
          this.log.warn(`Metadata failed for ${ref.url}: ${(err as Error).message.split('\n')[0]}`);
        }
        // A stream that's live or scheduled isn't a finished recording yet; catch it next run.
        if (meta.liveStatus === 'is_live' || meta.liveStatus === 'is_upcoming') continue;
      }

      const title = meetingTitle(meta.title, ref.label, ref.url);
      // Titles usually carry the actual meeting date; upload date can lag a day or more.
      const meetingDate = parseDateFromText(title) ?? labelDate ?? meta.date ?? null;
      const skip = !meetingDate || meetingDate < since;

      const m = await this.prisma.meeting.create({
        data: {
          sourceUrl: ref.url,
          platform: ref.platform,
          title,
          body: detectBody(title),
          meetingDate,
          durationSec: meta.durationSec ?? ref.durationSec,
          status: skip ? 'SKIPPED' : 'DISCOVERED',
        },
      });
      added++;
      if (!skip) {
        await this.enqueueProcess(m.id, meetingDate);
        queued++;
      }
    }
    const promoted = await this.promoteSkipped();
    this.log.log(`Discovery: ${refs.length} videos on page, ${added} new, ${queued} queued, ${promoted} older meetings now in the window`);
    return { found: refs.length, added, queued: queued + promoted };
  }

  /**
   * SKIPPED meetings that PROCESS_SINCE now covers (it was moved back to
   * backfill) are queued. Their status changes, so this runs once per meeting.
   */
  async promoteSkipped(): Promise<number> {
    const rows = await this.prisma.meeting.findMany({
      where: { status: 'SKIPPED', meetingDate: { gte: config.processSince } },
      select: { id: true, meetingDate: true },
    });
    let queued = 0;
    for (const m of rows) {
      // Boot and the startup discover both call this; only one may claim a meeting.
      const claimed = await this.prisma.meeting.updateMany({ where: { id: m.id, status: 'SKIPPED' }, data: { status: 'DISCOVERED', error: null } });
      if (!claimed.count) continue;
      await this.enqueueProcess(m.id, m.meetingDate);
      queued++;
    }
    return queued;
  }

  /**
   * A deploy that uses the in-container Redis drops queued jobs. Meetings in the
   * processing window that never finished — no transcript yet, or a transcript
   * with no recap — are queued again. Download and transcription are skipped
   * when those stages are already saved. Older archive rows stay put.
   */
  async requeueUnfinished(): Promise<number> {
    const pending = await this.prisma.meeting.findMany({
      where: {
        meetingDate: { gte: config.processSince },
        status: { in: ['DISCOVERED', 'RESEARCHING', 'DOWNLOADING', 'TRANSCRIBING', 'ANALYZING', 'FAILED'] },
        OR: [{ transcript: { is: null } }, { analysis: { is: null } }],
      },
      select: { id: true, meetingDate: true },
    });
    for (const m of pending) await this.enqueueProcess(m.id, m.meetingDate);
    return pending.length;
  }

  /**
   * Unsent drafts from the email window that predate the roster and agenda
   * check are rewritten with it. Backfill drafts are left alone so a deploy
   * doesn't pay to rewrite the whole archive.
   */
  async requeueOutdatedRecaps(): Promise<number> {
    const rows = await this.prisma.meeting.findMany({
      where: {
        status: { in: ['AWAITING_APPROVAL', 'FAILED'] },
        meetingDate: { gte: config.emailSince },
        transcript: { isNot: null },
        analysis: { is: { approvedAt: null, editedAt: null } },
      },
      select: { id: true, meetingDate: true, analysis: { select: { data: true } } },
    });
    let n = 0;
    for (const m of rows) {
      const data = m.analysis?.data;
      if (data && typeof data === 'object' && !Array.isArray(data) && 'checkedAgainst' in data) continue;
      await this.enqueueProcess(m.id, m.meetingDate, { refreshRecap: true });
      n++;
    }
    return n;
  }

  /** Newer meetings run first, so a backfill never holds up this week's meeting. */
  enqueueProcess(meetingId: string, meetingDate?: Date | null, opts: { refreshRecap?: boolean } = {}) {
    const daysOld = meetingDate ? Math.max(0, Math.floor((Date.now() - meetingDate.getTime()) / 86_400_000)) : 0;
    return this.processQ.add(
      'process',
      { meetingId, ...opts },
      {
        jobId: `process-${meetingId}-${Date.now()}`,
        priority: Math.min(1 + daysOld, 2_000_000),
        attempts: 3,
        backoff: { type: 'exponential', delay: 15 * 60_000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    );
  }
}
