import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Meeting } from '@prisma/client';
import { Queue } from 'bullmq';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AnalysisService, MeetingDigest, normalizeDigest } from '../analysis/analysis.service';
import { emptyRecording } from '../analysis/empty-recording';
import { config } from '../config';
import { EmailService } from '../email/email.service';
import { renderHtml, renderSubject, renderText, RenderInput } from '../email/render';
import { withPublishedSources } from '../enrichment/context';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma.service';
import { Q_CONTROL, Q_EMAIL } from '../queues';
import { MeetingContext, normalizeContext, ResearchService, vocabulary } from '../research/research.service';
import { TopicsService } from '../topics/topics.service';
import { Segment, TranscriptionService } from '../transcription/transcription.service';
import { parseYoutubeVtt, usableCaptions } from '../transcription/youtube-vtt';
import { PushService } from '../push/push.service';
import { ensureRefCode, inviteUrl, referralCount } from '../referrals';
import { esc, parseDateFromText, sign, slugify, spokenMeetingDate, transcriptOpening } from '../util';

const BACKFILL_NOTE = 'Backfill: older than EMAIL_SINCE, so no email is sent. Approve to publish it on /notes.';

/** Older meetings are published on /notes and never emailed. A meeting with no date is treated as current. */
export function isBackfill(m: { meetingDate: Date | null }): boolean {
  return !!m.meetingDate && m.meetingDate < config.emailSince;
}

@Injectable()
export class PipelineService {
  private log = new Logger(PipelineService.name);

  constructor(
    private prisma: PrismaService,
    private media: MediaService,
    private research: ResearchService,
    private topics: TopicsService,
    private transcription: TranscriptionService,
    private analysis: AnalysisService,
    private email: EmailService,
    private push: PushService,
    @InjectQueue(Q_CONTROL) private controlQ: Queue,
    @InjectQueue(Q_EMAIL) private emailQ: Queue,
  ) {}

