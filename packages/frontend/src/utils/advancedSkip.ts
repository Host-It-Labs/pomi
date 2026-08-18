import { Preferences, Timer } from '@pomi/shared';
import { TIMER_STATUSES, TIMER_TYPES } from '@pomi/shared/src/constants';

const getAdvancedSkipBaseMs = (timer: Timer) => {
  if (!timer.isExtension) {
    return 0;
  }

  return Math.max(0, timer.extensionBaseDuration ?? 0);
};

export const getAdvancedSkipFullMs = (timer: Timer) => {
  return getAdvancedSkipBaseMs(timer) + timer.duration;
};

export const getAdvancedSkipElapsedMs = (timer: Timer) => {
  const rawElapsed =
    timer.status === TIMER_STATUSES.RUNNING
      ? Date.now() - timer.startTime
      : timer.duration - timer.remainingTime;

  const currentElapsed = Math.min(timer.duration, Math.max(0, rawElapsed));
  const totalElapsed = getAdvancedSkipBaseMs(timer) + currentElapsed;

  return Math.min(getAdvancedSkipFullMs(timer), totalElapsed);
};

const hasStartedTimer = (timer: Timer) => {
  return (
    timer.status === TIMER_STATUSES.RUNNING ||
    getAdvancedSkipElapsedMs(timer) > 0
  );
};

export const shouldOpenAdvancedSkipModal = (
  timer: Timer | null,
  preferences?: Preferences | null
) => {
  if (!preferences?.advancedSkip || !timer) {
    return false;
  }

  if (timer.status === TIMER_STATUSES.COMPLETED) {
    return false;
  }

  return hasStartedTimer(timer);
};

export const getAdvancedSkipTargetLabel = (timer: Timer) => {
  return timer.type === TIMER_TYPES.WORK ? 'Break' : 'Work';
};

export const getAdvancedSkipSourceLabel = (timer: Timer) => {
  if (timer.isExtension) {
    return 'extension timer';
  }

  if (timer.type === TIMER_TYPES.LONG_BREAK) {
    return 'long break';
  }

  return timer.type === TIMER_TYPES.WORK ? 'work timer' : 'break timer';
};
