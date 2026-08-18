import type { Preferences, Timer } from '@pomi/shared';
import { TIMER_STATUSES, TIMER_TYPES } from '@pomi/shared/src/constants';

interface ShouldShowIntentionsPickerInput {
  preferences?: Preferences | null;
  timer?: Timer | null;
}

export function shouldShowIntentionsPicker({
  preferences,
  timer,
}: ShouldShowIntentionsPickerInput) {
  return (
    preferences?.intentionExtension &&
    (timer?.type === TIMER_TYPES.WORK ||
      (timer?.type === TIMER_TYPES.BREAK &&
        preferences?.intentionBreakIntentions) ||
      timer?.type === TIMER_TYPES.LONG_BREAK ||
      (timer?.status === TIMER_STATUSES.COMPLETED &&
        (timer?.type === TIMER_TYPES.BREAK ||
          timer?.type === TIMER_TYPES.LONG_BREAK)))
  );
}
