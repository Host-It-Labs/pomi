import { TIMER_STATUSES, TIMER_TYPES } from '@pomi/shared';
import { describe, expect, it, vi } from 'vitest';
import { TimerContinuationPlanV2 } from '../../src/timer/timer-continuation-plan';
import { TimerService } from '../../src/timer/timer.service';

describe('TimerService durable continuation activation', () => {
  it('re-arms only non-durable lifecycle work after an atomic Redis apply', async () => {
    const associateTimerWithUser = vi.fn(async () => undefined);
    const emitTimerUpdate = vi.fn();
    const emitExtensionStateUpdate = vi.fn();
    const stopCountdown = vi.fn();
    const startCountdown = vi.fn(async () => undefined);
    const cancelPausedTimerReminder = vi.fn();
    const cancelIdleDetectionCheck = vi.fn();
    const service = Object.create(TimerService.prototype) as TimerService;
    Object.assign(service, {
      usersService: { associateTimerWithUser },
      timerEvents: { emitTimerUpdate, emitExtensionStateUpdate },
      timerStore: {
        getCurrentTimer: vi.fn(async () => continuationPlan().nextTimer),
      },
      timerCountdownService: { stopCountdown, startCountdown },
      timerIdleService: {
        cancelPausedTimerReminder,
        cancelIdleDetectionCheck,
      },
    });
    const clearAutoAdvance = vi.fn();
    Object.assign(service, {
      clearAutoAdvance,
      logger: { error: vi.fn() },
    });
    const plan = continuationPlan();

    await service.activateTimerContinuation(plan);

    expect(clearAutoAdvance).toHaveBeenCalledWith('user-1');
    expect(stopCountdown).toHaveBeenCalledWith('user-1', plan.source);
    expect(cancelPausedTimerReminder).toHaveBeenCalledWith('user-1');
    expect(startCountdown).toHaveBeenCalledWith(
      plan.nextTimer,
      expect.any(Function)
    );
    expect(emitExtensionStateUpdate).toHaveBeenCalledWith(
      'user-1',
      plan.extensionState.kind === 'set' ? plan.extensionState.value : null
    );
    expect(associateTimerWithUser).toHaveBeenCalledWith('user-1', 'next-1');
    expect(emitTimerUpdate).toHaveBeenCalledWith('user-1', plan.nextTimer);
    expect(cancelIdleDetectionCheck).not.toHaveBeenCalled();
  });

  function continuationPlan(): TimerContinuationPlanV2 {
    return {
      source: { timerId: 'source-1', scheduleRevision: 'source-revision' },
      activationAt: 61_500,
      nextTimer: {
        id: 'next-1',
        scheduleRevision: 'next-revision',
        userId: 'user-1',
        startTime: 61_500,
        duration: 300_000,
        remainingTime: 300_000,
        type: TIMER_TYPES.BREAK,
        status: TIMER_STATUSES.RUNNING,
      },
      sessionState: { kind: 'keep' },
      extensionState: {
        kind: 'set',
        value: {
          startTime: 61_000,
          maxDuration: 900_000,
          originalTimerId: 'source-1',
          originalDuration: 60_000,
        },
      },
      extensionExpirationAt: 961_000,
      lastCompletionTimestamp: { kind: 'set', value: 61_000 },
      clearIdleDetected: true,
      clearHistory: true,
      idleDetection: {
        detectionId: '11111111-1111-4111-8111-111111111111',
        checkAt: 961_000,
        longBreakDuration: 900_000,
        expectedLastCompletionTimestamp: 61_000,
        expectedTimer: {
          timerId: 'next-1',
          scheduleRevision: 'next-revision',
        },
        expectedRuntimeRevision: 'next-revision',
        longBreakTimerId: '22222222-2222-4222-8222-222222222222',
        replacementTimer: {
          id: '33333333-3333-4333-8333-333333333333',
          scheduleRevision: '44444444-4444-4444-8444-444444444444',
          userId: 'user-1',
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
  }
});
