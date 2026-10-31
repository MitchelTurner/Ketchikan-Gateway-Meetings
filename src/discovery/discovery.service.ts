import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { config } from '../config';
import { MediaService, VideoMeta } from '../media/media.service';
import { PrismaService } from '../prisma.service';
import { Q_PROCESS } from '../queues';
import { CITY_FALLBACK_BODY, detectBody, parseDateFromText } from '../util';
import {
  detectVideos,
  granicusPublisherUrls,
  isGranicusPublisher,
  listEmbeds,
  meetingTitle,
  parseGranicusArchive,
  parseYoutubeChannelVideos,
  parseYoutubeWatchPage,
  VideoRef,
} from './video-detect';

// YouTube serves a shell page to the identifying scraper UA. A browser UA gets the video list.
const YOUTUBE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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
    const found: { ref: VideoRef; fallbackBody: string }[] = [];
    const seen = new Set<string>();
    const add = (ref: VideoRef, fallbackBody: string) => {
      if (seen.has(ref.url)) return;
      seen.add(ref.url);
      found.push({ ref, fallbackBody });
    };
    try {
      for (const ref of await this.findVideos()) add(ref, 'Other');
    } catch (err) {
      this.log.warn(`Borough archive failed: ${(err as Error).message.split('\n')[0]}`);
    }
    for (const ref of await this.findCityVideos()) add(ref, CITY_FALLBACK_BODY);

    let added = 0;
    let queued = 0;
    const since = config.processSince;

    for (const item of found) {
      const ref = item.ref;
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
        if (!meta.date && ref.platform === 'youtube') {
          try {
            const page = parseYoutubeWatchPage(await this.fetchYoutube(ref.url));
            const published = parseDateFromText(page.dateText);
            if (published || page.title || page.durationSec) {
              meta = {
                ...meta,
                date: meta.date ?? published ?? undefined,
                title: meta.title || page.title,
                durationSec: meta.durationSec ?? page.durationSec,
              };
            }
          } catch (err) {
            this.log.warn(`YouTube page failed for ${ref.url}: ${(err as Error).message.split('\n')[0]}`);
          }
        }
      }

      const title = meetingTitle(meta.title, ref.label, ref.url);
      // Titles usually carry the actual meeting date; upload date can lag a day or more.
      const meetingDate = parseDateFromText(title) ?? labelDate ?? meta.date ?? null;
      // A city upload with no date yet is left for the next check, instead of
      // being stored as SKIPPED forever.
      if (!meetingDate && ref.platform === 'youtube') {
        this.log.warn(`No date for ${ref.url}; will try again next check`);
        continue;
      }
      const skip = !meetingDate || meetingDate < since;

      const m = await this.prisma.meeting.create({
        data: {
          sourceUrl: ref.url,
          platform: ref.platform,
          title,
          body: detectBody(title, item.fallbackBody),
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
    this.log.log(`Discovery: ${found.length} videos, ${added} new, ${queued} queued, ${promoted} older meetings now in the window`);
    return { found: found.length, added, queued: queued + promoted };
  }

  /** City of Ketchikan uploads. yt-dlp when it can list the channel, and the public videos page either way. */
  private async findCityVideos(): Promise<VideoRef[]> {
    const url = config.cityYoutubeUrl.trim();
    if (!url) return [];
    const out = new Map<string, VideoRef>();
    const add = (list: VideoRef[]) => {
      for (const ref of list) {
        if (ref.platform !== 'youtube') continue;
        const existing = out.get(ref.url);
        if (!existing) out.set(ref.url, ref);
        else if (!existing.label && ref.label) existing.label = ref.label;
      }
    };
    try {
      add(await this.media.expandList(url));
    } catch (err) {
      this.log.warn(`City YouTube list failed: ${(err as Error).message.split('\n')[0]}`);
    }
    try {
      const html = await this.fetchYoutube(this.cityListingPage(url));
      add(parseYoutubeChannelVideos(html).slice(0, config.channelListLimit));
    } catch (err) {
      this.log.warn(`City channel page failed: ${(err as Error).message.split('\n')[0]}`);
    }
    this.log.log(`City of Ketchikan: ${out.size} recent videos`);
    return [...out.values()];
  }

  private cityListingPage(url: string): string {
    const bare = url.replace(/\/+$/, '');
    if (/\/(videos|streams|shorts)$/.test(bare) || bare.includes('/playlist?') || bare.includes('watch?')) return bare;
    return `${bare}/videos`;
  }

  private async fetchYoutube(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: { 'User-Agent': YOUTUBE_UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html' },
    });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return res.text();
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
