import type { Task } from '@pomi/shared';
import { describe, expect, it } from 'vitest';
import { getPinShortcutTask, searchMinimizedTasks } from './MinimizedTaskView';

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    userId: 'user-1',
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
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    itemKind: 'task',
    vacationEligible: false,
    ...overrides,
  };
}

describe('Minimized task search', () => {
  it('searches every Task Timer type and ranks the current type first', () => {
    const results = searchMinimizedTasks(
      [
        task('break-match', {
          title: 'Review break plan',
          timerType: 'break',
          intentionSlug: 'focus',
        }),
        task('work-match', {
          title: 'Review work plan',
          intentionSlug: 'focus',
        }),
        task('long-break-match', {
          title: 'Review long-break plan',
          timerType: 'longBreak',
          intentionSlug: 'focus',
        }),
      ],
      'review',
      { type: 'work', intention: 'focus', intentionSlugs: ['focus'] },
      false
    );

    expect(results.map(value => value.id)).toEqual([
      'work-match',
      'break-match',
      'long-break-match',
    ]);
  });

  it('keeps covered Tasks out of search when Vacation filtering is active', () => {
    const results = searchMinimizedTasks(
      [
        task('visible', { title: 'Review visible plan' }),
        task('covered', {
          title: 'Review covered plan',
          vacationEligible: true,
        }),
      ],
      'review',
      null,
      true
    );

    expect(results.map(value => value.id)).toEqual(['visible']);
  });

  it('does not expose contextual follow-ups through pin shortcuts', () => {
    const parent = task('parent');
    const followUp = task('follow-up', {
      followUpSourceTaskId: parent.id,
      followUpParent: { id: parent.id, title: parent.title },
    });

    expect(getPinShortcutTask([followUp, parent], 'Digit1')).toBeNull();
    expect(getPinShortcutTask([followUp, parent], 'Digit2')).toBe(parent);
  });
});
