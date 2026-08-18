import type { Preferences, Task, Timer } from '@pomi/shared';
import { getNextTimerType } from '@pomi/shared/src/utils/timerUtils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAdvancedSkipElapsedMs,
  getAdvancedSkipFullMs,
  getAdvancedSkipSourceLabel,
  getAdvancedSkipTargetLabel,
  shouldOpenAdvancedSkipModal,
} from './advancedSkip';
import {
  getBreakIntentionQueryTypes,
  shouldMixBreakIntentionTypes,
  sortMixedBreakIntentionsByTypeAndCount,
} from './breakIntentionPreview';
import { orderIntentionsForHabits } from './habits';
import { shouldShowIntentionsPicker } from './intentionsPickerVisibility';
import { getDisplayedSessionPosition } from './sessionDisplay';
import {
  formatCompactTaskRecurrence,
  formatTaskRecurrence,
  isTaskOverdue,
} from './taskUi';
import {
  applyIntentionFamilyManualOrder,
  applyUndatedManualOverrides,
  buildTaskView,
  getDisplayedTaskMode,
  sortTasksForGeneralView,
} from './taskView';
import {
  getAdditionalSelectedIntentionsCount,
  getSelectedExtensionIntentions,
  getSelectedTimerIntentions,
} from './timerIntentions';
import { formatTime, formatTimeWithUnit } from './timeUtils';

function timer(overrides: Partial<Timer>): Timer {
  return {
    id: 'timer',
    userId: 'user',
    type: 'work',
    status: 'paused',
    duration: 60_000,
    remainingTime: 60_000,
    startTime: 1_000,
    intention: undefined,
    intentionSlugs: [],
    subIntentions: {},
    isExtension: false,
    ...overrides,
  } as Timer;
}

function task(id: string, overrides: Partial<Task>): Task {
  return {
    id,
    userId: 'user',
    title: id,
    description: null,
    sourceTranscript: null,
    creationSource: 'manual',
    importSource: null,
    importSourceTaskId: null,
    dueDate: null,
    dueTime: null,
    manualOrder: null,
    manualOrderOverride: false,
    priority: 'normal',
    status: 'active',
    timerType: 'work',
    pinnedAt: null,
    intentionSlug: null,
    subIntentionSlug: null,
    recurrenceRule: null,
    recurrenceInterval: null,
    recurrenceAnchorMode: 'planned',
    followUpTaskId: null,
    followUpDelayDays: null,
    followUpSourceTaskId: null,
    createdAt: `2026-07-26T00:00:0${id.length}.000Z`,
    updatedAt: '2026-07-26T00:00:00.000Z',
    ...overrides,
    itemKind: 'task',
    vacationEligible: overrides.vacationEligible ?? false,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Timer and Session rules', () => {
  it('selects the next Timer type from every lifecycle state', () => {
    expect(getNextTimerType(null)).toBe('work');
    expect(
      getNextTimerType(timer({ type: 'longBreak', status: 'completed' }))
    ).toBe('work');
    expect(getNextTimerType(timer({ type: 'break', status: 'paused' }))).toBe(
      'break'
    );
    expect(
      getNextTimerType(timer({ type: 'longBreak', status: 'running' }))
    ).toBe('work');
  });

  it('formats timer values across minute, hour, and day boundaries', () => {
    expect(formatTime(61_999)).toBe('1:01');
    expect(formatTimeWithUnit(59_000)).toBe('0m 59s');
    expect(formatTimeWithUnit(3_661_000)).toBe('1h 1m');
    expect(formatTimeWithUnit(90_000_000)).toBe('1d 1h');
    expect(formatTimeWithUnit(100 * 86_400_000)).toBe('100d');
  });

  it('calculates bounded advanced-skip duration for normal and extension timers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(31_000);
    const running = timer({ status: 'running', startTime: 1_000 });
    const extension = timer({
      isExtension: true,
      extensionBaseDuration: 120_000,
      duration: 60_000,
      remainingTime: 30_000,
    });

    expect(getAdvancedSkipFullMs(running)).toBe(60_000);
    expect(getAdvancedSkipElapsedMs(running)).toBe(30_000);
    expect(getAdvancedSkipFullMs(extension)).toBe(180_000);
    expect(getAdvancedSkipElapsedMs(extension)).toBe(150_000);
    expect(getAdvancedSkipSourceLabel(extension)).toBe('extension timer');
    expect(getAdvancedSkipTargetLabel(extension)).toBe('Break');
  });

  it('opens advanced skip only for enabled, started, incomplete timers', () => {
    const preferences = { advancedSkip: true } as Preferences;

    expect(shouldOpenAdvancedSkipModal(null, preferences)).toBe(false);
    expect(
      shouldOpenAdvancedSkipModal(timer({ status: 'completed' }), preferences)
    ).toBe(false);
    expect(
      shouldOpenAdvancedSkipModal(
        timer({ duration: 60_000, remainingTime: 59_000 }),
        preferences
      )
    ).toBe(true);
    expect(shouldOpenAdvancedSkipModal(timer({}), null)).toBe(false);
  });

  it('keeps extension Session position on its originating work slot', () => {
    expect(getDisplayedSessionPosition(timer({ sessionPosition: 3 }))).toBe(3);
    expect(
      getDisplayedSessionPosition(
        timer({ isExtension: true, sessionPosition: 3 })
      )
    ).toBe(2);
    expect(
      getDisplayedSessionPosition(
        timer({ isExtension: true, sessionPosition: 1 })
      )
    ).toBe(1);
  });
});

