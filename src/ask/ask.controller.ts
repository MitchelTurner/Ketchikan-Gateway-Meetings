import { BadRequestException, Body, Controller, Get, Header, Headers, HttpCode, Logger, Param, Post, Query, Req, Res } from '@nestjs/common';
import Stripe from 'stripe';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { config } from '../config';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma.service';
import { esc } from '../util';
import { readerCookie, readerToken } from '../web/reader-cookie';
import { AskPageModel, askPage, AskTurnView } from '../web/page';
import { AskLimitError, AskService, AskUnavailableError } from './ask.service';
import { ASK_PRICE_LABEL, capFor } from './ask-logic';
import { BillingService } from './billing.service';

const LINK_WAIT_MS = 10 * 60 * 1000;

const FLASH: Record<string, string> = {
  link: 'If that address is confirmed, a link is on its way.',
  'link-failed': "The email didn't send. Try again in a minute.",
  cap: "You've used this month's questions.",
  failed: "That question didn't get an answer. Try again in a minute.",
  empty: 'Write a question first.',
  pending: 'Stripe is confirming the payment. Refresh in a moment.',
  paid: `You're in. ${ASK_PRICE_LABEL} covers more questions.`,
  'pay-failed': "Payment didn't open. Try again in a minute.",
  'bad-link': "That link didn't work. Ask for a new one.",
};

@Controller()
export class AskController {
  private log = new Logger(AskController.name);
  constructor(
    private prisma: PrismaService,
    private ask: AskService,
    private billing: BillingService,
    private email: EmailService,
  ) {}

  @Get('ask')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async show(@Req() req: Request, @Query('done') done?: string, @Query('m') meetingId?: string) {
    return askPage(await this.model(req, done, meetingId));
  }

  @Get('ask/in/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async enter(@Param('token') token: string, @Query('m') meetingId: string, @Req() req: Request, @Res() res: Response) {
    const reader = await this.prisma.subscriber.findUnique({ where: { token } });
    const meeting = safeId(meetingId);
    if (!reader || reader.status !== 'CONFIRMED') {
      res.type('html').send(askPage(await this.model(req, 'bad-link', meeting)));
      return;
    }
    res.setHeader('Set-Cookie', readerCookie(req, token));
    res.redirect(303, meeting ? `/ask?m=${encodeURIComponent(meeting)}` : '/ask');
  }

  @Post('ask/link')
  async link(@Body() body: { email?: string; meeting?: string }, @Res() res: Response) {
    const email = String(body.email ?? '').trim().toLowerCase();
    const meeting = safeId(body.meeting);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new BadRequestException('That email does not look right');
    const reader = await this.prisma.subscriber.findUnique({ where: { email } });
    const back = `/ask?done=link${meeting ? `&m=${encodeURIComponent(meeting)}` : ''}`;
    if (reader?.status === 'CONFIRMED') {
      const recent = reader.askLinkSentAt && Date.now() - reader.askLinkSentAt.getTime() < LINK_WAIT_MS;
      if (!recent) {
        if (!config.emailReady) return res.redirect(303, `/ask?done=link-failed${meeting ? `&m=${encodeURIComponent(meeting)}` : ''}`);
        try {
          const url = `${config.publicBaseUrl}/ask/in/${reader.token}${meeting ? `?m=${encodeURIComponent(meeting)}` : ''}`;
          await this.email.send({
            to: reader.email,
            subject: `Your link to ask about meetings · ${config.newsletterName}`,
            html: `<p>Use this link to ask about a Ketchikan meeting. It signs this browser in.</p><p><a href="${esc(url)}">${esc(url)}</a></p><p style="color:#5b6675;font-size:12px">${esc(config.mailingAddress)}</p>`,
            text: `Use this link to ask about a Ketchikan meeting:\n${url}\n\n${config.mailingAddress}`,
          });
          await this.prisma.subscriber.update({ where: { id: reader.id }, data: { askLinkSentAt: new Date() } });
        } catch (err) {
          this.log.warn(`Ask link not sent: ${(err as Error).message}`);
          return res.redirect(303, `/ask?done=link-failed${meeting ? `&m=${encodeURIComponent(meeting)}` : ''}`);
        }
      }
    }
    res.redirect(303, back);
  }

  @Post('ask/out')
  out(@Req() req: Request, @Res() res: Response) {
    res.setHeader('Set-Cookie', readerCookie(req, ''));
    res.redirect(303, '/ask');
  }

