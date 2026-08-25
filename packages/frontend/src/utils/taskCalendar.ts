import type { MixedTaskItem } from './mixedTaskItems';

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

export function getCalendarWeekRange(anchorDate: string): CalendarRange {
  const anchor = requireDate(anchorDate);
  const start = startOfWeek(anchor);
  return {
    start: formatLocalDateKey(start),
    end: formatLocalDateKey(addDays(start, 6)),
  };
}

export function getCalendarWeekDates(anchorDate: string) {
  const anchor = requireDate(anchorDate);
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, index) =>
    formatLocalDateKey(addDays(start, index))
  );
}

export function addCalendarWeek(anchorDate: string, direction: -1 | 1) {
  const anchor = requireDate(anchorDate);
  return formatLocalDateKey(addDays(anchor, direction * 7));
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
