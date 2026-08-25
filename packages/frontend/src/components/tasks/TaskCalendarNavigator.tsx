import clsx from 'clsx';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import type { MixedTaskItem } from '../../utils/mixedTaskItems';
import {
  addCalendarWeek,
  countCalendarEntriesByDate,
  getCalendarWeekDates,
  getCalendarWeekRange,
  getMixedTaskItemDueDate,
  getTodayDateKey,
  parseLocalDateKey,
} from '../../utils/taskCalendar';
import { useI18n } from '../../i18n';
import { IconButton } from '../ui/IconButton';

type Props = {
  entries: MixedTaskItem[];
  anchorDate: string;
  selectedDate: string | null;
  onAnchorDateChange: (date: string) => void;
  onSelectedDateChange: (date: string | null) => void;
};

function heading(anchorDate: string, locale: string) {
  const range = getCalendarWeekRange(anchorDate);
  const start = parseLocalDateKey(range.start)!;
  const end = parseLocalDateKey(range.end)!;
  return `${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(start)} – ${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(end)}`;
}

export function TaskCalendarNavigator({
  entries,
  anchorDate,
  selectedDate,
  onAnchorDateChange,
  onSelectedDateChange,
}: Props) {
  const { locale, t } = useI18n();
  const today = getTodayDateKey();
  const counts = countCalendarEntriesByDate(entries);
  const undatedCount = entries.filter(
    entry => getMixedTaskItemDueDate(entry) === null
  ).length;

  const move = (direction: -1 | 1) => {
    const next = addCalendarWeek(anchorDate, direction);
    onAnchorDateChange(next);
    onSelectedDateChange(next);
  };

  return (
    <section
      aria-label={t('task.calendar')}
      className="mt-3 rounded-xl border border-slate-800/70 bg-slate-900/35 p-2"
    >
      <div
        data-testid="task-calendar-header"
        className="flex items-center gap-1.5"
      >
        <IconButton
          label={t('task.previousCalendarPeriod', {
            period: t('common.week'),
          })}
          title={t('task.previousCalendarPeriod', {
            period: t('common.week'),
          })}
          size="sm"
          variant="secondary"
          onClick={() => move(-1)}
          className="h-7 w-7 !p-0"
        >
          <FaChevronLeft size={9} />
        </IconButton>
        <button
          type="button"
          onClick={() => {
            onAnchorDateChange(today);
            onSelectedDateChange(today);
          }}
          className="min-w-0 flex-1 truncate rounded-md px-2 py-1 text-center text-[11px] font-semibold text-slate-200 transition hover:bg-slate-800"
          title={t('task.goToToday')}
        >
          {heading(anchorDate, locale)}
        </button>
        {undatedCount > 0 && (
          <button
            type="button"
            aria-pressed={selectedDate === null}
            onClick={() => onSelectedDateChange(null)}
            className={clsx(
              'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] transition',
              selectedDate === null
                ? 'border-indigo-400/70 bg-indigo-500/20 text-indigo-100'
                : 'border-slate-800/70 bg-slate-950/30 text-slate-400 hover:border-slate-600'
            )}
          >
            {t('common.undated')}{' '}
            <span className="text-slate-600">{undatedCount}</span>
          </button>
        )}
        <IconButton
          label={t('task.nextCalendarPeriod', {
            period: t('common.week'),
          })}
          title={t('task.nextCalendarPeriod', {
            period: t('common.week'),
          })}
          size="sm"
          variant="secondary"
          onClick={() => move(1)}
          className="h-7 w-7 !p-0"
        >
          <FaChevronRight size={9} />
        </IconButton>
      </div>

      <div className="mt-1.5 grid grid-cols-7 gap-1">
        {getCalendarWeekDates(anchorDate).map(dateKey => {
          const date = parseLocalDateKey(dateKey)!;
          const count = counts.get(dateKey) ?? 0;
          const isSelected = selectedDate === dateKey;
          const weekday = new Intl.DateTimeFormat(locale, {
            weekday: 'short',
          }).format(date);
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
                'flex min-h-11 flex-col items-center justify-center rounded-md border px-1 py-1 text-center transition',
                isSelected
                  ? 'border-indigo-400/70 bg-indigo-500/20 text-indigo-100'
                  : 'border-slate-800/60 bg-slate-950/30 text-slate-300 hover:border-slate-600',
                dateKey === today && !isSelected && 'border-sky-500/45'
              )}
            >
              <span className="text-[9px] font-medium uppercase text-slate-500">
                {weekday}
              </span>
              <span className="text-xs font-semibold tabular-nums">
                {date.getDate()}
              </span>
              {count > 0 && (
                <span className="text-[8px] tabular-nums text-indigo-300">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
