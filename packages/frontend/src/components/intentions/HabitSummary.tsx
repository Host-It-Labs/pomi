import type { HabitCadence } from '@pomi/shared';
import clsx from 'clsx';
import { useI18n } from '../../i18n';
import type { HabitState } from '../../utils/habits';

interface HabitSummaryProps {
  habits: ReadonlyArray<{
    habitCadence?: HabitCadence;
    state: HabitState;
  }>;
  className?: string;
}

export function HabitSummary({ habits, className }: HabitSummaryProps) {
  const { t } = useI18n();
  const daily = habits.filter(
    habit =>
      habit.state !== null &&
      habit.habitCadence !== 'weekly' &&
      habit.habitCadence !== 'off'
  );
  const weekly = habits.filter(
    habit => habit.state !== null && habit.habitCadence === 'weekly'
  );
  if (daily.length === 0 && weekly.length === 0) return null;

  return (
    <div
      role="group"
      aria-label={t('intention.habitsRemaining')}
      className={clsx(
        'flex min-h-9 w-max flex-col justify-center gap-0.5 rounded-md border border-slate-600/60 bg-slate-800/80 px-2 py-1 shadow-sm shadow-slate-950/30',
        className
      )}
    >
      <span className="text-[9px] font-medium leading-none text-slate-400">
        {t('intention.habitsRemaining')}
      </span>
      <div className="flex items-center gap-2 text-[10px] leading-tight text-slate-300">
        {[
          {
            habits: daily,
            label: 'common.today',
            description: 'intention.dailyHabitsRemaining',
          },
          {
            habits: weekly,
            label: 'intention.thisWeek',
            description: 'intention.weeklyHabitsRemaining',
          },
        ]
          .filter(period => period.habits.length > 0)
          .map(period => {
            const count = period.habits.filter(
              habit => habit.state === 'pending'
            ).length;
            const description = t(period.description, { count });
            return (
              <span
                key={period.label}
                aria-label={description}
                title={description}
                className="flex items-baseline gap-1 whitespace-nowrap"
              >
                {t(period.label)}
                <strong className="font-semibold tabular-nums text-slate-100">
                  {count}
                </strong>
              </span>
            );
          })}
      </div>
    </div>
  );
}
