import { Injectable, Logger } from '@nestjs/common';
import { normalizeDigest } from '../analysis/analysis.service';
import { emptyRecording } from '../analysis/empty-recording';
import { config } from '../config';
import { PrismaService } from '../prisma.service';
import { BODIES, redactSecrets, slugify } from '../util';
import * as webpush from 'web-push';
import { pushEndpointAllowed } from './push-endpoint';

const KEY_ID = 'default';

export interface PushNotice {
  title: string;
  body: string;
  url: string;
}

/** What a phone shows when this recap goes public. */
export function noticeFor(meeting: { id: string; title: string; body: string }, data: unknown, base: string): PushNotice {
  const digest = normalizeDigest(data);
  const headline = digest?.headline || meeting.title;
  const slug = slugify(headline);
  return {
    title: headline,
    body: `${meeting.body}. A new recap is up.`,
    url: `${base}/notes/${encodeURIComponent(meeting.id)}${slug ? `/${slug}` : ''}`,
  };
}

@Injectable()
export class PushService {
  private log = new Logger(PushService.name);

  constructor(private prisma: PrismaService) {}

  async publicKey(): Promise<string> {
    return (await this.keys()).publicKey;
  }

  /** Saves a browser that asked for notifications. The same phone updating its keys replaces the old row. An empty list means every meeting. */
  async subscribe(endpoint: string, p256dh: string, auth: string, bodies?: string[]): Promise<void> {
    if (!pushEndpointAllowed(endpoint)) {
      this.log.warn('Phone subscription rejected: endpoint host is not a push service');
      return;
    }
    const data: { p256dh: string; auth: string; bodies?: string[] } = { p256dh, auth };
    if (bodies !== undefined) data.bodies = cleanBodies(bodies);
    const existing = await this.prisma.pushSubscription.findFirst({ where: { endpoint }, select: { id: true } });
    if (existing) {
      await this.prisma.pushSubscription.update({ where: { id: existing.id }, data });
      return;
    }
    await this.prisma.pushSubscription.create({ data: { endpoint, p256dh, auth, bodies: data.bodies ?? [] } });
  }

  async unsubscribe(endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
  }

  /** Buzzes every phone that opted in. A dead subscription is dropped. Never throws. */
  async notifyRecap(meetingId: string): Promise<void> {
    try {
      const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId }, include: { analysis: true } });
      if (!meeting?.analysis || meeting.analysis.hiddenAt || meeting.analysis.notifiedAt) return;
      const digest = normalizeDigest(meeting.analysis.data);
      if (!digest || emptyRecording(digest)) return;
      let base = '';
      try {
        base = config.publicBaseUrl;
      } catch {
        this.log.warn('Phone notifications skipped: PUBLIC_BASE_URL is not set');
        return;
      }
      const notice = noticeFor(meeting, meeting.analysis.data, base);
      const subs = (await this.prisma.pushSubscription.findMany()).filter(
        (s) => s.bodies.length === 0 || s.bodies.includes(meeting.body),
      );
      if (subs.length) {
        const keys = await this.keys();
        webpush.setVapidDetails(this.subject(), keys.publicKey, keys.privateKey);
        const payload = JSON.stringify(notice);
        await Promise.all(subs.map((s) => this.sendOne(s, payload)));
        this.log.log(`Notified ${subs.length} phone${subs.length === 1 ? '' : 's'} about ${notice.title}`);
      }
      await this.prisma.analysis.update({ where: { meetingId }, data: { notifiedAt: new Date() } });
    } catch (err) {
      this.log.warn(`Phone notifications failed: ${redactSecrets((err as Error).message)}`);
    }
  }

  private async sendOne(sub: { id: string; endpoint: string; p256dh: string; auth: string }, payload: string): Promise<void> {
    if (!pushEndpointAllowed(sub.endpoint)) {
      await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
      return;
    }
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 60 * 60 * 24 },
      );
    } catch (err) {
      const status = err instanceof webpush.WebPushError ? err.statusCode : 0;
      if (status === 404 || status === 410) {
        await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        return;
      }
      this.log.warn(`Notification not delivered: ${redactSecrets((err as Error).message)}`);
    }
  }

  private async keys(): Promise<{ publicKey: string; privateKey: string }> {
    const existing = await this.prisma.pushKeys.findUnique({ where: { id: KEY_ID } });
    if (existing) return existing;
    const generated = webpush.generateVAPIDKeys();
    try {
      return await this.prisma.pushKeys.create({
        data: { id: KEY_ID, publicKey: generated.publicKey, privateKey: generated.privateKey },
      });
    } catch {
      const again = await this.prisma.pushKeys.findUnique({ where: { id: KEY_ID } });
      if (again) return again;
      throw new Error('Could not store notification keys');
    }
  }

  /** A contact URL the push service can show. Falls back so a missing mailbox still sends. */
  private subject(): string {
    try {
      return `mailto:${config.adminEmail}`;
    } catch {
      try {
        return config.publicBaseUrl;
      } catch {
        return 'mailto:notifications@ketchikan.vote';
      }
    }
  }
}

const BODY_NAMES = new Set(BODIES.map((b) => b.name));

/** Drops anything that is not a real meeting body. An empty result means every meeting. */
function cleanBodies(bodies: string[]): string[] {
  return [...new Set(bodies.map(String).filter((b) => BODY_NAMES.has(b)))];
}
