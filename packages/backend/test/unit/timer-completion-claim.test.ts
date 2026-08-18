import { TIMER_STATUSES, TIMER_TYPES } from '@pomi/shared';
import { describe, expect, it, vi } from 'vitest';
import { TimerService } from '../../src/timer/timer.service';

describe('Timer completion claim', () => {
  it('stops stale workers before completion side effects', async () => {
    const claimRunningTimerCompletionByMode = vi.fn(async () => null);
    const clearTimerHistory = vi.fn();
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: { claimRunningTimerCompletionByMode },
      completingTimerIds: new Set<string>(),
      clearTimerHistory,
    }) as TimerService;
    const timer = {
      id: 'timer-1',
      userId: 'user-1',
      startTime: 123,
      duration: 60_000,
      remainingTime: 0,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.RUNNING,
    };

    await (
      service as unknown as {
        handleTimerCompletion(value: typeof timer): Promise<void>;
      }
    ).handleTimerCompletion(timer);

    expect(claimRunningTimerCompletionByMode).toHaveBeenCalledWith(
      'user-1',
      'timer-1',
      123
    );
    expect(clearTimerHistory).not.toHaveBeenCalled();
  });

  it('leaves stream-mode completion effects to the durable consumer', async () => {
    const timer = {
      id: 'timer-1',
      userId: 'user-1',
      startTime: 123,
      duration: 60_000,
      remainingTime: 0,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.RUNNING,
    };
    const claimRunningTimerCompletionByMode = vi.fn(async () => ({
      timer: { ...timer, status: TIMER_STATUSES.COMPLETED },
      mode: 'stream' as const,
      eventId: '1-0',
      completedAt: 60_123,
      claimedAt: 60_124,
    }));
    const clearTimerHistory = vi.fn();
    const completeTimer = vi.fn();
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: { claimRunningTimerCompletionByMode },
      completingTimerIds: new Set<string>(),
      clearTimerHistory,
      completeTimer,
    }) as TimerService;

    await (
      service as unknown as {
        handleTimerCompletion(value: typeof timer): Promise<void>;
      }
    ).handleTimerCompletion(timer);

    expect(clearTimerHistory).not.toHaveBeenCalled();
    expect(completeTimer).not.toHaveBeenCalled();
  });

  it('preserves local completion behavior in legacy mode', async () => {
    const timer = {
      id: 'timer-1',
      userId: 'user-1',
      startTime: 123,
      duration: 60_000,
      remainingTime: 0,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.RUNNING,
    };
    const completedTimer = {
      ...timer,
      status: TIMER_STATUSES.COMPLETED,
    };
    const claimRunningTimerCompletionByMode = vi.fn(async () => ({
      timer: completedTimer,
      mode: 'legacy' as const,
      eventId: null,
      completedAt: 60_123,
      claimedAt: 60_124,
    }));
    const clearTimerHistory = vi.fn();
    const completeTimer = vi.fn();
    const service = Object.assign(Object.create(TimerService.prototype), {
      timerStore: { claimRunningTimerCompletionByMode },
      completingTimerIds: new Set<string>(),
      clearTimerHistory,
      completeTimer,
    }) as TimerService;

    await (
      service as unknown as {
        handleTimerCompletion(value: typeof timer): Promise<void>;
      }
    ).handleTimerCompletion(timer);

    expect(clearTimerHistory).toHaveBeenCalledWith('user-1');
    expect(completeTimer).toHaveBeenCalledWith(completedTimer);
  });
});
