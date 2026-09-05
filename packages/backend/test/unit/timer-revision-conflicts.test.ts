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
  it('preserves the existing extension start when pausing an auto-started break', async () => {
    const timer = currentTimer({
      type: TIMER_TYPES.BREAK,
      status: TIMER_STATUSES.RUNNING,
      startTime: 10_000,
      duration: 300_000,
      remainingTime: 300_000,
      isAutoStarted: true,
      extensionCandidate: {
        originalTimerId: 'work-1',
        originalDuration: 1_500_000,
        extensionNextTimerType: TIMER_TYPES.BREAK,
      },
    });
    const replaceCurrentTimer = vi.fn(
      async (_userId: string, _expected: unknown, nextTimer: Timer) => ({
        kind: 'updated' as const,
        timer: { ...nextTimer, scheduleRevision: 'revision-paused' },
      })
    );
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getCurrentTimer: vi.fn(async () => timer),
        replaceCurrentTimer,
      },
      timerCountdownService: {
        refreshCountdown: vi.fn(),
        stopCountdown: vi.fn(),
      },
      timerIdleService: {
        cancelPausedTimerReminder: vi.fn(),
      },
      timerEvents: {
        emitTimerUpdate: vi.fn(),
        emitExtensionStateUpdate: vi.fn(),
      },
    }) as TimerService;
    const now = vi.spyOn(Date, 'now').mockReturnValue(20_000);

    await service.pauseTimer('user-1');

    expect(replaceCurrentTimer).toHaveBeenCalledWith(
      'user-1',
      { timerId: 'timer-current', scheduleRevision: 'revision-current' },
      expect.objectContaining({
        status: TIMER_STATUSES.PAUSED,
        remainingTime: 290_000,
      }),
      undefined
    );
    now.mockRestore();
  });

  it('does not arm extension when pausing a manually started break', async () => {
    const timer = currentTimer({
      type: TIMER_TYPES.BREAK,
      status: TIMER_STATUSES.RUNNING,
      startTime: 10_000,
      duration: 300_000,
      isAutoStarted: false,
      extensionCandidate: {
        originalTimerId: 'work-1',
        originalDuration: 1_500_000,
        extensionNextTimerType: TIMER_TYPES.BREAK,
      },
    });
    const replaceCurrentTimer = vi.fn(
      async (_userId: string, _expected: unknown, nextTimer: Timer) => ({
        kind: 'updated' as const,
        timer: { ...nextTimer, scheduleRevision: 'revision-paused' },
      })
    );
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getCurrentTimer: vi.fn(async () => timer),
        replaceCurrentTimer,
      },
      timerCountdownService: {
        refreshCountdown: vi.fn(),
        stopCountdown: vi.fn(),
      },
      timerIdleService: { cancelPausedTimerReminder: vi.fn() },
      timerEvents: {
        emitTimerUpdate: vi.fn(),
        emitExtensionStateUpdate: vi.fn(),
      },
    }) as TimerService;

    await service.pauseTimer('user-1');

    expect(replaceCurrentTimer.mock.calls[0][3]).toBeUndefined();
  });

  it('resets only the first intention on an eligible running auto-started break', async () => {
    const timer = currentTimer({
      type: TIMER_TYPES.BREAK,
      status: TIMER_STATUSES.RUNNING,
      startTime: 10_000,
      duration: 300_000,
      remainingTime: 250_000,
      isAutoStarted: true,
      extensionCandidate: {
        originalTimerId: 'work-1',
        originalDuration: 1_500_000,
        extensionNextTimerType: TIMER_TYPES.BREAK,
      },
    });
    const commitCurrentTimer = vi.fn(
      async (_userId: string, _expected: unknown, nextTimer: Timer) => nextTimer
    );
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getCurrentTimer: vi.fn(async () => timer),
      },
      preferencesService: {
        getPreferences: vi.fn(async () => ({
          intentionBreakIntentions: true,
          intentionMultiSelect: false,
          intentionCustomDurations: false,
          resetBreakOnFirstIntention: true,
          resetLongBreakOnFirstIntention: false,
        })),
      },
      intentionsService: {
        validateSubIntentionSelection: vi.fn(async () => ({
          focus: { emoji: '🎯', title: 'Focus' },
        })),
      },
      snapshotRuntime: vi.fn(async () => ({
        timer: { ...timer },
        sessionState: null,
        lastCompletionTimestamp: null,
        idleDetected: false,
        extensionState: {
          startTime: 25_000,
          originalTimerId: 'work-1',
          originalDuration: 1_500_000,
          extensionNextTimerType: TIMER_TYPES.BREAK,
        },
      })),
      commitCurrentTimer,
      timerEvents: {
        emitTimerUpdate: vi.fn(),
        emitExtensionStateUpdate: vi.fn(),
      },
      buildHistoryEntry: vi.fn(async () => ({})),
      pushTimerHistory: vi.fn(async () => undefined),
    }) as TimerService;
    const now = vi.spyOn(Date, 'now').mockReturnValue(50_000);

    const result = await service.selectTimerIntention(
      'user-1',
      TIMER_TYPES.BREAK,
      'focus',
      undefined,
      true
    );

    expect(result).toMatchObject({
      startTime: 50_000,
      remainingTime: 300_000,
      duration: 300_000,
      status: TIMER_STATUSES.RUNNING,
      intention: 'focus',
      isAutoStarted: true,
      extensionCandidate: expect.objectContaining({
        originalTimerId: 'work-1',
        originalDuration: 1_500_000,
      }),
    });
    expect(commitCurrentTimer).toHaveBeenCalledWith(
      'user-1',
      { timerId: 'timer-current', scheduleRevision: 'revision-current' },
      expect.objectContaining({
        startTime: 50_000,
        remainingTime: 300_000,
        hasConsumedFirstIntentionReset: true,
      }),
      undefined
    );
    expect(service.timerEvents.emitExtensionStateUpdate).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it('keeps reset provenance and preserves extension state after a later pause', async () => {
    let timer = currentTimer({
      type: TIMER_TYPES.BREAK,
      status: TIMER_STATUSES.RUNNING,
      startTime: 10_000,
      duration: 300_000,
      remainingTime: 250_000,
      isAutoStarted: true,
      extensionCandidate: {
        originalTimerId: 'work-1',
        originalDuration: 1_500_000,
        extensionNextTimerType: TIMER_TYPES.BREAK,
      },
    });
    const commitCurrentTimer = vi.fn(
      async (_userId: string, _expected: unknown, nextTimer: Timer) => {
        timer = { ...nextTimer };
        return timer;
      }
    );
    const emitExtensionStateUpdate = vi.fn();
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: {
        getCurrentTimer: vi.fn(async () => timer),
      },
      preferencesService: {
        getPreferences: vi.fn(async () => ({
          intentionBreakIntentions: true,
          intentionMultiSelect: false,
          intentionCustomDurations: false,
          resetBreakOnFirstIntention: true,
          resetLongBreakOnFirstIntention: false,
        })),
      },
      intentionsService: {
        validateSubIntentionSelection: vi.fn(async () => ({
          focus: { emoji: '🎯', title: 'Focus' },
        })),
      },
      snapshotRuntime: vi.fn(async () => ({
        timer: { ...timer },
        sessionState: null,
        lastCompletionTimestamp: null,
        idleDetected: false,
        extensionState: null,
      })),
      commitCurrentTimer,
      timerCountdownService: {
        stopCountdown: vi.fn(),
      },
      timerIdleService: {
        cancelPausedTimerReminder: vi.fn(),
      },
      timerEvents: {
        emitTimerUpdate: vi.fn(),
        emitExtensionStateUpdate,
      },
      buildHistoryEntry: vi.fn(async () => ({})),
      pushTimerHistory: vi.fn(async () => undefined),
    }) as TimerService;
    const now = vi.spyOn(Date, 'now').mockReturnValue(50_000);

    await service.selectTimerIntention(
      'user-1',
      TIMER_TYPES.BREAK,
      'focus',
      undefined,
      true
    );
    now.mockReturnValue(60_000);
    await service.selectTimerIntentions(
      'user-1',
      TIMER_TYPES.BREAK,
      [],
      undefined,
      true
    );
    now.mockReturnValue(70_000);
    await service.selectTimerIntention(
      'user-1',
      TIMER_TYPES.BREAK,
      'second',
      undefined,
      true
    );
    now.mockReturnValue(80_000);
    await service.pauseTimer('user-1');

    expect(commitCurrentTimer.mock.calls[0][2]).toMatchObject({
      startTime: 50_000,
      isAutoStarted: true,
      extensionCandidate: expect.any(Object),
      hasConsumedFirstIntentionReset: true,
    });
    expect(commitCurrentTimer.mock.calls[1][2]).toMatchObject({
      startTime: 50_000,
      isAutoStarted: true,
      extensionCandidate: expect.any(Object),
      hasConsumedFirstIntentionReset: true,
    });
    expect(commitCurrentTimer.mock.calls[2][2]).toMatchObject({
      startTime: 50_000,
      isAutoStarted: true,
      hasConsumedFirstIntentionReset: true,
    });
    expect(commitCurrentTimer.mock.calls[3][2]).toMatchObject({
      status: TIMER_STATUSES.PAUSED,
      remainingTime: 270_000,
      hasConsumedFirstIntentionReset: true,
    });
    expect(commitCurrentTimer.mock.calls[3][3]).toBeUndefined();
    expect(emitExtensionStateUpdate).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it('leaves an ineligible paused break untouched by the reset request', async () => {
    const timer = currentTimer({
      type: TIMER_TYPES.BREAK,
      status: TIMER_STATUSES.PAUSED,
      remainingTime: 250_000,
      isAutoStarted: true,
    });
    const commitCurrentTimer = vi.fn(
      async (_userId: string, _expected: unknown, nextTimer: Timer) => nextTimer
    );
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: { getCurrentTimer: vi.fn(async () => timer) },
      preferencesService: {
        getPreferences: vi.fn(async () => ({
          intentionBreakIntentions: true,
          intentionMultiSelect: false,
          intentionCustomDurations: false,
          resetBreakOnFirstIntention: true,
          resetLongBreakOnFirstIntention: false,
        })),
      },
      intentionsService: {
        validateSubIntentionSelection: vi.fn(async () => ({
          focus: { emoji: '🎯', title: 'Focus' },
        })),
      },
      snapshotRuntime: vi.fn(async () => ({
        timer: { ...timer },
        sessionState: null,
        lastCompletionTimestamp: null,
        idleDetected: false,
        extensionState: null,
      })),
      commitCurrentTimer,
      timerEvents: {
        emitTimerUpdate: vi.fn(),
        emitExtensionStateUpdate: vi.fn(),
      },
      buildHistoryEntry: vi.fn(async () => ({})),
      pushTimerHistory: vi.fn(async () => undefined),
    }) as TimerService;

    const result = await service.selectTimerIntention(
      'user-1',
      TIMER_TYPES.BREAK,
      'focus',
      undefined,
      true
    );

    expect(result.startTime).toBe(1_000);
    expect(result.remainingTime).toBe(250_000);
    expect(commitCurrentTimer).toHaveBeenCalledWith(
      'user-1',
      { timerId: 'timer-current', scheduleRevision: 'revision-current' },
      expect.objectContaining({ startTime: 1_000, remainingTime: 250_000 }),
      undefined
    );
  });

  it('does not publish a first-Intention reset after losing the Timer CAS', async () => {
    const timer = currentTimer({
      type: TIMER_TYPES.LONG_BREAK,
      status: TIMER_STATUSES.RUNNING,
      isAutoStarted: true,
      startTime: Date.now() - 50_000,
      duration: 900_000,
      remainingTime: 850_000,
    });
    const emitTimerUpdate = vi.fn();
    const buildHistoryEntry = vi.fn();
    const commitCurrentTimer = vi.fn(async () => {
      throw new ConflictException('Timer changed while action was processing');
    });
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: { getCurrentTimer: vi.fn(async () => timer) },
      preferencesService: {
        getPreferences: vi.fn(async () => ({
          intentionMultiSelect: false,
          intentionCustomDurations: false,
          resetBreakOnFirstIntention: false,
          resetLongBreakOnFirstIntention: true,
        })),
      },
      intentionsService: {
        validateSubIntentionSelection: vi.fn(async () => ({
          focus: { emoji: '🎯', title: 'Focus' },
        })),
      },
      snapshotRuntime: vi.fn(async () => ({
        timer: { ...timer },
        sessionState: null,
        lastCompletionTimestamp: null,
        idleDetected: false,
        extensionState: null,
      })),
      commitCurrentTimer,
      timerEvents: { emitTimerUpdate },
      buildHistoryEntry,
      pushTimerHistory: vi.fn(),
    }) as TimerService;

    await expect(
      service.selectTimerIntention(
        'user-1',
        TIMER_TYPES.LONG_BREAK,
        'focus',
        undefined,
        true
      )
    ).rejects.toBeInstanceOf(ConflictException);
    expect(commitCurrentTimer).toHaveBeenCalledOnce();
    expect(emitTimerUpdate).not.toHaveBeenCalled();
    expect(buildHistoryEntry).not.toHaveBeenCalled();
  });

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
      timerEvents: {
        emitTimerUpdate: vi.fn(),
        emitExtensionStateUpdate: vi.fn(),
      },
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
      timerEvents: {
        emitTimerUpdate: vi.fn(),
        emitExtensionStateUpdate: vi.fn(),
      },
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
      { extensionState: null }
    );
    expect(recordCompletedTimer).not.toHaveBeenCalled();
  });

  it('carries the captured Timer revision through an extension skip', async () => {
    const timer = currentTimer({
      isExtension: true,
      extensionNextTimerType: TIMER_TYPES.BREAK,
    });
    const createOrResumeTimer = vi.fn(async () =>
      currentTimer({ id: 'timer-next', type: TIMER_TYPES.BREAK })
    );
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: { getCurrentTimer: vi.fn(async () => timer) },
      preferencesService: {
        getPreferences: vi.fn(async () => ({
          advancedSkip: false,
          sessionsExtension: false,
          intentionExtension: false,
          intentionRequireSelection: false,
          autoStartBreak: false,
        })),
      },
      statisticsService: { recordCompletedTimer: vi.fn() },
      snapshotRuntime: vi.fn(async () => ({})),
      snapshotStatistics: vi.fn(async () => new Map()),
      createOrResumeTimer,
      buildHistoryEntry: vi.fn(async () => ({})),
      pushTimerHistory: vi.fn(async () => undefined),
    }) as TimerService;

    await service.skipTimer('user-1');

    expect(createOrResumeTimer).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        expectedVersion: {
          timerId: timer.id,
          scheduleRevision: timer.scheduleRevision,
        },
      })
    );
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

  it('preserves auto-start provenance for a non-session skipped Work Timer', async () => {
    const timer = currentTimer({
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.RUNNING,
      startTime: Date.now() - 60_000,
    });
    const nextTimer = currentTimer({
      id: 'timer-next',
      type: TIMER_TYPES.BREAK,
      status: TIMER_STATUSES.RUNNING,
      startTime: Date.now(),
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
          timerExtension: true,
          breakTimerDuration: 5 * 60_000,
        })),
      },
      statisticsService: { recordCompletedTimer: vi.fn() },
      snapshotRuntime: vi.fn(async () => ({})),
      snapshotStatistics: vi.fn(async () => new Map()),
      createOrResumeTimer,
      buildHistoryEntry: vi.fn(async () => ({})),
      pushTimerHistory: vi.fn(async () => undefined),
    }) as TimerService;

    await service.skipTimer('user-1', 'elapsed');

    expect(createOrResumeTimer).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        type: TIMER_TYPES.BREAK,
        startPaused: false,
        isAutoStarted: true,
        extensionCandidate: expect.objectContaining({
          originalTimerId: timer.id,
          originalDuration: timer.duration,
          extensionNextTimerType: TIMER_TYPES.BREAK,
        }),
      })
    );
  });

  it('does not arm extension for a skipped Work Timer that was not logged', async () => {
    const timer = currentTimer({
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.RUNNING,
      startTime: Date.now() - 60_000,
    });
    const nextTimer = currentTimer({
      id: 'timer-next',
      type: TIMER_TYPES.BREAK,
      status: TIMER_STATUSES.RUNNING,
      startTime: Date.now(),
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
          timerExtension: true,
          breakTimerDuration: 5 * 60_000,
        })),
      },
      statisticsService: { recordCompletedTimer: vi.fn() },
      snapshotRuntime: vi.fn(async () => ({})),
      snapshotStatistics: vi.fn(async () => new Map()),
      createOrResumeTimer,
      buildHistoryEntry: vi.fn(async () => ({})),
      pushTimerHistory: vi.fn(async () => undefined),
    }) as TimerService;

    await service.skipTimer('user-1');

    expect(createOrResumeTimer).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        type: TIMER_TYPES.BREAK,
        isAutoStarted: true,
        extensionCandidate: undefined,
      })
    );
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
      timerEvents: {
        emitTimerUpdate: vi.fn(),
        emitExtensionStateUpdate: vi.fn(),
      },
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

