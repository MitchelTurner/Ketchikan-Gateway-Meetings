import { Injectable, Logger } from '@nestjs/common';
import type { Subscriber } from '@prisma/client';
import type { Request } from 'express';
import { emptyRecording } from '../analysis/empty-recording';
import { normalizeDigest } from '../analysis/analysis.service';
import { config } from '../config';
import { confirmEmail, confirmExpiresAt } from '../email/confirm';
import { EmailService } from '../email/email.service';
import { loginEmail } from '../email/letter';
import { PrismaService } from '../prisma.service';
import { randomToken, redactSecrets } from '../util';
import { readerToken } from '../web/reader-cookie';
import {
  COMMENT_DAY_CAP,
  cleanComment,
  cleanDisplayName,
  dayStart,
  loginExpiresAt,
  loginStillOpen,
  safeNext,
  sessionOpen,
} from './account-logic';

const LINK_WAIT_MS = 10 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ReaderCommentView {
  name: string;
  body: string;
  when: string;
}

@Injectable()
export class AccountService {
  private log = new Logger(AccountService.name);
  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

  async readerFrom(req: Request): Promise<Subscriber | null> {
    const token = readerToken(req);
    if (!token) return null;
    const reader = await this.prisma.subscriber.findUnique({ where: { token } });
    if (!reader || !sessionOpen(reader)) return null;
    return reader;
  }

  /**
   * New addresses get the confirmation letter, which creates the account when they tap it.
   * Confirmed readers get a one-time sign-in letter. The reply is the same either way.
   */
  async begin(emailRaw: unknown, nextRaw: unknown): Promise<'sent' | 'failed' | 'bad-email'> {
    const email = String(emailRaw ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) return 'bad-email';
    const next = safeNext(nextRaw);
    const existing = await this.prisma.subscriber.findUnique({ where: { email } });
    if (existing?.askLinkSentAt && Date.now() - existing.askLinkSentAt.getTime() < LINK_WAIT_MS) return 'sent';
    if (!config.emailReady) return 'failed';
    try {
      if (existing && sessionOpen(existing)) await this.sendLogin(existing, next);
      else if (existing) {
        const updated = await this.prisma.subscriber.update({
          where: { id: existing.id },
          data: { status: 'PENDING', token: randomToken(), confirmExpiresAt: confirmExpiresAt() },
        });
        await this.sendConfirm(updated, next);
      } else {
        const created = await this.prisma.subscriber.create({
          data: { email, status: 'PENDING', token: randomToken(), confirmExpiresAt: confirmExpiresAt() },
        });
        await this.sendConfirm(created, next);
      }
      return 'sent';
    } catch (err) {
      this.log.warn(`Sign-in email not sent: ${redactSecrets((err as Error).message)}`);
      return 'failed';
    }
  }

  /** Clears the nonce. A second click of the same link does not sign in. */
  async openNonce(nonce: string): Promise<Subscriber | null> {
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(nonce)) return null;
    const reader = await this.prisma.subscriber.findFirst({ where: { loginNonce: nonce } });
    if (!reader || !loginStillOpen(reader.loginExpiresAt) || !sessionOpen(reader)) return null;
    const claimed = await this.prisma.subscriber.updateMany({
      where: { id: reader.id, loginNonce: nonce },
      data: { loginNonce: null, loginExpiresAt: null },
    });
    if (claimed.count !== 1) return null;
    return reader;
  }

  async saveName(id: string, raw: unknown): Promise<boolean> {
    const displayName = cleanDisplayName(raw);
    if (!displayName) return false;
    await this.prisma.subscriber.update({ where: { id }, data: { displayName } });
    return true;
  }

  async commentsFor(meetingId: string): Promise<ReaderCommentView[]> {
    const rows = await this.prisma.comment.findMany({
      where: { meetingId },
      orderBy: { createdAt: 'asc' },
      take: 80,
      include: { subscriber: { select: { displayName: true } } },
    });
    return rows.map((row) => ({
      name: cleanDisplayName(row.subscriber.displayName) || 'Reader',
      body: row.body,
      when: row.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: config.timezone }),
    }));
  }

  /**
   * A filled honeypot reports success and stores nothing.
   * The meeting has to be a real public recap.
   */
  async addComment(reader: Subscriber, meetingId: string, rawBody: unknown, website: unknown): Promise<'ok' | 'empty' | 'cap' | 'name' | 'missing'> {
    if (!cleanDisplayName(reader.displayName)) return 'name';
    if (String(website ?? '').trim()) return 'ok';
    const body = cleanComment(rawBody);
    if (!body) return 'empty';
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId }, include: { analysis: true } });
    const digest = meeting?.analysis && !meeting.analysis.hiddenAt ? normalizeDigest(meeting.analysis.data) : null;
    if (!meeting || !digest || emptyRecording(digest)) return 'missing';
    const count = await this.prisma.comment.count({
      where: { subscriberId: reader.id, createdAt: { gte: dayStart(config.timezone) } },
    });
    if (count >= COMMENT_DAY_CAP) return 'cap';
    await this.prisma.comment.create({ data: { meetingId, subscriberId: reader.id, body } });
    return 'ok';
  }

  private async sendLogin(reader: Subscriber, next: string): Promise<void> {
    const nonce = randomToken();
    await this.prisma.subscriber.update({
      where: { id: reader.id },
      data: { loginNonce: nonce, loginExpiresAt: loginExpiresAt(), askLinkSentAt: new Date() },
    });
    const url = `${config.publicBaseUrl}/login/in/${nonce}?next=${encodeURIComponent(next)}`;
    const message = loginEmail({ url, siteUrl: config.publicBaseUrl, mailingAddress: config.mailingAddress });
    try {
      await this.email.send({ to: reader.email, subject: message.subject, html: message.html, text: message.text });
    } catch (err) {
      await this.prisma.subscriber.update({
        where: { id: reader.id },
        data: { loginNonce: null, loginExpiresAt: null, askLinkSentAt: null },
      });
      throw err;
    }
  }

  private async sendConfirm(reader: Subscriber, next: string): Promise<void> {
    await this.prisma.subscriber.update({ where: { id: reader.id }, data: { askLinkSentAt: new Date() } });
    const url = `${config.publicBaseUrl}/confirm/${reader.token}?next=${encodeURIComponent(next)}`;
    const message = confirmEmail({ url, siteUrl: config.publicBaseUrl, mailingAddress: config.mailingAddress });
    try {
      await this.email.send({ to: reader.email, subject: message.subject, html: message.html });
    } catch (err) {
      await this.prisma.subscriber.update({ where: { id: reader.id }, data: { askLinkSentAt: null } });
      throw err;
    }
  }
}
