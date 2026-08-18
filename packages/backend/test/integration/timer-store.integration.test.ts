import { TIMER_STATUSES, TIMER_TYPES, type Timer } from '@pomi/shared';
import { randomUUID } from 'crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  APPLY_TIMER_CONTINUATION_PLAN_SCRIPT,
  CLAIM_RUNNING_TIMER_COMPLETION_BY_MODE_SCRIPT,
  TIMER_COMPLETION_MODE_KEY,
  TIMER_COMPLETION_SCHEDULER_LOCK_KEY,
  TIMER_COMPLETION_SCHEDULE_KEY,
  TIMER_COMPLETION_SCHEDULE_QUARANTINE_KEY,
  TIMER_COMPLETION_SCHEDULE_READY_KEY,
  TIMER_COMPLETION_STREAM_KEY,
  TIMER_COMPLETION_STREAM_VERSION,
  TIMER_IDLE_DETECTION_STREAM_KEY,
  TIMER_IDLE_DETECTION_MODE_KEY,
  TIMER_IDLE_SCHEDULE_KEY,
  TIMER_IDLE_SCHEDULE_GENERATION_KEY,
  TIMER_IDLE_SCHEDULE_QUARANTINE_KEY,
  TIMER_IDLE_SCHEDULE_READY_KEY,
  TimerStore,
  timerVersion,
} from '../../src/timer/timer-store';
import type { TimerContinuationPlanV2 } from '../../src/timer/timer-continuation-plan';

const redisUrl = process.env.REDIS_URL;

