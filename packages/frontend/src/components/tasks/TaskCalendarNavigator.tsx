import clsx from 'clsx';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import type { MixedTaskItem } from '../../utils/mixedTaskItems';
import {
  addCalendarPeriod,
  countCalendarEntriesByDate,
  countCalendarEntriesInRange,
  formatLocalDateKey,
  getCalendarGridDates,
  getCalendarRange,
  getMixedTaskItemDueDate,
  getTodayDateKey,
  parseLocalDateKey,
  type TaskCalendarScale,
} from '../../utils/taskCalendar';
import { IconButton } from '../ui/IconButton';
import { useI18n } from '../../i18n';

type Props = {
  entries: MixedTaskItem[];
  scale: TaskCalendarScale;
  anchorDate: string;
  selectedDate: string | null;
  onScaleChange: (scale: TaskCalendarScale) => void;
  onAnchorDateChange: (date: string) => void;
  onSelectedDateChange: (date: string | null) => void;
};

const SCALES: TaskCalendarScale[] = ['day', 'week', 'month', 'year'];
function heading(scale: TaskCalendarScale, anchorDate: string, locale: string) {
  const anchor = parseLocalDateKey(anchorDate) ?? new Date();
  if (scale === 'day') {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(anchor);
  }
  if (scale === 'week') {
    const range = getCalendarRange(scale, anchorDate);
    const start = parseLocalDateKey(range.start)!;
    const end = parseLocalDateKey(range.end)!;
    return `${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(start)} – ${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(end)}`;
  }
  if (scale === 'month') {
    return new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
    }).format(anchor);
  }
  return String(anchor.getFullYear());
}

