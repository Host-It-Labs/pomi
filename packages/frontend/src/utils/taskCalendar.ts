import type { MixedTaskItem } from './mixedTaskItems';

export type TaskCalendarScale = 'day' | 'week' | 'month' | 'year';

export type CalendarRange = {
  start: string;
  end: string;
};

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getTodayDateKey() {
  return formatLocalDateKey(new Date());
}

export function parseLocalDateKey(value: string) {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12
  );
  return formatLocalDateKey(date) === value ? date : null;
}

function requireDate(value: string) {
  return parseLocalDateKey(value) ?? parseLocalDateKey(getTodayDateKey())!;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

export function getCalendarRange(
  scale: TaskCalendarScale,
  anchorDate: string
): CalendarRange {
  const anchor = requireDate(anchorDate);
  if (scale === 'day') {
    return { start: anchorDate, end: anchorDate };
  }
  if (scale === 'week') {
    const start = startOfWeek(anchor);
    return {
      start: formatLocalDateKey(start),
      end: formatLocalDateKey(addDays(start, 6)),
    };
  }
  if (scale === 'month') {
    return {
      start: formatLocalDateKey(
        new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12)
      ),
      end: formatLocalDateKey(
        new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 12)
      ),
    };
  }
  return {
    start: `${anchor.getFullYear()}-01-01`,
    end: `${anchor.getFullYear()}-12-31`,
  };
}

export function getCalendarGridDates(
  scale: Exclude<TaskCalendarScale, 'year'>,
  anchorDate: string
) {
  const anchor = requireDate(anchorDate);
  if (scale === 'day') return [formatLocalDateKey(anchor)];
  if (scale === 'week') {
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, index) =>
      formatLocalDateKey(addDays(start, index))
    );
  }
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
  const gridStart = startOfWeek(monthStart);
  return Array.from({ length: 42 }, (_, index) =>
    formatLocalDateKey(addDays(gridStart, index))
  );
}

export function addCalendarPeriod(
  scale: TaskCalendarScale,
  anchorDate: string,
  direction: -1 | 1
) {
  const anchor = requireDate(anchorDate);
  if (scale === 'day') return formatLocalDateKey(addDays(anchor, direction));
  if (scale === 'week') {
    return formatLocalDateKey(addDays(anchor, direction * 7));
  }
  const next = new Date(anchor);
  next.setDate(1);
  next.setMonth(next.getMonth() + direction * (scale === 'month' ? 1 : 12));
  return formatLocalDateKey(next);
}

export function getMixedTaskItemDueDate(entry: MixedTaskItem) {
  return entry.kind === 'task' ? entry.task.dueDate : entry.item.dueDate;
}

export function filterCalendarEntries(
  entries: MixedTaskItem[],
  selectedDate: string | null
) {
  return entries.filter(
    entry => getMixedTaskItemDueDate(entry) === selectedDate
  );
}

export function countCalendarEntriesByDate(entries: MixedTaskItem[]) {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const dueDate = getMixedTaskItemDueDate(entry);
    if (!dueDate) continue;
    counts.set(dueDate, (counts.get(dueDate) ?? 0) + 1);
  }
  return counts;
}

export function countCalendarEntriesInRange(
  entries: MixedTaskItem[],
  range: CalendarRange
) {
  return entries.filter(entry => {
    const dueDate = getMixedTaskItemDueDate(entry);
    return dueDate !== null && dueDate >= range.start && dueDate <= range.end;
  }).length;
}