  @Post('ask/checkout')
  async checkout(@Req() req: Request, @Res() res: Response) {
    const reader = await this.reader(req);
    if (!reader || !config.askBillingReady) return res.redirect(303, '/ask?done=pay-failed');
    try {
      res.redirect(303, await this.billing.checkoutUrl(reader.id));
    } catch (err) {
      this.log.warn(`Ask checkout failed: ${(err as Error).message}`);
      res.redirect(303, '/ask?done=pay-failed');
    }
  }

  @Post('ask/portal')
  async portal(@Req() req: Request, @Res() res: Response) {
    const reader = await this.reader(req);
    if (!reader?.stripeCustomerId || !config.askBillingReady) return res.redirect(303, '/ask?done=pay-failed');
    try {
      res.redirect(303, await this.billing.portalUrl(reader.stripeCustomerId));
    } catch (err) {
      this.log.warn(`Ask portal failed: ${(err as Error).message}`);
      res.redirect(303, '/ask?done=pay-failed');
    }
  }

  @Post('ask')
  async question(@Req() req: Request, @Res() res: Response, @Body() body: { question?: string; meeting?: string }) {
    const reader = await this.reader(req);
    if (!reader) return res.redirect(303, '/ask');
    const question = String(body.question ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
    const meeting = safeId(body.meeting);
    if (!question) return res.redirect(303, `/ask${meeting ? `?m=${encodeURIComponent(meeting)}&` : '?'}done=empty`);
    try {
      await this.ask.ask(reader.id, question, meeting);
    } catch (err) {
      const done = err instanceof AskLimitError ? 'cap' : 'failed';
      if (!(err instanceof AskLimitError) && !(err instanceof AskUnavailableError)) this.log.warn(`Ask failed: ${(err as Error).message}`);
      return res.redirect(303, `/ask${meeting ? `?m=${encodeURIComponent(meeting)}&` : '?'}done=${done}`);
    }
    res.redirect(303, '/ask');
  }

  @Post('stripe/webhook')
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    if (!config.askBillingReady) throw new BadRequestException('Payments are not configured');
    if (!req.rawBody || !signature) throw new BadRequestException('Missing signature');
    try {
      await this.billing.handleWebhook(req.rawBody, signature);
    } catch (err) {
      if (err instanceof Stripe.errors.StripeSignatureVerificationError) throw new BadRequestException('Bad signature');
      throw err;
    }
    return { received: true };
  }

  private async reader(req: Request) {
    const token = readerToken(req);
    if (!token) return null;
    const reader = await this.prisma.subscriber.findUnique({ where: { token } });
    if (!reader || reader.status !== 'CONFIRMED') return null;
    return reader;
  }

  private async model(req: Request, done?: string, meetingId?: string): Promise<AskPageModel> {
    const reader = await this.reader(req);
    const pin = safeId(meetingId);
    const paid = reader?.askAccess === 'paid';
    const cap = capFor(paid);
    const used = reader ? await this.ask.usedThisMonth(reader.id) : 0;
    const turns = reader
      ? (
          await this.prisma.askTurn.findMany({
            where: { subscriberId: reader.id },
            orderBy: { createdAt: 'desc' },
            take: 8,
          })
        )
          .reverse()
          .map(turnView)
      : [];
    let pinHeadline = '';
    if (pin) {
      const meeting = await this.prisma.meeting.findUnique({ where: { id: pin }, include: { analysis: true } });
      const data = meeting?.analysis?.data;
      const headline = data && typeof data === 'object' && !Array.isArray(data) ? (data as { headline?: unknown }).headline : '';
      pinHeadline = typeof headline === 'string' ? headline : '';
    }
    const flashKey = done === 'pending' && paid ? 'paid' : done;
    return {
      signedIn: Boolean(reader),
      paid,
      billing: config.askBillingReady,
      ready: config.askReady,
      used,
      cap,
      left: Math.max(0, cap - used),
      turns,
      pinId: pin,
      pinHeadline,
      flash: flashKey ? FLASH[flashKey] : undefined,
    };
  }
}

function safeId(value: unknown): string {
  const id = String(value ?? '');
  return /^[a-z0-9]{8,40}$/i.test(id) ? id : '';
}

function turnView(turn: { question: string; answer: string; sources: unknown }): AskTurnView {
  const sources = Array.isArray(turn.sources)
    ? turn.sources.flatMap((row) => {
        if (!row || typeof row !== 'object') return [];
        const label = typeof (row as { label?: unknown }).label === 'string' ? (row as { label: string }).label : '';
        const href = typeof (row as { href?: unknown }).href === 'string' ? (row as { href: string }).href : '';
        if (!label || !(href.startsWith('/') || href.startsWith('https://'))) return [];
        return [{ label, href }];
      })
    : [];
  return { question: turn.question, answer: turn.answer, sources };
}
