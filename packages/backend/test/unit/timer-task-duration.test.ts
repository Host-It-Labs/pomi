import { TIMER_STATUSES, TIMER_TYPES, type Timer } from '@pomi/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimerService } from '../../src/timer/timer.service';

const WORK_DURATION = 25 * 60_000;
const INTENTION_DURATION = 10 * 60_000;
const TASK_DURATION = 30 * 60_000;

function timer(overrides: Partial<Timer> = {}): Timer {
  return {
    id: 'timer-1',
    scheduleRevision: 'revision-1',
    userId: 'user-1',
    startTime: 1_000,
    duration: WORK_DURATION,
    type: TIMER_TYPES.WORK,
    status: TIMER_STATUSES.PAUSED,
    remainingTime: WORK_DURATION,
    ...overrides,
  };
}

function createService(
  existingTimer: Timer | null,
  intentionDuration?: number,
  preferenceOverrides: Record<string, unknown> = {}
) {
  const committedTimers: Timer[] = [];
  const preferences = {
    intentionBreakIntentions: true,
    intentionShowBreakIntentionsInLongBreak: false,
    intentionMultiSelect: false,
    intentionCustomDurations: intentionDuration !== undefined,
    intentionExtension: false,
    intentionRequireSelection: false,
    sessionsExtension: false,
    workTimerDuration: WORK_DURATION,
    breakTimerDuration: 5 * 60_000,
    sessionLongBreakDuration: 15 * 60_000,
    resetBreakOnFirstIntention: false,
    resetLongBreakOnFirstIntention: false,
    ...preferenceOverrides,
  };
  const service = Object.assign(Object.create(TimerService.prototype), {
    timerStore: {
      getCurrentTimer: vi.fn(async () => existingTimer),
      getSessionState: vi.fn(async () => null),
    },
    preferencesService: {
      getPreferences: vi.fn(async () => preferences),
    },
    intentionsService: {},
    usersService: {
      associateTimerWithUser: vi.fn(async () => undefined),
    },
    timerEvents: {
      emitTimerUpdate: vi.fn(),
      emitExtensionStateUpdate: vi.fn(),
    },
    snapshotRuntime: vi.fn(async () => null),
    resolveIntentionSelection: vi.fn(async () => ({
      intentionData: {},
      subIntentions: {},
      primaryIntention: 'focus',
      primaryTitle: 'Focus',
      primaryEmoji: '🎯',
      intentionEmojis: { focus: '🎯' },
      subIntentionEmojis: {},
      customDuration: intentionDuration,
      customDurationSource:
        intentionDuration === undefined ? undefined : ('parent' as const),
    })),
    commitCurrentTimer: vi.fn(async (_userId, _expected, nextTimer) => {
      committedTimers.push(nextTimer);
      return nextTimer;
    }),
    applyCommittedTimerTransition: vi.fn(async () => undefined),
  }) as TimerService;

  return { service, committedTimers };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Task-specific Timer durations', () => {
  it('lets a focused Task override Intention and global duration on a fresh Timer', async () => {
    const { service, committedTimers } = createService(
      null,
      INTENTION_DURATION
    );

    const result = await service.createOrResumeTimer('user-1', {
      type: TIMER_TYPES.WORK,
      intention: 'focus',
      intentions: ['focus'],
      focusedTaskId: 'task-1',
      customDuration: TASK_DURATION,
    });

    expect(result).toMatchObject({
      duration: TASK_DURATION,
      remainingTime: TASK_DURATION,
      focusedTaskIds: ['task-1'],
    });
    expect(committedTimers[0]).toMatchObject({
      duration: TASK_DURATION,
      remainingTime: TASK_DURATION,
    });
  });

  it('uses the existing Intention or global fallback when a focused Task has no duration', async () => {
    const withIntention = createService(null, INTENTION_DURATION);
    const intentionResult = await withIntention.service.createOrResumeTimer(
      'user-1',
      {
        type: TIMER_TYPES.WORK,
        intention: 'focus',
        intentions: ['focus'],
        focusedTaskId: 'task-without-duration',
      }
    );
    expect(intentionResult.duration).toBe(INTENTION_DURATION);

    const withoutIntention = createService(null);
    const globalResult = await withoutIntention.service.createOrResumeTimer(
      'user-1',
      {
        type: TIMER_TYPES.WORK,
        intention: 'focus',
        intentions: ['focus'],
        focusedTaskId: 'task-without-duration',
      }
    );
    expect(globalResult.duration).toBe(WORK_DURATION);
  });

  it.each([
    { status: TIMER_STATUSES.RUNNING, remainingTime: WORK_DURATION - 600_000 },
    { status: TIMER_STATUSES.PAUSED, remainingTime: WORK_DURATION - 600_000 },
  ])(
    'preserves duration and elapsed time when pinning into an already started $status Timer',
    async ({ status, remainingTime }) => {
      vi.useFakeTimers();
      vi.setSystemTime(601_000);
      const existing = timer({
        status,
        startTime: 1_000,
        remainingTime,
      });
      const { service, committedTimers } = createService(existing);

      const result = await service.createOrResumeTimer('user-1', {
        type: TIMER_TYPES.WORK,
        intention: 'focus',
        intentions: ['focus'],
        focusedTaskId: 'task-1',
        customDuration: TASK_DURATION,
      });

      expect(result.duration).toBe(WORK_DURATION);
      expect(result.remainingTime).toBe(WORK_DURATION - 600_000);
      expect(committedTimers[0]).toMatchObject({
        duration: WORK_DURATION,
        remainingTime: WORK_DURATION - 600_000,
      });
    }
  );

  it('applies a focused Task duration to a paused Timer that has not started', async () => {
    const existing = timer();
    const { service } = createService(existing);

    const result = await service.createOrResumeTimer('user-1', {
      type: TIMER_TYPES.WORK,
      intention: 'focus',
      intentions: ['focus'],
      focusedTaskId: 'task-1',
      customDuration: TASK_DURATION,
    });

    expect(result.status).toBe(TIMER_STATUSES.RUNNING);
    expect(result.duration).toBe(TASK_DURATION);
    expect(result.remainingTime).toBe(TASK_DURATION);
  });

  it.each([TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK])(
    'applies a focused Task duration when resetting an auto-started %s',
    async type => {
      vi.useFakeTimers();
      vi.setSystemTime(601_000);
      const existing = timer({
        type,
        status: TIMER_STATUSES.RUNNING,
        startTime: 1_000,
        duration: 300_000,
        remainingTime: 240_000,
        isAutoStarted: true,
      });
      const { service } = createService(existing, INTENTION_DURATION, {
        resetBreakOnFirstIntention: true,
        resetLongBreakOnFirstIntention: true,
        intentionShowBreakIntentionsInLongBreak: true,
      });

      const result = await service.createOrResumeTimer('user-1', {
        type,
        intention: 'focus',
        intentions: ['focus'],
        focusedTaskId: 'task-1',
        customDuration: TASK_DURATION,
        resetOnFirstIntention: true,
      });

      expect(result).toMatchObject({
        duration: TASK_DURATION,
        remainingTime: TASK_DURATION,
        startTime: 601_000,
        focusedTaskIds: ['task-1'],
        hasConsumedFirstIntentionReset: true,
      });
    }
  );
});
