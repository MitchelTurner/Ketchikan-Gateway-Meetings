import { BadRequestException, Body, Controller, Get, Header, Logger, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { capFor } from '../ask/ask-logic';
import { BillingService, publicBillingError } from '../ask/billing.service';
import { AskService } from '../ask/ask.service';
import { config } from '../config';
import { PrismaService } from '../prisma.service';
import { normalizeDigest } from '../analysis/analysis.service';
import { emptyRecording } from '../analysis/empty-recording';
import { accountPage, AccountPageModel, loginPage, noteHref } from '../web/page';
import { readerCookie } from '../web/reader-cookie';
import { cleanDisplayName, safeNext } from './account-logic';
import { AccountService } from './account.service';

const LOGIN_FLASH: Record<string, string> = {
  sent: 'Check your inbox. The link signs this browser in.',
  failed: "The email didn't send. Try again in a minute.",
  bad: "That link didn't work. Ask for a new one.",
};

const ACCOUNT_FLASH: Record<string, string> = {
  saved: 'Name saved. It shows on comments.',
  name: 'Use 2 to 40 letters. That name is what other readers see.',
  pending: 'Stripe is confirming the payment. Refresh in a moment.',
  paid: "You're on the $5 plan.",
  'pay-failed': "That didn't open. Try again in a minute.",
};

@Controller()
export class AccountController {
  private log = new Logger(AccountController.name);
  constructor(
    private accounts: AccountService,
    private billing: BillingService,
    private ask: AskService,
    private prisma: PrismaService,
  ) {}

  @Get('login')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async show(@Req() req: Request, @Res() res: Response, @Query('next') next?: string, @Query('done') done?: string) {
    const dest = safeNext(next);
    const reader = await this.accounts.readerFrom(req);
    if (reader) {
      res.redirect(303, dest);
      return;
    }
    res.type('html').send(loginPage({ next: dest, flash: done ? LOGIN_FLASH[done] : undefined }));
  }

  @Post('login')
  async start(@Body() body: { email?: string; next?: string }, @Res() res: Response) {
    const result = await this.accounts.begin(body.email, body.next);
    if (result === 'bad-email') throw new BadRequestException('That email does not look right');
    const done = result === 'failed' ? 'failed' : 'sent';
    res.redirect(303, `/login?done=${done}&next=${encodeURIComponent(safeNext(body.next))}`);
  }

  @Get('login/in/:nonce')
  async enter(@Param('nonce') nonce: string, @Query('next') next: string, @Req() req: Request, @Res() res: Response) {
    const reader = await this.accounts.openNonce(nonce);
    if (!reader) {
      res.redirect(303, '/login?done=bad');
      return;
    }
    res.setHeader('Set-Cookie', readerCookie(req, reader.token));
    res.redirect(303, safeNext(next));
  }

  @Get('account')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async account(@Req() req: Request, @Res() res: Response, @Query('done') done?: string, @Query('why') why?: string) {
    const reader = await this.accounts.readerFrom(req);
    if (!reader) {
      res.redirect(303, '/login?next=%2Faccount');
      return;
    }
    res.type('html').send(accountPage(await this.model(reader.id, done, why)));
  }

  @Post('account')
  async rename(@Req() req: Request, @Res() res: Response, @Body() body: { displayName?: string }) {
    const reader = await this.accounts.readerFrom(req);
    if (!reader) {
      res.redirect(303, '/login?next=%2Faccount');
      return;
    }
    const ok = await this.accounts.saveName(reader.id, body.displayName);
    res.redirect(303, `/account?done=${ok ? 'saved' : 'name'}`);
  }

  @Post('account/checkout')
  async checkout(@Req() req: Request, @Res() res: Response) {
    const reader = await this.accounts.readerFrom(req);
    if (!reader || !config.askBillingReady) {
      res.redirect(303, payFailed('Payments are not turned on.'));
      return;
    }
    try {
      res.redirect(303, await this.billing.checkoutUrl(reader.id, '/account'));
    } catch (err) {
      this.log.warn(`Checkout failed: ${publicBillingError(err)}`);
      res.redirect(303, payFailed(publicBillingError(err)));
    }
  }

  @Post('account/portal')
  async portal(@Req() req: Request, @Res() res: Response) {
    const reader = await this.accounts.readerFrom(req);
    if (!reader || !config.askBillingReady) {
      res.redirect(303, payFailed('Payments are not turned on.'));
      return;
    }
    if (!reader.stripeCustomerId) {
      res.redirect(303, '/account');
      return;
    }
    try {
      res.redirect(303, await this.billing.portalUrl(reader.stripeCustomerId));
    } catch (err) {
      this.log.warn(`Portal failed: ${publicBillingError(err)}`);
      res.redirect(303, payFailed(publicBillingError(err)));
    }
  }

  @Post('account/out')
  out(@Req() req: Request, @Res() res: Response) {
    res.setHeader('Set-Cookie', readerCookie(req, ''));
    res.redirect(303, '/');
  }

  @Post('notes/:id/comment')
  async comment(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: { body?: string; website?: string },
  ) {
    const back = await this.notePath(id);
    const reader = await this.accounts.readerFrom(req);
    if (!reader) {
      res.redirect(303, `/login?next=${encodeURIComponent(back)}`);
      return;
    }
    const status = await this.accounts.addComment(reader, id, body.body, body.website);
    if (status === 'missing') {
      res.redirect(303, '/notes');
      return;
    }
    const flag = status === 'ok' ? 'ok' : status;
    res.redirect(303, `${back}?comment=${flag}#comments`);
  }

  private async model(id: string, done?: string, why?: string): Promise<AccountPageModel> {
    const reader = await this.prisma.subscriber.findUnique({ where: { id } });
    if (!reader) {
      return {
        email: '',
        displayName: '',
        paid: false,
        billing: false,
        hasCustomer: false,
        used: 0,
        cap: capFor(false),
        left: capFor(false),
      };
    }
    const paid = reader.askAccess === 'paid';
    const cap = capFor(paid);
    const used = await this.ask.usedThisMonth(reader.id);
    const flashKey = done === 'pending' && paid ? 'paid' : done;
    const detail = String(why ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const base = flashKey ? ACCOUNT_FLASH[flashKey] : undefined;
    return {
      email: reader.email,
      displayName: cleanDisplayName(reader.displayName),
      paid,
      billing: config.askBillingReady,
      hasCustomer: Boolean(reader.stripeCustomerId),
      used,
      cap,
      left: Math.max(0, cap - used),
      flash: detail && base ? `${base} ${detail}` : detail || base,
    };
  }

  private async notePath(id: string): Promise<string> {
    if (!/^[a-z0-9]{8,40}$/i.test(id)) return '/notes';
    const meeting = await this.prisma.meeting.findUnique({ where: { id }, include: { analysis: true } });
    const digest = meeting?.analysis && !meeting.analysis.hiddenAt ? normalizeDigest(meeting.analysis.data) : null;
    if (!meeting || !digest || emptyRecording(digest)) return '/notes';
    return noteHref(meeting.id, digest.headline);
  }
}

function payFailed(why: string): string {
  const note = why.replace(/\s+/g, ' ').trim().slice(0, 240);
  return note ? `/account?done=pay-failed&why=${encodeURIComponent(note)}` : '/account?done=pay-failed';
}
