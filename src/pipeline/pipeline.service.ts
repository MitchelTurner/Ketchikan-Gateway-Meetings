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
import { Segment, TranscriptionService } from '../transcription/transcription.service';
import { esc, sign } from '../util';

@Injectable()
export class PipelineService {
  private log = new Logger(PipelineService.name);

  constructor(
    private prisma: PrismaService,
    private media: MediaService,
    private transcription: TranscriptionService,
    private analysis: AnalysisService,
    private email: EmailService,
    @InjectQueue(Q_CONTROL) private controlQ: Queue,
    @InjectQueue(Q_EMAIL) private emailQ: Queue,
  ) {}

  /** download → transcribe → analyze → (approval email | deliver). Each stage is skipped if already done. */
  async processMeeting(meetingId: string) {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: { transcript: true, analysis: true },
    });
    if (['SENDING', 'SENT'].includes(meeting.status)) return;

    try {
      let segments = meeting.transcript?.segments as Segment[] | undefined;
      if (!segments) {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-'));
        try {
          await this.setStatus(meetingId, 'DOWNLOADING');
          const audio = await this.media.downloadAudio(meeting.sourceUrl, dir);
          await this.setStatus(meetingId, 'TRANSCRIBING');
          segments = await this.transcription.transcribe(audio);
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
        const digest = await this.analysis.analyze(meeting, segments);
        await this.prisma.analysis.create({ data: { meetingId, model: this.analysis.model, data: digest as any } });
      }

      if (config.autoSend) {
        await this.approve(meetingId);
      } else {
        await this.setStatus(meetingId, 'AWAITING_APPROVAL');
        await this.sendApprovalPreview(meetingId);
      }
    } catch (err) {
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { status: 'FAILED', error: (err as Error).message.slice(0, 2000) },
      });
      throw err;
    }
  }

  private setStatus(id: string, status: Meeting['status']) {
    return this.prisma.meeting.update({ where: { id }, data: { status, error: null } });
  }

  approveUrl(meetingId: string) {
    return `${config.publicBaseUrl}/admin/meetings/${meetingId}/approve?sig=${sign(`approve:${meetingId}`)}`;
  }

  async sendApprovalPreview(meetingId: string) {
    const input = await this.renderInput(meetingId, null);
    input.banner = `<div style="background:#fff7e0;border:1px solid #e8c766;border-radius:8px;padding:14px 16px;margin-bottom:16px;font-size:14px;line-height:1.5">
<strong>Preview — not sent to subscribers yet.</strong><br>Check the recap against the video, then
<a href="${esc(this.approveUrl(meetingId))}" style="color:#0b5d7a;font-weight:600">approve and send</a>.</div>`;
    await this.email.send({
      to: config.adminEmail,
      subject: `[Review] ${renderSubject(input)}`,
      html: renderHtml(input),
      text: `Approve: ${this.approveUrl(meetingId)}\n\n${renderText(input)}`,
    });
  }

  /** Marks the recap approved and fans out to subscribers. */
  async approve(meetingId: string) {
    await this.prisma.analysis.update({ where: { meetingId }, data: { approvedAt: new Date() } });
    await this.controlQ.add('deliver', { meetingId }, { jobId: `deliver-${meetingId}`, removeOnComplete: 200 });
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