describe('Intention selection rules', () => {
  it('deduplicates selected Timer and extension Intentions', () => {
    expect(
      getSelectedTimerIntentions({
        intention: 'deep-work',
        intentionSlugs: ['deep-work', 'admin', 'deep-work'],
      })
    ).toEqual(['deep-work', 'admin']);
    expect(
      getSelectedExtensionIntentions({
        intention: 'deep-work',
        intentionSlugs: undefined,
      })
    ).toEqual(['deep-work']);
    expect(
      getAdditionalSelectedIntentionsCount({
        intention: 'deep-work',
        intentionSlugs: ['deep-work', 'admin', 'email'],
      })
    ).toBe(2);
  });

  it('shows picker for supported Timer/preference combinations', () => {
    const preferences = {
      intentionExtension: true,
      intentionBreakIntentions: false,
    } as Preferences;

    expect(shouldShowIntentionsPicker({ preferences, timer: timer({}) })).toBe(
      true
    );
    expect(
      shouldShowIntentionsPicker({
        preferences,
        timer: timer({ type: 'break' }),
      })
    ).toBe(false);
    expect(
      shouldShowIntentionsPicker({
        preferences,
        timer: timer({ type: 'break', status: 'completed' }),
      })
    ).toBe(true);
    expect(
      shouldShowIntentionsPicker({
        preferences: null,
        timer: timer({ type: 'longBreak' }),
      })
    ).toBeFalsy();
  });

  it('puts pending Habits first without reordering peers', () => {
    const values = [
      { id: 'done', state: 'done' as const },
      { id: 'plain', state: null },
      { id: 'pending-a', state: 'pending' as const },
      { id: 'pending-b', state: 'pending' as const },
    ];

    expect(orderIntentionsForHabits(values, value => value.state)).toEqual([
      values[2],
      values[3],
      values[0],
      values[1],
    ]);
  });

  it('mixes Long-break and Break Intentions deterministically', () => {
    const intentions = [
      { slug: 'b', title: 'Break B', sourceType: 'break' as const },
      { slug: 'l', title: 'Long', sourceType: 'longBreak' as const },
      { slug: 'a', title: 'Break A', sourceType: 'break' as const },
    ];
    const counts: Record<string, number> = { b: 2, l: 1, a: 2 };

    expect(shouldMixBreakIntentionTypes('longBreak', true)).toBe(true);
    expect(getBreakIntentionQueryTypes('longBreak', true)).toEqual([
      'break',
      'longBreak',
    ]);
    expect(
      sortMixedBreakIntentionsByTypeAndCount(
        intentions,
        intention => counts[intention.slug]
      ).map(intention => intention.slug)
    ).toEqual(['l', 'a', 'b']);
  });
});

