import type { TimerTypes } from '@pomi/shared';
import { TIMER_TYPES } from '@pomi/shared/src/constants';
import clsx from 'clsx';
import { useI18n } from '../../i18n';

export function TaskTimerTypeBadge({ timerType }: { timerType: TimerTypes }) {
  const { t } = useI18n();
  return (
    timerType !== TIMER_TYPES.WORK && (
      <span
        className={clsx(
          'shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-none',
          timerType === TIMER_TYPES.BREAK
            ? 'border-green-500/35 bg-green-500/10 text-green-200'
            : 'border-purple-500/35 bg-purple-500/10 text-purple-200'
        )}
      >
        {timerType === TIMER_TYPES.LONG_BREAK
          ? t('common.longBreak')
          : t('common.break')}
      </span>
    )
  );
}
