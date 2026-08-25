import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { createDatabaseOptions } from '../../src/database/database.module';
import { createRedisOptions } from '../../src/redis/redis.module';

describe('runtime startup recovery', () => {
  it('runs migrations before providers start background work', () => {
    const options = createDatabaseOptions(
      new ConfigService({
        DATABASE_URL: 'postgres://user:password@localhost:5432/pomodoro',
        NODE_ENV: 'test',
      })
    );

    expect(options.migrationsRun).toBe(true);
    expect(options.synchronize).toBe(false);
    expect(options.migrations).toEqual([
      expect.stringMatching(/packages\/backend\/migrations\/\*\{\.ts,\.js\}$/),
    ]);
  });

  it('bounds failed Redis commands while keeping reconnects enabled', () => {
    const options = createRedisOptions();

    expect(options.maxRetriesPerRequest).toBe(3);
    expect(options.retryStrategy?.(1)).toBe(250);
    expect(options.retryStrategy?.(100)).toBe(5_000);
  });
});
