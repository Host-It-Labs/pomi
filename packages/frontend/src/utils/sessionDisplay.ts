import { Timer } from '@pomi/shared';

export const getDisplayedSessionPosition = (timer?: Timer | null) => {
  if (timer?.isExtension && timer.sessionPosition) {
    return Math.max(1, timer.sessionPosition - 1);
  }

  return timer?.sessionPosition;
};
