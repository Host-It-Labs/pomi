import { TIMER_STATUSES, TIMER_TYPES, type Timer } from '@pomi/shared';
import { describe, expect, it } from 'vitest';
import { TimerStore, timerVersion } from '../../src/timer/timer-store';

class MemoryRedis {
  readonly values = new Map<string, string>();
  readonly schedules = new Map<string, number>();
  now = Date.now();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async eval(script: string, keyCount: number, ...args: string[]) {
    const keys = args.slice(0, keyCount);
    const [timerKey] = keys;
    const values = args.slice(keyCount);
    const currentRaw = this.values.get(timerKey);
    const current = currentRaw ? (JSON.parse(currentRaw) as Timer) : null;

    if (script.includes('local expectedId')) {
      const [expectedId, expectedRevision, nextRaw, revision, member, running] =
        values;
      if (
        (current &&
          (!expectedId ||
            current.id !== expectedId ||
            (current.scheduleRevision ?? '') !== expectedRevision)) ||
        (!current && expectedId)
      ) {
        return [0, currentRaw ?? null];
      }
      const next = JSON.parse(nextRaw) as Timer;
      next.scheduleRevision = revision;
      const updated = JSON.stringify(next);
      this.values.set(timerKey, updated);
      this.schedules.delete(member);
      if (next.status === running) {
        this.schedules.set(member, next.startTime + next.duration);
      }
      const extensionMode = values[13];
      const extensionRaw = values[14];
      if (extensionMode === 'set') {
        this.values.set(keys[6], extensionRaw);
      } else if (extensionMode === 'clear') {
        this.values.delete(keys[6]);
      }
      return [1, updated];
    }

    const [timerId, running, startTime] = values;
    if (
      !current ||
      current.id !== timerId ||
      current.status !== running ||
      current.startTime !== Number(startTime)
    ) {
      return null;
    }

    if (script.includes('timer.hasNotifiedBeforeTimeNotification == true')) {
      const [, , , notifyBeforeTime, revision, member] = values;
      const remaining = current.duration - (this.now - current.startTime);
      if (
        current.hasNotifiedBeforeTimeNotification ||
        remaining > Number(notifyBeforeTime)
      ) {
        return null;
      }
      current.remainingTime = Math.max(0, remaining);
      current.hasNotifiedBeforeTimeNotification = true;
      current.scheduleRevision = revision;
      this.values.set(timerKey, JSON.stringify(current));
      this.schedules.set(member, current.startTime + current.duration);
      return JSON.stringify(current);
    }

    const [, , , completed, revision, member] = values;
    if (current.duration - (this.now - current.startTime) > 0) return null;
    current.remainingTime = 0;
    current.status = completed as Timer['status'];
    current.scheduleRevision = revision;
    this.values.set(timerKey, JSON.stringify(current));
    this.schedules.delete(member);
    const updated = JSON.stringify(current);
    if (script.includes("'schemaVersion'")) {
      return [
        updated,
        'legacy',
        '',
        String(current.startTime + current.duration),
        String(this.now),
      ];
    }
    return updated;
  }
}

function createTimer(overrides: Partial<Timer> = {}): Timer {
  return {
    id: 'timer-1',
    userId: 'user-1',
    startTime: 1_000,
    duration: 60_000,
    type: TIMER_TYPES.WORK,
    status: TIMER_STATUSES.RUNNING,
    remainingTime: 60_000,
    ...overrides,
  };
}

describe('TimerStore revisioned schedule writes', () => {
  it('creates a revision and atomically indexes the running deadline', async () => {
    const redis = new MemoryRedis();
    const store = new TimerStore(redis as never);

    const write = await store.replaceCurrentTimer(
      'user-1',
      null,
      createTimer()
    );

    expect(write).toMatchObject({
      kind: 'updated',
      timer: { scheduleRevision: expect.any(String) },
    });
    expect(redis.schedules.get('completion:user-1')).toBe(61_000);
  });

  it('fences stale writers without changing state or deadline', async () => {
    const redis = new MemoryRedis();
    const store = new TimerStore(redis as never);
    const created = await store.replaceCurrentTimer(
      'user-1',
      null,
      createTimer()
    );
    if (created.kind !== 'updated') throw new Error('Timer setup conflicted');
    const stale = timerVersion(created.timer);
    const updated = await store.replaceCurrentTimer('user-1', stale, {
      ...created.timer,
      duration: 120_000,
    });
    if (updated.kind !== 'updated') throw new Error('Timer update conflicted');

    await expect(
      store.replaceCurrentTimer('user-1', stale, {
        ...created.timer,
        status: TIMER_STATUSES.PAUSED,
      })
    ).resolves.toMatchObject({ kind: 'conflict' });
    expect(redis.schedules.get('completion:user-1')).toBe(121_000);
  });

  it('clears extension state atomically with the Timer replacement', async () => {
    const redis = new MemoryRedis();
    const store = new TimerStore(redis as never);
    redis.values.set(
      'user:user-1:timer_extension_state',
      JSON.stringify({ active: true })
    );

    await store.replaceCurrentTimer('user-1', null, createTimer(), {
      extensionState: null,
    });

    expect(redis.values.has('user:user-1:timer_extension_state')).toBe(false);
  });

  it('keeps warning indexed and removes the deadline on completion', async () => {
    const redis = new MemoryRedis();
    redis.now = 61_001;
    const store = new TimerStore(redis as never);
    const created = await store.replaceCurrentTimer(
      'user-1',
      null,
      createTimer()
    );
    if (created.kind !== 'updated') throw new Error('Timer setup conflicted');

    const warned = await store.claimRunningTimerWarning(
      'user-1',
      created.timer.id,
      created.timer.startTime,
      60_000
    );
    expect(warned?.hasNotifiedBeforeTimeNotification).toBe(true);
    expect(redis.schedules.get('completion:user-1')).toBe(61_000);

    await expect(
      store.claimRunningTimerCompletionByMode(
        'user-1',
        created.timer.id,
        created.timer.startTime
      )
    ).resolves.toMatchObject({
      mode: 'legacy',
      timer: { status: TIMER_STATUSES.COMPLETED },
    });
    expect(redis.schedules.has('completion:user-1')).toBe(false);
  });
});
