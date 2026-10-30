import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { config } from '../config';
import { DiscoveryService } from '../discovery/discovery.service';
import { Q_CONTROL, Q_EMAIL, Q_PROCESS } from '../queues';
import { PipelineService } from './pipeline.service';

@Processor(Q_CONTROL)
export class ControlProcessor extends WorkerHost {
  constructor(private discovery: DiscoveryService, private pipeline: PipelineService) {
    super();
  }
  async process(job: Job) {
    if (job.name === 'discover') return this.discovery.discover();
    if (job.name === 'deliver') return this.pipeline.deliver(job.data.meetingId);
  }
}

// One meeting at a time: downloads are large and transcription is the expensive step.
@Processor(Q_PROCESS, { concurrency: 1 })
export class ProcessProcessor extends WorkerHost {
  constructor(private pipeline: PipelineService) {
    super();
  }
  async process(job: Job<{ meetingId: string }>) {
    await this.pipeline.processMeeting(job.data.meetingId);
  }
}

// Resend's default limit is a few requests/second; stay under it.
@Processor(Q_EMAIL, { concurrency: 2, limiter: { max: Number(process.env.EMAIL_RATE_PER_SEC || 2), duration: 1000 } })
export class EmailProcessor extends WorkerHost {
  constructor(private pipeline: PipelineService) {
    super();
  }
  async process(job: Job<{ meetingId: string; subscriberId: string }>) {
    await this.pipeline.sendOne(job.data.meetingId, job.data.subscriberId);
  }
}

/** Registers the recurring archive check (idempotent across restarts/deploys). */
@Injectable()
export class DiscoveryScheduler implements OnApplicationBootstrap {
  private log = new Logger(DiscoveryScheduler.name);
  constructor(@InjectQueue(Q_CONTROL) private controlQ: Queue, private discovery: DiscoveryService) {}
  async onApplicationBootstrap() {
    await this.controlQ.upsertJobScheduler(
      'discover-archive',
      { pattern: config.discoveryCron, tz: config.timezone },
      { name: 'discover', opts: { removeOnComplete: 50, removeOnFail: 50 } },
    );
    await this.controlQ.add('discover', {}, { jobId: `discover-boot-${Date.now()}`, removeOnComplete: 20, removeOnFail: 20 });
    const unfinished = await this.discovery.requeueUnfinished();
    const recaps = await this.discovery.requeueRecapsWithoutNews();
    this.log.log(`Archive check scheduled: "${config.discoveryCron}" (${config.timezone}). Startup discover queued. ${unfinished} unfinished meeting(s) queued. ${recaps} recap(s) queued to add local news and name checks.`);
  }
}
