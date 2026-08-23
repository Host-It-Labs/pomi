import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis, RedisOptions } from 'ioredis';

import { PomiLogger } from '../logging/pomi-logger';
import { formatSafeError } from '../logging/sanitize-log';
import { DEFAULT_REDIS_URL, REDIS_CLIENT } from './redis.constants';

const REDIS_COMMAND_RETRY_LIMIT = 3;
const REDIS_RECONNECT_DELAY_MAX_MS = 5_000;

export function createRedisOptions(): RedisOptions {
  return {
    maxRetriesPerRequest: REDIS_COMMAND_RETRY_LIMIT,
    retryStrategy: attempt =>
      Math.min(attempt * 250, REDIS_RECONNECT_DELAY_MAX_MS),
  };
}

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('REDIS_URL') || DEFAULT_REDIS_URL;
        const client = new Redis(url, createRedisOptions());
        const logger = new PomiLogger(RedisModule.name);
        client.on('error', error => {
          logger.warn(
            `Redis connection unavailable (${formatSafeError(error)})`
          );
        });
        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
