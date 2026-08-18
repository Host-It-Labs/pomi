import { TIMER_STATUSES, TIMER_TYPES, Timer } from '@pomi/shared';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TimerCompletionEffectsService } from '../../src/timer/timer-completion-effects.service';
import { TimerCompletionOutboxService } from '../../src/timer/timer-completion-outbox.service';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('Timer completion effects integration', () => {
  let dataSource: DataSource;
  let service: TimerCompletionEffectsService;
  let outboxService: TimerCompletionOutboxService;
  let userId: string;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL,
    });
    await dataSource.initialize();
    service = new TimerCompletionEffectsService(dataSource);
    outboxService = new TimerCompletionOutboxService(dataSource);
  });

  beforeEach(async () => {
    await cleanTestUsers();
    userId = randomUUID();
    await dataSource.query(
      `INSERT INTO "users" ("id", "username", "password") VALUES ($1, $2, 'test-password')`,
      [userId, `vitest_timer_completion_${userId}`]
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await cleanTestUsers();
      await dataSource.destroy();
    }
  });

  it('applies a regular completion and its outbox event once', async () => {
    await createIntention('focus', TIMER_TYPES.WORK);
    await createIntention('deep-work', TIMER_TYPES.WORK);
    const timer = completedTimer({
      intention: ' focus ',
      intentionSlugs: [' focus '],
      subIntentions: { ' focus ': ' deep-work ' },
    });
    const options = {
      completedAt: 1_725_000_000_000,
      isLastWorkTimerInSession: false,
    };

    const [first, second] = await Promise.all([
      service.persistCompletionEffects(userId, timer, options),
      service.persistCompletionEffects(userId, timer, options),
    ]);

    expect([first.applied, second.applied].sort()).toEqual([false, true]);
    expect(await countRows('timer_completion_receipts', timer.id)).toBe(1);
    expect(await countRows('notification_outbox', timer.id)).toBe(1);
    expect(await countRows('timer_continuation_outbox', timer.id)).toBe(1);
    const statistics = await dataSource.query(
      `SELECT "duration", "intention", "intentions", "subIntentions" FROM "statistics" WHERE "id" = $1`,
      [timer.id]
    );
    expect(statistics).toEqual([
      expect.objectContaining({
        duration: timer.duration,
        intention: 'focus',
        intentions: ['focus'],
        subIntentions: { focus: 'deep-work' },
      }),
    ]);
    const intentions = await dataSource.query(
      `SELECT "slug", "usageCount" FROM "intentions" WHERE "userId" = $1 ORDER BY "slug"`,
      [userId]
    );
    expect(intentions).toEqual([
      { slug: 'deep-work', usageCount: 1 },
      { slug: 'focus', usageCount: 1 },
    ]);
    await expect(
      service.persistCompletionEffects(
        userId,
        { ...timer, duration: timer.duration + 1 },
        options
      )
    ).rejects.toThrow(
      'Timer completion payload conflicts with its durable receipt'
    );
    await expect(
      service.persistCompletionEffects(userId, timer, {
        ...options,
        completedAt: options.completedAt + 1,
      })
    ).rejects.toThrow(
      'Timer completion payload conflicts with its durable receipt'
    );
  });

  it('persists one idle statistic and special notification without a continuation', async () => {
    const detectedAt = 1_725_000_000_000;
    const longBreakTimer = completedTimer({
      type: TIMER_TYPES.LONG_BREAK,
      startTime: detectedAt - 900_000,
      duration: 900_000,
      hasNotifiedLongBreakDetection: true,
    });
    const replacementTimer: Timer = {
      id: randomUUID(),
      scheduleRevision: randomUUID(),
      userId,
      startTime: 0,
      duration: 1_500_000,
      remainingTime: 1_500_000,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.PAUSED,
    };
    const options = {
      detectionId: 'detection-1',
      detectedAt,
      replacementTimer,
    };

    const [first, second] = await Promise.all([
      service.persistIdleDetectionEffects(userId, longBreakTimer, options),
      service.persistIdleDetectionEffects(userId, longBreakTimer, options),
    ]);

    expect([first.applied, second.applied].sort()).toEqual([false, true]);
    expect(
      await countRows('timer_completion_receipts', longBreakTimer.id)
    ).toBe(1);
    const notifications = await dataSource.query(
      `SELECT "type", "idempotencyKey" FROM "notification_outbox" WHERE "userId" = $1`,
      [userId]
    );
    expect(notifications).toEqual([
      {
        type: 'long-break-detected',
        idempotencyKey: 'long-break-detected:detection-1',
      },
    ]);
    expect(
      await countRows('timer_continuation_outbox', longBreakTimer.id)
    ).toBe(0);
    const statistics = await dataSource.query(
      `SELECT "type", "duration" FROM "statistics" WHERE "id" = $1`,
      [longBreakTimer.id]
    );
    expect(statistics).toEqual([
      { type: TIMER_TYPES.LONG_BREAK, duration: 900_000 },
    ]);
  });

  it('appends an extension duration once to its exact original statistic', async () => {
    const originalTimerId = randomUUID();
    await dataSource.query(
      `
        INSERT INTO "statistics"
          ("id", "userId", "type", "date", "duration", "completedAt")
        VALUES ($1, $2, 'work', '2026-07-27', 60000, 1)
      `,
      [originalTimerId, userId]
    );
    const timer = completedTimer({
      isExtension: true,
      extensionOriginalTimerId: originalTimerId,
      duration: 30_000,
    });
    const options = {
      completedAt: 1_725_000_000_000,
      isLastWorkTimerInSession: false,
    };

    await service.persistCompletionEffects(userId, timer, options);
    await service.persistCompletionEffects(userId, timer, options);

    const statistics = await dataSource.query(
      `SELECT "id", "duration" FROM "statistics" WHERE "userId" = $1`,
      [userId]
    );
    expect(statistics).toEqual([{ id: originalTimerId, duration: 90_000 }]);
  });

  it('records a break receipt without creating a statistic', async () => {
    const timer = completedTimer({ type: TIMER_TYPES.BREAK });

    await service.persistCompletionEffects(userId, timer, {
      completedAt: 1_725_000_000_000,
      isLastWorkTimerInSession: false,
    });

    expect(await countRows('timer_completion_receipts', timer.id)).toBe(1);
    expect(await countRows('notification_outbox', timer.id)).toBe(1);
    expect(await countRows('timer_continuation_outbox', timer.id)).toBe(1);
    const statistics = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM "statistics" WHERE "userId" = $1`,
      [userId]
    );
    expect(statistics[0].count).toBe(0);
  });

  it('rolls back the receipt and outbox when an extension target is missing', async () => {
    const timer = completedTimer({
      isExtension: true,
      extensionOriginalTimerId: randomUUID(),
    });

    await expect(
      service.persistCompletionEffects(userId, timer, {
        completedAt: 1_725_000_000_000,
        isLastWorkTimerInSession: false,
      })
    ).rejects.toThrow(
      'Original Timer statistic is unavailable for extension completion'
    );

    expect(await countRows('timer_completion_receipts', timer.id)).toBe(0);
    expect(await countRows('notification_outbox', timer.id)).toBe(0);
    expect(await countRows('timer_continuation_outbox', timer.id)).toBe(0);
  });

  it('batch-leases notification work with fenced renewal and retry', async () => {
    const secondUserId = randomUUID();
    await dataSource.query(
      `INSERT INTO "users" ("id", "username", "password") VALUES ($1, $2, 'test-password')`,
      [secondUserId, `vitest_timer_completion_${secondUserId}`]
    );
    const timers = [
      completedTimer({}),
      completedTimer({ userId: secondUserId }),
    ];
    await Promise.all(
      timers.map(timer =>
        service.persistCompletionEffects(timer.userId as string, timer, {
          completedAt: 1_725_000_000_000,
          isLastWorkTimerInSession: false,
        })
      )
    );

    const [firstDispatcher, secondDispatcher] = await Promise.all([
      outboxService.claimPendingCompletionNotifications(10, 30_000),
      outboxService.claimPendingCompletionNotifications(10, 30_000),
    ]);
    const claims = [...firstDispatcher, ...secondDispatcher];
    expect(claims).toHaveLength(2);
    expect(new Set(claims.map(claim => claim.id)).size).toBe(2);
    expect(new Set(claims.map(claim => claim.claimToken)).size).toBe(2);
    const claim = claims[0];
    const otherClaim = claims[1];

    expect(
      await outboxService.renewCompletionNotificationLease(
        otherClaim.id,
        claim.claimToken,
        30_000
      )
    ).toBe(false);

    expect(
      await outboxService.renewCompletionNotificationLease(
        claim.id,
        randomUUID(),
        30_000
      )
    ).toBe(false);
    expect(
      await outboxService.renewCompletionNotificationLease(
        claim.id,
        claim.claimToken,
        30_000
      )
    ).toBe(true);
    expect(
      await outboxService.releaseClaimedCompletionNotification(
        claim.id,
        randomUUID(),
        new Error('stale worker'),
        5_000
      )
    ).toBe(false);
    expect(
      await outboxService.releaseClaimedCompletionNotification(
        claim.id,
        claim.claimToken,
        new Error('provider unavailable'),
        5_000
      )
    ).toBe(true);
    await dataSource.query(
      `UPDATE "notification_outbox" SET "availableAt" = now() WHERE "id" = $1`,
      [claim.id]
    );
    const retried = await outboxService.claimPendingCompletionNotifications(
      10,
      30_000
    );
    const retry = retried.find(candidate => candidate.id === claim.id);
    expect(retry?.claimToken).toEqual(expect.any(String));
    expect(retry?.claimToken).not.toBe(claim.claimToken);
    expect(
      await outboxService.markClaimedCompletionNotificationProcessed(
        claim.id,
        claim.claimToken
      )
    ).toBe(false);
    expect(
      await outboxService.markClaimedCompletionNotificationProcessed(
        claim.id,
        retry!.claimToken
      )
    ).toBe(true);

    await dataSource.query(
      `UPDATE "notification_outbox" SET "claimedUntil" = now() - interval '1 second', "availableAt" = now() - interval '1 second' WHERE "id" = $1`,
      [otherClaim.id]
    );
    const reclaimed = await outboxService.claimPendingCompletionNotifications(
      10,
      30_000
    );
    const recovered = reclaimed.find(
      candidate => candidate.id === otherClaim.id
    );
    expect(recovered?.claimToken).not.toBe(otherClaim.claimToken);
    expect(
      await outboxService.markClaimedCompletionNotificationProcessed(
        otherClaim.id,
        otherClaim.claimToken
      )
    ).toBe(false);
    expect(
      await outboxService.releaseClaimedCompletionNotification(
        otherClaim.id,
        otherClaim.claimToken,
        new Error('late failure'),
        0
      )
    ).toBe(false);
    expect(
      await outboxService.markClaimedCompletionNotificationProcessed(
        otherClaim.id,
        recovered!.claimToken
      )
    ).toBe(true);
  });

  it('claims only the oldest pending completion for each user', async () => {
    const firstTimer = completedTimer({});
    await service.persistCompletionEffects(userId, firstTimer, {
      completedAt: 1_725_000_000_000,
      isLastWorkTimerInSession: false,
    });
    await dataSource.query(
      `UPDATE "notification_outbox" SET "createdAt" = now() - interval '1 second' WHERE "idempotencyKey" = $1`,
      [`timer-completed:${firstTimer.id}`]
    );
    const secondTimer = completedTimer({});
    await service.persistCompletionEffects(userId, secondTimer, {
      completedAt: 1_725_000_060_000,
      isLastWorkTimerInSession: false,
    });

    const [firstClaim] =
      await outboxService.claimPendingCompletionNotifications(10, 30_000);
    expect(firstClaim.idempotencyKey).toBe(`timer-completed:${firstTimer.id}`);
    await expect(
      outboxService.claimPendingCompletionNotifications(10, 30_000)
    ).resolves.toEqual([]);
    await outboxService.markClaimedCompletionNotificationProcessed(
      firstClaim.id,
      firstClaim.claimToken
    );
    const [secondClaim] =
      await outboxService.claimPendingCompletionNotifications(10, 30_000);
    expect(secondClaim.idempotencyKey).toBe(
      `timer-completed:${secondTimer.id}`
    );
  });

  it('dead-letters malformed notification work under its fenced lease', async () => {
    const timer = completedTimer({});
    await service.persistCompletionEffects(userId, timer, {
      completedAt: 1_725_000_000_000,
      isLastWorkTimerInSession: false,
    });
    const [claim] = await outboxService.claimPendingCompletionNotifications(
      1,
      30_000
    );

    expect(
      await outboxService.markClaimedCompletionNotificationFailed(
        claim.id,
        randomUUID(),
        new Error('stale worker')
      )
    ).toBe(false);
    expect(
      await outboxService.markClaimedCompletionNotificationFailed(
        claim.id,
        claim.claimToken,
        new Error('malformed payload')
      )
    ).toBe(true);
    const [row] = (await dataSource.query(
      `SELECT "status", "processedAt", "claimToken", "claimedUntil", "lastError" FROM "notification_outbox" WHERE "id" = $1`,
      [claim.id]
    )) as Array<Record<string, unknown>>;
    expect(row).toMatchObject({
      status: 'failed',
      claimToken: null,
      claimedUntil: null,
      lastError: 'malformed payload',
    });
    expect(row.processedAt).not.toBeNull();
  });

  it('persists one deterministic continuation plan under a fenced lease', async () => {
    const timer = completedTimer({});
    await service.persistCompletionEffects(userId, timer, {
      completedAt: 1_725_000_000_000,
      isLastWorkTimerInSession: false,
    });

    const continuationClaims = await Promise.all([
      outboxService.claimPendingTimerContinuations(1, 30_000),
      outboxService.claimPendingTimerContinuations(1, 30_000),
    ]);
    expect(continuationClaims.flat()).toHaveLength(1);
    const [claim] = continuationClaims.flat();
    expect(claim).toEqual(
      expect.objectContaining({
        timerId: timer.id,
        userId,
        plan: null,
        planVersion: null,
      })
    );
    const plan = { nextTimerId: randomUUID(), outcome: 'advance' };
    expect(
      await outboxService.storeClaimedTimerContinuationPlan(
        timer.id,
        randomUUID(),
        plan,
        1
      )
    ).toBe(false);
    expect(
      await outboxService.storeClaimedTimerContinuationPlan(
        timer.id,
        claim.claimToken,
        plan,
        1
      )
    ).toBe(true);
    expect(
      await outboxService.storeClaimedTimerContinuationPlan(
        timer.id,
        claim.claimToken,
        { ...plan, outcome: 'different' },
        1
      )
    ).toBe(false);
    await dataSource.query(
      `UPDATE "timer_continuation_outbox" SET "claimedUntil" = now() - interval '1 second', "availableAt" = now() - interval '1 second' WHERE "timerId" = $1`,
      [timer.id]
    );
    const [retry] = await outboxService.claimPendingTimerContinuations(
      1,
      30_000
    );
    expect(retry).toEqual(
      expect.objectContaining({ plan, planVersion: 1, attempts: 2 })
    );
    expect(retry.claimToken).not.toBe(claim.claimToken);
    expect(
      await outboxService.renewTimerContinuationLease(
        timer.id,
        claim.claimToken,
        30_000
      )
    ).toBe(false);
    expect(
      await outboxService.storeClaimedTimerContinuationPlan(
        timer.id,
        claim.claimToken,
        { ...plan, outcome: 'different' },
        1
      )
    ).toBe(false);
    expect(
      await outboxService.markClaimedTimerContinuationProcessed(
        timer.id,
        claim.claimToken,
        'applied'
      )
    ).toBe(false);
    expect(
      await outboxService.releaseClaimedTimerContinuation(
        timer.id,
        retry.claimToken,
        new Error('redis unavailable'),
        0
      )
    ).toBe(true);
    const [finalClaim] = await outboxService.claimPendingTimerContinuations(
      1,
      30_000
    );
    expect(finalClaim).toEqual(
      expect.objectContaining({ plan, planVersion: 1, attempts: 3 })
    );
    expect(
      await outboxService.markClaimedTimerContinuationProcessed(
        timer.id,
        finalClaim.claimToken,
        'applied'
      )
    ).toBe(true);
  });

  it('upgrades an exact claimed continuation plan once', async () => {
    const timer = completedTimer({});
    await service.persistCompletionEffects(userId, timer, {
      completedAt: 1_725_000_000_000,
      isLastWorkTimerInSession: false,
    });
    const [claim] = await outboxService.claimPendingTimerContinuations(
      1,
      30_000
    );
    const v1 = { source: timer.id, idleDetection: null };
    const v2 = { ...v1, schema: 'durable-idle' };
    await expect(
      outboxService.storeClaimedTimerContinuationPlan(
        timer.id,
        claim.claimToken,
        v1,
        1
      )
    ).resolves.toBe(true);

    await expect(
      outboxService.upgradeClaimedTimerContinuationPlan(
        timer.id,
        randomUUID(),
        v1,
        v2,
        1,
        2
      )
    ).resolves.toBe(false);
    await expect(
      outboxService.upgradeClaimedTimerContinuationPlan(
        timer.id,
        claim.claimToken,
        { ...v1, source: 'different' },
        v2,
        1,
        2
      )
    ).resolves.toBe(false);
    await expect(
      outboxService.upgradeClaimedTimerContinuationPlan(
        timer.id,
        claim.claimToken,
        v1,
        v2,
        1,
        2
      )
    ).resolves.toBe(true);
    await expect(
      outboxService.upgradeClaimedTimerContinuationPlan(
        timer.id,
        claim.claimToken,
        v1,
        { ...v2, schema: 'different' },
        1,
        2
      )
    ).resolves.toBe(false);

    const [row] = (await dataSource.query(
      `SELECT "plan", "planVersion" FROM "timer_continuation_outbox" WHERE "timerId" = $1`,
      [timer.id]
    )) as Array<{ plan: Record<string, unknown>; planVersion: number }>;
    expect(row).toEqual({ plan: v2, planVersion: 2 });
  });

  it('rejects invalid outbox claim and lease bounds before querying', async () => {
    await expect(
      outboxService.claimPendingCompletionNotifications(0, 30_000)
    ).rejects.toThrow('Notification claim limit must be a positive integer');
    await expect(
      outboxService.claimPendingTimerContinuations(1, -1)
    ).rejects.toThrow('Continuation lease duration must be between');
    await expect(
      outboxService.storeClaimedTimerContinuationPlan(
        randomUUID(),
        randomUUID(),
        null as never,
        1
      )
    ).rejects.toThrow('Continuation plan must be a non-empty object');
    await expect(
      outboxService.markClaimedTimerContinuationProcessed(
        randomUUID(),
        randomUUID(),
        'unknown' as never
      )
    ).rejects.toThrow('Unsupported continuation outcome');
  });

  it('backfills missing continuation work without replaying additive effects', async () => {
    await createIntention('focus', TIMER_TYPES.WORK);
    await dataSource.query(
      `UPDATE "intentions" SET "usageCount" = 1 WHERE "userId" = $1 AND "slug" = 'focus'`,
      [userId]
    );
    const timer = completedTimer({
      intention: 'focus',
      intentionSlugs: ['focus'],
    });
    const options = {
      completedAt: 1_725_000_000_000,
      isLastWorkTimerInSession: false,
    };
    const payload = {
      timer,
      isLastWorkTimerInSession: false,
      completedAt: options.completedAt,
    };
    await dataSource.query(
      `
        INSERT INTO "timer_completion_receipts"
          ("timerId", "userId", "effectVersion", "completedAt", "payload")
        VALUES ($1, $2, 1, $3, $4::jsonb)
      `,
      [timer.id, userId, options.completedAt, JSON.stringify(payload)]
    );
    await dataSource.query(
      `
        INSERT INTO "statistics"
          ("id", "userId", "type", "date", "duration", "completedAt", "intention", "intentions")
        VALUES ($1, $2, 'work', '2024-08-29', $3, $4, 'focus', ARRAY['focus'])
      `,
      [timer.id, userId, timer.duration, options.completedAt]
    );

    await expect(
      service.persistCompletionEffects(userId, timer, options)
    ).resolves.toMatchObject({ applied: false });

    expect(await countRows('timer_continuation_outbox', timer.id)).toBe(1);
    const statistics = await dataSource.query(
      `SELECT "duration" FROM "statistics" WHERE "id" = $1`,
      [timer.id]
    );
    expect(statistics).toEqual([{ duration: timer.duration }]);
    const intentions = await dataSource.query(
      `SELECT "usageCount" FROM "intentions" WHERE "userId" = $1 AND "slug" = 'focus'`,
      [userId]
    );
    expect(intentions).toEqual([{ usageCount: 1 }]);
  });

  function completedTimer(overrides: Partial<Timer>): Timer {
    return {
      id: randomUUID(),
      userId,
      startTime: 1_724_999_940_000,
      duration: 60_000,
      remainingTime: 0,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.COMPLETED,
      ...overrides,
    };
  }

  async function createIntention(slug: string, type: string): Promise<void> {
    await dataSource.query(
      `
        INSERT INTO "intentions"
          ("id", "userId", "title", "emoji", "slug", "type", "parentIntentionId", "hasCustomDuration", "customDuration", "keepScreenAwake", "isHabit", "isArchived", "isFavorite", "usageCount")
        VALUES ($1, $2, $3, 'x', $3, $4, NULL, false, NULL, false, false, false, false, 0)
      `,
      [randomUUID(), userId, slug, type]
    );
  }

  async function countRows(table: string, timerId: string): Promise<number> {
    const column =
      table === 'notification_outbox' ? 'idempotencyKey' : 'timerId';
    const value =
      table === 'notification_outbox' ? `timer-completed:${timerId}` : timerId;
    const rows = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM "${table}" WHERE "${column}" = $1`,
      [value]
    );
    return rows[0].count;
  }

  async function cleanTestUsers(): Promise<void> {
    await dataSource.query(
      `DELETE FROM "timer_continuation_outbox" WHERE "timerId" IN (SELECT "timerId" FROM "timer_completion_receipts" WHERE "userId" IN (SELECT "id" FROM "users" WHERE "username" LIKE 'vitest_timer_completion_%'))`
    );
    await dataSource.query(
      `DELETE FROM "notification_outbox" WHERE "userId" IN (SELECT "id" FROM "users" WHERE "username" LIKE 'vitest_timer_completion_%')`
    );
    await dataSource.query(
      `DELETE FROM "timer_completion_receipts" WHERE "userId" IN (SELECT "id" FROM "users" WHERE "username" LIKE 'vitest_timer_completion_%')`
    );
    await dataSource.query(
      `DELETE FROM "statistics" WHERE "userId" IN (SELECT "id" FROM "users" WHERE "username" LIKE 'vitest_timer_completion_%')`
    );
    await dataSource.query(
      `DELETE FROM "intentions" WHERE "userId" IN (SELECT "id" FROM "users" WHERE "username" LIKE 'vitest_timer_completion_%')`
    );
    await dataSource.query(
      `DELETE FROM "users" WHERE "username" LIKE 'vitest_timer_completion_%'`
    );
  }
});
