import { InjectQueue } from '@nestjs/bullmq';
import {
  CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Header, HttpCode, Injectable,
  NotFoundException, Param, Post, Query, UseGuards,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { timingSafeEqual } from 'crypto';
import { config } from '../config';
import { DiscoveryService } from '../discovery/discovery.service';
import { renderHtml } from '../email/render';
import { PipelineService } from '../pipeline/pipeline.service';
import { PrismaService } from '../prisma.service';
import { Q_CONTROL } from '../queues';
import { esc, verify } from '../util';
import { page } from './page';

@Injectable()
class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const h = String(ctx.switchToHttp().getRequest().headers.authorization ?? '');
    const given = Buffer.from(h.replace(/^Bearer\s+/i, ''));
    const want = Buffer.from(config.adminToken);
    return given.length === want.length && timingSafeEqual(given, want);
  }
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
  meetings(@Query('status') status?: string) {
    return this.prisma.meeting.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: [{ meetingDate: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      select: { id: true, title: true, body: true, meetingDate: true, status: true, error: true, sourceUrl: true },
    });
  }

  /** Re-run (or force-run a SKIPPED meeting). Finished stages are reused. */
  @Post('meetings/:id/process')
  @UseGuards(AdminGuard)
  async process(@Param('id') id: string, @Query('reanalyze') reanalyze?: string) {
    if (reanalyze === 'true') await this.prisma.analysis.deleteMany({ where: { meetingId: id } });
    await this.prisma.meeting.update({ where: { id }, data: { status: 'DISCOVERED', error: null } });
    await this.discovery.enqueueProcess(id);
    return { queued: true };
  }

  @Get('meetings/:id/preview')
  @UseGuards(AdminGuard)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async preview(@Param('id') id: string) {
    return renderHtml(await this.pipeline.renderInput(id, null));
  }

  @Get('meetings/:id/transcript')
  @UseGuards(AdminGuard)
  async transcript(@Param('id') id: string) {
    const t = await this.prisma.transcript.findUnique({ where: { meetingId: id } });
    if (!t) throw new NotFoundException();
    return t;
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
