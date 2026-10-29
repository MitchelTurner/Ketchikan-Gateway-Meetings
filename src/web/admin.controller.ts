import { InjectQueue } from '@nestjs/bullmq';
import {
  CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Header, HttpCode, Injectable,
  NotFoundException, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Queue } from 'bullmq';
import { timingSafeEqual } from 'crypto';
import { config } from '../config';
import { DiscoveryService } from '../discovery/discovery.service';
import { renderHtml } from '../email/render';
import { PipelineService } from '../pipeline/pipeline.service';
import { PrismaService } from '../prisma.service';
import { Q_CONTROL } from '../queues';
import { esc, formatDate, verify } from '../util';
import { adminMeetingsPage, adminTranscriptPage, page } from './page';

@Injectable()
class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const header = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const query = typeof req.query.token === 'string' ? req.query.token : '';
    const given = header || query || readCookie(req.headers.cookie, 'admin_token');
    const want = config.adminToken;
    const a = Buffer.from(given);
    const b = Buffer.from(want);
    const ok = a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
    // One browser visit with ?token= sets a cookie so transcript links stay readable.
    if (ok && query) {
      res.setHeader('Set-Cookie', `admin_token=${encodeURIComponent(query)}; HttpOnly; Path=/admin; SameSite=Lax; Max-Age=2592000`);
    }
    return ok;
  }
}

function readCookie(header: unknown, name: string): string {
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1 || part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

@Controller('admin')
export class AdminController {
  constructor(
    private prisma: PrismaService,
    private discovery: DiscoveryService,
    private pipeline: PipelineService,
    @InjectQueue(Q_CONTROL) private controlQ: Queue,
  ) {}

  /** Shows what the scraper sees on the archive page. Run this first after deploying. */
  @Get('inspect')
  @UseGuards(AdminGuard)
  inspect() {
    return this.discovery.inspect();
  }

  @Post('discover')
  @UseGuards(AdminGuard)
  async discover() {
    await this.controlQ.add('discover', {}, { removeOnComplete: 50 });
    return { queued: true };
  }

  @Get('meetings')
  @UseGuards(AdminGuard)
  async meetings(@Query('status') status: string | undefined, @Req() req: Request) {
    const meetings = await this.prisma.meeting.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: [{ meetingDate: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      select: {
        id: true, title: true, body: true, meetingDate: true, status: true, error: true, sourceUrl: true,
        transcript: { select: { id: true } },
        analysis: { select: { id: true } },
      },
    });
    const rows = meetings.map((m) => ({
      id: m.id,
      title: m.title,
      body: m.body,
      meetingDate: m.meetingDate,
      status: m.status,
      error: m.error,
      sourceUrl: m.sourceUrl,
      hasTranscript: Boolean(m.transcript),
      hasAnalysis: Boolean(m.analysis),
    }));
    if (!String(req.headers.accept ?? '').includes('text/html')) return rows;
    return adminMeetingsPage(
      rows.map((m) => ({
        id: m.id,
        title: m.title,
        body: m.body,
        date: formatDate(m.meetingDate),
        status: m.status,
        error: m.error,
        hasTranscript: m.hasTranscript,
        hasAnalysis: m.hasAnalysis,
      })),
    );
  }

  /** Re-run (or force-run a SKIPPED meeting). Finished stages are reused. */
  @Post('meetings/:id/process')
  @UseGuards(AdminGuard)
  async process(@Param('id') id: string, @Query('reanalyze') reanalyze?: string) {
    const existing = await this.prisma.meeting.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException();
    if (reanalyze === 'true') await this.prisma.analysis.deleteMany({ where: { meetingId: id } });
    await this.prisma.meeting.update({ where: { id }, data: { status: 'DISCOVERED', error: null } });
    await this.discovery.enqueueProcess(id);
    return { queued: true };
  }

  @Get('meetings/:id/preview')
  @UseGuards(AdminGuard)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async preview(@Param('id') id: string) {
    try {
      return renderHtml(await this.pipeline.renderInput(id, null));
    } catch (err) {
      if (err instanceof NotFoundException) {
        return page('No recap yet', `<h1>No recap yet</h1><p>This meeting doesn't have a written recap to preview.</p>`);
      }
      throw err;
    }
  }

  @Get('meetings/:id/transcript')
  @UseGuards(AdminGuard)
  async transcript(@Param('id') id: string, @Req() req: Request) {
    const t = await this.prisma.transcript.findUnique({ where: { meetingId: id }, include: { meeting: true } });
    if (!t) throw new NotFoundException();
    if (!String(req.headers.accept ?? '').includes('text/html')) return t;
    const segments = Array.isArray(t.segments) ? (t.segments as { start?: number; speaker?: string; text?: string }[]) : [];
    return adminTranscriptPage(t.meeting, t.provider, segments);
  }

  // Signed link from the review email. GET shows a button; POST sends (so link-scanners can't trigger a send).
  @Get('meetings/:id/approve')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async approveForm(@Param('id') id: string, @Query('sig') sig: string) {
    if (!verify(`approve:${id}`, sig)) throw new ForbiddenException();
    const m = await this.prisma.meeting.findUnique({ where: { id }, include: { analysis: true } });
    if (!m) throw new NotFoundException();
    if (m.analysis?.approvedAt) return page('Already approved', `<h1>Already approved</h1><p>${esc(m.title)} went out ${esc(m.analysis.approvedAt.toISOString())}.</p>`);
    const n = await this.prisma.subscriber.count({ where: { status: 'CONFIRMED', OR: [{ bodies: { isEmpty: true } }, { bodies: { has: m.body } }] } });
    return page('Approve recap', `<h1>Send this recap?</h1><p><strong>${esc(m.title)}</strong><br>Goes to ${n} subscriber${n === 1 ? '' : 's'}.</p>
<form method="post" action="/admin/meetings/${esc(id)}/approve?sig=${esc(sig)}"><button type="submit">Approve and send</button></form>`);
  }

  @Post('meetings/:id/approve')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async approve(@Param('id') id: string, @Query('sig') sig: string) {
    if (!verify(`approve:${id}`, sig)) throw new ForbiddenException();
    const a = await this.prisma.analysis.findUnique({ where: { meetingId: id } });
    if (!a) throw new NotFoundException();
    if (!a.approvedAt) await this.pipeline.approve(id);
    return page('Sending', `<h1>Sending</h1><p>The recap is on its way to subscribers.</p>`);
  }

  @Get('stats')
  @UseGuards(AdminGuard)
  async stats() {
    const [subs, meetings] = await Promise.all([
      this.prisma.subscriber.groupBy({ by: ['status'], _count: true }),
      this.prisma.meeting.groupBy({ by: ['status'], _count: true }),
    ]);
    return { subscribers: subs, meetings };
  }
}
