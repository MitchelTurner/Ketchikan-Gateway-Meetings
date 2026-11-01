import { BadRequestException, Body, Controller, Get, Header, Headers, HttpCode, Logger, Param, Post, Query, Req, Res } from '@nestjs/common';
import Stripe from 'stripe';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AccountService } from '../account/account.service';
import { config } from '../config';
import { PrismaService } from '../prisma.service';
import { postedFromHere } from '../web/https';
import { readerCookie } from '../web/reader-cookie';
import { AskPageModel, askPage, AskTurnView } from '../web/page';
import { AskLimitError, AskService, AskUnavailableError } from './ask.service';
import { ASK_PRICE_LABEL, capFor } from './ask-logic';
import { BillingService, publicBillingError } from './billing.service';

const FLASH: Record<string, string> = {
  link: 'Check your inbox. The link signs this browser in.',
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
    private accounts: AccountService,
  ) {}

  @Get('ask')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async show(@Req() req: Request, @Query('done') done?: string, @Query('m') meetingId?: string, @Query('why') why?: string) {
    return askPage(await this.model(req, done, meetingId, why));
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
    const meeting = safeId(body.meeting);
    const result = await this.accounts.begin(body.email, meeting ? `/ask?m=${meeting}` : '/ask');
    if (result === 'bad-email') throw new BadRequestException('That email does not look right');
    const done = result === 'failed' ? 'link-failed' : 'link';
    res.redirect(303, `/ask?done=${done}${meeting ? `&m=${encodeURIComponent(meeting)}` : ''}`);
  }

  @Post('ask/out')
  out(@Req() req: Request, @Res() res: Response) {
    if (!postedFromHere(req)) {
      res.redirect(303, '/ask');
      return;
    }
    res.setHeader('Set-Cookie', readerCookie(req, ''));
    res.redirect(303, '/ask');
  }

  @Post('ask/checkout')
  async checkout(@Req() req: Request, @Res() res: Response) {
    const reader = await this.reader(req);
    if (!reader) return res.redirect(303, '/ask');
    if (!config.askBillingReady) return res.redirect(303, askPayFailed('Payments are not turned on.'));
    try {
      res.redirect(303, await this.billing.checkoutUrl(reader.id));
    } catch (err) {
      this.log.warn(`Ask checkout failed: ${publicBillingError(err)}`);
      res.redirect(303, askPayFailed(publicBillingError(err)));
    }
  }

  @Post('ask/portal')
  async portal(@Req() req: Request, @Res() res: Response) {
    const reader = await this.reader(req);
    if (!reader) return res.redirect(303, '/ask');
    if (!config.askBillingReady) return res.redirect(303, askPayFailed('Payments are not turned on.'));
    if (!reader.stripeCustomerId) return res.redirect(303, '/ask');
    try {
      res.redirect(303, await this.billing.portalUrl(reader.stripeCustomerId));
    } catch (err) {
      this.log.warn(`Ask portal failed: ${publicBillingError(err)}`);
      res.redirect(303, askPayFailed(publicBillingError(err)));
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
      if (!(err instanceof AskLimitError) && !(err instanceof AskUnavailableError)) this.log.warn(`Ask failed: ${publicBillingError(err)}`);
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

  private reader(req: Request) {
    return this.accounts.readerFrom(req);
  }

  private async model(req: Request, done?: string, meetingId?: string, why?: string): Promise<AskPageModel> {
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
    const detail = String(why ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const base = flashKey ? FLASH[flashKey] : undefined;
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
      flash: detail && base ? `${base} ${detail}` : detail || base,
    };
  }
}

function askPayFailed(why: string): string {
  const note = why.replace(/\s+/g, ' ').trim().slice(0, 240);
  return note ? `/ask?done=pay-failed&why=${encodeURIComponent(note)}` : '/ask?done=pay-failed';
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
