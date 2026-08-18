import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as Sentry from '@sentry/nestjs';
import * as dotenv from 'dotenv';
import Redis from 'ioredis';
import { AppModule } from './app.module';
import { configureHttpApp } from './configure-app';
import { SentryLoggerService } from './logging/sentry-logger.service';
import { sanitizeSentryEvent } from './logging/sanitize-log';
import { RedisIoAdapter } from './realtime/redis-io.adapter';
import { REDIS_CLIENT } from './redis/redis.constants';
import { getConfiguredBackendSentryRelease } from './sentry-release';

dotenv.config();

async function bootstrap() {
  const sentryDsn = process.env.NEST_SENTRY_DSN?.trim();
  Sentry.init({
    dsn: sentryDsn,
    sendDefaultPii: false,
    enabled: process.env.NODE_ENV === 'production' && Boolean(sentryDsn),
    enableLogs: true,
    environment: process.env.NODE_ENV || 'development',
    release: getConfiguredBackendSentryRelease(),
    debug: false,
    beforeSend: event => sanitizeSentryEvent(event),
  });

  const sentryLogger = new SentryLoggerService();
  Logger.overrideLogger(sentryLogger);

  let app: NestExpressApplication | undefined;
  let redisClient: Redis | undefined;
  try {
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      bodyParser: false,
      logger: sentryLogger,
    });
    app.enableShutdownHooks();
    configureHttpApp(app);
    redisClient = app.get<Redis>(REDIS_CLIENT);
    const redisIoAdapter = new RedisIoAdapter(app, redisClient);
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);

    await app.listen(process.env.NEST_PORT || 3000);
  } catch (error) {
    try {
      await app?.close();
    } catch (closeError) {
      sentryLogger.error(closeError, undefined, 'bootstrap cleanup');
    } finally {
      redisClient?.disconnect();
    }
    throw error;
  }
}
void bootstrap().catch(error => {
  new SentryLoggerService('pomi-bootstrap').error(
    error,
    undefined,
    'bootstrap'
  );
  process.exitCode = 1;
});
