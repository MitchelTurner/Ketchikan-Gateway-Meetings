import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { config } from './config';
import { HtmlExceptionFilter } from './web/http-exception.filter';
import { StatsService } from './web/stats.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use('/fonts', express.static(join(process.cwd(), 'public', 'fonts'), { maxAge: '365d', immutable: true }));
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
