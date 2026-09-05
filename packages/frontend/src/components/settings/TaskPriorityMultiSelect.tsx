import type { TaskPriority } from '@pomi/shared';
import { TASK_PRIORITIES } from '@pomi/shared/src/constants';
import clsx from 'clsx';
import { useState } from 'react';
import { FaChevronDown, FaInfoCircle } from 'react-icons/fa';
import { useI18n } from '../../i18n';
import { AnchoredPopover } from '../ui/AnchoredPopover';

const PRIORITY_OPTIONS: Array<{
  value: TaskPriority;
  dotClassName: string;
}> = [
  { value: TASK_PRIORITIES.LOW, dotClassName: 'bg-slate-400' },
  {
    value: TASK_PRIORITIES.NORMAL,
    dotClassName: 'bg-sky-400',
  },
  {
    value: TASK_PRIORITIES.HIGH,
    dotClassName: 'bg-amber-400',
  },
  {
    value: TASK_PRIORITIES.URGENT,
    dotClassName: 'bg-rose-400',
  },
];

export function TaskPriorityMultiSelect({
  value,
  onChange,
}: {
  value: TaskPriority[];
  onChange: (value: TaskPriority[]) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const summary = getPrioritySummary(value, t);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-ink">{t('task.priorities')}</p>
        <button
          type="button"
          aria-label={t('task.prioritiesAbout')}
          title={t('task.prioritiesDescription')}
          className="text-slate-600 hover:text-slate-300"
        >
          <FaInfoCircle size={12} />
        </button>
      </div>
      <AnchoredPopover
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        className="w-64 rounded-xl border border-slate-700 bg-slate-950 p-2 shadow-2xl shadow-black/50"
        trigger={
          <button
            type="button"
            aria-label={t('task.reminderPriorities')}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            onClick={() => setIsOpen(current => !current)}
            className="flex h-10 min-w-52 items-center justify-between gap-4 rounded-xl border border-slate-700/70 bg-slate-900 px-3 text-left text-sm text-slate-100 transition hover:border-indigo-400/45 hover:bg-slate-800"
          >
            <span>{summary}</span>
            <FaChevronDown
              size={10}
              className={clsx(
                'text-slate-500 transition-transform motion-reduce:transition-none',
                isOpen && 'rotate-180'
              )}
            />
          </button>
        }
      >
        <div className="space-y-1">
          {PRIORITY_OPTIONS.map(option => {
            const checked = value.includes(option.value);
            return (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
              >
                <input
                  type="checkbox"
                  aria-label={`${t(`common.${option.value}`)} ${t('task.reminders')}`}
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? value.filter(priority => priority !== option.value)
                      : PRIORITY_OPTIONS.map(
                          candidate => candidate.value
                        ).filter(
                          priority =>
                            priority === option.value ||
                            value.includes(priority)
                        );
                    void onChange(next);
                  }}
                  className="size-4 accent-indigo-500"
                />
                <span
                  className={clsx('size-2 rounded-full', option.dotClassName)}
                />
                <span className="flex-1">{t(`common.${option.value}`)}</span>
              </label>
            );
          })}
        </div>
      </AnchoredPopover>
    </div>
  );
}

function getPrioritySummary(
  value: TaskPriority[],
  translate: (key: string) => string
) {
  if (value.length === 0) return translate('common.off');
  if (value.length === PRIORITY_OPTIONS.length) {
    return translate('task.allPriorities');
  }
  return PRIORITY_OPTIONS.filter(option => value.includes(option.value))
    .map(option => translate(`common.${option.value}`))
    .join(' + ');
}
