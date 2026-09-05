import { useLayoutEffect } from 'react';
import { TIMER_TYPES } from '@pomi/shared/src/constants';
import { useTimerStore } from '../stores/timerStore';

export function AppTheme() {
  const timerType = useTimerStore.use.timer()?.type ?? TIMER_TYPES.WORK;
  useLayoutEffect(() => {
    document.documentElement.dataset.timerAccent = timerType;
    delete document.documentElement.dataset.backgroundPreview;
  }, [timerType]);
  return null;
}
