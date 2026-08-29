import { Preferences, TIMER_STATUSES, TIMER_TYPES, Timer } from '@pomi/shared';
import { describe, expect, it, vi } from 'vitest';
import { TimerContinuationWorkerService } from '../../src/timer/timer-continuation-worker.service';

describe('TimerContinuationWorkerService', () => {
  it('stores, applies, activates, and acknowledges one deterministic plan', async () => {
    const harness = createHarness();

    await harness.processJob(job());

    expect(harness.getPreferences).toHaveBeenCalledWith('user-1');
    expect(harness.storePlan).toHaveBeenCalledWith(
      'timer-1',
      'claim-1',
      expect.objectContaining({
        source: {
          timerId: 'timer-1',
          scheduleRevision: 'source-revision',
        },
        nextTimer: expect.objectContaining({ userId: 'user-1' }),
      }),
      2
    );
    expect(harness.renewLease).toHaveBeenCalledWith(
      'timer-1',
      'claim-1',
      30_000
    );
    expect(harness.applyPlan).toHaveBeenCalledOnce();
    expect(harness.activatePlan).toHaveBeenCalledOnce();
    expect(harness.markProcessed).toHaveBeenCalledWith(
      'timer-1',
      'claim-1',
      'applied'
    );
  });

  it('reactivates a stored plan after Redis applied it before a crash', async () => {
    const harness = createHarness();
    const initialJob = job();
    await harness.processJob(initialJob);
    const storedPlan = harness.storePlan.mock.calls[0][2];
    vi.clearAllMocks();
    harness.renewLease.mockResolvedValue(true);
    harness.applyPlan.mockResolvedValue({
      kind: 'already-applied',
      timer: storedPlan.nextTimer,
    });
    harness.markProcessed.mockResolvedValue(true);

    await harness.processJob({
      ...initialJob,
      attempts: 2,
      plan: storedPlan,
      planVersion: 2,
    });

    expect(harness.getPreferences).not.toHaveBeenCalled();
    expect(harness.storePlan).not.toHaveBeenCalled();
    expect(harness.activatePlan).toHaveBeenCalledWith(storedPlan);
    expect(harness.markProcessed).toHaveBeenCalledWith(
      'timer-1',
      'claim-1',
      'applied'
    );
  });

  it('marks a user-overridden continuation superseded without activation', async () => {
    const harness = createHarness();
    harness.applyPlan.mockResolvedValue({
      kind: 'superseded',
      current: null,
    });

    await harness.processJob(job());

    expect(harness.activatePlan).not.toHaveBeenCalled();
    expect(harness.markProcessed).toHaveBeenCalledWith(
      'timer-1',
      'claim-1',
      'superseded'
    );
  });

  it('dead-letters a malformed payload without retrying it', async () => {
    const harness = createHarness();

    await harness.processJob({ ...job(), payload: {} });

    expect(harness.markProcessed).toHaveBeenCalledWith(
      'timer-1',
      'claim-1',
      'failed'
    );
    expect(harness.release).not.toHaveBeenCalled();
    expect(harness.applyPlan).not.toHaveBeenCalled();
  });

  it('releases transient planning failures with bounded backoff', async () => {
    const harness = createHarness();
    harness.getPreferences.mockRejectedValueOnce(new Error('database down'));

    await harness.processJob(job());

    expect(harness.release).toHaveBeenCalledWith(
      'timer-1',
      'claim-1',
      expect.objectContaining({ message: 'database down' }),
      5_000
    );
    expect(harness.markProcessed).not.toHaveBeenCalled();
  });

  it('does not apply a plan after losing its lease', async () => {
    const harness = createHarness();
    harness.renewLease.mockResolvedValueOnce(false);

    await harness.processJob(job());

    expect(harness.applyPlan).not.toHaveBeenCalled();
    expect(harness.activatePlan).not.toHaveBeenCalled();
    expect(harness.markProcessed).not.toHaveBeenCalled();
  });

  it('does not apply a plan after losing its distributed user lock', async () => {
    const harness = createHarness();
    harness.renewUserLock.mockResolvedValueOnce(false);

    await harness.processJob(job());

    expect(harness.applyPlan).not.toHaveBeenCalled();
    expect(harness.activatePlan).not.toHaveBeenCalled();
    expect(harness.markProcessed).not.toHaveBeenCalled();
  });

  it('dead-letters unsupported stored plan versions', async () => {
    const harness = createHarness();
    const initialJob = job();
    await harness.processJob(initialJob);
    const storedPlan = harness.storePlan.mock.calls[0][2];
    vi.clearAllMocks();

    await harness.processJob({
      ...initialJob,
      plan: storedPlan,
      planVersion: 3,
    });

    expect(harness.markProcessed).toHaveBeenCalledWith(
      'timer-1',
      'claim-1',
      'failed'
    );
    expect(harness.release).not.toHaveBeenCalled();
  });

  it('upgrades and applies a persisted v1 plan under the active claim', async () => {
    const harness = createHarness();
    const initialJob = job();
    await harness.processJob(initialJob);
    const storedPlan = harness.storePlan.mock.calls[0][2];
    vi.clearAllMocks();

    const legacyPlan = {
      ...storedPlan,
      idleDetection: {
        checkAt: 966_000,
        longBreakDuration: 900_000,
      },
    };
    await harness.processJob({
      ...initialJob,
      plan: legacyPlan,
      planVersion: 1,
    });

    expect(harness.upgradePlan).toHaveBeenCalledWith(
      'timer-1',
      'claim-1',
      legacyPlan,
      expect.objectContaining({
        idleDetection: expect.objectContaining({ checkAt: 961_000 }),
      }),
      1,
      2
    );
    expect(harness.applyPlan).toHaveBeenCalledOnce();
    expect(harness.markProcessed).toHaveBeenCalledWith(
      'timer-1',
      'claim-1',
      'applied'
    );
  });

  it('dead-letters unsupported completed Timer types', async () => {
    const harness = createHarness();
    const invalidJob = job();
    invalidJob.payload.timer.type = 'unknown' as never;

    await harness.processJob(invalidJob);

    expect(harness.markProcessed).toHaveBeenCalledWith(
      'timer-1',
      'claim-1',
      'failed'
    );
    expect(harness.applyPlan).not.toHaveBeenCalled();
  });

  it('serializes multiple claimed continuations for the same user', async () => {
    const harness = createHarness();
    let active = 0;
    let maxActive = 0;
    harness.applyPlan.mockImplementation(async (_userId, plan) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return { kind: 'superseded', current: plan.nextTimer };
    });

    await harness.processJobs([
      jobFor('timer-1', 'claim-1'),
      jobFor('timer-2', 'claim-2'),
    ]);

    expect(maxActive).toBe(1);
    expect(harness.applyPlan).toHaveBeenCalledTimes(2);
  });

  it('continues a user batch when lock cleanup unexpectedly fails', async () => {
    const harness = createHarness();
    harness.releaseUserLock.mockRejectedValueOnce(
      new Error('database unavailable')
    );

    await harness.processJobs([
      jobFor('timer-1', 'claim-1'),
      jobFor('timer-2', 'claim-2'),
    ]);

    expect(harness.applyPlan).toHaveBeenCalledTimes(2);
  });

  it('releases a continuation when another replica holds the user lock', async () => {
    const harness = createHarness();
    harness.claimUserLock.mockResolvedValueOnce(null);

    await harness.processJob(job());

    expect(harness.release).toHaveBeenCalledWith(
      'timer-1',
      'claim-1',
      expect.objectContaining({
        message: 'Another continuation is active for this user',
      }),
      250
    );
    expect(harness.applyPlan).not.toHaveBeenCalled();
    expect(harness.releaseUserLock).not.toHaveBeenCalled();
  });

  function createHarness() {
    let appliedTimer: Timer | null = null;
    const storePlan = vi.fn(async () => true);
    const upgradePlan = vi.fn(async () => true);
    const renewLease = vi.fn(async () => true);
    const markProcessed = vi.fn(async () => true);
    const release = vi.fn(async () => true);
    const getPreferences = vi.fn(async () => preferences());
    const applyPlan = vi.fn(async (_userId, plan) => ({
      kind: 'applied' as const,
      timer: (appliedTimer = plan.nextTimer),
    }));
    const getCurrentTimer = vi.fn(async () => appliedTimer);
    const claimUserLock = vi.fn(async () => 'user-lock-1');
    const renewUserLock = vi.fn(async () => true);
    const releaseUserLock = vi.fn(async () => true);
    const activatePlan = vi.fn(async () => undefined);
    const service = new TimerContinuationWorkerService(
      {
        storeClaimedTimerContinuationPlan: storePlan,
        upgradeClaimedTimerContinuationPlan: upgradePlan,
        renewTimerContinuationLease: renewLease,
        markClaimedTimerContinuationProcessed: markProcessed,
        releaseClaimedTimerContinuation: release,
      } as never,
      { getPreferences } as never,
      {
        applyTimerContinuationPlan: applyPlan,
        getCurrentTimer,
        claimTimerContinuationUserLock: claimUserLock,
        renewTimerContinuationUserLock: renewUserLock,
        releaseTimerContinuationUserLock: releaseUserLock,
      } as never,
      { activateTimerContinuation: activatePlan } as never
    );
    Object.assign(service, { logger: { error: vi.fn(), warn: vi.fn() } });
    const internals = service as unknown as {
      processJob(target: ReturnType<typeof job>): Promise<void>;
      processJobs(targets: Array<ReturnType<typeof job>>): Promise<void>;
    };
    return {
      service,
      storePlan,
      upgradePlan,
      renewLease,
      markProcessed,
      release,
      getPreferences,
      applyPlan,
      getCurrentTimer,
      claimUserLock,
      renewUserLock,
      releaseUserLock,
      activatePlan,
      processJob: internals.processJob.bind(service),
      processJobs: internals.processJobs.bind(service),
    };
  }

  function job() {
    return jobFor('timer-1', 'claim-1');
  }

  function jobFor(timerId: string, claimToken: string) {
    const timer: Timer = {
      id: timerId,
      scheduleRevision: 'source-revision',
      userId: 'user-1',
      startTime: 1_000,
      duration: 60_000,
      remainingTime: 0,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.COMPLETED,
      sessionPosition: 1,
      sessionTotal: 4,
    };
    return {
      timerId: timer.id,
      userId: timer.userId as string,
      payload: {
        timer,
        completedAt: 61_000,
        isLastWorkTimerInSession: false,
      },
      attempts: 1,
      claimToken,
      plan: null,
      planVersion: null,
    };
  }

  function preferences(): Preferences {
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
    } as Preferences;
  }
});
