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
import { PushController } from './push/push.controller';
import { PushService } from './push/push.service';
import { AccountController } from './account/account.controller';
import { AccountService } from './account/account.service';
import { AskController } from './ask/ask.controller';
import { AskService } from './ask/ask.service';
import { BillingService } from './ask/billing.service';
import { AdminController } from './web/admin.controller';
import { PublicController } from './web/public.controller';
import { StatsService } from './web/stats.service';

@Module({
  imports: [
    BullModule.forRootAsync({ useFactory: () => ({ connection: redisConnection() }) }),
    BullModule.registerQueue({ name: Q_CONTROL }, { name: Q_PROCESS }, { name: Q_EMAIL }),
  ],
  controllers: [PublicController, AdminController, PushController, AskController, AccountController],
  providers: [
    PrismaService,
    MediaService,
    ResearchService,
    TopicsService,
    DeepDiveService,
    TranscriptionService,
    AnalysisService,
    EmailService,
    PushService,
    DiscoveryService,
    PipelineService,
    ControlProcessor,
    ProcessProcessor,
    EmailProcessor,
    DiscoveryScheduler,
    StatsService,
    AskService,
    BillingService,
    AccountService,
  ],
})
export class AppModule {}
