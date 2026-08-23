import type { ListItem, Task } from '@pomi/shared';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_TASK_PROPERTY_FILTERS,
  hasTaskPropertyFilters,
  matchesListItemPropertyFilters,
  matchesTaskPropertyFilters,
} from './TaskPropertyFilterMenu';

describe('Task property filters', () => {
  const datedRecurring = {
    dueDate: '2026-08-12',
    recurrenceRule: 'FREQ=WEEKLY',
    pinnedAt: '2026-08-11T10:00:00Z',
    priority: 'high',
    timerType: 'work',
  } as Task;
  const undated = {
    dueDate: null,
    recurrenceRule: null,
    pinnedAt: null,
    priority: 'normal',
    timerType: 'work',
  } as Task;

  it('combines due-date, recurrence, pin, and priority filters', () => {
    const filters = {
      dueDate: 'yes' as const,
      recurrence: 'yes' as const,
      pinned: 'yes' as const,
      priorities: ['high' as const],
      timerTypes: ['work' as const, 'break' as const],
    };

    expect(matchesTaskPropertyFilters(datedRecurring, filters)).toBe(true);
    expect(matchesTaskPropertyFilters(undated, filters)).toBe(false);
    expect(hasTaskPropertyFilters(filters)).toBe(true);
  });

  it('supports negative filters and treats List items as non-recurring and unpinned', () => {
    const filters = {
      dueDate: 'no' as const,
      recurrence: 'no' as const,
      pinned: 'no' as const,
      priorities: ['normal' as const],
      timerTypes: ['work' as const],
    };
    const item = { dueDate: null, priority: 'normal' } as ListItem;

    expect(matchesTaskPropertyFilters(undated, filters)).toBe(true);
    expect(matchesListItemPropertyFilters(item, filters)).toBe(true);
    expect(
      matchesListItemPropertyFilters(item, EMPTY_TASK_PROPERTY_FILTERS)
    ).toBe(true);
  });
});
