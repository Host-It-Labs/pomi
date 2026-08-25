import type { Task } from '@pomi/shared';
import { describe, expect, it } from 'vitest';
import type { MixedTaskItem } from './mixedTaskItems';
import {
  addCalendarWeek,
  countCalendarEntriesByDate,
  filterCalendarEntries,
  getCalendarWeekDates,
  getCalendarWeekRange,
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
  it('builds a local Monday-first week', () => {
    expect(getCalendarWeekRange('2026-08-12')).toEqual({
      start: '2026-08-10',
      end: '2026-08-16',
    });
    expect(getCalendarWeekDates('2026-08-12')).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
    ]);
  });

  it('moves by whole weeks without UTC date drift', () => {
    expect(addCalendarWeek('2026-12-28', 1)).toBe('2027-01-04');
    expect(addCalendarWeek('2026-12-28', -1)).toBe('2026-12-21');
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
