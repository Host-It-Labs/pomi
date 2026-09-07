import { useDismissibleDropdown } from '../../hooks/useDismissibleDropdown';
import type { ListItem, Task, TaskPriority, TimerTypes } from '@pomi/shared';
import { TIMER_TYPES } from '@pomi/shared/src/constants';
import clsx from 'clsx';
import { FaCheck, FaSlidersH } from 'react-icons/fa';
import { useI18n } from '../../i18n';
import { IconButton } from '../ui/IconButton';

export type PresenceFilter = 'all' | 'yes' | 'no';

export type TaskPropertyFilters = {
  dueDate: PresenceFilter;
  recurrence: PresenceFilter;
  pinned: PresenceFilter;
  priorities: TaskPriority[];
  timerTypes: TimerTypes[];
};

const ALL_PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
const ALL_TIMER_TYPES: TimerTypes[] = [
  TIMER_TYPES.WORK,
  TIMER_TYPES.BREAK,
  TIMER_TYPES.LONG_BREAK,
];

export const EMPTY_TASK_PROPERTY_FILTERS: TaskPropertyFilters = {
  dueDate: 'all',
  recurrence: 'all',
  pinned: 'all',
  priorities: ALL_PRIORITIES,
  timerTypes: ALL_TIMER_TYPES,
};

export function hasTaskPropertyFilters(filters: TaskPropertyFilters) {
  return (
    filters.dueDate !== 'all' ||
    filters.recurrence !== 'all' ||
    filters.pinned !== 'all' ||
    filters.priorities.length !== ALL_PRIORITIES.length ||
    filters.timerTypes.length !== ALL_TIMER_TYPES.length
  );
}

export function matchesTaskPropertyFilters(
  task: Task,
  filters: TaskPropertyFilters
) {
  return (
    matchesPresence(Boolean(task.dueDate), filters.dueDate) &&
    matchesPresence(Boolean(task.recurrenceRule), filters.recurrence) &&
    matchesPresence(Boolean(task.pinnedAt), filters.pinned) &&
    filters.priorities.includes(task.priority) &&
    filters.timerTypes.includes(task.timerType)
  );
}

export function matchesListItemPropertyFilters(
  item: ListItem,
  filters: TaskPropertyFilters
) {
  return (
    matchesPresence(Boolean(item.dueDate), filters.dueDate) &&
    matchesPresence(false, filters.recurrence) &&
    matchesPresence(false, filters.pinned) &&
    filters.priorities.includes(item.priority) &&
    filters.timerTypes.includes(TIMER_TYPES.WORK)
  );
}

function matchesPresence(value: boolean, filter: PresenceFilter) {
  return filter === 'all' || (filter === 'yes' ? value : !value);
}

