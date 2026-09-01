import { describe, expect, it, vi } from 'vitest';
import { TimerCompletionSchedulerService } from '../../src/timer/timer-completion-scheduler.service';

describe('TimerCompletionSchedulerService', () => {
  it('claims due work with the current leader token', async () => {
    const claimScheduled = vi.fn(async () => ({ kind: 'claimed' }));
    const service = createService({
      claimScheduledTimerCompletion: claimScheduled,
    });
    Object.assign(service, { leaderToken: 'leader-1' });
    const scheduled = {
      member: 'completion:user-1',
      userId: 'user-1',
      deadline: 61_000,
    };

    await internals(service).processScheduledCompletion(scheduled, 'leader-1');

    expect(claimScheduled).toHaveBeenCalledWith(
      'user-1',
      scheduled,
      'leader-1'
    );
  });

  it('stops trusting leadership after a fenced claim rejects it', async () => {
    const service = createService({
      claimScheduledTimerCompletion: vi.fn(async () => ({
        kind: 'lost-leader',
      })),
    });
    Object.assign(service, { leaderToken: 'leader-1' });

    await internals(service).processScheduledCompletion(
      {
        member: 'completion:user-1',
        userId: 'user-1',
        deadline: 61_000,
      },
      'leader-1'
    );

    expect(
      (service as unknown as { leaderToken: string | null }).leaderToken
    ).toBeNull();
  });

  it('removes malformed schedule members only under the leader token', async () => {
    const removeMalformed = vi.fn(async () => true);
    const service = createService({
      removeMalformedTimerCompletion: removeMalformed,
    });

    await internals(service).processScheduledCompletion(
      { member: 'invalid', userId: null, deadline: 61_000 },
      'leader-1'
    );

    expect(removeMalformed).toHaveBeenCalledWith('invalid', 61_000, 'leader-1');
  });

  it('claims due idle detection under the same singleton lease', async () => {
    const claim = vi.fn(async () => ({ kind: 'claimed' }));
    const service = createService({ claimScheduledIdleDetection: claim });
    Object.assign(service, { leaderToken: 'leader-1' });
    const scheduled = {
      member: 'idle:user-1',
      userId: 'user-1',
      deadline: 61_000,
    };

    await internals(service).processScheduledIdleDetection(
      scheduled,
      'leader-1'
    );

    expect(claim).toHaveBeenCalledWith('user-1', scheduled, 'leader-1');
  });

  it('acquires and renews singleton leadership', async () => {
    const claim = vi.fn(async () => 'leader-1');
    const renew = vi.fn(async () => true);
    const service = createService({
      claimTimerCompletionScheduler: claim,
      renewTimerCompletionScheduler: renew,
    });

    await expect(internals(service).ensureLeadership()).resolves.toBe(true);
    await expect(internals(service).ensureLeadership()).resolves.toBe(true);
    expect(claim).toHaveBeenCalledOnce();
    expect(renew).toHaveBeenCalledWith('leader-1', 10_000);
  });

  it('releases a leader lease acquired while shutdown begins', async () => {
    let resolveClaim: (token: string) => void = () => undefined;
    const claim = vi.fn(
      () =>
        new Promise<string>(resolve => {
          resolveClaim = resolve;
        })
    );
    const release = vi.fn(async () => true);
    const service = createService({
      claimTimerCompletionScheduler: claim,
      releaseTimerCompletionScheduler: release,
    });

    const acquiring = internals(service).ensureLeadership();
    await service.onModuleDestroy();
    resolveClaim('leader-after-stop');

    await expect(acquiring).resolves.toBe(false);
    expect(release).toHaveBeenCalledWith('leader-after-stop');
    expect(
      (service as unknown as { leaderToken: string | null }).leaderToken
    ).toBeNull();
  });

  it('wakes an idle scheduler before its bounded fallback timeout', async () => {
    const service = createService();
    const waiting = internals(service).waitForScheduleWake(60_000);

    internals(service).requestScheduleWake();

    await expect(waiting).resolves.toBeUndefined();
  });

  it('reconciles Timer keys before marking the schedule ready', async () => {
    const reconcile = vi.fn(async () => 'scheduled');
    const markReady = vi.fn(async () => true);
    const service = createService({
      isTimerCompletionScheduleReady: vi.fn(async () => false),
      scanCurrentTimerUsers: vi.fn(async () => ({
        cursor: '0',
        userIds: ['user-1', 'user-2'],
      })),
      reconcileTimerCompletionSchedule: reconcile,
      markTimerCompletionScheduleReady: markReady,
    });
    Object.assign(service, { leaderToken: 'leader-1' });

    await expect(internals(service).ensureScheduleReady()).resolves.toBe(true);

    expect(reconcile.mock.calls).toEqual([
      ['user-1', 'leader-1'],
      ['user-2', 'leader-1'],
    ]);
    expect(markReady).toHaveBeenCalledWith('leader-1');
  });

  it('does not mark the schedule ready after quarantining corrupt state', async () => {
    const markReady = vi.fn(async () => true);
    const service = createService({
      isTimerCompletionScheduleReady: vi.fn(async () => false),
      scanCurrentTimerUsers: vi.fn(async () => ({
        cursor: '0',
        userIds: ['user-1', 'user-2'],
      })),
      reconcileTimerCompletionSchedule: vi
        .fn()
        .mockResolvedValueOnce('scheduled')
        .mockResolvedValueOnce('corrupt'),
      markTimerCompletionScheduleReady: markReady,
    });
    Object.assign(service, { leaderToken: 'leader-1' });

    await expect(internals(service).ensureScheduleReady()).resolves.toBe(false);
    expect(markReady).not.toHaveBeenCalled();
  });

  it('reconciles durable idle state before marking it ready', async () => {
    const scheduleIdleDetection = vi.fn(async () => 'scheduled');
    const markIdleReady = vi.fn(async () => true);
    const service = createService({
      scanLastCompletionUsers: vi.fn(async () => ({
        cursor: '0',
        userIds: ['user-1'],
      })),
      scheduleIdleDetection,
      isIdleDetectionScheduleReady: vi.fn(async () => false),
      getIdleDetectionScheduleGeneration: vi.fn(async () => 7),
      markIdleDetectionScheduleReady: markIdleReady,
    });
    Object.assign(service, { leaderToken: 'leader-1' });

    await expect(internals(service).ensureScheduleReady()).resolves.toBe(true);

    expect(scheduleIdleDetection).toHaveBeenCalledWith(
      'user-1',
      {
        longBreakDuration: 900_000,
        workTimerDuration: 1_500_000,
        sessionPomodorosCount: 4,
      },
      'leader-1'
    );
    expect(markIdleReady).toHaveBeenCalledWith('leader-1', 7);
  });

  function createService(overrides: Record<string, unknown>) {
    const service = new TimerCompletionSchedulerService(
      {
        claimTimerCompletionScheduler: vi.fn(async () => 'leader-1'),
        renewTimerCompletionScheduler: vi.fn(async () => true),
        releaseTimerCompletionScheduler: vi.fn(async () => true),
        startTimerScheduleWakeListener: vi.fn(async () => undefined),
        stopTimerScheduleWakeListener: vi.fn(async () => undefined),
        getIdleDetectionMode: vi.fn(async () => 'legacy'),
        getTimerCompletionMode: vi.fn(async () => 'legacy'),
        getNextTimerCompletionDeadline: vi.fn(async () => null),
        getNextIdleDetectionDeadline: vi.fn(async () => null),
        claimScheduledTimerCompletion: vi.fn(async () => ({ kind: 'claimed' })),
        removeMalformedTimerCompletion: vi.fn(async () => true),
        isTimerCompletionScheduleReady: vi.fn(async () => true),
        scanCurrentTimerUsers: vi.fn(async () => ({
          cursor: '0',
          userIds: [],
        })),
        reconcileTimerCompletionSchedule: vi.fn(async () => 'scheduled'),
        markTimerCompletionScheduleReady: vi.fn(async () => true),
        isIdleDetectionScheduleReady: vi.fn(async () => true),
        getIdleDetectionScheduleGeneration: vi.fn(async () => 0),
        scanLastCompletionUsers: vi.fn(async () => ({
          cursor: '0',
          userIds: [],
        })),
        markIdleDetectionScheduleReady: vi.fn(async () => true),
        claimScheduledIdleDetection: vi.fn(async () => ({ kind: 'claimed' })),
        removeMalformedIdleDetection: vi.fn(async () => true),
        scheduleIdleDetection: vi.fn(async () => 'scheduled'),
        cancelIdleDetectionSchedule: vi.fn(async () => true),
        ...overrides,
      } as never,
      {
        getPreferences: vi.fn(async () => ({
          sessionAutoDetectLongBreak: true,
          sessionsExtension: true,
          sessionHasLongBreak: true,
          sessionLongBreakDuration: 900_000,
          workTimerDuration: 1_500_000,
          sessionPomodorosCount: 4,
        })),
      } as never
    );
    Object.assign(service, { logger: { error: vi.fn(), warn: vi.fn() } });
    return service;
  }

  function internals(service: TimerCompletionSchedulerService) {
    return service as unknown as {
      ensureLeadership(): Promise<boolean>;
      ensureScheduleReady(): Promise<boolean>;
      processScheduledCompletion(
        scheduled: {
          member: string;
          userId: string | null;
          deadline: number;
        },
        leaderToken: string
      ): Promise<void>;
      processScheduledIdleDetection(
        scheduled: {
          member: string;
          userId: string | null;
          deadline: number;
        },
        leaderToken: string
      ): Promise<void>;
      waitForScheduleWake(delayMs: number): Promise<void>;
      requestScheduleWake(): void;
    };
  }
});
