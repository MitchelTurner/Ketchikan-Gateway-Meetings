import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
