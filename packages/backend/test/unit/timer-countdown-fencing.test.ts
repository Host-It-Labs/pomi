import { TIMER_STATUSES, TIMER_TYPES, Timer } from '@pomi/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimerCountdownService } from '../../src/timer/timer-countdown.service';

describe('TimerCountdownService version fencing', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not let a delayed stale start replace a newer Timer countdown', async () => {
    let releaseFirstPreferences: (() => void) | undefined;
    const firstPreferences = new Promise<void>(resolve => {
      releaseFirstPreferences = resolve;
    });
    const timerA = timer('timer-a', 'revision-a');
    const timerB = timer('timer-b', 'revision-b');
    let current = timerA;
    const getPreferences = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstPreferences;
        return preferences();
      })
      .mockResolvedValue(preferences());
    const service = new TimerCountdownService(
      { getPreferences } as never,
      { getCurrentTimer: vi.fn(async () => current) } as never,
      { emitTimerUpdate: vi.fn() } as never,
      { emitTimerWarning: vi.fn() } as never
    );

    const staleStart = service.startCountdown(timerA, vi.fn());
    current = timerB;
    await service.startCountdown(timerB, vi.fn());
    releaseFirstPreferences?.();
    await staleStart;

    const intervals = (
      service as unknown as {
        intervals: Map<string, { timerId: string; scheduleRevision: string }>;
      }
    ).intervals;
    expect(intervals.get('user-1')).toMatchObject({
      timerId: 'timer-b',
      scheduleRevision: 'revision-b',
    });

    service.stopCountdown('user-1', {
      timerId: 'timer-a',
      scheduleRevision: 'revision-a',
    });
    expect(intervals.get('user-1')?.timerId).toBe('timer-b');
    service.onModuleDestroy();
  });

  it('does not arm a delayed countdown after shutdown', async () => {
    let releasePreferences: (() => void) | undefined;
    const delayedPreferences = new Promise<void>(resolve => {
      releasePreferences = resolve;
    });
    const current = timer('timer-a', 'revision-a');
    const service = new TimerCountdownService(
      {
        getPreferences: vi.fn(async () => {
          await delayedPreferences;
          return preferences();
        }),
      } as never,
      { getCurrentTimer: vi.fn(async () => current) } as never,
      { emitTimerUpdate: vi.fn() } as never,
      { emitTimerWarning: vi.fn() } as never
    );

    const starting = service.startCountdown(current, vi.fn());
    service.onModuleDestroy();
    releasePreferences?.();
    await starting;

    expect(
      (
        service as unknown as {
          intervals: Map<string, unknown>;
        }
      ).intervals.size
    ).toBe(0);
  });

  it('waits for the next deadline instead of polling Redis each second', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
    const current = timer('timer-a', 'revision-a');
    const getCurrentTimer = vi.fn(async () => current);
    const service = new TimerCountdownService(
      { getPreferences: vi.fn(async () => preferences()) } as never,
      { getCurrentTimer } as never,
      { emitTimerUpdate: vi.fn() } as never,
      { emitTimerWarning: vi.fn() } as never
    );

    await service.startCountdown(current, vi.fn());
    await vi.advanceTimersByTimeAsync(59_999);

    expect(getCurrentTimer).toHaveBeenCalledOnce();
    service.onModuleDestroy();
  });

  it('rearms a shortened authoritative Timer without another bootstrap read', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
    const initial = timer('timer-a', 'revision-a');
    let current = initial;
    const getPreferences = vi.fn(async () => preferences());
    const getCurrentTimer = vi.fn(async () => current);
    const onComplete = vi.fn(async () => {
      current = { ...current, status: TIMER_STATUSES.COMPLETED };
    });
    const service = new TimerCountdownService(
      { getPreferences } as never,
      { getCurrentTimer } as never,
      { emitTimerUpdate: vi.fn() } as never,
      { emitTimerWarning: vi.fn() } as never
    );

    await service.startCountdown(initial, onComplete);
    current = {
      ...initial,
      scheduleRevision: 'revision-b',
      duration: 30_000,
      remainingTime: 30_000,
    };
    await service.refreshCountdown(current, onComplete);
    await vi.advanceTimersByTimeAsync(29_999);

    expect(getPreferences).toHaveBeenCalledOnce();
    expect(getCurrentTimer).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onComplete).toHaveBeenCalledOnce();
    service.onModuleDestroy();
  });

  it('does not let a delayed stale warning replace a newer countdown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
    const timerA = timer('timer-a', 'revision-a');
    const timerB = timer('timer-b', 'revision-b');
    let current = timerA;
    let resolveWarning: ((value: Timer) => void) | undefined;
    const warningClaim = new Promise<Timer>(resolve => {
      resolveWarning = resolve;
    });
    const emitTimerUpdate = vi.fn();
    const emitTimerWarning = vi.fn();
    const service = new TimerCountdownService(
      {
        getPreferences: vi.fn(async () => ({
          notifyBeforeTime: 60_000,
          notifyBeforeWorkComplete: true,
        })),
      } as never,
      {
        getCurrentTimer: vi.fn(async () => current),
        claimRunningTimerWarning: vi.fn(() => warningClaim),
      } as never,
      { emitTimerUpdate } as never,
      { emitTimerWarning } as never
    );

    await service.startCountdown(timerA, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    current = timerB;
    await service.startCountdown(timerB, vi.fn());
    resolveWarning?.({
      ...timerA,
      scheduleRevision: 'warning-revision',
      hasNotifiedBeforeTimeNotification: true,
    });
    await Promise.resolve();

    const schedules = (
      service as unknown as {
        intervals: Map<string, { timerId: string; scheduleRevision: string }>;
      }
    ).intervals;
    expect(schedules.get('user-1')).toMatchObject({
      timerId: 'timer-b',
      scheduleRevision: 'revision-b',
    });
    expect(emitTimerUpdate).not.toHaveBeenCalled();
    expect(emitTimerWarning).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });

  it('retries an authoritative deadline check after a transient read failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
    const expired = {
      ...timer('timer-a', 'revision-a'),
      startTime: Date.now() - 60_000,
    };
    const getCurrentTimer = vi
      .fn()
      .mockResolvedValueOnce(expired)
      .mockRejectedValueOnce(new Error('redis unavailable'))
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce(null);
    const onComplete = vi.fn(async () => undefined);
    const service = new TimerCountdownService(
      { getPreferences: vi.fn(async () => preferences()) } as never,
      { getCurrentTimer } as never,
      { emitTimerUpdate: vi.fn() } as never,
      { emitTimerWarning: vi.fn() } as never
    );
    Object.assign(service, { logger: { error: vi.fn() } });

    await service.startCountdown(expired, onComplete);
    await vi.advanceTimersByTimeAsync(999);
    expect(onComplete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(onComplete).toHaveBeenCalledOnce();
    service.onModuleDestroy();
  });

  it('adopts a remote running revision after its stale deadline fires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
    const initial = timer('timer-a', 'revision-a');
    const remoteRevision = {
      ...initial,
      scheduleRevision: 'revision-b',
      duration: 120_000,
      remainingTime: 120_000,
    };
    let current = initial;
    const getCurrentTimer = vi.fn(async () => current);
    const service = new TimerCountdownService(
      { getPreferences: vi.fn(async () => preferences()) } as never,
      { getCurrentTimer } as never,
      { emitTimerUpdate: vi.fn() } as never,
      { emitTimerWarning: vi.fn() } as never
    );

    await service.startCountdown(initial, vi.fn());
    current = remoteRevision;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(
      (
        service as unknown as {
          intervals: Map<string, { scheduleRevision: string }>;
        }
      ).intervals.get('user-1')?.scheduleRevision
    ).toBe('revision-b');
    expect(getCurrentTimer).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
  });

  it('backs off and bootstraps authoritative state after completion fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
    const expired = {
      ...timer('timer-a', 'revision-a'),
      startTime: Date.now() - 60_000,
    };
    const getCurrentTimer = vi.fn(async () => expired);
    const onComplete = vi.fn(async () => {
      throw new Error('completion unavailable');
    });
    const service = new TimerCountdownService(
      { getPreferences: vi.fn(async () => preferences()) } as never,
      { getCurrentTimer } as never,
      { emitTimerUpdate: vi.fn() } as never,
      { emitTimerWarning: vi.fn() } as never
    );
    Object.assign(service, { logger: { error: vi.fn() } });

    await service.startCountdown(expired, onComplete);
    await vi.advanceTimersByTimeAsync(999);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(getCurrentTimer).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(getCurrentTimer).toHaveBeenCalledTimes(3);
    expect(onComplete).toHaveBeenCalledOnce();
    service.onModuleDestroy();
  });

  it('retries bootstrap failures without rejecting the committed mutation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
    const current = timer('timer-a', 'revision-a');
    const getPreferences = vi
      .fn()
      .mockRejectedValueOnce(new Error('preferences unavailable'))
      .mockResolvedValue(preferences());
    const service = new TimerCountdownService(
      { getPreferences } as never,
      { getCurrentTimer: vi.fn(async () => current) } as never,
      { emitTimerUpdate: vi.fn() } as never,
      { emitTimerWarning: vi.fn() } as never
    );
    Object.assign(service, { logger: { error: vi.fn() } });

    expect(service.refreshCountdown(current, vi.fn())).toBeUndefined();
    await vi.advanceTimersByTimeAsync(999);
    expect(getPreferences).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    expect(getPreferences).toHaveBeenCalledTimes(2);
    expect(
      (
        service as unknown as {
          intervals: Map<string, { preferences?: object }>;
        }
      ).intervals.get('user-1')?.preferences
    ).toBeDefined();
    service.onModuleDestroy();
  });

  it('loads fresh warning preferences for a new Timer ID', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
    const timerA = timer('timer-a', 'revision-a');
    const timerB = timer('timer-b', 'revision-b');
    let current = timerA;
    const firstPreferences = preferences();
    const nextPreferences = {
      notifyBeforeTime: 30_000,
      notifyBeforeWorkComplete: true,
    };
    const getPreferences = vi
      .fn()
      .mockResolvedValueOnce(firstPreferences)
      .mockResolvedValueOnce(nextPreferences);
    const service = new TimerCountdownService(
      { getPreferences } as never,
      { getCurrentTimer: vi.fn(async () => current) } as never,
      { emitTimerUpdate: vi.fn() } as never,
      { emitTimerWarning: vi.fn() } as never
    );

    await service.startCountdown(timerA, vi.fn());
    current = timerB;
    service.refreshCountdown(timerB, vi.fn());
    await vi.advanceTimersByTimeAsync(0);

    expect(getPreferences).toHaveBeenCalledTimes(2);
    expect(
      (
        service as unknown as {
          intervals: Map<string, { preferences?: object }>;
        }
      ).intervals.get('user-1')?.preferences
    ).toBe(nextPreferences);
    service.onModuleDestroy();
  });

  function timer(id: string, scheduleRevision: string): Timer {
    return {
      id,
      scheduleRevision,
      userId: 'user-1',
      startTime: Date.now(),
      duration: 60_000,
      remainingTime: 60_000,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.RUNNING,
    };
  }

  function preferences() {
    return { notifyBeforeTime: 0, notifyBeforeWorkComplete: false };
  }
});
