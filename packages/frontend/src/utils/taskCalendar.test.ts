import type { Task } from '@pomi/shared';
import { describe, expect, it } from 'vitest';
import type { MixedTaskItem } from './mixedTaskItems';
import {
  addCalendarPeriod,
  countCalendarEntriesByDate,
  filterCalendarEntries,
  getCalendarGridDates,
  getCalendarRange,
  parseLocalDateKey,
} from './taskCalendar';

function taskEntry(
  id: string,
  dueDate: string | null
): Extract<MixedTaskItem, { kind: 'task' }> {
  return {
    kind: 'task',
    task: {
      id,
      dueDate,
      priority: 'normal',
    } as Task,
  };
}

describe('Task calendar dates', () => {
  it('builds local Monday-first week and padded month ranges', () => {
    expect(getCalendarRange('week', '2026-08-12')).toEqual({
      start: '2026-08-10',
      end: '2026-08-16',
    });
    expect(getCalendarRange('month', '2026-08-12')).toEqual({
      start: '2026-08-01',
      end: '2026-08-31',
    });
    const month = getCalendarGridDates('month', '2026-08-12');
    expect(month).toHaveLength(42);
    expect(month[0]).toBe('2026-07-27');
    expect(month[41]).toBe('2026-09-06');
  });

  it('moves each scale without UTC date drift', () => {
    expect(addCalendarPeriod('day', '2026-02-28', 1)).toBe('2026-03-01');
    expect(addCalendarPeriod('week', '2026-12-28', 1)).toBe('2027-01-04');
    expect(addCalendarPeriod('month', '2026-01-31', 1)).toBe('2026-02-01');
    expect(addCalendarPeriod('year', '2024-02-29', 1)).toBe('2025-02-01');
    expect(parseLocalDateKey('2026-02-30')).toBeNull();
  });

  it('keeps dated and undated selections separate after other filters', () => {
    const entries = [
      taskEntry('today-1', '2026-08-12'),
      taskEntry('today-2', '2026-08-12'),
      taskEntry('later', '2026-08-13'),
      taskEntry('undated', null),
    ];
    expect(filterCalendarEntries(entries, '2026-08-12')).toHaveLength(2);
    expect(
      filterCalendarEntries(entries, null).map(entry =>
        entry.kind === 'task' ? entry.task.id : entry.item.id
      )
    ).toEqual(['undated']);
    expect(countCalendarEntriesByDate(entries)).toEqual(
      new Map([
        ['2026-08-12', 2],
        ['2026-08-13', 1],
      ])
    );
  });
});