describe('logging extension time', () => {
  it.each([TIMER_STATUSES.RUNNING, TIMER_STATUSES.PAUSED])(
    'restarts the following %s timer after transferring elapsed Work',
    async status => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(70_000);
      const timer = currentTimer({
        type: TIMER_TYPES.BREAK,
        status,
        startTime: 10_000,
        duration: 300_000,
        remainingTime: 240_000,
      });
      const replaceCurrentTimer = vi.fn(
        async (_user: string, _version: unknown, next: Timer) => ({
          kind: 'updated',
          timer: next,
        })
      );
      const appendDurationToStatistic = vi.fn();
      const service = Object.assign(Object.create(TimerService.prototype), {
        timerStore: {
          getCurrentTimer: vi.fn(async () => timer),
          getExtensionState: vi.fn(async () => ({
            startTime: 10_000,
            originalTimerId: 'work-1',
            originalDuration: 1_500_000,
          })),
          replaceCurrentTimer,
          clearExtensionState: vi.fn(),
        },
        statisticsService: {
          getStatisticUndoSnapshot: vi.fn(async () => null),
          appendDurationToStatistic,
        },
        snapshotRuntime: vi.fn(async () => ({})),
        snapshotStatistics: vi.fn(async () => new Map()),
        buildHistoryEntry: vi.fn(async () => ({})),
        pushTimerHistory: vi.fn(),
        timerCountdownService: { refreshCountdown: vi.fn() },
        timerEvents: {
          emitTimerUpdate: vi.fn(),
          emitExtensionStateUpdate: vi.fn(),
        },
      }) as TimerService;
      try {
        const result = await service.resolveTimerExtension(
          'user-1',
          'logElapsed'
        );
        expect(result).toMatchObject({
          remainingTime: 300_000,
          startTime: status === TIMER_STATUSES.RUNNING ? 70_000 : 0,
          status,
        });
        expect(replaceCurrentTimer).toHaveBeenCalledWith(
          'user-1',
          { timerId: timer.id, scheduleRevision: timer.scheduleRevision },
          result,
          { extensionState: null }
        );
        expect(appendDurationToStatistic).toHaveBeenCalledWith(
          'user-1',
          'work-1',
          60_000,
          undefined
        );
      } finally {
        now.mockRestore();
      }
    }
  );
});
