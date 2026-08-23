import { BadRequestException, ConflictException } from '@nestjs/common';
import { TIMER_STATUSES, TIMER_TYPES, type Timer } from '@pomi/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  TimerMutationOutcomeUnknownException,
  TimerService,
} from '../../src/timer/timer.service';

const currentTimer = (overrides: Partial<Timer> = {}): Timer => ({
  id: 'timer-current',
  scheduleRevision: 'revision-current',
  userId: 'user-1',
  startTime: 1_000,
  duration: 25 * 60_000,
  type: TIMER_TYPES.WORK,
  status: TIMER_STATUSES.PAUSED,
  remainingTime: 25 * 60_000,
  ...overrides,
});

const conflict = (timer: Timer) => ({
  kind: 'conflict' as const,
  current: timer,
});

describe('TimerService revision conflicts', () => {
  it('rearms the one-shot countdown after every successful Timer revision', async () => {
    const timer = currentTimer({ status: TIMER_STATUSES.RUNNING });
    const committed = { ...timer, scheduleRevision: 'revision-next' };
    const refreshCountdown = vi.fn(async () => undefined);
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        replaceCurrentTimer: vi.fn(async () => ({
          kind: 'updated' as const,
          timer: committed,
        })),
      },
      timerCountdownService: { refreshCountdown },
    }) as TimerService;

    await (
      service as unknown as {
        commitCurrentTimer(
          userId: string,
          expected: unknown,
          timer: Timer
        ): Promise<Timer>;
      }
    ).commitCurrentTimer('user-1', null, timer);

    expect(refreshCountdown).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleRevision: 'revision-next' }),
      expect.any(Function)
    );
  });

  it('rearms legacy idle detection for persisted non-running Timers on startup', async () => {
    const timer = currentTimer({ status: TIMER_STATUSES.COMPLETED });
    const scheduleIdleDetectionCheck = vi.fn();
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getAllCurrentTimerKeys: vi.fn(async () => [
          'user:user-1:current_timer',
        ]),
        getCurrentTimer: vi.fn(async () => timer),
      },
      timerIdleService: { scheduleIdleDetectionCheck },
      logger: { error: vi.fn(), warn: vi.fn() },
    }) as TimerService;

    await (
      service as unknown as {
        restoreActiveTimersOnStartup(): Promise<void>;
      }
    ).restoreActiveTimersOnStartup();

    expect(scheduleIdleDetectionCheck).toHaveBeenCalledWith(
      'user-1',
      expect.any(Function)
    );
  });

  it('isolates a transient account restore failure and continues with later Timers', async () => {
    const timer = currentTimer({
      userId: 'user-2',
      status: TIMER_STATUSES.RUNNING,
      startTime: Date.now(),
    });
    const startCountdown = vi.fn(async () => undefined);
    const warn = vi.fn();
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getAllCurrentTimerKeys: vi.fn(async () => [
          'user:user-1:current_timer',
          'user:user-2:current_timer',
        ]),
        getCurrentTimer: vi
          .fn()
          .mockRejectedValueOnce(
            Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
          )
          .mockResolvedValueOnce(timer),
      },
      timerCountdownService: { startCountdown },
      logger: { error: vi.fn(), warn },
    }) as TimerService;

    await (
      service as unknown as {
        restoreActiveTimersOnStartup(): Promise<void>;
      }
    ).restoreActiveTimersOnStartup();

    expect(startCountdown).toHaveBeenCalledWith(timer, expect.any(Function));
    expect(warn).toHaveBeenCalledWith(
      'Timer runtime restoration deferred for one account (Error (ECONNRESET))'
    );
  });

  it('does not change session state when a stack loses the Timer CAS', async () => {
    const timer = currentTimer({
      sessionPosition: 1,
      sessionTotal: 3,
      originalDuration: 25 * 60_000,
    });
    const setSessionState = vi.fn();
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getCurrentTimer: vi.fn(async () => timer),
        getSessionState: vi.fn(async () => ({
          currentPosition: 1,
          totalPomodoros: 3,
        })),
        replaceCurrentTimer: vi.fn(async () => conflict(timer)),
        setSessionState,
      },
      preferencesService: {
        getPreferences: vi.fn(async () => ({
          sessionsExtension: true,
          sessionStackTimers: true,
          workTimerDuration: 25 * 60_000,
        })),
      },
      snapshotRuntime: vi.fn(async () => ({})),
    }) as TimerService;

    await expect(service.stackTimer('user-1')).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(setSessionState).not.toHaveBeenCalled();
  });

  it('restores elapsed progress when undoing or redoing a running Timer', async () => {
    const snapshotNow = 100_000;
    const restoreNow = 200_000;
    const savedTimer = currentTimer({
      status: TIMER_STATUSES.RUNNING,
      duration: 25 * 60_000,
      remainingTime: 20 * 60_000,
      startTime: snapshotNow - 5 * 60_000,
    });
    const commitCurrentTimer = vi.fn(
      async (_userId, _expected, timer) => timer
    );
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        clearExtensionState: vi.fn(),
        clearLastCompletionTimestamp: vi.fn(),
        clearIdleDetected: vi.fn(),
      },
      commitCurrentTimer,
      clearAutoAdvance: vi.fn(),
      timerCountdownService: {
        stopCountdown: vi.fn(),
        startCountdown: vi.fn(async () => undefined),
      },
      timerIdleService: {
        cancelIdleDetectionCheck: vi.fn(),
        cancelPausedTimerReminder: vi.fn(),
        schedulePausedTimerReminder: vi.fn(),
      },
      timerEvents: {
        emitExtensionStateUpdate: vi.fn(),
        emitTimerUpdate: vi.fn(),
      },
      scheduleIdleDetectionCheck: vi.fn(),
    }) as TimerService;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(restoreNow);

    const restored = await (
      service as unknown as {
        restoreRuntimeSnapshot(
          userId: string,
          snapshot: {
            timer: Timer;
            sessionState: null;
            lastCompletionTimestamp: null;
            idleDetected: false;
            extensionState: null;
          },
          expected: null
        ): Promise<Timer | null>;
      }
    ).restoreRuntimeSnapshot(
      'user-1',
      {
        timer: savedTimer,
        sessionState: null,
        lastCompletionTimestamp: null,
        idleDetected: false,
        extensionState: null,
      },
      null
    );

    expect(restored).toMatchObject({
      remainingTime: 20 * 60_000,
      startTime: restoreNow - (25 * 60_000 - 20 * 60_000),
    });
    expect(commitCurrentTimer).toHaveBeenCalledWith(
      'user-1',
      null,
      expect.objectContaining({
        remainingTime: 20 * 60_000,
        startTime: restoreNow - (25 * 60_000 - 20 * 60_000),
      }),
      expect.any(Object)
    );
    nowSpy.mockRestore();
  });

  it('stacks another duration at the configured final session without scheduling another timer', async () => {
    const timer = currentTimer({
      sessionPosition: 3,
      sessionTotal: 3,
      originalDuration: 25 * 60_000,
    });
    const committedTimers: Timer[] = [];
    const setSessionState = vi.fn();
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getCurrentTimer: vi.fn(async () => timer),
        getSessionState: vi.fn(async () => ({
          currentPosition: 3,
          totalPomodoros: 3,
        })),
        setSessionState,
      },
      preferencesService: {
        getPreferences: vi.fn(async () => ({
          sessionsExtension: true,
          sessionStackTimers: true,
          workTimerDuration: 25 * 60_000,
          breakTimerDuration: 5 * 60_000,
        })),
      },
      snapshotRuntime: vi.fn(async () => ({})),
      commitCurrentTimer: vi.fn(async (_userId, _expected, nextTimer) => {
        committedTimers.push(nextTimer);
        return nextTimer;
      }),
      buildHistoryEntry: vi.fn(async () => ({})),
      pushTimerHistory: vi.fn(async () => undefined),
      timerEvents: { emitTimerUpdate: vi.fn() },
    }) as TimerService;

    const result = await service.stackTimer('user-1');

    expect(result).toMatchObject({
      sessionPosition: 3,
      sessionTotal: 3,
      stackedSessions: 2,
      stackedSessionPlanReduction: 0,
    });
    expect(committedTimers[0]).toMatchObject({
      sessionTotal: 3,
      stackedSessionPlanReduction: 0,
    });
    expect(setSessionState).not.toHaveBeenCalled();
  });

  it('restores consumed Session slots and clears stack metadata on reset', async () => {
    const timer = currentTimer({
      sessionPosition: 2,
      sessionTotal: 3,
      stackedSessions: 2,
      stackedSessionPlanReduction: 1,
    });
    const createOrResumeTimer = vi.fn(async () => timer);
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getCurrentTimer: vi.fn(async () => timer),
        getSessionState: vi.fn(async () => ({
          currentPosition: 2,
          totalPomodoros: 3,
          stackedSessions: 2,
        })),
      },
      preferencesService: {
        getPreferences: vi.fn(async () => ({
          intentionCustomDurations: false,
        })),
      },
      snapshotRuntime: vi.fn(async () => ({})),
      createOrResumeTimer,
      buildHistoryEntry: vi.fn(async () => ({})),
      pushTimerHistory: vi.fn(async () => undefined),
    }) as TimerService;

    await service.resetTimer('user-1');

    expect(createOrResumeTimer.mock.calls[0][1].sessionState).toEqual({
      currentPosition: 2,
      totalPomodoros: 4,
    });
  });

  it('clears stack metadata without expanding the configured final Session total', async () => {
    const timer = currentTimer({
      sessionPosition: 3,
      sessionTotal: 3,
      stackedSessions: 2,
      stackedSessionPlanReduction: 0,
    });
    const getSessionState = vi.fn(async () => ({
      currentPosition: 3,
      totalPomodoros: 3,
      stackedSessions: 2,
    }));
    const createOrResumeTimer = vi.fn(async () => timer);
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getCurrentTimer: vi.fn(async () => timer),
        getSessionState,
      },
      preferencesService: {
        getPreferences: vi.fn(async () => ({
          intentionCustomDurations: false,
        })),
      },
      snapshotRuntime: vi.fn(async () => ({})),
      createOrResumeTimer,
      buildHistoryEntry: vi.fn(async () => ({})),
      pushTimerHistory: vi.fn(async () => undefined),
    }) as TimerService;

    await service.resetTimer('user-1');

    expect(getSessionState).toHaveBeenCalledOnce();
    expect(createOrResumeTimer.mock.calls[0][1].sessionState).toEqual({
      currentPosition: 3,
      totalPomodoros: 3,
    });
  });

  it('constructs the first reset Timer from the replacement Session state', async () => {
    const timer = currentTimer({
      sessionPosition: 2,
      sessionTotal: 3,
      stackedSessions: 2,
      stackedSessionPlanReduction: 1,
    });
    const replacementSessionState = {
      currentPosition: 2,
      totalPomodoros: 4,
    };
    const getSessionState = vi.fn(async () => ({
      currentPosition: 2,
      totalPomodoros: 3,
      stackedSessions: 2,
    }));
    const replaceCurrentTimer = vi.fn(
      async (_userId: string, _expected: unknown, next: Timer) => ({
        kind: 'updated' as const,
        timer: { ...next, scheduleRevision: 'revision-next' },
      })
    );
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getCurrentTimer: vi.fn(async () => timer),
        getSessionState,
        replaceCurrentTimer,
      },
      preferencesService: {
        getPreferences: vi.fn(async () => ({
          intentionExtension: false,
          intentionRequireSelection: false,
          intentionCustomDurations: false,
          sessionsExtension: true,
          workTimerDuration: 25 * 60_000,
          breakTimerDuration: 5 * 60_000,
          sessionLongBreakDuration: 15 * 60_000,
        })),
      },
      usersService: {
        associateTimerWithUser: vi.fn(async () => undefined),
      },
      timerCountdownService: { refreshCountdown: vi.fn() },
      timerEvents: { emitTimerUpdate: vi.fn() },
      applyCommittedTimerTransition: vi.fn(async () => undefined),
    }) as TimerService;

    const result = await service.createOrResumeTimer('user-1', {
      type: TIMER_TYPES.WORK,
      isResetOrSkip: true,
      preserveSessionState: true,
      sessionState: replacementSessionState,
    });

    expect(getSessionState).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      sessionPosition: 2,
      sessionTotal: 4,
    });
    expect(result.stackedSessions).toBeUndefined();
    expect(replaceCurrentTimer).toHaveBeenCalledWith(
      'user-1',
      {
        timerId: timer.id,
        scheduleRevision: timer.scheduleRevision,
      },
      expect.objectContaining({
        sessionPosition: 2,
        sessionTotal: 4,
        stackedSessions: undefined,
      }),
      {
        sessionState: replacementSessionState,
        extensionState: null,
      }
    );
  });

  it('does not apply extension effects when replacement loses the Timer CAS', async () => {
    const timer = currentTimer({ status: TIMER_STATUSES.COMPLETED });
    const appendDurationToStatistic = vi.fn();
    const clearExtensionState = vi.fn();
    const stopCountdown = vi.fn();
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getExtensionState: vi.fn(async () => ({
          startTime: Date.now() - 1_000,
          originalTimerId: 'timer-original',
          originalDuration: 25 * 60_000,
        })),
        getCurrentTimer: vi.fn(async () => timer),
        getSessionState: vi.fn(async () => null),
        replaceCurrentTimer: vi.fn(async () => conflict(timer)),
        clearExtensionState,
      },
      statisticsService: {
        getStatisticUndoSnapshot: vi.fn(async () => null),
        appendDurationToStatistic,
      },
      snapshotRuntime: vi.fn(async () => ({})),
      snapshotStatistics: vi.fn(async () => new Map()),
      timerCountdownService: { stopCountdown },
    }) as TimerService;

    await expect(
      service.resolveTimerExtension('user-1', 'addFiveMinutes')
    ).rejects.toBeInstanceOf(ConflictException);
    expect(appendDurationToStatistic).not.toHaveBeenCalled();
    expect(clearExtensionState).not.toHaveBeenCalled();
    expect(stopCountdown).not.toHaveBeenCalled();
  });

  it('rejects continuing an extension after its configured maximum', async () => {
    const timer = currentTimer({ status: TIMER_STATUSES.COMPLETED });
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getExtensionState: vi.fn(async () => ({
          startTime: 1_000,
          maxDuration: 10_000,
          originalTimerId: 'timer-original',
          originalDuration: 25 * 60_000,
        })),
        getCurrentTimer: vi.fn(async () => timer),
      },
      snapshotRuntime: vi.fn(async () => ({})),
    }) as TimerService;
    const now = vi.spyOn(Date, 'now').mockReturnValue(11_000);

    await expect(
      service.resolveTimerExtension('user-1', 'addFiveMinutes')
    ).rejects.toBeInstanceOf(BadRequestException);
    now.mockRestore();
  });

  it('caps logged extension duration at its configured maximum', () => {
    const service = Object.create(TimerService.prototype) as TimerService;
    const now = vi.spyOn(Date, 'now').mockReturnValue(20_000);

    const elapsed = (
      service as unknown as {
        getExtensionElapsedDuration(state: {
          startTime: number;
          maxDuration: number;
        }): number;
      }
    ).getExtensionElapsedDuration({ startTime: 1_000, maxDuration: 10_000 });

    expect(elapsed).toBe(10_000);
    now.mockRestore();
  });

  it('does not clear companion state when create-or-resume loses the CAS', async () => {
    const timer = currentTimer();
    const clearExtensionState = vi.fn();
    const setSessionState = vi.fn();
    const startCountdown = vi.fn();
    const cancelPausedTimerReminder = vi.fn();
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getCurrentTimer: vi.fn(async () => timer),
        replaceCurrentTimer: vi.fn(async () => conflict(timer)),
        clearExtensionState,
        setSessionState,
      },
      preferencesService: {
        getPreferences: vi.fn(async () => ({
          intentionExtension: false,
          intentionRequireSelection: false,
          intentionCustomDurations: false,
          sessionsExtension: false,
        })),
      },
      timerIdleService: { cancelPausedTimerReminder },
      timerCountdownService: { startCountdown },
      timerEvents: {
        emitExtensionStateUpdate: vi.fn(),
        emitTimerUpdate: vi.fn(),
      },
    }) as TimerService;

    await expect(
      service.createOrResumeTimer('user-1', { type: TIMER_TYPES.WORK })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(clearExtensionState).not.toHaveBeenCalled();
    expect(setSessionState).not.toHaveBeenCalled();
    expect(startCountdown).not.toHaveBeenCalled();
    expect(cancelPausedTimerReminder).not.toHaveBeenCalled();
  });

  it('does not restore companion runtime state when Timer restore loses CAS', async () => {
    const timer = currentTimer();
    const setSessionState = vi.fn();
    const setExtensionState = vi.fn();
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getCurrentTimer: vi.fn(async () => timer),
        replaceCurrentTimer: vi.fn(async () => conflict(timer)),
        setSessionState,
        setExtensionState,
      },
    }) as TimerService;

    await expect(
      (
        service as unknown as {
          restoreRuntimeSnapshot(
            userId: string,
            snapshot: object,
            expected: object
          ): Promise<Timer | null>;
        }
      ).restoreRuntimeSnapshot(
        'user-1',
        {
          timer,
          sessionState: { currentPosition: 1, totalPomodoros: 3 },
          lastCompletionTimestamp: null,
          idleDetected: false,
          extensionState: { originalTimerId: 'timer-original', startTime: 1 },
        },
        {
          timerId: timer.id,
          scheduleRevision: timer.scheduleRevision,
        }
      )
    ).rejects.toBeInstanceOf(ConflictException);
    expect(setSessionState).not.toHaveBeenCalled();
    expect(setExtensionState).not.toHaveBeenCalled();
  });

  it('keeps undo history and statistics untouched when restore loses CAS', async () => {
    const timer = currentTimer();
    const restoreStatisticHistorySnapshot = vi.fn();
    const entry = {
      before: {
        timer,
        sessionState: null,
        lastCompletionTimestamp: null,
        idleDetected: false,
        extensionState: null,
      },
      after: {
        timer,
        sessionState: null,
        lastCompletionTimestamp: null,
        idleDetected: false,
        extensionState: null,
      },
      capturedAt: 1,
      label: 'Change timer',
      statistics: [{ id: 'stat-1', before: null, after: null }],
    };
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getRuntimeRevision: vi.fn(async () => 'runtime-1'),
        getCurrentTimer: vi.fn(async () => timer),
        peekUndoHistoryCandidate: vi.fn(async () => ({
          entry,
          serializedEntry: 'serialized-entry',
        })),
        replaceCurrentTimer: vi.fn(async () => conflict(timer)),
      },
      statisticsService: { restoreStatisticHistorySnapshot },
    }) as TimerService;

    await expect(service.undoLastTimerAction('user-1')).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(restoreStatisticHistorySnapshot).not.toHaveBeenCalled();
  });

  it('does not log a skipped Timer when its initiating revision is stale', async () => {
    const stale = currentTimer({
      status: TIMER_STATUSES.RUNNING,
      startTime: Date.now() - 60_000,
    });
    const concurrent = { ...stale, scheduleRevision: 'revision-concurrent' };
    const recordCompletedTimer = vi.fn();
    const replaceCurrentTimer = vi.fn(async () => conflict(concurrent));
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getCurrentTimer: vi
          .fn()
          .mockResolvedValueOnce(stale)
          .mockResolvedValueOnce(concurrent),
        replaceCurrentTimer,
      },
      preferencesService: {
        getPreferences: vi.fn(async () => ({
          advancedSkip: true,
          sessionsExtension: false,
          intentionExtension: false,
          intentionRequireSelection: false,
          breakTimerDuration: 5 * 60_000,
          autoStartBreak: true,
        })),
      },
      statisticsService: { recordCompletedTimer },
      snapshotRuntime: vi.fn(async () => ({})),
      snapshotStatistics: vi.fn(async () => new Map()),
    }) as TimerService;

    await expect(service.skipTimer('user-1', 'elapsed')).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(replaceCurrentTimer).toHaveBeenCalledWith(
      'user-1',
      {
        timerId: stale.id,
        scheduleRevision: stale.scheduleRevision,
      },
      expect.any(Object),
      undefined
    );
    expect(recordCompletedTimer).not.toHaveBeenCalled();
  });

  it('marks post-transition skip effect failures as outcome unknown', async () => {
    const timer = currentTimer({
      status: TIMER_STATUSES.RUNNING,
      startTime: Date.now() - 60_000,
    });
    const nextTimer = currentTimer({
      id: 'timer-next',
      type: TIMER_TYPES.BREAK,
    });
    const createOrResumeTimer = vi.fn(async () => nextTimer);
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: { getCurrentTimer: vi.fn(async () => timer) },
      preferencesService: {
        getPreferences: vi.fn(async () => ({
          advancedSkip: true,
          sessionsExtension: false,
          intentionExtension: false,
          intentionRequireSelection: false,
          autoStartBreak: true,
        })),
      },
      statisticsService: {
        recordCompletedTimer: vi.fn(async () => {
          throw new Error('statistics unavailable');
        }),
      },
      intentionsService: {
        incrementIntentionsUsage: vi.fn(),
        incrementSubIntentionsUsage: vi.fn(),
      },
      snapshotRuntime: vi.fn(async () => ({})),
      snapshotStatistics: vi.fn(async () => new Map()),
      createOrResumeTimer,
    }) as TimerService;

    await expect(service.skipTimer('user-1', 'elapsed')).rejects.toBeInstanceOf(
      TimerMutationOutcomeUnknownException
    );
    expect(createOrResumeTimer).toHaveBeenCalledOnce();
  });

  it('clears session state atomically when resuming the same long break', async () => {
    const timer = currentTimer({
      type: TIMER_TYPES.LONG_BREAK,
      sessionPosition: 2,
      sessionTotal: 4,
    });
    const replaceCurrentTimer = vi.fn(
      async (_userId: string, _expected: unknown, next: Timer) => ({
        kind: 'updated' as const,
        timer: { ...next, scheduleRevision: 'revision-next' },
      })
    );
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getCurrentTimer: vi.fn(async () => timer),
        replaceCurrentTimer,
      },
      preferencesService: {
        getPreferences: vi.fn(async () => ({
          intentionExtension: false,
          intentionRequireSelection: false,
          intentionCustomDurations: false,
        })),
      },
      timerCountdownService: { refreshCountdown: vi.fn() },
      timerEvents: { emitTimerUpdate: vi.fn() },
      snapshotRuntime: vi.fn(async () => ({})),
      buildHistoryEntry: vi.fn(async () => ({})),
      pushTimerHistory: vi.fn(),
      applyCommittedTimerTransition: vi.fn(),
    }) as TimerService;

    await service.startLongBreakTimer('user-1');

    expect(replaceCurrentTimer).toHaveBeenCalledWith(
      'user-1',
      {
        timerId: timer.id,
        scheduleRevision: 'revision-current',
      },
      expect.any(Object),
      { sessionState: null }
    );
  });
});