describe('Task recurrence and due boundaries', () => {
  it('formats supported and unknown recurrence rules', () => {
    expect(formatTaskRecurrence('FREQ=DAILY', 'planned')).toBe(
      'repeats every 1 day from due'
    );
    expect(formatTaskRecurrence('FREQ=WEEKLY;INTERVAL=2', 'completion')).toBe(
      'repeats every 2 weeks after done'
    );
    expect(formatTaskRecurrence('FREQ=MONTHLY', 'planned', 3)).toBe(
      'repeats every 3 months from due'
    );
    expect(formatTaskRecurrence('FREQ=YEARLY', 'planned')).toBe(
      'repeats from due'
    );
    expect(formatCompactTaskRecurrence('FREQ=WEEKLY;INTERVAL=2')).toBe(
      '2 weeks'
    );
    expect(formatCompactTaskRecurrence(null)).toBeNull();
  });

  it('normalizes recurrence intervals and compact labels', () => {
    expect(formatTaskRecurrence('FREQ=DAILY;INTERVAL=0', 'planned')).toBe(
      'repeats every 1 day from due'
    );
    expect(formatTaskRecurrence('FREQ=MONTHLY', 'completion', Number.NaN)).toBe(
      'repeats every 1 month after done'
    );
    expect(formatCompactTaskRecurrence('FREQ=DAILY')).toBe('day');
    expect(formatCompactTaskRecurrence('FREQ=MONTHLY', 3)).toBe('3 months');
    expect(formatCompactTaskRecurrence('FREQ=WEEKLY', 0)).toBe('week');
    expect(formatCompactTaskRecurrence('FREQ=YEARLY')).toBe('repeats');
  });

  it('treats timed Tasks as overdue immediately and date-only Tasks after day end', () => {
    const dateOnly = { dueDate: '2026-07-26', dueTime: null } as Task;
    const timed = { dueDate: '2026-07-26', dueTime: '10:00' } as Task;

    expect(isTaskOverdue(dateOnly, new Date(2026, 6, 26, 23, 59))).toBe(false);
    expect(isTaskOverdue(dateOnly, new Date(2026, 6, 27, 0, 0, 1))).toBe(true);
    expect(isTaskOverdue(timed, new Date(2026, 6, 26, 10, 0, 1))).toBe(true);
    expect(isTaskOverdue({ dueDate: null, dueTime: null } as Task)).toBe(false);
    expect(
      isTaskOverdue(
        { dueDate: 'invalid', dueTime: null } as Task,
        new Date(2026, 6, 27)
      )
    ).toBe(false);
  });
});

