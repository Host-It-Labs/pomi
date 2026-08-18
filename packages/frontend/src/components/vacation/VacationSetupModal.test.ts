import { describe, expect, it } from 'vitest';
import type { Task } from '@pomi/shared';
import {
  getGroupSelectionState,
  getInitialVacationExclusions,
  partitionRecurringTasks,
  removeFromSet,
  selectOnlyRecurringTasks,
} from './VacationSetupModal';

describe('vacation coverage selection', () => {
  it('clears item exclusions when a group is reselected', () => {
    const current = new Set(['task-1', 'task-2', 'unrelated']);

    const next = removeFromSet(current, ['task-1', 'task-2']);

    expect([...next]).toEqual(['unrelated']);
    expect([...current]).toEqual(['task-1', 'task-2', 'unrelated']);
  });

  it('selects recurring Tasks and excludes non-recurring Tasks', () => {
    const tasks = [task('recurring', 'FREQ=WEEKLY'), task('one-off', null)];

    const excluded = selectOnlyRecurringTasks(new Set(['unrelated']), tasks);

    expect([...excluded]).toEqual(['unrelated', 'one-off']);
  });

  it('partitions recurring Tasks before one-off Tasks', () => {
    const recurring = task('recurring', 'FREQ=DAILY');
    const oneOff = task('one-off', null);

    expect(partitionRecurringTasks([oneOff, recurring])).toEqual({
      recurring: [recurring],
      nonRecurring: [oneOff],
    });
  });

  it('derives partial groups from item-level Vacation Coverage overrides', () => {
    const items = [task('included', null), task('excluded', null)];
    items[0].vacationEligible = true;
    items[1].vacationEligible = false;
    expect(getGroupSelectionState(items, new Set(['excluded']))).toEqual({
      checked: false,
      indeterminate: true,
    });
  });

  it('restores an explicitly configured all-excluded state', () => {
    const items = [task('one', null), task('two', null)];
    items.forEach(item => {
      item.vacationEligible = false;
    });

    expect(getInitialVacationExclusions(items, true)).toEqual(
      new Set(['one', 'two'])
    );
    expect(getInitialVacationExclusions(items, false)).toEqual(new Set());
  });
});

function task(id: string, recurrenceRule: string | null) {
  return { id, recurrenceRule } as Task;
}