export function TaskCalendarNavigator({
  entries,
  scale,
  anchorDate,
  selectedDate,
  onScaleChange,
  onAnchorDateChange,
  onSelectedDateChange,
}: Props) {
  const { locale, t } = useI18n();
  const today = getTodayDateKey();
  const counts = countCalendarEntriesByDate(entries);
  const anchor = parseLocalDateKey(anchorDate) ?? new Date();
  const currentMonth = anchor.getMonth();
  const undatedCount = entries.filter(
    entry => getMixedTaskItemDueDate(entry) === null
  ).length;
  const scaleLabels: Record<TaskCalendarScale, string> = {
    day: t('common.day'),
    week: t('common.week'),
    month: t('common.month'),
    year: t('common.year'),
  };
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(
      new Date(2026, 0, 5 + index, 12)
    )
  );

  const move = (direction: -1 | 1) => {
    const next = addCalendarPeriod(scale, anchorDate, direction);
    onAnchorDateChange(next);
    onSelectedDateChange(next);
  };

  return (
    <section
      aria-label={t('task.calendar')}
      className="mt-4 rounded-xl border border-slate-800/70 bg-slate-900/35 p-2.5"
    >
      <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-950/60 p-1">
        {SCALES.map(option => (
          <button
            key={option}
            type="button"
            aria-pressed={scale === option}
            onClick={() => {
              onScaleChange(option);
              onSelectedDateChange(anchorDate);
            }}
            className={clsx(
              'h-7 rounded-md text-[11px] font-medium capitalize transition-colors',
              scale === option
                ? 'bg-indigo-500/25 text-indigo-100'
                : 'text-slate-500 hover:bg-slate-800/80 hover:text-slate-200'
            )}
          >
            {scaleLabels[option]}
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <IconButton
          label={t('task.previousCalendarPeriod', {
            period: scaleLabels[scale],
          })}
          title={t('task.previousCalendarPeriod', {
            period: scaleLabels[scale],
          })}
          size="sm"
          variant="secondary"
          onClick={() => move(-1)}
          className="h-8 w-8 !p-0"
        >
          <FaChevronLeft size={10} />
        </IconButton>
        <button
          type="button"
          onClick={() => {
            onAnchorDateChange(today);
            onSelectedDateChange(today);
          }}
          className="min-w-0 truncate rounded-md px-2 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
          title={t('task.goToToday')}
        >
          {heading(scale, anchorDate, locale)}
        </button>
        <IconButton
          label={t('task.nextCalendarPeriod', {
            period: scaleLabels[scale],
          })}
          title={t('task.nextCalendarPeriod', {
            period: scaleLabels[scale],
          })}
          size="sm"
          variant="secondary"
          onClick={() => move(1)}
          className="h-8 w-8 !p-0"
        >
          <FaChevronRight size={10} />
        </IconButton>
      </div>

      {scale === 'year' ? (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {Array.from({ length: 12 }, (_, month) => {
            const monthDate = new Date(anchor.getFullYear(), month, 1, 12);
            const monthKey = formatLocalDateKey(monthDate);
            const monthLabel = new Intl.DateTimeFormat(locale, {
              month: 'short',
            }).format(monthDate);
            const count = countCalendarEntriesInRange(
              entries,
              getCalendarRange('month', monthKey)
            );
            return (
              <button
                key={monthKey}
                type="button"
                aria-label={`${monthLabel} ${count} ${count === 1 ? t('common.item') : t('common.items')}`}
                onClick={() => {
                  onAnchorDateChange(monthKey);
                  onSelectedDateChange(monthKey);
                  onScaleChange('month');
                }}
                className="rounded-md border border-slate-800/70 bg-slate-950/35 px-2 py-2 text-left transition hover:border-indigo-500/50 hover:bg-indigo-950/20"
              >
                <span className="block text-[11px] font-medium text-slate-300">
                  {monthLabel}
                </span>
                <span className="text-[9px] text-slate-600">
                  {count} {count === 1 ? t('common.item') : t('common.items')}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <>
          {scale !== 'day' && (
            <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[9px] font-medium text-slate-600">
              {weekdays.map(day => (
                <span key={day}>{day}</span>
              ))}
            </div>
          )}
          <div
            className={clsx(
              'mt-1 grid gap-1',
              scale === 'day' ? 'grid-cols-1' : 'grid-cols-7'
            )}
          >
            {getCalendarGridDates(scale, anchorDate).map(dateKey => {
              const date = parseLocalDateKey(dateKey)!;
              const count = counts.get(dateKey) ?? 0;
              const isSelected = selectedDate === dateKey;
              const isOutsideMonth =
                scale === 'month' && date.getMonth() !== currentMonth;
              return (
                <button
                  key={dateKey}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`${new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date)}: ${count} ${count === 1 ? t('common.item') : t('common.items')}`}
                  onClick={() => {
                    onAnchorDateChange(dateKey);
                    onSelectedDateChange(dateKey);
                  }}
                  className={clsx(
                    'relative rounded-md border text-left transition',
                    scale === 'day' ? 'min-h-16 p-3' : 'min-h-10 p-1',
                    isSelected
                      ? 'border-indigo-400/70 bg-indigo-500/20 text-indigo-100'
                      : 'border-slate-800/60 bg-slate-950/30 text-slate-300 hover:border-slate-600',
                    isOutsideMonth && !isSelected && 'opacity-35',
                    dateKey === today && !isSelected && 'border-sky-500/45'
                  )}
                >
                  <span
                    className={clsx(
                      'block font-medium',
                      scale === 'day' ? 'text-sm' : 'text-[10px]'
                    )}
                  >
                    {scale === 'day'
                      ? new Intl.DateTimeFormat(locale, {
                          weekday: 'long',
                          month: 'long',
                          day: 'numeric',
                        }).format(date)
                      : date.getDate()}
                  </span>
                  {count > 0 && (
                    <span className="mt-0.5 block text-[8px] tabular-nums text-indigo-300">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      <button
        type="button"
        aria-pressed={selectedDate === null}
        onClick={() => onSelectedDateChange(null)}
        className={clsx(
          'mt-2 w-full rounded-md border px-2 py-1.5 text-left text-[11px] transition',
          selectedDate === null
            ? 'border-indigo-400/70 bg-indigo-500/20 text-indigo-100'
            : 'border-slate-800/70 bg-slate-950/30 text-slate-400 hover:border-slate-600'
        )}
      >
        {t('common.undated')}{' '}
        <span className="text-slate-600">{undatedCount}</span>
      </button>
    </section>
  );
}
