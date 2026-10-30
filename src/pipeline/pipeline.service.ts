import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Meeting } from '@prisma/client';
import { Queue } from 'bullmq';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AnalysisService, normalizeDigest } from '../analysis/analysis.service';
import { config } from '../config';
import { EmailService } from '../email/email.service';
import { renderHtml, renderSubject, renderText, RenderInput } from '../email/render';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma.service';
import { Q_CONTROL, Q_EMAIL } from '../queues';
import { MeetingContext, normalizeContext, ResearchService, vocabulary } from '../research/research.service';
import { Segment, TranscriptionService } from '../transcription/transcription.service';
import { esc, sign } from '../util';

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
    private transcription: TranscriptionService,
    private analysis: AnalysisService,
    private email: EmailService,
    @InjectQueue(Q_CONTROL) private controlQ: Queue,
    @InjectQueue(Q_EMAIL) private emailQ: Queue,
  ) {}

  /** research → download → transcribe → analyze → (approval email | deliver). Each stage is skipped if already done. */
  async processMeeting(meetingId: string) {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: { research: true, transcript: true, analysis: true },
    });
    if (['SENDING', 'SENT', 'PUBLISHED'].includes(meeting.status)) return;

    try {
      let context = meeting.research ? normalizeContext(meeting.research.data) : null;
      if (!context && !meeting.analysis && config.researchEnabled) context = await this.runResearch(meeting);

      let segments = meeting.transcript?.segments as Segment[] | undefined;
      if (!segments) {
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

      if (!meeting.analysis) {
        await this.setStatus(meetingId, 'ANALYZING');
        const digest = await this.analysis.analyze(meeting, segments, context);
        await this.prisma.analysis.create({ data: { meetingId, model: this.analysis.model, data: digest as any } });
      }

      await this.setStatus(meetingId, 'AWAITING_APPROVAL');
      if (isBackfill(meeting)) {
        // Hundreds of old meetings must not each send a review email.
        if (config.autoSend) await this.approve(meetingId);
        else await this.prisma.meeting.update({ where: { id: meetingId }, data: { error: BACKFILL_NOTE } });
      } else if (config.autoSend && config.emailReady) {
        await this.approve(meetingId);
      } else {
        await this.sendReviewEmail(meetingId);
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
  private async sendReviewEmail(meetingId: string) {
    if (!config.emailReady) {
      const note = 'Transcript is ready. Review email skipped until Resend is configured.';
      await this.prisma.meeting.update({ where: { id: meetingId }, data: { error: note } });
      this.log.warn(`${meetingId}: ${note}`);
      return;
    }
    try {
      await this.sendApprovalPreview(meetingId);
    } catch (err) {
      const note = `Transcript is ready. Review email was not sent: ${(err as Error).message}`.slice(0, 2000);
      await this.prisma.meeting.update({ where: { id: meetingId }, data: { status: 'AWAITING_APPROVAL', error: note } });
      this.log.error(`${meetingId}: ${note}`);
    }
  }

  async sendApprovalPreview(meetingId: string) {
    const input = await this.renderInput(meetingId, null);
    input.banner = `<div style="background:#fff7e0;border:1px solid #e8c766;border-radius:8px;padding:14px 16px;margin-bottom:16px;font-size:14px;line-height:1.5">
<strong>Preview — not sent to subscribers yet.</strong><br>Check the recap against the video, then
<a href="${esc(this.approveUrl(meetingId))}" style="color:#0b5d7a;font-weight:600">approve and send</a>.${
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

  /** Marks the recap approved and fans out to subscribers. Backfill is published on /notes only. */
  async approve(meetingId: string) {
    await this.prisma.analysis.update({ where: { meetingId }, data: { approvedAt: new Date() } });
    const meeting = await this.prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    if (isBackfill(meeting)) {
      await this.prisma.meeting.update({ where: { id: meetingId }, data: { status: 'PUBLISHED', error: null } });
      return;
    }
    await this.controlQ.add('deliver', { meetingId }, { jobId: `deliver-${meetingId}`, removeOnComplete: 200 });
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
    const meeting = await this.prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    await this.setStatus(meetingId, 'SENDING');
    const subs = await this.prisma.subscriber.findMany({
      where: {
        status: 'CONFIRMED',
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
  }

  async sendOne(meetingId: string, subscriberId: string) {
    const rec = await this.prisma.emailSend.findUnique({ where: { meetingId_subscriberId: { meetingId, subscriberId } } });
    if (rec?.status === 'sent') return;
    const sub = await this.prisma.subscriber.findUniqueOrThrow({ where: { id: subscriberId } });
    if (sub.status !== 'CONFIRMED') return;
    const input = await this.renderInput(meetingId, sub.token);
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
