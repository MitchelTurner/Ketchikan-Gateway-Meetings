import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { config } from '../config';
import { DiscoveryService } from '../discovery/discovery.service';
import { Q_CONTROL, Q_EMAIL, Q_PROCESS } from '../queues';
import { DeepDiveService } from '../topics/deep-dive.service';
import { TopicsService } from '../topics/topics.service';
import { PipelineService } from './pipeline.service';

@Processor(Q_CONTROL)
export class ControlProcessor extends WorkerHost {
  constructor(
    private discovery: DiscoveryService,
    private pipeline: PipelineService,
    private topics: TopicsService,
    private dives: DeepDiveService,
  ) {
    super();
  }
  async process(job: Job) {
    if (job.name === 'discover') return this.discovery.discover();
    if (job.name === 'deliver') return this.pipeline.deliver(job.data.meetingId);
    if (job.name === 'tag-topics') return this.topics.tagUntagged();
    if (job.name === 'deep-dive') return this.dives.write(job.data.topicId, job.data.triggerMeetingId);
  }
}

// One meeting at a time: downloads are large and transcription is the expensive step.
@Processor(Q_PROCESS, { concurrency: 1 })
export class ProcessProcessor extends WorkerHost {
  constructor(private pipeline: PipelineService) {
    super();
  }
  async process(job: Job<{ meetingId: string; refreshRecap?: boolean }>) {
    await this.pipeline.processMeeting(job.data.meetingId, { refreshRecap: job.data.refreshRecap });
  }
}

// Resend's default limit is a few requests/second; stay under it.
@Processor(Q_EMAIL, { concurrency: 2, limiter: { max: Number(process.env.EMAIL_RATE_PER_SEC || 2), duration: 1000 } })
export class EmailProcessor extends WorkerHost {
  constructor(private pipeline: PipelineService, private dives: DeepDiveService) {
    super();
  }
  async process(job: Job<{ meetingId?: string; deepDiveId?: string; subscriberId: string }>) {
    if (job.name === 'send-dive') return this.dives.sendOne(job.data.deepDiveId!, job.data.subscriberId);
    await this.pipeline.sendOne(job.data.meetingId!, job.data.subscriberId);
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
    const unfinished = (await this.discovery.requeueUnfinished()) + (await this.discovery.promoteSkipped());
    const outdated = await this.discovery.requeueOutdatedRecaps();
    // Recaps written before topics existed (or while tagging failed) get tagged in the background.
    await this.controlQ.add('tag-topics', {}, { jobId: `tag-topics-boot-${Date.now()}`, removeOnComplete: 20, removeOnFail: 20 });
    this.log.log(`Archive check scheduled: "${config.discoveryCron}" (${config.timezone}). Startup discover queued. ${unfinished} unfinished meeting(s) queued. ${outdated} draft recap(s) queued to add the roster and agenda check.`);
  }
}
