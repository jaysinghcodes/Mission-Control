import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import {
  refreshBundledPeers,
  scheduleBundledPeerRefresh,
} from './auth/bundled-proxy';
import { bindHost, evaluateWriteBind } from './auth/write-token';
import { evaluateDashboardBind } from './auth/password';
import { bootApi } from './boot';
import { apiListenPort } from './config/ports';
import { webOrigins } from './cors-origins';

/**
 * Mission Control API bootstrap.
 *
 * CORS is locked to the Vite dev origins (localhost AND 127.0.0.1 — the
 * tunnel can present either) by default; override with a comma-separated
 * WEB_ORIGIN when deploying. Never use a wildcard here; the dashboard is
 * the only allowed consumer.
 */
async function bootstrap() {
  // Load .env, then apply reviewed migrations, before the listen checks.
  bootApi();

  const host = bindHost();
  const decision = evaluateWriteBind();
  if (decision.action === 'refuse') {
    console.error(decision.message);
    process.exit(1);
  }
  if (decision.action === 'warn') {
    console.warn(decision.message);
  }
  if (decision.action === 'log') {
    console.log(decision.message);
  }

  const dashboard = evaluateDashboardBind();
  if (dashboard.action === 'refuse') {
    console.error(dashboard.message);
    process.exit(1);
  }
  if (dashboard.action === 'warn') {
    console.warn(dashboard.message);
  }

  // Default JSON limit is 100kb. A memory.snapshot carries full note bodies
  // (MEMORY.md can be long), so the parser is raised to 2mb. The bridge
  // still skips a single file over 1MB.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { limit: '2mb', extended: true });

  // CORS is configured at BOTH layers deliberately (GLM review 🟡 #9):
  //  - enableCors() here covers HTTP REST routes (health, future CRUD)
  //  - the @WebSocketGateway decorator has its own cors for the WS handshake
  // They serve different transports; both are locked to the WEB_ORIGIN list, never wildcard.
  app.enableCors({
    origin: webOrigins(),
    credentials: true,
  });

  await refreshBundledPeers();
  scheduleBundledPeerRefresh();

  const port = apiListenPort();
  await app.listen(port, host);

  console.log(`mission-control api listening on ${host}:${port}`);
}
bootstrap();
