import { TIMER_STATUSES, TIMER_TYPES, Timer } from '@pomi/shared';
import { describe, expect, it, vi } from 'vitest';
import { TimerCompletionNotificationWorkerService } from '../../src/timer/timer-completion-notification-worker.service';
import { MAX_DURABLE_COMPLETION_ATTEMPTS } from '../../src/timer/timer-completion-outbox.service';

describe('TimerCompletionNotificationWorkerService', () => {
  it('dispatches and acknowledges a valid durable completion', async () => {
    const harness = createHarness();

    await harness.processJob(job());

    expect(harness.emitCompleted).toHaveBeenCalledWith(
      'user-1',
      job().payload.timer,
      false,
      61_000,
      'timer-completed:timer-1'
    );
    expect(harness.markProcessed).toHaveBeenCalledWith('outbox-1', 'claim-1');
  });

  it('dead-letters malformed internal payloads', async () => {
    const harness = createHarness();

    await harness.processJob({ ...job(), payload: {} });

    expect(harness.markFailed).toHaveBeenCalledWith(
      'outbox-1',
      'claim-1',
      expect.objectContaining({
        message: 'Timer completion notification payload is malformed',
      })
    );
    expect(harness.release).not.toHaveBeenCalled();
    expect(harness.emitCompleted).not.toHaveBeenCalled();
  });

  it('dispatches the durable long-break-detected notification', async () => {
    const harness = createHarness();
    const replacementTimer: Timer = {
      id: 'work-1',
      scheduleRevision: 'work-revision-1',
      userId: 'user-1',
      startTime: 0,
      duration: 1_500_000,
      remainingTime: 1_500_000,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.PAUSED,
    };
    const longBreakTimer: Timer = {
      id: 'long-break-1',
      scheduleRevision: 'detection-1',
      userId: 'user-1',
      startTime: 1_000,
      duration: 900_000,
      remainingTime: 0,
      type: TIMER_TYPES.LONG_BREAK,
      status: TIMER_STATUSES.COMPLETED,
      hasNotifiedLongBreakDetection: true,
    };

    await harness.processJob(
      job({
        type: 'long-break-detected',
        idempotencyKey: 'long-break-detected:detection-1',
        payload: {
          detectionId: 'detection-1',
          detectedAt: 901_000,
          longBreakTimer,
          replacementTimer,
        },
      })
    );

    expect(harness.emitLongBreakDetected).toHaveBeenCalledWith(
      'user-1',
      replacementTimer,
      901_000,
      'long-break-detected:detection-1'
    );
    expect(harness.emitCompleted).not.toHaveBeenCalled();
  });

  it('releases transient provider failures with bounded backoff', async () => {
    const harness = createHarness();
    harness.emitCompleted.mockRejectedValueOnce(new Error('provider down'));

    await harness.processJob(job());

    expect(harness.release).toHaveBeenCalledWith(
      'outbox-1',
      'claim-1',
      expect.objectContaining({ message: 'provider down' }),
      5_000
    );
    expect(harness.markProcessed).not.toHaveBeenCalled();
  });

  it('dead-letters a transient failure after the durable retry budget is exhausted', async () => {
    const harness = createHarness();
    harness.emitCompleted.mockRejectedValueOnce(new Error('provider down'));

    await harness.processJob(
      job({ attempts: MAX_DURABLE_COMPLETION_ATTEMPTS })
    );

    expect(harness.markFailed).toHaveBeenCalledWith(
      'outbox-1',
      'claim-1',
      expect.objectContaining({ message: 'provider down' })
    );
    expect(harness.release).not.toHaveBeenCalled();
    expect(harness.markProcessed).not.toHaveBeenCalled();
  });

  it('does not dispatch after losing its database lease', async () => {
    const harness = createHarness();
    harness.renewLease.mockResolvedValueOnce(false);

    await harness.processJob(job());

    expect(harness.emitCompleted).not.toHaveBeenCalled();
    expect(harness.markProcessed).not.toHaveBeenCalled();
  });

  it('serializes completion notifications for the same user', async () => {
    const harness = createHarness();
    let active = 0;
    let maxActive = 0;
    harness.emitCompleted.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
    });

    await harness.processJobs([
      job(),
      job({
        id: 'outbox-2',
        claimToken: 'claim-2',
        idempotencyKey: 'timer-completed:timer-2',
        payload: {
          ...job().payload,
          timer: { ...job().payload.timer, id: 'timer-2' },
        },
      }),
    ]);

    expect(maxActive).toBe(1);
    expect(harness.emitCompleted).toHaveBeenCalledTimes(2);
  });

  it('continues a user batch when a failed job cannot be released', async () => {
    const harness = createHarness();
    harness.emitCompleted.mockRejectedValueOnce(new Error('provider down'));
    harness.release.mockRejectedValueOnce(new Error('database unavailable'));

    await harness.processJobs([
      job(),
      job({
        id: 'outbox-2',
        claimToken: 'claim-2',
        idempotencyKey: 'timer-completed:timer-2',
        payload: {
          ...job().payload,
          timer: { ...job().payload.timer, id: 'timer-2' },
        },
      }),
    ]);

    expect(harness.emitCompleted).toHaveBeenCalledTimes(2);
  });

  function createHarness() {
    const renewLease = vi.fn(async () => true);
    const markProcessed = vi.fn(async () => true);
    const markFailed = vi.fn(async () => true);
    const release = vi.fn(async () => true);
    const emitCompleted = vi.fn(async () => undefined);
    const emitLongBreakDetected = vi.fn(async () => undefined);
    const service = new TimerCompletionNotificationWorkerService(
      {
        renewCompletionNotificationLease: renewLease,
        markClaimedCompletionNotificationProcessed: markProcessed,
        markClaimedCompletionNotificationFailed: markFailed,
        releaseClaimedCompletionNotification: release,
      } as never,
      {
        emitDurableTimerCompleted: emitCompleted,
        emitDurableLongBreakDetected: emitLongBreakDetected,
      } as never
    );
    Object.assign(service, { logger: { error: vi.fn(), warn: vi.fn() } });
    const internals = service as unknown as {
      processJob(target: ReturnType<typeof job>): Promise<void>;
      processJobs(targets: Array<ReturnType<typeof job>>): Promise<void>;
    };
    return {
      renewLease,
      markProcessed,
      markFailed,
      release,
      emitCompleted,
      emitLongBreakDetected,
      processJob: internals.processJob.bind(service),
      processJobs: internals.processJobs.bind(service),
    };
  }

  function job(overrides: Record<string, unknown> = {}) {
    const timer: Timer = {
      id: 'timer-1',
      scheduleRevision: 'timer-revision-1',
      userId: 'user-1',
      startTime: 1_000,
      duration: 60_000,
      remainingTime: 0,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.COMPLETED,
    };
    return {
      id: 'outbox-1',
      type: 'timer-completed',
      idempotencyKey: 'timer-completed:timer-1',
      userId: 'user-1',
      payload: {
        timer,
        completedAt: 61_000,
        isLastWorkTimerInSession: false,
      },
      attempts: 1,
      claimToken: 'claim-1',
      ...overrides,
    };
  }
});
