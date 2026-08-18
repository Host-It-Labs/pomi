import { TIMER_STATUSES, TIMER_TYPES } from '../constants';
import { Timer } from '../types';

export const getNextTimerType = (timer: Timer | null): Timer['type'] => {
  if (!timer || timer.status === TIMER_STATUSES.COMPLETED) {
    return TIMER_TYPES.WORK;
  }

  if (timer.status === TIMER_STATUSES.PAUSED) {
    return timer.type;
  }

  return TIMER_TYPES.WORK;
};