describe.runIf(Boolean(redisUrl))('TimerStore schedule contract', () => {
  let redis: Redis;
  let store: TimerStore;
  const users = new Set<string>();
  const completionEventIds = new Set<string>();
  const idleEventIds = new Set<string>();

  const timerKey = (userId: string) => `user:${userId}:current_timer`;
  const scheduleMember = (userId: string) => `completion:${userId}`;
  const createTimer = (
    userId: string,
    overrides: Partial<Timer> = {}
  ): Timer => ({
    id: randomUUID(),
    userId,
    startTime: Date.now(),
    duration: 25 * 60_000,
    type: TIMER_TYPES.WORK,
    status: TIMER_STATUSES.RUNNING,
    remainingTime: 25 * 60_000,
    ...overrides,
  });
  const createUserId = () => {
    const userId = `timer-store-integration-${randomUUID()}`;
    users.add(userId);
    return userId;
  };

  beforeAll(() => {
    redis = new Redis(redisUrl as string);
    store = new TimerStore(redis);
  });

  afterAll(async () => {
    for (const userId of users) {
      await redis.del(
        timerKey(userId),
        `user:${userId}:timer_runtime_revision`,
        `user:${userId}:session_state`,
        `user:${userId}:last_timer_completion`,
        `user:${userId}:idle_detected`,
        `user:${userId}:timer_undo_state`,
        `user:${userId}:timer_undo_history`,
        `user:${userId}:timer_redo_history`,
        `user:${userId}:timer_extension_state`,
        `user:${userId}:timer_continuation_lock`,
        `user:${userId}:idle_detection_schedule:v1`
      );
      await redis.zrem(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId));
      await redis.zrem(TIMER_IDLE_SCHEDULE_KEY, `idle:${userId}`);
      await redis.hdel(
        TIMER_COMPLETION_SCHEDULE_QUARANTINE_KEY,
        scheduleMember(userId)
      );
      await redis.hdel(TIMER_IDLE_SCHEDULE_QUARANTINE_KEY, `idle:${userId}`);
    }
    if (idleEventIds.size > 0) {
      await redis.xdel(TIMER_IDLE_DETECTION_STREAM_KEY, ...idleEventIds);
    }
    if (completionEventIds.size > 0) {
      await redis.xdel(
        TIMER_COMPLETION_STREAM_KEY,
        ...Array.from(completionEventIds)
      );
    }
    await redis.del(TIMER_COMPLETION_MODE_KEY);
    await redis.del(TIMER_IDLE_DETECTION_MODE_KEY);
    await redis.del(TIMER_COMPLETION_SCHEDULER_LOCK_KEY);
    await redis.del(TIMER_COMPLETION_SCHEDULE_READY_KEY);
    await redis.del(TIMER_IDLE_SCHEDULE_READY_KEY);
    await redis.del(TIMER_IDLE_SCHEDULE_GENERATION_KEY);
    await redis.quit();
  });

  it('creates and revisions a running Timer with one durable deadline', async () => {
    const userId = createUserId();
    const timer = createTimer(userId);

    const write = await store.replaceCurrentTimer(userId, null, timer);

    expect(write.kind).toBe('updated');
    if (write.kind !== 'updated') return;
    expect(write.timer.scheduleRevision).toEqual(expect.any(String));
    await expect(
      redis.zscore(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId))
    ).resolves.toBe(String(timer.startTime + timer.duration));
  });

  it('allows one concurrent writer and rejects the stale revision', async () => {
    const userId = createUserId();
    const initial = await store.replaceCurrentTimer(
      userId,
      null,
      createTimer(userId)
    );
    if (initial.kind !== 'updated') throw new Error('Timer setup conflicted');

    const expected = timerVersion(initial.timer);
    const [first, second] = await Promise.all([
      store.replaceCurrentTimer(userId, expected, {
        ...initial.timer,
        remainingTime: initial.timer.remainingTime - 1,
      }),
      store.replaceCurrentTimer(userId, expected, {
        ...initial.timer,
        remainingTime: initial.timer.remainingTime - 2,
      }),
    ]);

    expect([first.kind, second.kind].sort()).toEqual(['conflict', 'updated']);
    const persisted = await store.getCurrentTimer(userId);
    expect(persisted?.scheduleRevision).not.toBe(
      initial.timer.scheduleRevision
    );
  });

  it('removes and restores the deadline as status changes', async () => {
    const userId = createUserId();
    const created = await store.replaceCurrentTimer(
      userId,
      null,
      createTimer(userId)
    );
    if (created.kind !== 'updated') throw new Error('Timer setup conflicted');

    const paused = await store.replaceCurrentTimer(
      userId,
      timerVersion(created.timer),
      { ...created.timer, status: TIMER_STATUSES.PAUSED }
    );
    expect(paused.kind).toBe('updated');
    await expect(
      redis.zscore(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId))
    ).resolves.toBeNull();
    if (paused.kind !== 'updated') return;
    const resumed = await store.replaceCurrentTimer(
      userId,
      timerVersion(paused.timer),
      { ...paused.timer, status: TIMER_STATUSES.RUNNING }
    );
    expect(resumed.kind).toBe('updated');
    await expect(
      redis.zscore(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId))
    ).resolves.toBe(String(paused.timer.startTime + paused.timer.duration));
  });

  it('upgrades a revisionless Timer and fences later stale writes', async () => {
    const userId = createUserId();
    const legacy = createTimer(userId);
    await redis.set(timerKey(userId), JSON.stringify(legacy));

    const upgraded = await store.replaceCurrentTimer(
      userId,
      timerVersion(legacy),
      { ...legacy, remainingTime: legacy.remainingTime - 1 }
    );
    expect(upgraded.kind).toBe('updated');
    if (upgraded.kind !== 'updated') return;

    await expect(
      store.replaceCurrentTimer(userId, timerVersion(legacy), legacy)
    ).resolves.toMatchObject({ kind: 'conflict' });
  });

  it('keeps warning claims indexed and removes completed claims', async () => {
    const userId = createUserId();
    const now = Date.now() - 100;
    const created = await store.replaceCurrentTimer(
      userId,
      null,
      createTimer(userId, { startTime: now, duration: 60_000 })
    );
    if (created.kind !== 'updated') throw new Error('Timer setup conflicted');

    const warned = await store.claimRunningTimerWarning(
      userId,
      created.timer.id,
      created.timer.startTime,
      60_000
    );
    expect(warned?.scheduleRevision).not.toBe(created.timer.scheduleRevision);
    await expect(
      redis.zscore(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId))
    ).resolves.toBe(String(now + 60_000));

    const overdue = { ...warned, startTime: now - 60_001 } as Timer;
    const moved = await store.replaceCurrentTimer(
      userId,
      timerVersion(warned as Timer),
      overdue
    );
    if (moved.kind !== 'updated') throw new Error('Timer move conflicted');
    await expect(
      store.claimRunningTimerCompletionByMode(
        userId,
        moved.timer.id,
        moved.timer.startTime
      )
    ).resolves.toMatchObject({
      mode: 'legacy',
      timer: { status: TIMER_STATUSES.COMPLETED },
    });
    await expect(
      redis.zscore(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId))
    ).resolves.toBeNull();
  });

  it('atomically appends a durable event with a completed Timer claim', async () => {
    await redis.set(TIMER_COMPLETION_MODE_KEY, 'stream');
    const userId = createUserId();
    const created = await store.replaceCurrentTimer(
      userId,
      null,
      createTimer(userId, { startTime: Date.now() - 61_000, duration: 60_000 })
    );
    if (created.kind !== 'updated') throw new Error('Timer setup conflicted');

    const claimed = await store.claimRunningTimerCompletionByMode(
      userId,
      created.timer.id,
      created.timer.startTime
    );
    if (!claimed) throw new Error('Timer completion was not claimed');
    if (!claimed.eventId) throw new Error('Completion event was not appended');
    completionEventIds.add(claimed.eventId);

    expect(claimed.timer).toMatchObject({
      id: created.timer.id,
      userId,
      status: TIMER_STATUSES.COMPLETED,
      remainingTime: 0,
    });
    expect(claimed.mode).toBe('stream');
    expect(claimed.completedAt).toBe(
      created.timer.startTime + created.timer.duration
    );
    expect(claimed.claimedAt).toBeGreaterThanOrEqual(claimed.completedAt);
    await expect(
      redis.zscore(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId))
    ).resolves.toBeNull();
    const entries = await redis.xrange(
      TIMER_COMPLETION_STREAM_KEY,
      claimed.eventId,
      claimed.eventId
    );
    expect(entries).toHaveLength(1);
    expect(Object.fromEntries(pairFields(entries[0][1]))).toMatchObject({
      schemaVersion: TIMER_COMPLETION_STREAM_VERSION,
      userId,
      timerId: created.timer.id,
      scheduleRevision: claimed.timer.scheduleRevision,
      completedAt: String(claimed.completedAt),
      claimedAt: String(claimed.claimedAt),
      timer: JSON.stringify(claimed.timer),
    });
    await expect(
      store.claimRunningTimerCompletionByMode(
        userId,
        created.timer.id,
        created.timer.startTime
      )
    ).resolves.toBeNull();
    await redis.del(TIMER_COMPLETION_MODE_KEY);
  });

  it('fences scheduled completion by leader token and stream mode', async () => {
    await redis.del(TIMER_COMPLETION_SCHEDULER_LOCK_KEY);
    const userId = createUserId();
    const created = await store.replaceCurrentTimer(
      userId,
      null,
      createTimer(userId, { startTime: Date.now() - 61_000, duration: 60_000 })
    );
    if (created.kind !== 'updated') throw new Error('Timer setup conflicted');
    const scheduled = (
      await store.getDueTimerCompletions(await store.getRedisTimeMs(), 100)
    ).find(candidate => candidate.userId === userId);
    if (!scheduled) throw new Error('Due schedule was not found');
    const leaderToken = await store.claimTimerCompletionScheduler(10_000);
    if (!leaderToken) throw new Error('Scheduler leader setup failed');

    await expect(
      store.claimScheduledTimerCompletion(userId, scheduled, randomUUID())
    ).resolves.toEqual({ kind: 'lost-leader' });
    await expect(
      store.claimScheduledTimerCompletion(userId, scheduled, leaderToken)
    ).resolves.toEqual({ kind: 'legacy' });
    await expect(store.getCurrentTimer(userId)).resolves.toMatchObject({
      status: TIMER_STATUSES.RUNNING,
    });

    await redis.set(TIMER_COMPLETION_MODE_KEY, 'stream');
    const result = await store.claimScheduledTimerCompletion(
      userId,
      scheduled,
      leaderToken
    );
    expect(result.kind).toBe('claimed');
    if (result.kind !== 'claimed' || !result.claim.eventId) {
      throw new Error('Scheduled completion was not claimed');
    }
    completionEventIds.add(result.claim.eventId);
    await expect(store.getCurrentTimer(userId)).resolves.toMatchObject({
      status: TIMER_STATUSES.COMPLETED,
      remainingTime: 0,
    });
    await expect(
      redis.zscore(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId))
    ).resolves.toBeNull();
    await store.releaseTimerCompletionScheduler(leaderToken);
  });

  it('repairs drifted deadlines and prunes non-running schedules', async () => {
    await redis.del(TIMER_COMPLETION_SCHEDULER_LOCK_KEY);
    await redis.set(TIMER_COMPLETION_MODE_KEY, 'stream');
    const userId = createUserId();
    const created = await store.replaceCurrentTimer(
      userId,
      null,
      createTimer(userId, { startTime: Date.now(), duration: 60_000 })
    );
    if (created.kind !== 'updated') throw new Error('Timer setup conflicted');
    const driftedDeadline = Date.now() - 1;
    await redis.zadd(
      TIMER_COMPLETION_SCHEDULE_KEY,
      driftedDeadline,
      scheduleMember(userId)
    );
    const leaderToken = await store.claimTimerCompletionScheduler(10_000);
    if (!leaderToken) throw new Error('Scheduler leader setup failed');
    const scheduled = {
      member: scheduleMember(userId),
      userId,
      deadline: driftedDeadline,
    };

    await expect(
      store.claimScheduledTimerCompletion(userId, scheduled, leaderToken)
    ).resolves.toEqual({ kind: 'repaired' });
    await expect(
      redis.zscore(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId))
    ).resolves.toBe(String(created.timer.startTime + created.timer.duration));

    const paused = await store.replaceCurrentTimer(
      userId,
      timerVersion(created.timer),
      { ...created.timer, status: TIMER_STATUSES.PAUSED }
    );
    if (paused.kind !== 'updated') throw new Error('Timer pause conflicted');
    await redis.zadd(
      TIMER_COMPLETION_SCHEDULE_KEY,
      driftedDeadline,
      scheduleMember(userId)
    );
    await expect(
      store.claimScheduledTimerCompletion(
        userId,
        { ...scheduled, deadline: driftedDeadline },
        leaderToken
      )
    ).resolves.toEqual({ kind: 'stale' });
    await expect(
      redis.zscore(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId))
    ).resolves.toBeNull();
    await store.releaseTimerCompletionScheduler(leaderToken);
  });

  it('quarantines corrupt scheduled state before publishing an event', async () => {
    await redis.del(TIMER_COMPLETION_SCHEDULER_LOCK_KEY);
    await redis.set(TIMER_COMPLETION_MODE_KEY, 'stream');
    const userId = createUserId();
    const timer = createTimer(userId, {
      startTime: Date.now() - 61_000,
      duration: 0,
    });
    const raw = JSON.stringify(timer);
    const deadline = timer.startTime + timer.duration;
    await redis.set(timerKey(userId), raw);
    await redis.zadd(
      TIMER_COMPLETION_SCHEDULE_KEY,
      deadline,
      scheduleMember(userId)
    );
    const streamLengthBefore = await redis.xlen(TIMER_COMPLETION_STREAM_KEY);
    const leaderToken = await store.claimTimerCompletionScheduler(10_000);
    if (!leaderToken) throw new Error('Scheduler leader setup failed');

    await expect(
      store.claimScheduledTimerCompletion(
        userId,
        { member: scheduleMember(userId), userId, deadline },
        leaderToken
      )
    ).resolves.toEqual({ kind: 'corrupt' });
    await expect(redis.get(timerKey(userId))).resolves.toBe(raw);
    await expect(
      redis.zscore(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId))
    ).resolves.toBeNull();
    await expect(
      redis.hget(
        TIMER_COMPLETION_SCHEDULE_QUARANTINE_KEY,
        scheduleMember(userId)
      )
    ).resolves.toBe(raw);
    await expect(redis.xlen(TIMER_COMPLETION_STREAM_KEY)).resolves.toBe(
      streamLengthBefore
    );
    await store.releaseTimerCompletionScheduler(leaderToken);
  });

  it('quarantines malformed scheduled payload fields before publishing', async () => {
    await redis.del(TIMER_COMPLETION_SCHEDULER_LOCK_KEY);
    await redis.set(TIMER_COMPLETION_MODE_KEY, 'stream');
    const userId = createUserId();
    const timer = createTimer(userId, {
      startTime: Date.now() - 61_000,
      duration: 60_000,
      intentionSlugs: [],
    });
    const raw = JSON.stringify(timer);
    const deadline = timer.startTime + timer.duration;
    await redis.set(timerKey(userId), raw);
    await redis.zadd(
      TIMER_COMPLETION_SCHEDULE_KEY,
      deadline,
      scheduleMember(userId)
    );
    const streamLengthBefore = await redis.xlen(TIMER_COMPLETION_STREAM_KEY);
    const leaderToken = await store.claimTimerCompletionScheduler(10_000);
    if (!leaderToken) throw new Error('Scheduler leader setup failed');

    await expect(
      store.claimScheduledTimerCompletion(
        userId,
        { member: scheduleMember(userId), userId, deadline },
        leaderToken
      )
    ).resolves.toEqual({ kind: 'corrupt' });
    await expect(
      redis.hget(
        TIMER_COMPLETION_SCHEDULE_QUARANTINE_KEY,
        scheduleMember(userId)
      )
    ).resolves.toBe(raw);
    await expect(redis.xlen(TIMER_COMPLETION_STREAM_KEY)).resolves.toBe(
      streamLengthBefore
    );
    await store.releaseTimerCompletionScheduler(leaderToken);
  });

  it('quarantines corrupt local completion state before publishing an event', async () => {
    await redis.set(TIMER_COMPLETION_MODE_KEY, 'stream');
    const userId = createUserId();
    const timer = createTimer(userId, {
      startTime: Date.now() - 61_000,
      duration: 60_000,
      extensionBaseDuration: 0,
    });
    const raw = JSON.stringify(timer);
    const deadline = timer.startTime + timer.duration;
    await redis.set(timerKey(userId), raw);
    await redis.zadd(
      TIMER_COMPLETION_SCHEDULE_KEY,
      deadline,
      scheduleMember(userId)
    );
    const streamLengthBefore = await redis.xlen(TIMER_COMPLETION_STREAM_KEY);

    await expect(
      store.claimRunningTimerCompletionByMode(userId, timer.id, timer.startTime)
    ).resolves.toBeNull();
    await expect(redis.get(timerKey(userId))).resolves.toBe(raw);
    await expect(
      redis.zscore(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId))
    ).resolves.toBeNull();
    await expect(
      redis.hget(
        TIMER_COMPLETION_SCHEDULE_QUARANTINE_KEY,
        scheduleMember(userId)
      )
    ).resolves.toBe(raw);
    await expect(redis.xlen(TIMER_COMPLETION_STREAM_KEY)).resolves.toBe(
      streamLengthBefore
    );
  });

  it('quarantines malformed local payload fields before publishing', async () => {
    await redis.set(TIMER_COMPLETION_MODE_KEY, 'stream');
    const userId = createUserId();
    const timer = createTimer(userId, {
      startTime: Date.now() - 61_000,
      duration: 60_000,
      focusedTaskIds: [1] as unknown as string[],
    });
    const raw = JSON.stringify(timer);
    const deadline = timer.startTime + timer.duration;
    await redis.set(timerKey(userId), raw);
    await redis.zadd(
      TIMER_COMPLETION_SCHEDULE_KEY,
      deadline,
      scheduleMember(userId)
    );
    const streamLengthBefore = await redis.xlen(TIMER_COMPLETION_STREAM_KEY);

    await expect(
      store.claimRunningTimerCompletionByMode(userId, timer.id, timer.startTime)
    ).resolves.toBeNull();
    await expect(
      redis.hget(
        TIMER_COMPLETION_SCHEDULE_QUARANTINE_KEY,
        scheduleMember(userId)
      )
    ).resolves.toBe(raw);
    await expect(redis.xlen(TIMER_COMPLETION_STREAM_KEY)).resolves.toBe(
      streamLengthBefore
    );
  });

  it('backfills authoritative schedules before marking readiness', async () => {
    await redis.del(
      TIMER_COMPLETION_SCHEDULER_LOCK_KEY,
      TIMER_COMPLETION_SCHEDULE_READY_KEY
    );
    const userId = createUserId();
    const created = await store.replaceCurrentTimer(
      userId,
      null,
      createTimer(userId, { startTime: Date.now(), duration: 60_000 })
    );
    if (created.kind !== 'updated') throw new Error('Timer setup conflicted');
    await redis.zrem(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId));
    const leaderToken = await store.claimTimerCompletionScheduler(10_000);
    if (!leaderToken) throw new Error('Scheduler leader setup failed');

    await expect(
      store.reconcileTimerCompletionSchedule(userId, randomUUID())
    ).resolves.toBe('lost-leader');
    await expect(
      store.reconcileTimerCompletionSchedule(userId, leaderToken)
    ).resolves.toBe('scheduled');
    await expect(
      redis.zscore(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId))
    ).resolves.toBe(String(created.timer.startTime + created.timer.duration));
    await expect(
      store.markTimerCompletionScheduleReady(randomUUID())
    ).resolves.toBe(false);
    await expect(
      store.markTimerCompletionScheduleReady(leaderToken)
    ).resolves.toBe(true);
    await expect(store.isTimerCompletionScheduleReady()).resolves.toBe(true);

    let cursor = '0';
    const scannedUserIds: string[] = [];
    do {
      const page = await store.scanCurrentTimerUsers(cursor, 1_000);
      scannedUserIds.push(...page.userIds);
      cursor = page.cursor;
    } while (cursor !== '0');
    expect(scannedUserIds).toContain(userId);
    await store.releaseTimerCompletionScheduler(leaderToken);
  });

  it('quarantines corrupt state during schedule backfill', async () => {
    await redis.del(
      TIMER_COMPLETION_SCHEDULER_LOCK_KEY,
      TIMER_COMPLETION_SCHEDULE_READY_KEY
    );
    const userId = createUserId();
    const timer = createTimer(userId, {
      sessionIntentionEmojis: { 1: 1 } as unknown as Record<number, string>,
    });
    const raw = JSON.stringify(timer);
    await redis.set(timerKey(userId), raw);
    await redis.zadd(
      TIMER_COMPLETION_SCHEDULE_KEY,
      timer.startTime + timer.duration,
      scheduleMember(userId)
    );
    const leaderToken = await store.claimTimerCompletionScheduler(10_000);
    if (!leaderToken) throw new Error('Scheduler leader setup failed');

    await expect(
      store.reconcileTimerCompletionSchedule(userId, leaderToken)
    ).resolves.toBe('corrupt');
    await expect(
      redis.zscore(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId))
    ).resolves.toBeNull();
    await expect(
      redis.hget(
        TIMER_COMPLETION_SCHEDULE_QUARANTINE_KEY,
        scheduleMember(userId)
      )
    ).resolves.toBe(raw);
    await expect(store.isTimerCompletionScheduleReady()).resolves.toBe(false);
    await store.releaseTimerCompletionScheduler(leaderToken);
  });

  it('enables durable idle claims only from ready generation-fenced state', async () => {
    await redis.del(
      TIMER_COMPLETION_SCHEDULER_LOCK_KEY,
      TIMER_IDLE_SCHEDULE_READY_KEY,
      TIMER_IDLE_SCHEDULE_GENERATION_KEY,
      TIMER_IDLE_DETECTION_MODE_KEY
    );
    await redis.set(TIMER_IDLE_DETECTION_MODE_KEY, 'unsupported-mode');
    await expect(store.getIdleDetectionMode()).resolves.toBe('legacy');
    const leaderToken = await store.claimTimerCompletionScheduler(10_000);
    if (!leaderToken) throw new Error('Scheduler leader setup failed');

    await expect(
      store.enableDurableIdleDetection(leaderToken, 0)
    ).resolves.toBe(false);
    await expect(
      store.markIdleDetectionScheduleReady(leaderToken, 0)
    ).resolves.toBe(true);
    await store.prepareIdleDetectionScheduleChange();
    await expect(
      store.enableDurableIdleDetection(leaderToken, 0)
    ).resolves.toBe(false);
    await expect(
      store.markIdleDetectionScheduleReady(leaderToken, 1)
    ).resolves.toBe(true);
    await expect(
      store.enableDurableIdleDetection(leaderToken, 0)
    ).resolves.toBe(false);
    await expect(
      store.enableDurableIdleDetection(leaderToken, 1)
    ).resolves.toBe(true);
    await expect(store.getIdleDetectionMode()).resolves.toBe('durable');

    await store.releaseTimerCompletionScheduler(leaderToken);
  });

  it('defaults completion claims to local legacy processing', async () => {
    await redis.set(TIMER_COMPLETION_MODE_KEY, 'unsupported-mode');
    const userId = createUserId();
    const created = await store.replaceCurrentTimer(
      userId,
      null,
      createTimer(userId, { startTime: Date.now() - 61_000, duration: 60_000 })
    );
    if (created.kind !== 'updated') throw new Error('Timer setup conflicted');

    await expect(
      store.claimRunningTimerCompletionByMode(
        userId,
        created.timer.id,
        created.timer.startTime
      )
    ).resolves.toMatchObject({ mode: 'legacy', eventId: null });
    await redis.del(TIMER_COMPLETION_MODE_KEY);
  });

  it('rejects a corrupt stream before mutating the Timer claim', async () => {
    const prefix = `timer-claim-script-${randomUUID()}`;
    const keys = {
      timer: `${prefix}:timer`,
      schedule: `${prefix}:schedule`,
      revision: `${prefix}:revision`,
      stream: `${prefix}:stream`,
      mode: `${prefix}:mode`,
      quarantine: `${prefix}:quarantine`,
    };
    const member = `${prefix}:member`;
    const timer = createTimer(createUserId(), {
      startTime: Date.now() - 61_000,
      duration: 60_000,
      scheduleRevision: randomUUID(),
    });
    const serializedTimer = JSON.stringify(timer);
    try {
      await redis.set(keys.timer, serializedTimer);
      await redis.zadd(keys.schedule, timer.startTime + timer.duration, member);
      await redis.set(keys.revision, 'before');
      await redis.set(keys.stream, 'wrong-type');
      await redis.set(keys.mode, 'stream');

      await expect(
        redis.eval(
          CLAIM_RUNNING_TIMER_COMPLETION_BY_MODE_SCRIPT,
          6,
          keys.timer,
          keys.schedule,
          keys.revision,
          keys.stream,
          keys.mode,
          keys.quarantine,
          timer.id,
          TIMER_STATUSES.RUNNING,
          timer.startTime,
          TIMER_STATUSES.COMPLETED,
          randomUUID(),
          member,
          TIMER_COMPLETION_STREAM_VERSION,
          timer.userId as string
        )
      ).rejects.toThrow('Completion stream key has an invalid type');

      await expect(redis.get(keys.timer)).resolves.toBe(serializedTimer);
      await expect(redis.zscore(keys.schedule, member)).resolves.toBe(
        String(timer.startTime + timer.duration)
      );
      await expect(redis.get(keys.revision)).resolves.toBe('before');
      await expect(redis.get(keys.stream)).resolves.toBe('wrong-type');
    } finally {
      await redis.del(...Object.values(keys));
    }
  });

  it('atomically applies, recognizes, and fences a Timer continuation plan', async () => {
    const userId = createUserId();
    const sourceWrite = await store.replaceCurrentTimer(
      userId,
      null,
      createTimer(userId, {
        startTime: 1_000,
        duration: 60_000,
        remainingTime: 0,
        status: TIMER_STATUSES.COMPLETED,
      })
    );
    if (sourceWrite.kind !== 'updated') {
      throw new Error('Timer setup conflicted');
    }
    const nextTimer: Timer = {
      id: randomUUID(),
      scheduleRevision: randomUUID(),
      userId,
      startTime: 61_500,
      duration: 300_000,
      remainingTime: 300_000,
      type: TIMER_TYPES.BREAK,
      status: TIMER_STATUSES.RUNNING,
    };
    const plan: TimerContinuationPlanV2 = {
      source: timerVersion(sourceWrite.timer),
      activationAt: 61_500,
      nextTimer,
      sessionState: {
        kind: 'set',
        value: { currentPosition: 2, totalPomodoros: 4 },
      },
      extensionState: { kind: 'clear' },
      extensionExpirationAt: null,
      lastCompletionTimestamp: { kind: 'set', value: 61_000 },
      clearIdleDetected: true,
      clearHistory: true,
      idleDetection: {
        detectionId: randomUUID(),
        checkAt: 961_000,
        longBreakDuration: 900_000,
        expectedLastCompletionTimestamp: 61_000,
        expectedTimer: timerVersion(nextTimer),
        expectedRuntimeRevision: nextTimer.scheduleRevision as string,
        longBreakTimerId: randomUUID(),
        replacementTimer: {
          id: randomUUID(),
          scheduleRevision: randomUUID(),
          userId,
          startTime: 0,
          duration: 1_500_000,
          remainingTime: 1_500_000,
          type: TIMER_TYPES.WORK,
          status: TIMER_STATUSES.PAUSED,
          sessionPosition: 1,
          sessionTotal: 4,
        },
        replacementSessionState: {
          currentPosition: 1,
          totalPomodoros: 4,
        },
      },
    };
    await redis.set(`user:${userId}:idle_detected`, 'true');
    await redis.set(`user:${userId}:timer_extension_state`, '{}');
    await redis.rpush(`user:${userId}:timer_undo_history`, '{}');
    await redis.rpush(`user:${userId}:timer_redo_history`, '{}');

    const expiredToken = await store.claimTimerContinuationUserLock(
      userId,
      30_000
    );
    if (!expiredToken) throw new Error('Continuation lock setup failed');
    await store.releaseTimerContinuationUserLock(userId, expiredToken);
    await expect(
      store.applyTimerContinuationPlan(userId, plan, expiredToken)
    ).resolves.toEqual({ kind: 'lost-lock' });
    await expect(store.getCurrentTimer(userId)).resolves.toEqual(
      sourceWrite.timer
    );

    const claimToken = await store.claimTimerContinuationUserLock(
      userId,
      30_000
    );
    if (!claimToken) throw new Error('Continuation lock setup failed');
    await expect(
      store.applyTimerContinuationPlan(userId, plan, claimToken)
    ).resolves.toEqual({ kind: 'applied', timer: nextTimer });
    await store.releaseTimerContinuationUserLock(userId, claimToken);
    await expect(store.getCurrentTimer(userId)).resolves.toEqual(nextTimer);
    await expect(store.getSessionState(userId)).resolves.toEqual({
      currentPosition: 2,
      totalPomodoros: 4,
    });
    await expect(store.getExtensionState(userId)).resolves.toBeNull();
    await expect(store.getLastCompletionTimestamp(userId)).resolves.toBe(
      61_000
    );
    await expect(store.isIdleDetected(userId)).resolves.toBe(false);
    await expect(store.getTimerHistoryStatus(userId)).resolves.toEqual({
      canUndo: false,
      canRedo: false,
    });
    await expect(
      redis.zscore(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId))
    ).resolves.toBe(String(nextTimer.startTime + nextTimer.duration));

    await expect(
      store.applyTimerContinuationPlan(userId, plan)
    ).resolves.toEqual({ kind: 'already-applied', timer: nextTimer });
    const changed = await store.replaceCurrentTimer(
      userId,
      timerVersion(nextTimer),
      { ...nextTimer, status: TIMER_STATUSES.PAUSED }
    );
    if (changed.kind !== 'updated') throw new Error('Timer change conflicted');
    await expect(
      store.applyTimerContinuationPlan(userId, plan)
    ).resolves.toEqual({ kind: 'superseded', current: changed.timer });
  });

  it('claims one fenced idle detection and atomically installs paused Work', async () => {
    const userId = createUserId();
    const redisNow = await store.getRedisTimeMs();
    const completedAt = redisNow - 20_000;
    const sourceWrite = await store.replaceCurrentTimer(
      userId,
      null,
      createTimer(userId, {
        startTime: completedAt - 60_000,
        duration: 60_000,
        remainingTime: 0,
        status: TIMER_STATUSES.COMPLETED,
      })
    );
    if (sourceWrite.kind !== 'updated') throw new Error('Setup conflicted');
    const nextTimer: Timer = {
      id: randomUUID(),
      scheduleRevision: randomUUID(),
      userId,
      startTime: 0,
      duration: 300_000,
      remainingTime: 300_000,
      type: TIMER_TYPES.BREAK,
      status: TIMER_STATUSES.PAUSED,
    };
    const replacementTimer: Timer = {
      id: randomUUID(),
      scheduleRevision: randomUUID(),
      userId,
      startTime: 0,
      duration: 1_500_000,
      remainingTime: 1_500_000,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.PAUSED,
      sessionPosition: 1,
      sessionTotal: 4,
    };
    const detectionId = randomUUID();
    const checkAt = completedAt + 10_000;
    const plan: TimerContinuationPlanV2 = {
      source: timerVersion(sourceWrite.timer),
      activationAt: completedAt,
      nextTimer,
      sessionState: {
        kind: 'set',
        value: { currentPosition: 2, totalPomodoros: 4 },
      },
      extensionState: {
        kind: 'set',
        value: {
          startTime: completedAt,
          maxDuration: 10_000,
          originalTimerId: sourceWrite.timer.id,
          originalDuration: sourceWrite.timer.duration,
        },
      },
      extensionExpirationAt: completedAt + 10_000,
      lastCompletionTimestamp: { kind: 'set', value: completedAt },
      clearIdleDetected: true,
      clearHistory: true,
      idleDetection: {
        detectionId,
        checkAt,
        longBreakDuration: 10_000,
        expectedLastCompletionTimestamp: completedAt,
        expectedTimer: timerVersion(nextTimer),
        expectedRuntimeRevision: nextTimer.scheduleRevision as string,
        longBreakTimerId: randomUUID(),
        replacementTimer,
        replacementSessionState: { currentPosition: 1, totalPomodoros: 4 },
      },
    };

    await expect(
      store.applyTimerContinuationPlan(userId, plan)
    ).resolves.toEqual({ kind: 'applied', timer: nextTimer });
    await expect(
      redis.zscore(TIMER_IDLE_SCHEDULE_KEY, `idle:${userId}`)
    ).resolves.toBe(String(checkAt));
    await redis
      .multi()
      .zrem(TIMER_IDLE_SCHEDULE_KEY, `idle:${userId}`)
      .del(`user:${userId}:idle_detection_schedule:v1`)
      .exec();
    await expect(
      store.applyTimerContinuationPlan(userId, plan)
    ).resolves.toEqual({ kind: 'already-applied', timer: nextTimer });
    await expect(
      redis.zscore(TIMER_IDLE_SCHEDULE_KEY, `idle:${userId}`)
    ).resolves.toBe(String(checkAt));
    await redis
      .multi()
      .zrem(TIMER_IDLE_SCHEDULE_KEY, `idle:${userId}`)
      .del(`user:${userId}:idle_detection_schedule:v1`)
      .set(`user:${userId}:timer_runtime_revision`, randomUUID())
      .exec();
    await expect(
      store.applyTimerContinuationPlan(userId, plan)
    ).resolves.toEqual({ kind: 'already-applied', timer: nextTimer });
    await expect(
      redis.zscore(TIMER_IDLE_SCHEDULE_KEY, `idle:${userId}`)
    ).resolves.toBeNull();
    await redis.set(
      `user:${userId}:timer_runtime_revision`,
      nextTimer.scheduleRevision as string
    );
    await expect(
      store.applyTimerContinuationPlan(userId, plan)
    ).resolves.toEqual({ kind: 'already-applied', timer: nextTimer });
    const leader = await store.claimTimerCompletionScheduler(30_000);
    if (!leader) throw new Error('Scheduler lease setup failed');
    const scheduled = (
      await store.getDueIdleDetections(await store.getRedisTimeMs(), 100)
    ).find(candidate => candidate.userId === userId);
    if (!scheduled) throw new Error('Idle schedule setup failed');
    try {
      await redis.del(TIMER_IDLE_DETECTION_MODE_KEY);
      await expect(
        store.claimScheduledIdleDetection(userId, scheduled, leader)
      ).resolves.toEqual({ kind: 'legacy' });
      await redis.set(TIMER_IDLE_DETECTION_MODE_KEY, 'durable');
      const results = await Promise.all([
        store.claimScheduledIdleDetection(userId, scheduled, leader),
        store.claimScheduledIdleDetection(userId, scheduled, leader),
      ]);
      const claimed = results.find(result => result.kind === 'claimed');

      expect(results.filter(result => result.kind === 'claimed')).toHaveLength(
        1
      );
      expect(claimed).toEqual({
        kind: 'claimed',
        claim: expect.objectContaining({
          detectionId,
          replacementTimer,
          longBreakTimer: expect.objectContaining({
            id: plan.idleDetection?.longBreakTimerId,
            type: TIMER_TYPES.LONG_BREAK,
            status: TIMER_STATUSES.COMPLETED,
            hasNotifiedLongBreakDetection: true,
          }),
        }),
      });
      if (claimed?.kind === 'claimed') {
        expect(claimed.claim.longBreakTimer).toMatchObject({
          startTime: completedAt,
          duration: 10_000,
          remainingTime: 0,
        });
      }
      if (claimed?.kind === 'claimed') idleEventIds.add(claimed.claim.eventId);
      await expect(store.getCurrentTimer(userId)).resolves.toEqual(
        replacementTimer
      );
      await expect(store.getSessionState(userId)).resolves.toEqual({
        currentPosition: 1,
        totalPomodoros: 4,
      });
      await expect(
        store.getLastCompletionTimestamp(userId)
      ).resolves.toBeNull();
      await expect(store.getExtensionState(userId)).resolves.toBeNull();
      await expect(store.isIdleDetected(userId)).resolves.toBe(true);
      await expect(
        redis.zscore(TIMER_IDLE_SCHEDULE_KEY, `idle:${userId}`)
      ).resolves.toBeNull();
    } finally {
      await store.releaseTimerCompletionScheduler(leader);
    }
  });

  it('lets a user Timer revision beat a due idle schedule', async () => {
    await redis.set(TIMER_IDLE_DETECTION_MODE_KEY, 'durable');
    const userId = createUserId();
    const initialWrite = await store.replaceCurrentTimer(
      userId,
      null,
      createTimer(userId, {
        startTime: 0,
        duration: 300_000,
        remainingTime: 300_000,
        status: TIMER_STATUSES.PAUSED,
        type: TIMER_TYPES.BREAK,
      })
    );
    if (initialWrite.kind !== 'updated') throw new Error('Setup conflicted');
    await store.setLastCompletionTimestamp(
      userId,
      (await store.getRedisTimeMs()) - 20_000
    );
    await store.clearIdleDetected(userId);
    await store.scheduleIdleDetection(userId, {
      longBreakDuration: 10_000,
      workTimerDuration: 1_500_000,
      sessionPomodorosCount: 4,
    });
    const changed = await store.replaceCurrentTimer(
      userId,
      timerVersion(initialWrite.timer),
      { ...initialWrite.timer, duration: 600_000, remainingTime: 600_000 }
    );
    if (changed.kind !== 'updated') throw new Error('Timer change conflicted');
    const scheduled = (
      await store.getDueIdleDetections(await store.getRedisTimeMs(), 100)
    ).find(candidate => candidate.userId === userId);
    if (!scheduled) throw new Error('Idle schedule setup failed');
    const leader = await store.claimTimerCompletionScheduler(30_000);
    if (!leader) throw new Error('Scheduler lease setup failed');

    try {
      await expect(
        store.claimScheduledIdleDetection(userId, scheduled, leader)
      ).resolves.toEqual({ kind: 'stale' });
      await expect(store.getCurrentTimer(userId)).resolves.toEqual(
        changed.timer
      );
    } finally {
      await store.releaseTimerCompletionScheduler(leader);
    }
  });

  it('preflights continuation key types before mutating Redis state', async () => {
    const prefix = `timer-continuation-script-${randomUUID()}`;
    const keys = Array.from(
      { length: 12 },
      (_value, index) => `${prefix}:${index}`
    );
    const source = createTimer(createUserId(), {
      status: TIMER_STATUSES.COMPLETED,
      scheduleRevision: 'source-revision',
    });
    const next = createTimer(source.userId as string, {
      id: 'next-timer',
      scheduleRevision: 'next-revision',
    });
    try {
      await redis.set(keys[0], JSON.stringify(source));
      await redis.zadd(keys[1], source.startTime + source.duration, 'member');
      await redis.rpush(keys[3], 'wrong-type');

      await expect(
        redis.eval(
          APPLY_TIMER_CONTINUATION_PLAN_SCRIPT,
          12,
          ...keys,
          source.id,
          source.scheduleRevision as string,
          next.id,
          next.scheduleRevision as string,
          JSON.stringify(next),
          'member',
          TIMER_STATUSES.RUNNING,
          'set',
          '{}',
          'keep',
          '',
          'keep',
          '',
          '1',
          '1',
          '0',
          '',
          'idle-member',
          '',
          ''
        )
      ).rejects.toThrow('Session state key has an invalid type');

      await expect(redis.get(keys[0])).resolves.toBe(JSON.stringify(source));
      await expect(redis.zscore(keys[1], 'member')).resolves.toBe(
        String(source.startTime + source.duration)
      );
      await expect(redis.lrange(keys[3], 0, -1)).resolves.toEqual([
        'wrong-type',
      ]);
    } finally {
      await redis.del(...keys);
    }
  });

  it('assigns imported state a fresh revision and matching schedule', async () => {
    const userId = createUserId();
    const imported = createTimer(userId, { scheduleRevision: 'exported' });
    const snapshot = {
      currentTimer: imported,
      sessionState: null,
      lastCompletionTimestamp: null,
      idleDetected: false,
      undoState: null,
      undoHistory: [],
      redoHistory: [],
      extensionState: null,
    };

    await store.importUserData(userId, snapshot);
    expect((await store.getCurrentTimer(userId))?.scheduleRevision).not.toBe(
      'exported'
    );
    await expect(
      redis.zscore(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId))
    ).resolves.toBe(String(imported.startTime + imported.duration));

    await store.importUserData(userId, {
      ...snapshot,
      currentTimer: { ...imported, status: TIMER_STATUSES.COMPLETED },
    });
    await expect(
      redis.zscore(TIMER_COMPLETION_SCHEDULE_KEY, scheduleMember(userId))
    ).resolves.toBeNull();
  });

  it('retries intention rename without overwriting a concurrently changed Timer', async () => {
    const userId = createUserId();
    const created = await store.replaceCurrentTimer(
      userId,
      null,
      createTimer(userId, { intention: 'before', intentionSlugs: ['before'] })
    );
    if (created.kind !== 'updated') throw new Error('Timer setup conflicted');
    const exportUserData = store.exportUserData.bind(store);
    vi.spyOn(store, 'exportUserData').mockImplementationOnce(async targetId => {
      const snapshot = await exportUserData(targetId);
      const changed = await store.replaceCurrentTimer(
        userId,
        timerVersion(created.timer),
        { ...created.timer, duration: created.timer.duration + 60_000 }
      );
      if (changed.kind !== 'updated')
        throw new Error('Concurrent write failed');
      return snapshot;
    });

    await store.renameIntentionSlug(
      userId,
      TIMER_TYPES.WORK,
      'before',
      'after'
    );
    await expect(store.getCurrentTimer(userId)).resolves.toMatchObject({
      intention: 'after',
      duration: created.timer.duration + 60_000,
    });
  });

  it('moves the exact undo entry atomically with the fenced Timer write', async () => {
    const userId = createUserId();
    const created = await store.replaceCurrentTimer(
      userId,
      null,
      createTimer(userId)
    );
    if (created.kind !== 'updated') throw new Error('Timer setup conflicted');
    const runtime = {
      timer: created.timer,
      sessionState: null,
      lastCompletionTimestamp: null,
      idleDetected: false,
      extensionState: null,
    };
    await store.pushUndoHistory(userId, {
      before: runtime,
      after: runtime,
      capturedAt: 1,
      label: 'Test undo',
    });
    const candidate = await store.peekUndoHistoryCandidate(userId);
    if (!candidate) throw new Error('Missing undo candidate');
    const runtimeRevision = await store.getRuntimeRevision(userId);

    const restored = await store.replaceCurrentTimer(
      userId,
      timerVersion(created.timer),
      { ...created.timer, status: TIMER_STATUSES.PAUSED },
      {
        expectedRuntimeRevision: runtimeRevision,
        historyTransition: {
          direction: 'undo',
          serializedEntry: candidate.serializedEntry,
        },
      }
    );

    expect(restored.kind).toBe('updated');
    await expect(store.getTimerHistoryStatus(userId)).resolves.toEqual({
      canUndo: false,
      canRedo: true,
    });
  });

  it('fences concurrent continuation activation for one user', async () => {
    const userId = createUserId();

    const [first, second] = await Promise.all([
      store.claimTimerContinuationUserLock(userId, 30_000),
      store.claimTimerContinuationUserLock(userId, 30_000),
    ]);
    const token = first ?? second;
    expect(token).toEqual(expect.any(String));
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(
      await store.releaseTimerContinuationUserLock(userId, randomUUID())
    ).toBe(false);
    expect(
      await store.renewTimerContinuationUserLock(userId, token!, 60_000)
    ).toBe(true);
    expect(await store.releaseTimerContinuationUserLock(userId, token!)).toBe(
      true
    );
  });

  function pairFields(fields: string[]): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];
    for (let index = 0; index < fields.length; index += 2) {
      pairs.push([fields[index], fields[index + 1]]);
    }
    return pairs;
  }
});