export function TaskPropertyFilterMenu({
  filters,
  isOpen,
  onOpenChange,
  onChange,
}: {
  filters: TaskPropertyFilters;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onChange: (filters: TaskPropertyFilters) => void;
}) {
  const { t } = useI18n();
  const dropdownRef = useDismissibleDropdown(isOpen, onOpenChange);
  const active = hasTaskPropertyFilters(filters);
  const activeCount =
    Number(filters.dueDate !== 'all') +
    Number(filters.recurrence !== 'all') +
    Number(filters.pinned !== 'all') +
    Number(filters.priorities.length !== ALL_PRIORITIES.length) +
    Number(filters.timerTypes.length !== ALL_TIMER_TYPES.length);

  const setPresence = (
    key: 'dueDate' | 'recurrence' | 'pinned',
    value: PresenceFilter
  ) => onChange({ ...filters, [key]: value });

  return (
    <div ref={dropdownRef} className="relative">
      <IconButton
        label={t('task.propertyFilters')}
        title={t('task.propertyFilters')}
        size="sm"
        variant={active ? 'primary' : 'secondary'}
        onClick={() => onOpenChange(!isOpen)}
        aria-expanded={isOpen}
        className="relative h-7 w-7 !p-0"
      >
        <FaSlidersH size={11} />
        {activeCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-indigo-200 px-0.5 text-[8px] font-bold text-indigo-950">
            {activeCount}
          </span>
        ) : null}
      </IconButton>
      {isOpen ? (
        <div className="absolute right-0 top-full z-40 mt-1 w-64 space-y-3 rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs shadow-xl shadow-black/30">
          <PresenceSelect
            label={t('common.dueDate')}
            value={filters.dueDate}
            yesLabel={t('task.hasDueDate')}
            noLabel={t('task.noDueDate')}
            onChange={value => setPresence('dueDate', value)}
          />
          <PresenceSelect
            label={t('task.recurrence')}
            value={filters.recurrence}
            yesLabel={t('statistics.recurring')}
            noLabel={t('task.oneTime')}
            onChange={value => setPresence('recurrence', value)}
          />
          <PresenceSelect
            label={t('statistics.pinned')}
            value={filters.pinned}
            yesLabel={t('task.pinned')}
            noLabel={t('task.unpinned')}
            onChange={value => setPresence('pinned', value)}
          />
          <fieldset className="space-y-1.5">
            <legend className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              {t('task.timerTypes')}
            </legend>
            <div className="grid grid-cols-3 gap-1">
              {ALL_TIMER_TYPES.map(timerType => {
                const checked = filters.timerTypes.includes(timerType);
                const label =
                  timerType === TIMER_TYPES.WORK
                    ? t('common.work')
                    : timerType === TIMER_TYPES.BREAK
                      ? t('common.break')
                      : t('common.longBreak');
                return (
                  <label
                    key={timerType}
                    className={clsx(
                      'flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1.5',
                      checked
                        ? 'bg-indigo-500/15 text-indigo-100'
                        : 'text-slate-400 hover:bg-slate-800/70'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        onChange({
                          ...filters,
                          timerTypes: checked
                            ? filters.timerTypes.filter(
                                candidate => candidate !== timerType
                              )
                            : [...filters.timerTypes, timerType],
                        })
                      }
                      className="peer sr-only"
                    />
                    <span className="flex h-3 w-3 items-center justify-center rounded border border-slate-600 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400/70">
                      {checked ? <FaCheck size={7} /> : null}
                    </span>
                    <span className="truncate">{label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              {t('task.priorities')}
            </legend>
            <div className="grid grid-cols-2 gap-1">
              {ALL_PRIORITIES.map(priority => {
                const checked = filters.priorities.includes(priority);
                return (
                  <label
                    key={priority}
                    className={clsx(
                      'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 capitalize',
                      checked
                        ? 'bg-indigo-500/15 text-indigo-100'
                        : 'text-slate-400 hover:bg-slate-800/70'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        onChange({
                          ...filters,
                          priorities: checked
                            ? filters.priorities.filter(
                                candidate => candidate !== priority
                              )
                            : [...filters.priorities, priority],
                        })
                      }
                      className="peer sr-only"
                    />
                    <span className="flex h-3 w-3 items-center justify-center rounded border border-slate-600 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400/70">
                      {checked ? <FaCheck size={7} /> : null}
                    </span>
                    {t(`common.${priority}`)}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <button
            type="button"
            onClick={() => onChange(EMPTY_TASK_PROPERTY_FILTERS)}
            disabled={!active}
            className="w-full rounded-md border border-slate-700 px-2 py-1.5 text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
          >
            {t('task.clearPropertyFilters')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PresenceSelect({
  label,
  value,
  yesLabel,
  noLabel,
  onChange,
}: {
  label: string;
  value: PresenceFilter;
  yesLabel: string;
  noLabel: string;
  onChange: (value: PresenceFilter) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="grid grid-cols-[5.25rem_minmax(0,1fr)] items-center gap-2 text-slate-400">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={event => onChange(event.target.value as PresenceFilter)}
        className="h-8 rounded-md border border-slate-700 bg-slate-900 px-2 text-slate-100"
      >
        <option value="all">{t('common.all')}</option>
        <option value="yes">{yesLabel}</option>
        <option value="no">{noLabel}</option>
      </select>
    </label>
  );
}