  /** research → download → transcribe → analyze → (approval email | deliver). Each stage is skipped if already done. */
  async processMeeting(meetingId: string, opts: { refreshRecap?: boolean } = {}) {
    let meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: { research: true, transcript: true, analysis: true },
    });
    if (['SENDING', 'SENT', 'PUBLISHED'].includes(meeting.status)) return;

    try {
      // A refresh rewrites an unsent draft with the current sources; a sent recap stays as mailed.
      const redo = !!opts.refreshRecap && !!meeting.analysis && !meeting.analysis.approvedAt && !meeting.analysis.editedAt;
      let wroteAnalysis = false;
      let fresh: MeetingDigest | null = null;
      let context = meeting.research ? normalizeContext(meeting.research.data) : null;
      if (!context && (!meeting.analysis || redo) && config.researchEnabled) context = await this.runResearch(meeting);
      if (!meeting.transcript || !meeting.analysis || redo) {
        context ??= config.knownNames.length ? { people: config.knownNames, agenda: [], terms: [], articles: [] } : null;
        context = await withPublishedSources(meeting, context, config.userAgent);
      }

      let segments = meeting.transcript?.segments as Segment[] | undefined;
      if (!segments) {
        const captions = await this.youtubeTranscript(meeting);
        if (captions) {
          segments = captions;
          await this.prisma.transcript.create({
            data: {
              meetingId,
              provider: 'youtube',
              segments: segments as any,
              text: segments.map((s) => s.text).join(' '),
            },
          });
        } else {
          const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-'));
          try {
            await this.setStatus(meetingId, 'DOWNLOADING');
            const audio = await this.media.downloadAudio(meeting.sourceUrl, dir);
            await this.setStatus(meetingId, 'TRANSCRIBING');
            segments = await this.transcription.transcribe(audio, vocabulary(context));
            if (!segments.length) throw new Error('Transcript came back empty');
            await this.prisma.transcript.create({
              data: {
                meetingId,
                provider: this.transcription.providerName,
                segments: segments as any,
                text: segments.map((s) => s.text).join(' '),
              },
            });
          } finally {
            await fs.rm(dir, { recursive: true, force: true });
          }
        }
      }

      if (segments?.length && (!meeting.analysis || redo) && !parseDateFromText(meeting.title)) {
        meeting = await this.alignSpokenDate(meeting, segments);
      }

      if (!meeting.analysis) {
        await this.setStatus(meetingId, 'ANALYZING');
        fresh = await this.analysis.analyze(meeting, segments, context);
        await this.prisma.analysis.create({ data: { meetingId, model: this.analysis.model, data: fresh as any } });
        wroteAnalysis = true;
      } else if (redo) {
        await this.setStatus(meetingId, 'ANALYZING');
        try {
          fresh = await this.analysis.analyze(meeting, segments, context);
          await this.prisma.analysis.update({ where: { meetingId }, data: { model: this.analysis.model, data: fresh as any } });
        } catch (err) {
          // The earlier draft stays up; the next deploy tries again.
          this.log.warn(`${meetingId}: recap refresh failed, keeping the earlier draft: ${(err as Error).message}`);
          await this.prisma.meeting.update({
            where: { id: meetingId },
            data: { status: 'AWAITING_APPROVAL', error: `Recap refresh failed, showing the earlier draft: ${(err as Error).message}`.slice(0, 2000) },
          });
          return;
        }
      }

      const recap = fresh ?? (meeting.analysis ? normalizeDigest(meeting.analysis.data) : null);
      if (recap && emptyRecording(recap)) {
        // The file is a microphone check. Keep it off the site and out of subscriber mail.
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { status: 'PUBLISHED', error: 'Recording is only a microphone check, so no recap was published.' },
        });
        this.log.log(`${meetingId}: recording is only a microphone check; recap stays off the site`);
        return;
      }

      // Topics are extra: a failure is logged and retried by the next tag-topics run.
      if (!meeting.analysis || !meeting.topicsAt) {
        await this.topics
          .tagMeeting(meetingId, { allowDeepDive: !isBackfill(meeting) })
          .catch((err) => this.log.warn(`${meetingId}: topic tagging failed: ${(err as Error).message}`));
      }

      await this.setStatus(meetingId, 'AWAITING_APPROVAL');
      if (isBackfill(meeting)) {
        // Hundreds of old meetings must not each send a review email.
        if (config.autoSend) await this.approve(meetingId);
        else await this.prisma.meeting.update({ where: { id: meetingId }, data: { error: BACKFILL_NOTE } });
      } else if (config.autoSend) {
        await this.approve(meetingId);
      } else {
        await this.sendReviewEmail(meetingId, wroteAnalysis);
        // Only a recap written on this pass. A deploy that rewrites an older draft must not email the backlog.
        if (wroteAnalysis) await this.releaseToReaders(meetingId);
      }
    } catch (err) {
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { status: 'FAILED', error: (err as Error).message.slice(0, 2000) },
      });
      throw err;
    }
  }

  /**
   * A YouTube title often has no day, so the row is dated from the upload.
   * If the chair says the meeting day in the opening, and that day is within
   * a week of the upload, use the spoken day. A title that already has a date
   * is left alone. Already-written recaps are not rewritten here.
   */
  private async alignSpokenDate<T extends { id: string; title: string; meetingDate: Date | null }>(
    meeting: T,
    segments: Segment[],
  ): Promise<T> {
    const next = spokenMeetingDate(transcriptOpening(segments), meeting.meetingDate);
    if (!next) return meeting;
    await this.prisma.meeting.update({ where: { id: meeting.id }, data: { meetingDate: next } });
    this.log.log(
      `${meeting.id}: meeting date ${meeting.meetingDate?.toISOString().slice(0, 10) ?? 'none'} → ${next.toISOString().slice(0, 10)} from the transcript`,
    );
    return { ...meeting, meetingDate: next };
  }

  /**
   * YouTube already transcribes its own videos. Use that when the track is long
   * enough to recap; otherwise fall through to the paid transcription.
   */
  private async youtubeTranscript(meeting: {
    id: string;
    platform: string;
    sourceUrl: string;
    durationSec: number | null;
  }): Promise<Segment[] | null> {
    if (meeting.platform !== 'youtube') return null;
    try {
      const vtt = await this.media.youtubeCaptions(meeting.sourceUrl);
      const segments = vtt ? parseYoutubeVtt(vtt) : [];
      if (!usableCaptions(segments, meeting.durationSec)) {
        this.log.log(`${meeting.id}: YouTube captions missing or too short; transcribing the audio`);
        return null;
      }
      this.log.log(`${meeting.id}: using YouTube's transcript (${segments.length} lines)`);
      return segments;
    } catch (err) {
      this.log.warn(`${meeting.id}: YouTube captions unavailable: ${(err as Error).message.split('\n')[0]}`);
      return null;
    }
  }

  /**
   * Roster, agenda and news from the web. A failure here is logged and the
   * meeting carries on without it; the next run tries again.
   */
  private async runResearch(meeting: Meeting): Promise<MeetingContext | null> {
    await this.setStatus(meeting.id, 'RESEARCHING');
    try {
      const context = await this.research.research(meeting);
      await this.prisma.research.create({ data: { meetingId: meeting.id, model: this.research.model, data: context as any } });
      this.log.log(
        `${meeting.id}: research found ${context.people.length} people, ${context.agenda.length} agenda items, ${context.articles.length} articles`,
      );
      return context;
    } catch (err) {
      this.log.warn(`${meeting.id}: research failed, continuing without it: ${(err as Error).message}`);
      return config.knownNames.length ? { people: config.knownNames, agenda: [], terms: [], articles: [] } : null;
    }
  }

  private setStatus(id: string, status: Meeting['status']) {
    return this.prisma.meeting.update({ where: { id }, data: { status, error: null } });
  }

  approvePath(meetingId: string) {
    return `/admin/meetings/${meetingId}/approve?sig=${sign(`approve:${meetingId}`)}`;
  }

  approveUrl(meetingId: string) {
    return `${config.publicBaseUrl}${this.approvePath(meetingId)}`;
  }

  /**
   * The transcript and recap are already saved. A missing Resend setup, or a
   * send failure, must not mark that work FAILED.
   */
  private async sendReviewEmail(meetingId: string, releasing: boolean) {
    if (!config.emailReady) {
      const note = 'Transcript is ready. Review email skipped until Resend is configured.';
      await this.prisma.meeting.update({ where: { id: meetingId }, data: { error: note } });
      this.log.warn(`${meetingId}: ${note}`);
      return;
    }
    try {
      await this.sendApprovalPreview(meetingId, releasing);
    } catch (err) {
      const note = `Transcript is ready. Review email was not sent: ${(err as Error).message}`.slice(0, 2000);
      await this.prisma.meeting.update({ where: { id: meetingId }, data: { status: 'AWAITING_APPROVAL', error: note } });
      this.log.error(`${meetingId}: ${note}`);
    }
  }

  async sendApprovalPreview(meetingId: string, releasing = false) {
    const input = await this.renderInput(meetingId, null);
    const lead = releasing
      ? 'Subscribers are being emailed this recap. Check it against the video, then'
      : 'This recap is on the site. Check it against the video, then';
    input.banner = `<div style="background:#fff7e0;border:1px solid #e8c766;border-radius:8px;padding:14px 16px;margin-bottom:16px;font-size:14px;line-height:1.5">
<strong>For your review.</strong><br>${lead}
<a href="${esc(this.approveUrl(meetingId))}" style="color:#0b5d7a;font-weight:600">mark it reviewed</a>.${
      input.digest.nameCorrections.length
        ? `<br><br>Names corrected from the transcript: ${input.digest.nameCorrections.map((f) => `${esc(f.heard)} → <strong>${esc(f.corrected)}</strong>`).join(', ')}`
        : ''
    }</div>`;
    await this.email.send({
      to: config.adminEmail,
      subject: `[Review] ${renderSubject(input)}`,
      html: renderHtml(input),
      text: `Approve: ${this.approveUrl(meetingId)}\n\n${renderText(input)}`,
    });
  }

  /**
   * Marks the recap reviewed. Subscriber mail and the phone buzz already went
   * out when the recap was written; this does not send them again. A recap
   * that never reached readers (an older draft, or mail that was not ready)
   * is sent now. Backfill is published on /notes only.
   */
  async approve(meetingId: string): Promise<'published' | 'reviewed' | 'sending'> {
    const existing = await this.prisma.analysis.findUniqueOrThrow({ where: { meetingId } });
    if (!existing.approvedAt) {
      await this.prisma.analysis.update({ where: { meetingId }, data: { approvedAt: new Date() } });
    }
    const meeting = await this.prisma.meeting.findUniqueOrThrow({ where: { id: meetingId }, include: { analysis: true } });
    if (isBackfill(meeting)) {
      await this.prisma.meeting.update({ where: { id: meetingId }, data: { status: 'PUBLISHED', error: null } });
      return 'published';
    }
    const mailed = meeting.status === 'SENT' || meeting.status === 'SENDING';
    if (mailed) {
      void this.push.notifyRecap(meetingId);
      return 'reviewed';
    }
    if (!config.emailReady) {
      void this.push.notifyRecap(meetingId);
      await this.prisma.meeting.update({ where: { id: meetingId }, data: { status: 'PUBLISHED', error: null } });
      return 'reviewed';
    }
    await this.enqueueDeliver(meetingId);
    return 'sending';
  }

  /** Emails confirmed subscribers, then buzzes phones. One job per meeting, so a second approval does not queue another. */
  private async enqueueDeliver(meetingId: string): Promise<void> {
    try {
      await this.controlQ.add('deliver', { meetingId }, { jobId: `deliver-${meetingId}`, removeOnComplete: 200 });
    } catch (err) {
      this.log.warn(`${meetingId}: subscriber email already queued or could not be queued: ${(err as Error).message}`);
    }
  }

  /**
   * The recap is on the site. Tell subscribers and phones now, without waiting
   * for a person to review it. Backfill stays quiet, and a second pass does
   * nothing once phones were already buzzed.
   */
  private async releaseToReaders(meetingId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId }, include: { analysis: true } });
    if (!meeting?.analysis || meeting.analysis.hiddenAt || meeting.analysis.notifiedAt) return;
    if (isBackfill(meeting)) return;
    if (config.emailReady) {
      await this.enqueueDeliver(meetingId);
      return;
    }
    void this.push.notifyRecap(meetingId);
  }

  /** Approves a recap for the website without emailing anyone, whatever its date. */
  async publishOnly(meetingId: string) {
    await this.prisma.analysis.update({ where: { meetingId }, data: { approvedAt: new Date() } });
    await this.prisma.meeting.update({ where: { id: meetingId }, data: { status: 'PUBLISHED', error: null } });
    void this.push.notifyRecap(meetingId);
  }

  /** Approves every drafted backfill recap at once. */
  async publishBackfill(): Promise<number> {
    const rows = await this.prisma.meeting.findMany({
      where: { status: 'AWAITING_APPROVAL', meetingDate: { lt: config.emailSince }, analysis: { is: { approvedAt: null } } },
      select: { id: true },
    });
    for (const m of rows) await this.approve(m.id);
    return rows.length;
  }

  async deliver(meetingId: string) {
    if (!config.emailReady) {
      this.log.warn(`${meetingId}: subscriber email skipped until Resend is configured`);
      void this.push.notifyRecap(meetingId);
      return;
    }
    const meeting = await this.prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    await this.setStatus(meetingId, 'SENDING');
    const subs = await this.prisma.subscriber.findMany({
      where: {
        status: 'CONFIRMED',
        recaps: true,
        OR: [{ bodies: { isEmpty: true } }, { bodies: { has: meeting.body } }],
      },
      select: { id: true },
    });
    await this.prisma.emailSend.createMany({
      data: subs.map((s: { id: string }) => ({ meetingId, subscriberId: s.id })),
      skipDuplicates: true,
    });
    await this.emailQ.addBulk(
      subs.map((s: { id: string }) => ({
        name: 'send',
        data: { meetingId, subscriberId: s.id },
        opts: { jobId: `send-${meetingId}-${s.id}`, attempts: 4, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 1000 },
      })),
    );
    await this.setStatus(meetingId, 'SENT');
    this.log.log(`Queued ${subs.length} emails for ${meeting.title}`);
    void this.push.notifyRecap(meetingId);
  }

  async sendOne(meetingId: string, subscriberId: string) {
    const rec = await this.prisma.emailSend.findUnique({ where: { meetingId_subscriberId: { meetingId, subscriberId } } });
    if (rec?.status === 'sent') return;
    const sub = await this.prisma.subscriber.findUniqueOrThrow({ where: { id: subscriberId } });
    if (sub.status !== 'CONFIRMED') return;
    const input = await this.renderInput(meetingId, sub.token);
    const [code, count] = await Promise.all([ensureRefCode(this.prisma, sub), referralCount(this.prisma, sub.id)]);
    const notePath = `/notes/${encodeURIComponent(meetingId)}${slugify(input.digest.headline) ? `/${slugify(input.digest.headline)}` : ''}`;
    input.invite = { url: inviteUrl(code, notePath), count, badgesUrl: `${config.publicBaseUrl}/preferences/${sub.token}#invite` };
    try {
      const providerId = await this.email.send({
        to: sub.email,
        subject: renderSubject(input),
        html: renderHtml(input),
        text: renderText(input),
        unsubscribeUrl: input.unsubscribeUrl,
      });
      await this.prisma.emailSend.update({
        where: { meetingId_subscriberId: { meetingId, subscriberId } },
        data: { status: 'sent', providerId, error: null },
      });
    } catch (err) {
      await this.prisma.emailSend.update({
        where: { meetingId_subscriberId: { meetingId, subscriberId } },
        data: { status: 'failed', error: (err as Error).message.slice(0, 1000) },
      });
      throw err;
    }
  }

  async renderInput(meetingId: string, subscriberToken: string | null): Promise<RenderInput> {
    const m = await this.prisma.meeting.findUnique({ where: { id: meetingId }, include: { analysis: true } });
    const digest = m?.analysis ? normalizeDigest(m.analysis.data) : null;
    if (!m || !digest) throw new NotFoundException();
    const base = config.publicBaseUrl;
    return {
      meeting: m,
      digest,
      newsletterName: config.newsletterName,
      mailingAddress: config.mailingAddress,
      unsubscribeUrl: subscriberToken ? `${base}/unsubscribe/${subscriberToken}` : `${base}/`,
      preferencesUrl: subscriberToken ? `${base}/preferences/${subscriberToken}` : `${base}/`,
    };
  }
}