describe('Task ordering rules', () => {
  it('shows All tasks when minimized mode has no current Timer Intention', () => {
    expect(getDisplayedTaskMode('intention', false)).toBe('general');
    expect(getDisplayedTaskMode('intention', true)).toBe('intention');
    expect(getDisplayedTaskMode('general', false)).toBe('general');
  });

  it('applies bounded manual positions while leaving pinned tasks automatic', () => {
    const automaticA = task('automatic-a', {});
    const automaticB = task('automatic-b', {});
    const pinned = task('pinned', {
      pinnedAt: '2026-07-26T00:00:00.000Z',
      manualOrder: 0,
      manualOrderOverride: true,
    });
    const beforeStart = task('before-start', {
      manualOrder: -10,
      manualOrderOverride: true,
    });
    const afterEnd = task('after-end', {
      manualOrder: 99,
      manualOrderOverride: true,
    });

    expect(
      applyUndatedManualOverrides([
        automaticA,
        pinned,
        automaticB,
        afterEnd,
        beforeStart,
      ]).map(value => value.id)
    ).toEqual([
      'before-start',
      'automatic-a',
      'pinned',
      'automatic-b',
      'after-end',
    ]);
    expect(applyUndatedManualOverrides([])).toEqual([]);
  });

  it('reorders only unpinned members of the same Intention family', () => {
    const familyA = task('family-a', {
      intentionSlug: 'deep-work',
      manualOrder: 1,
      manualOrderOverride: true,
    });
    const otherType = task('break-family', {
      timerType: 'break',
      intentionSlug: 'deep-work',
      manualOrder: 0,
      manualOrderOverride: true,
    });
    const familyB = task('family-b', { intentionSlug: 'deep-work' });
    const unlinked = task('unlinked', {
      manualOrder: 0,
      manualOrderOverride: true,
    });
    const pinned = task('pinned-family', {
      intentionSlug: 'deep-work',
      pinnedAt: '2026-07-26T00:00:00.000Z',
      manualOrder: 0,
      manualOrderOverride: true,
    });

    expect(
      applyIntentionFamilyManualOrder([
        familyA,
        otherType,
        familyB,
        unlinked,
        pinned,
      ]).map(value => value.id)
    ).toEqual([
      'family-b',
      'break-family',
      'family-a',
      'unlinked',
      'pinned-family',
    ]);
  });

  it('orders the general view by pin, overdue state, due date, time, and priority', () => {
    const tasks = [
      task('undated-low', { priority: 'low' }),
      task('future-late', {
        dueDate: '2026-07-27',
        dueTime: null,
        priority: 'urgent',
      }),
      task('future-early', {
        dueDate: '2026-07-27',
        dueTime: '08:00',
        priority: 'low',
      }),
      task('future-same-newer', {
        dueDate: '2026-07-28',
        dueTime: '09:00',
        createdAt: '2026-07-26T10:00:00.000Z',
      }),
      task('future-same-older', {
        dueDate: '2026-07-28',
        dueTime: '09:00',
        createdAt: '2026-07-26T09:00:00.000Z',
      }),
      task('overdue-high', {
        dueDate: '2026-07-25',
        priority: 'high',
      }),
      task('overdue-urgent', {
        dueDate: '2026-07-24',
        priority: 'urgent',
      }),
      task('pinned-later', { pinnedAt: '2026-07-26T09:00:00.000Z' }),
      task('pinned-first', { pinnedAt: '2026-07-26T08:00:00.000Z' }),
    ];

    const expectedOrder = [
      'pinned-first',
      'pinned-later',
      'overdue-urgent',
      'overdue-high',
      'future-early',
      'future-late',
      'future-same-older',
      'future-same-newer',
      'undated-low',
    ];

    expect(
      buildTaskView({
        tasks,
        mode: 'general',
        filterTimerType: false,
        hideVacationCovered: false,
        today: '2026-07-26',
        currentTime: '12:00',
      }).tasks.map(value => value.id)
    ).toEqual(expectedOrder);
    expect(
      sortTasksForGeneralView(tasks, '2026-07-26', '12:00').map(
        value => value.id
      )
    ).toEqual(expectedOrder);
  });

  it('filters Intention mode by Timer family and keeps a general preview', () => {
    const activeTimer = timer({
      type: 'work',
      intention: 'deep-work',
      intentionSlugs: ['deep-work'],
      subIntention: 'coding',
      subIntentions: { 'deep-work': 'coding' },
    });
    const tasks = [
      task('matching-parent', { intentionSlug: 'deep-work' }),
      task('matching-sub', {
        intentionSlug: 'deep-work',
        subIntentionSlug: 'coding',
      }),
      task('other-sub', {
        intentionSlug: 'deep-work',
        subIntentionSlug: 'review',
      }),
      task('other-intention', { intentionSlug: 'admin' }),
      task('unlinked', {}),
      task('pinned-other', {
        intentionSlug: 'admin',
        pinnedAt: '2026-07-26T00:00:00.000Z',
      }),
      task('break-task', { timerType: 'break', intentionSlug: 'rest' }),
    ];

    const view = buildTaskView({
      tasks,
      timer: activeTimer,
      mode: 'intention',
      today: '2026-07-26',
      currentTime: '12:00',
      filterTimerType: true,
      hideVacationCovered: false,
    });

    expect(view.tasks.map(value => value.id)).toEqual([
      'pinned-other',
      'matching-parent',
      'matching-sub',
      'unlinked',
    ]);
    expect(view.generalPreviewTasks.map(value => value.id)).toEqual([
      'other-sub',
      'other-intention',
    ]);
  });

  it('hides Vacation-covered Tasks while active filtering is enabled', () => {
    const view = buildTaskView({
      tasks: [
        task('visible', { vacationEligible: false }),
        task('covered', { vacationEligible: true }),
      ],
      mode: 'general',
      filterTimerType: false,
      today: '2026-07-26',
      currentTime: '12:00',
      hideVacationCovered: true,
    });

    expect(view.tasks.map(value => value.id)).toEqual(['visible']);
  });

  it('falls back to general ordering without selected Timer Intentions', () => {
    const values = [
      task('break', { timerType: 'break' }),
      task('work', { timerType: 'work' }),
    ];
    const view = buildTaskView({
      tasks: values,
      timer: timer({ type: 'break', intention: undefined, intentionSlugs: [] }),
      mode: 'intention',
      today: '2026-07-26',
      currentTime: '12:00',
      filterTimerType: true,
      hideVacationCovered: false,
    });

    expect(view.tasks.map(value => value.id)).toEqual(['break']);
    expect(view.generalPreviewTasks).toEqual([]);
  });

  it('supports legacy single-Intention Timers and cross-type previews', () => {
    const view = buildTaskView({
      tasks: [
        task('matching', { intentionSlug: 'deep-work' }),
        task('other-work', { intentionSlug: 'admin' }),
        task('other-type', {
          timerType: 'break',
          intentionSlug: 'deep-work',
        }),
      ],
      timer: timer({
        intention: 'deep-work',
        intentionSlugs: undefined,
        subIntention: undefined,
        subIntentions: undefined,
      }),
      mode: 'intention',
      filterTimerType: false,
      hideVacationCovered: false,
      today: '2026-07-26',
      currentTime: '12:00',
    });

    expect(view.tasks.map(value => value.id)).toEqual(['matching']);
    expect(view.generalPreviewTasks.map(value => value.id)).toEqual([
      'other-work',
      'other-type',
    ]);
  });

  it('moves timed Tasks into priority ordering after their due minute', () => {
    const alreadyOverdue = task('already-overdue', {
      dueDate: '2026-07-26',
      dueTime: '11:00',
      priority: 'low',
    });
    const dueAtBoundary = task('due-at-boundary', {
      dueDate: '2026-07-26',
      dueTime: '12:00',
      priority: 'urgent',
    });

    expect(
      sortTasksForGeneralView(
        [alreadyOverdue, dueAtBoundary],
        '2026-07-26',
        '11:59'
      ).map(value => value.id)
    ).toEqual(['already-overdue', 'due-at-boundary']);
    expect(
      sortTasksForGeneralView(
        [alreadyOverdue, dueAtBoundary],
        '2026-07-26',
        '12:01'
      ).map(value => value.id)
    ).toEqual(['due-at-boundary', 'already-overdue']);
  });

  it('moves date-only Tasks into priority ordering after local midnight', () => {
    const alreadyOverdue = task('already-overdue', {
      dueDate: '2026-07-25',
      priority: 'low',
    });
    const dueAtBoundary = task('due-at-boundary', {
      dueDate: '2026-07-26',
      priority: 'urgent',
    });

    expect(
      sortTasksForGeneralView(
        [alreadyOverdue, dueAtBoundary],
        '2026-07-26',
        '23:59'
      ).map(value => value.id)
    ).toEqual(['already-overdue', 'due-at-boundary']);
    expect(
      sortTasksForGeneralView(
        [alreadyOverdue, dueAtBoundary],
        '2026-07-27',
        '00:01'
      ).map(value => value.id)
    ).toEqual(['due-at-boundary', 'already-overdue']);
  });
});
