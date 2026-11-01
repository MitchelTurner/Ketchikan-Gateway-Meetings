import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { config } from './config';
import { forceHttps } from './web/https';
import { HtmlExceptionFilter } from './web/http-exception.filter';
import { StatsService } from './web/stats.service';

function publicHttpsBase(): string | null {
  try {
    const base = config.publicBaseUrl;
    return base.startsWith('https://') ? base : null;
  } catch {
    return null;
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Railway terminates TLS and forwards the original scheme. Without this,
  // Express treats every request as http and a redirect can loop.
  app.set('trust proxy', 1);
  app.use(forceHttps(publicHttpsBase));
  app.useGlobalFilters(new HtmlExceptionFilter());
  app.use(app.get(StatsService).middleware());
  app.enableShutdownHooks();
  // Railway healthchecks and private networking arrive over IPv6. `::` is
  // dual-stack on Linux (it also accepts IPv4). Fall back only where IPv6
  // itself is disabled, so a local run without IPv6 can still boot.
  let host = '::';
  try {
    await app.listen(config.port, host);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EAFNOSUPPORT') throw err;
    host = '0.0.0.0';
    await app.listen(config.port, host);
  }
  const shown = host === '::' ? '[::]' : host;
  new Logger('Main').log(`Listening on ${shown}:${config.port}`);
}
bootstrap();
