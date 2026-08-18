import { TIMER_STATUSES, TIMER_TYPES, Timer } from '@pomi/shared';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  TIMER_COMPLETION_STREAM_GROUP,
  TimerCompletionStreamService,
} from '../../src/timer/timer-completion-stream.service';
import {
  TIMER_COMPLETION_STREAM_KEY,
  TIMER_COMPLETION_STREAM_VERSION,
} from '../../src/timer/timer-store';

const redisUrl = process.env.REDIS_URL;

describe.runIf(Boolean(redisUrl))('Timer completion Stream integration', () => {
  let redis: Redis;
  let service: TimerCompletionStreamService;
  const persistCompletionEffects = vi.fn(async () => ({
    applied: true,
    notificationIdempotencyKey: 'timer-completed:timer-1',
  }));

  beforeAll(async () => {
    redis = new Redis(redisUrl as string, { db: 14 });
    await redis.del(TIMER_COMPLETION_STREAM_KEY);
    service = new TimerCompletionStreamService(redis, {
      persistCompletionEffects,
    } as never);
    await internals().ensureConsumerGroup();
  });

  afterAll(async () => {
    await service?.onModuleDestroy();
    if (redis) {
      await redis.del(TIMER_COMPLETION_STREAM_KEY);
      await redis.quit();
    }
  });

  it('reclaims an abandoned event and acknowledges it after persistence', async () => {
    const timer: Timer = {
      id: 'timer-1',
      userId: 'user-1',
      scheduleRevision: 'revision-1',
      startTime: 1_000,
      duration: 60_000,
      remainingTime: 0,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.COMPLETED,
    };
    const eventId = await redis.xadd(
      TIMER_COMPLETION_STREAM_KEY,
      '*',
      'schemaVersion',
      TIMER_COMPLETION_STREAM_VERSION,
      'userId',
      timer.userId as string,
      'timerId',
      timer.id,
      'scheduleRevision',
      timer.scheduleRevision as string,
      'completedAt',
      '61000',
      'claimedAt',
      '61001',
      'timer',
      JSON.stringify(timer)
    );
    await redis.xreadgroup(
      'GROUP',
      TIMER_COMPLETION_STREAM_GROUP,
      'crashed-consumer',
      'COUNT',
      1,
      'STREAMS',
      TIMER_COMPLETION_STREAM_KEY,
      '>'
    );

    await internals().recoverPending(0);

    expect(persistCompletionEffects).toHaveBeenCalledTimes(1);
    expect(persistCompletionEffects).toHaveBeenCalledWith('user-1', timer, {
      completedAt: 61_000,
      isLastWorkTimerInSession: false,
    });
    const pending = await redis.xpending(
      TIMER_COMPLETION_STREAM_KEY,
      TIMER_COMPLETION_STREAM_GROUP
    );
    expect(pending[0]).toBe(0);
    await expect(
      redis.xrange(TIMER_COMPLETION_STREAM_KEY, eventId, eventId)
    ).resolves.toEqual([]);

    await internals().recoverPending(0);
    expect(persistCompletionEffects).toHaveBeenCalledTimes(1);
  });

  function internals() {
    return service as unknown as {
      ensureConsumerGroup(): Promise<void>;
      recoverPending(minIdleMs: number): Promise<void>;
    };
  }
});
