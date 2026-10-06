import { Module, Global } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LiveActivityGateway } from './live-activity/live-activity.gateway';
import { HealthController } from './health/health.controller';
import { HealthTickerService } from './health/health.ticker';
import { IngestController } from './ingest/ingest.controller';
import { SnapshotsService } from './snapshots/snapshots.service';
import { DocsService } from './docs/docs.service';
import { AgentsController } from './agents/agents.controller';
import { RunsController } from './runs/runs.controller';
import { TicketsController } from './tickets/tickets.controller';
import { ProjectsController } from './projects/projects.controller';
import { SessionsController } from './sessions/sessions.controller';
import { CalendarController } from './calendar/calendar.controller';
import { UsageController } from './usage/usage.controller';
import { ActivityController } from './activity/activity.controller';
import { LogsController } from './logs/logs.controller';
import { ApprovalsController } from './approvals/approvals.controller';
import { SearchController } from './search/search.controller';
import { SystemController } from './system/system.controller';
import { ModelsController } from './models/models.controller';
import { MemoryController } from './memory/memory.controller';
import { DocsController } from './docs/docs.controller';
import { DevicesController, MissionController } from './team/team.controller';
import { GitHubService } from './github/github.service';
import { PrismaService } from './prisma/prisma.service';

/**
 * AppModule — root module for the Mission Control API.
 *
 * v2: full live-data surface — resource controllers backed by the real
 * OpenClaw state that the bridge syncs via *.snapshot events, plus the
 * ingest door, health probe and ticker, and the Socket.IO gateway.
 */
@Global()
@Module({
  imports: [],
  controllers: [
    AppController,
    HealthController,
    IngestController,
    AgentsController,
    RunsController,
    TicketsController,
    ProjectsController,
    SessionsController,
    CalendarController,
    UsageController,
    ActivityController,
    LogsController,
    ApprovalsController,
    SearchController,
    SystemController,
    ModelsController,
    MemoryController,
    DocsController,
    MissionController,
    DevicesController,
  ],
  providers: [
    AppService,
    LiveActivityGateway,
    PrismaService,
    HealthTickerService,
    SnapshotsService,
    DocsService,
    GitHubService,
  ],
  exports: [PrismaService, LiveActivityGateway],
})
export class AppModule {}
