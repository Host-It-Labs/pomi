import type { TaskRecurrenceAnchorMode } from '@pomi/shared';
import clsx from 'clsx';
import { useI18n } from '../../i18n';

export const TASK_RECURRENCE_UNITS = [
  { value: 'DAILY' },
  { value: 'WEEKLY' },
  { value: 'MONTHLY' },
] as const;

export type TaskRecurrenceUnit =
  (typeof TASK_RECURRENCE_UNITS)[number]['value'];

type Props = {
  interval: string;
  unit: TaskRecurrenceUnit;
  anchorMode: TaskRecurrenceAnchorMode;
  onIntervalChange: (value: string) => void;
  onUnitChange: (value: TaskRecurrenceUnit) => void;
  onAnchorModeChange: (value: TaskRecurrenceAnchorMode) => void;
  intervalAriaLabel: string;
  unitAriaLabel: string;
  compact: boolean;
};

export function TaskRecurrenceFields({
  interval,
  unit,
  anchorMode,
  onIntervalChange,
  onUnitChange,
  onAnchorModeChange,
  intervalAriaLabel,
  unitAriaLabel,
  compact,
}: Props) {
  const { t } = useI18n();
  const controlClassName = clsx(
    'w-full rounded-md border border-slate-700/60 bg-slate-950 px-2 text-slate-100 outline-none focus:border-indigo-400/70',
    compact ? 'h-9 text-sm' : 'h-[42px] text-sm'
  );

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-slate-300">
          {compact ? <span>{t('task.interval')}</span> : null}
          <input
            aria-label={intervalAriaLabel}
            type="number"
            min={1}
            step="any"
            value={interval}
            onChange={event => onIntervalChange(event.target.value)}
            className={controlClassName}
          />
        </label>
        <label className="space-y-1 text-xs text-slate-300">
          {compact ? <span>{t('task.unit')}</span> : null}
          <select
            aria-label={unitAriaLabel}
            value={unit}
            onChange={event =>
              onUnitChange(event.target.value as TaskRecurrenceUnit)
            }
            className={controlClassName}
          >
            {TASK_RECURRENCE_UNITS.map(option => (
              <option key={option.value} value={option.value}>
                {t(`task.recurrence.${option.value.toLowerCase()}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(['planned', 'completion'] as TaskRecurrenceAnchorMode[]).map(
          value => (
            <button
              key={value}
              type="button"
              onClick={() => onAnchorModeChange(value)}
              className={clsx(
                'rounded-md border px-2 py-2 text-xs capitalize transition',
                anchorMode === value
                  ? 'border-indigo-400/60 bg-indigo-500/20 text-indigo-100'
                  : 'border-slate-700/60 text-slate-400 hover:bg-slate-800/40'
              )}
            >
              {t(`task.recurrence.${value}`)}
            </button>
          )
        )}
      </div>
    </div>
  );
}

export function parseSimpleTaskRecurrence(
  rule: string | null | undefined,
  fractionalInterval?: number | null
): { interval: string; unit: TaskRecurrenceUnit } | null {
  if (!rule) return null;
  const parts = rule.split(';');
  if (parts.some(part => !/^(FREQ|INTERVAL)=/.test(part))) return null;
  const unit = rule.match(/FREQ=(DAILY|WEEKLY|MONTHLY)/)?.[1] as
    | TaskRecurrenceUnit
    | undefined;
  if (!unit) return null;
  return {
    interval:
      fractionalInterval?.toString() ??
      rule.match(/INTERVAL=(\d+)/)?.[1] ??
      '1',
    unit,
  };
}

export function buildSimpleTaskRecurrence(
  interval: string,
  unit: TaskRecurrenceUnit
) {
  const parsedInterval = Number(interval);
  if (!Number.isFinite(parsedInterval) || parsedInterval < 1) {
    return { rule: null, interval: null };
  }
  if (!Number.isInteger(parsedInterval)) {
    return { rule: `FREQ=${unit}`, interval: parsedInterval };
  }
  return {
    rule:
      parsedInterval === 1
        ? `FREQ=${unit}`
        : `FREQ=${unit};INTERVAL=${parsedInterval}`,
    interval: null,
  };
}
