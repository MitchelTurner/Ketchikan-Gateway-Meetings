import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AnalysisService } from './analysis/analysis.service';
import { redisConnection } from './config';
import { DiscoveryService } from './discovery/discovery.service';
import { EmailService } from './email/email.service';
import { MediaService } from './media/media.service';
import { PipelineService } from './pipeline/pipeline.service';
import { ControlProcessor, DiscoveryScheduler, EmailProcessor, ProcessProcessor } from './pipeline/processors';
import { PrismaService } from './prisma.service';
import { ResearchService } from './research/research.service';
import { DeepDiveService } from './topics/deep-dive.service';
import { TopicsService } from './topics/topics.service';
import { Q_CONTROL, Q_EMAIL, Q_PROCESS } from './queues';
import { TranscriptionService } from './transcription/transcription.service';
import { AdminController } from './web/admin.controller';
import { PublicController } from './web/public.controller';

@Module({
  imports: [
    BullModule.forRootAsync({ useFactory: () => ({ connection: redisConnection() }) }),
    BullModule.registerQueue({ name: Q_CONTROL }, { name: Q_PROCESS }, { name: Q_EMAIL }),
  ],
  controllers: [PublicController, AdminController],
  providers: [
    PrismaService,
    MediaService,
    ResearchService,
    TopicsService,
    DeepDiveService,
    TranscriptionService,
    AnalysisService,
    EmailService,
    DiscoveryService,
    PipelineService,
    ControlProcessor,
    ProcessProcessor,
    EmailProcessor,
    DiscoveryScheduler,
  ],
})
export class AppModule {}
