import { Preferences, TIMER_STATUSES, TIMER_TYPES, Timer } from '@pomi/shared';
import { describe, expect, it } from 'vitest';
import {
  buildTimerContinuationPlan,
  parseTimerContinuationPlan,
} from '../../src/timer/timer-continuation-plan';

describe('buildTimerContinuationPlan', () => {
  it('advances a session work Timer to an auto-started break', () => {
    const plan = buildPlan(
      completedTimer({
        sessionPosition: 2,
        sessionTotal: 4,
        intentionEmoji: 'A',
        subIntentionEmoji: 'B',
        focusedTaskIds: ['task-1'],
      }),
      preferences({ autoStartBreak: true })
    );

    expect(plan.nextTimer).toEqual(
      expect.objectContaining({
        id: 'next-timer',
        type: TIMER_TYPES.BREAK,
        status: TIMER_STATUSES.RUNNING,
        startTime: 61_500,
        sessionPosition: 3,
        sessionTotal: 4,
        focusedTaskIds: ['task-1'],
      })
    );
    expect(plan.activationAt).toBe(61_500);
    expect(plan.sessionState).toEqual({
      kind: 'set',
      value: {
        currentPosition: 3,
        totalPomodoros: 4,
        stackedSessions: undefined,
        completedIntentionEmojis: { 2: 'AB' },
      },
    });
    expect(plan.lastCompletionTimestamp).toEqual({
      kind: 'set',
      value: 61_000,
    });
  });

  it('finishes a session with an auto-started long break and clears session state', () => {
    const plan = buildPlan(
      completedTimer({ sessionPosition: 4, sessionTotal: 4 }),
      preferences({
        sessionHasLongBreak: true,
        autoStartBreak: true,
      })
    );

    expect(plan.nextTimer).toEqual(
      expect.objectContaining({
        type: TIMER_TYPES.LONG_BREAK,
        status: TIMER_STATUSES.RUNNING,
        startTime: 61_500,
        duration: 900_000,
      })
    );
    expect(plan.sessionState).toEqual({ kind: 'clear' });
    expect(plan.lastCompletionTimestamp).toEqual({ kind: 'clear' });
    expect(plan.idleDetection).toBeNull();
  });

  it.each([TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK])(
    'carries an extension candidate into an auto-started %s',
    type => {
      const plan = buildPlan(
        completedTimer({
          type: TIMER_TYPES.WORK,
          ...(type === TIMER_TYPES.LONG_BREAK
            ? { sessionPosition: 4, sessionTotal: 4 }
            : {}),
        }),
        preferences({
          autoStartBreak: true,
          timerExtension: true,
          sessionHasLongBreak: type === TIMER_TYPES.LONG_BREAK,
        })
      );

      expect(plan.nextTimer).toEqual(
        expect.objectContaining({
          type,
          status: TIMER_STATUSES.RUNNING,
          isAutoStarted: true,
          extensionCandidate: expect.objectContaining({
            originalTimerId: 'timer-1',
            originalDuration: 60_000,
            extensionNextTimerType: type,
          }),
        })
      );
      expect(plan.extensionState).toEqual({ kind: 'keep' });
    }
  );

  it('finishes a stacked final timer without scheduling an extra work position', () => {
    const plan = buildPlan(
      completedTimer({
        sessionPosition: 3,
        sessionTotal: 3,
        stackedSessions: 2,
        stackedSessionPlanReduction: 0,
      }),
      preferences({
        sessionHasLongBreak: true,
        autoStartBreak: true,
      })
    );

    expect(plan.nextTimer.type).toBe(TIMER_TYPES.LONG_BREAK);
    expect(plan.sessionState).toEqual({ kind: 'clear' });
  });

  it('starts a fresh paused session when a final work Timer has no long break', () => {
    const plan = buildPlan(
      completedTimer({ sessionPosition: 4, sessionTotal: 4 }),
      preferences({ sessionHasLongBreak: false })
    );

    expect(plan.nextTimer).toEqual(
      expect.objectContaining({
        type: TIMER_TYPES.WORK,
        status: TIMER_STATUSES.PAUSED,
        startTime: 0,
        sessionPosition: 1,
        sessionTotal: 4,
      })
    );
    expect(plan.sessionState).toEqual({
      kind: 'set',
      value: { currentPosition: 1, totalPomodoros: 4 },
    });
    expect(plan.extensionState).toEqual({ kind: 'clear' });
  });

  it('auto-starts Work after a completed break when Work is selected', () => {
    const plan = buildPlan(
      completedTimer({ type: TIMER_TYPES.BREAK }),
      preferences({ autoStartWork: true })
    );

    expect(plan.nextTimer).toEqual(
      expect.objectContaining({
        type: TIMER_TYPES.WORK,
        status: TIMER_STATUSES.RUNNING,
        isAutoStarted: true,
      })
    );
  });

  it('can keep long breaks paused while short breaks auto-start', () => {
    const plan = buildPlan(
      completedTimer({ sessionPosition: 4, sessionTotal: 4 }),
      preferences({
        autoStartBreak: true,
        autoStartLongBreak: false,
        sessionHasLongBreak: true,
      })
    );

    expect(plan.nextTimer).toEqual(
      expect.objectContaining({
        type: TIMER_TYPES.LONG_BREAK,
        status: TIMER_STATUSES.PAUSED,
      })
    );
  });

  it('preserves extension routing without copying focused tasks', () => {
    const plan = buildPlan(
      completedTimer({
        isExtension: true,
        extensionNextTimerType: TIMER_TYPES.BREAK,
        stackedSessions: 2,
        focusedTaskIds: ['task-1'],
      }),
      preferences({ autoStartBreak: false })
    );

    expect(plan.nextTimer).toEqual(
      expect.objectContaining({
        type: TIMER_TYPES.BREAK,
        status: TIMER_STATUSES.PAUSED,
        duration: 600_000,
      })
    );
    expect(plan.nextTimer.focusedTaskIds).toBeUndefined();
  });

  it('builds deterministic extension state from the completion deadline', () => {
    const plan = buildPlan(
      completedTimer({ intention: 'focus' }),
      preferences({
        timerExtension: true,
        autoStartBreak: false,
        sessionAutoDetectLongBreak: true,
      })
    );

    expect(plan.extensionState).toEqual({
      kind: 'set',
      value: expect.objectContaining({
        startTime: 61_000,
        maxDuration: 900_000,
        originalTimerId: 'timer-1',
        originalDuration: 60_000,
        extensionNextTimerType: TIMER_TYPES.BREAK,
        intention: 'focus',
      }),
    });
    expect(plan.extensionExpirationAt).toBe(961_000);
    expect(plan.idleDetection).toEqual({
      detectionId: '11111111-1111-4111-8111-111111111111',
      checkAt: 961_000,
      longBreakDuration: 900_000,
      expectedLastCompletionTimestamp: 61_000,
      expectedTimer: {
        timerId: 'next-timer',
        scheduleRevision: 'next-revision',
      },
      expectedRuntimeRevision: 'next-revision',
      longBreakTimerId: '22222222-2222-4222-8222-222222222222',
      replacementTimer: expect.objectContaining({
        id: '33333333-3333-4333-8333-333333333333',
        scheduleRevision: '44444444-4444-4444-8444-444444444444',
        type: TIMER_TYPES.WORK,
        status: TIMER_STATUSES.PAUSED,
        duration: 1_500_000,
        remainingTime: 1_500_000,
        sessionPosition: 1,
        sessionTotal: 4,
      }),
      replacementSessionState: {
        currentPosition: 1,
        totalPomodoros: 4,
      },
    });
  });

  it('recovers a persisted v1 plan without treating old idle metadata as v2', () => {
    const current = buildPlan(completedTimer({}), preferences({}));
    const recovered = parseTimerContinuationPlan(
      {
        ...current,
        idleDetection: {
          checkAt: 966_000,
          longBreakDuration: 900_000,
        },
      },
      1
    );

    expect(recovered.idleDetection).toBeNull();
    expect(recovered.nextTimer).toEqual(current.nextTimer);
  });

  it('rejects unknown persisted plan versions', () => {
    expect(() =>
      parseTimerContinuationPlan(
        buildPlan(completedTimer({}), preferences({})),
        3
      )
    ).toThrow('Unsupported Timer continuation plan version: 3');
  });

  it.each([TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK])(
    'advances a completed %s to paused work',
    type => {
      const plan = buildPlan(completedTimer({ type }), preferences({}));

      expect(plan.nextTimer).toEqual(
        expect.objectContaining({
          type: TIMER_TYPES.WORK,
          status: TIMER_STATUSES.PAUSED,
          startTime: 0,
        })
      );
    }
  );

  it('starts a fresh session after a long break even if its snapshot has stale session fields', () => {
    const plan = buildPlan(
      completedTimer({
        type: TIMER_TYPES.LONG_BREAK,
        sessionPosition: 4,
        sessionTotal: 4,
      }),
      preferences({})
    );

    expect(plan.sessionState).toEqual({
      kind: 'set',
      value: { currentPosition: 1, totalPomodoros: 4 },
    });
    expect(plan.nextTimer.sessionPosition).toBe(1);
  });

  it('does not propagate stacked break count through work into the next break', () => {
    const settings = preferences({});
    const workPlan = buildPlan(
      completedTimer({
        type: TIMER_TYPES.BREAK,
        stackedSessions: 3,
        sessionPosition: 2,
        sessionTotal: 4,
      }),
      settings
    );
    expect(workPlan.nextTimer.stackedSessions).toBeUndefined();

    const breakPlan = buildPlan(
      {
        ...workPlan.nextTimer,
        status: TIMER_STATUSES.COMPLETED,
        remainingTime: 0,
      },
      settings
    );
    expect(breakPlan.nextTimer.type).toBe(TIMER_TYPES.BREAK);
    expect(breakPlan.nextTimer.duration).toBe(300_000);
  });

  function buildPlan(timer: Timer, settings: Preferences) {
    return buildTimerContinuationPlan(
      timer,
      settings,
      61_000,
      'next-timer',
      'next-revision',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444'
    );
  }

  function completedTimer(overrides: Partial<Timer>): Timer {
    return {
      id: 'timer-1',
      scheduleRevision: 'source-revision',
      userId: 'user-1',
      startTime: 1_000,
      duration: 60_000,
      remainingTime: 0,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.COMPLETED,
      sessionPosition: 1,
      sessionTotal: 4,
      ...overrides,
    };
  }

  function preferences(overrides: Partial<Preferences>): Preferences {
    return {
      workTimerDuration: 1_500_000,
      breakTimerDuration: 300_000,
      autoStartBreak: false,
      sessionsExtension: true,
      sessionPomodorosCount: 4,
      sessionHasLongBreak: true,
      sessionLongBreakDuration: 900_000,
      resetBreakOnFirstIntention: false,
      resetLongBreakOnFirstIntention: false,
      timerExtension: false,
      ...overrides,
    } as Preferences;
  }
});
