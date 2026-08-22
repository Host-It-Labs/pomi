import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TIMER_STATUSES, TIMER_TYPES, type Timer } from '@pomi/shared';
import { TimerIdleService } from '../../src/timer/timer-idle.service';

describe('TimerIdleService rollout behavior', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps one legacy fallback armed until durable idle mode is enabled', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const harness = createHarness('legacy');

    harness.service.scheduleIdleDetectionCheck('user-1', harness.createWork);
    await vi.waitFor(() => expect(harness.schedule).toHaveBeenCalledOnce());
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(harness.claimLegacy).toHaveBeenCalledOnce());
    expect(harness.recordStatistic).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        type: TIMER_TYPES.LONG_BREAK,
        duration: 10_000,
      })
    );
    expect(harness.createWork).toHaveBeenCalledWith('user-1');
    expect(harness.emitLongBreak).toHaveBeenCalledOnce();
  });

  it('prewarms the durable schedule without arming local effects in durable mode', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const harness = createHarness('durable');

    harness.service.scheduleIdleDetectionCheck('user-1', harness.createWork);
    await vi.waitFor(() => expect(harness.schedule).toHaveBeenCalledOnce());

    expect(vi.getTimerCount()).toBe(0);
    expect(harness.claimLegacy).not.toHaveBeenCalled();
    expect(harness.recordStatistic).not.toHaveBeenCalled();
  });

  it('serializes overlapping schedule refreshes so the newest policy wins', async () => {
    let resolveFirstPreferences!: (value: Record<string, unknown>) => void;
    const enabled = {
      sessionAutoDetectLongBreak: true,
      sessionsExtension: true,
      sessionHasLongBreak: true,
      sessionLongBreakDuration: 10_000,
      workTimerDuration: 25 * 60_000,
      sessionPomodorosCount: 4,
    };
    const disabled = { ...enabled, sessionAutoDetectLongBreak: false };
    const getPreferences = vi
      .fn()
      .mockReturnValueOnce(
        new Promise(resolve => {
          resolveFirstPreferences = resolve;
        })
      )
      .mockResolvedValueOnce(disabled);
    const writes: string[] = [];
    const service = new TimerIdleService(
      { onPreferencesUpdate: new Subject(), getPreferences } as never,
      {} as never,
      {
        prepareIdleDetectionScheduleChange: vi.fn(async () => undefined),
        scheduleIdleDetection: vi.fn(async () => {
          writes.push('schedule');
          return 'scheduled';
        }),
        cancelIdleDetectionSchedule: vi.fn(async () => {
          writes.push('cancel');
          return true;
        }),
        getIdleDetectionMode: vi.fn(async () => 'durable'),
      } as never,
      {} as never,
      { userExists: vi.fn(async () => true) } as never
    );
    Object.assign(service, { logger: { error: vi.fn(), warn: vi.fn() } });

    service.scheduleIdleDetectionCheck('user-1');
    service.scheduleIdleDetectionCheck('user-1');
    await vi.waitFor(() => expect(getPreferences).toHaveBeenCalledOnce());
    resolveFirstPreferences(enabled);

    await vi.waitFor(() => expect(writes).toEqual(['schedule', 'cancel']));
    expect(getPreferences).toHaveBeenCalledTimes(2);
  });

  it('cleans stale idle schedules without creating preferences for a deleted user', async () => {
    const getPreferences = vi.fn();
    const cancelIdleDetectionSchedule = vi.fn(async () => true);
    const service = new TimerIdleService(
      { onPreferencesUpdate: new Subject(), getPreferences } as never,
      {} as never,
      {
        prepareIdleDetectionScheduleChange: vi.fn(async () => undefined),
        cancelIdleDetectionSchedule,
      } as never,
      {} as never,
      { userExists: vi.fn(async () => false) } as never
    );
    Object.assign(service, { logger: { error: vi.fn(), warn: vi.fn() } });

    service.scheduleIdleDetectionCheck('deleted-user');

    await vi.waitFor(() =>
      expect(cancelIdleDetectionSchedule).toHaveBeenCalledWith('deleted-user')
    );
    expect(getPreferences).not.toHaveBeenCalled();
  });

  function createHarness(mode: 'legacy' | 'durable') {
    const preferences = {
      sessionAutoDetectLongBreak: true,
      sessionsExtension: true,
      sessionHasLongBreak: true,
      sessionLongBreakDuration: 10_000,
      workTimerDuration: 25 * 60_000,
      sessionPomodorosCount: 4,
    };
    const currentTimer: Timer = {
      id: 'timer-1',
      scheduleRevision: 'revision-1',
      userId: 'user-1',
      startTime: 0,
      duration: 5 * 60_000,
      remainingTime: 5 * 60_000,
      type: TIMER_TYPES.BREAK,
      status: TIMER_STATUSES.PAUSED,
    };
    const schedule = vi.fn(async () => 'scheduled');
    const claimLegacy = vi.fn(async () => true);
    const recordStatistic = vi.fn(async () => undefined);
    const emitLongBreak = vi.fn(async () => undefined);
    const createWork = vi.fn(async () => ({
      ...currentTimer,
      id: 'replacement-1',
      type: TIMER_TYPES.WORK,
    }));
    const service = new TimerIdleService(
      {
        onPreferencesUpdate: new Subject(),
        getPreferences: vi.fn(async () => preferences),
      } as never,
      { recordCompletedTimer: recordStatistic } as never,
      {
        prepareIdleDetectionScheduleChange: vi.fn(async () => undefined),
        scheduleIdleDetection: schedule,
        cancelIdleDetectionSchedule: vi.fn(async () => true),
        getIdleDetectionMode: vi.fn(async () => mode),
        getLastCompletionTimestamp: vi.fn(async () => 1_000),
        getCurrentTimer: vi.fn(async () => currentTimer),
        getExtensionState: vi.fn(async () => ({})),
        claimLegacyIdleDetection: claimLegacy,
        clearLastCompletionTimestamp: vi.fn(async () => undefined),
        clearSessionState: vi.fn(async () => undefined),
      } as never,
      {
        emitLongBreakDetected: emitLongBreak,
      } as never,
      { userExists: vi.fn(async () => true) } as never
    );
    Object.assign(service, { logger: { error: vi.fn(), warn: vi.fn() } });
    return {
      service,
      schedule,
      claimLegacy,
      recordStatistic,
      emitLongBreak,
      createWork,
    };
  }
});
