import type { Preferences, TimerTypes } from '@pomi/shared';
import { TIMER_TYPES } from '@pomi/shared/src/constants';

export type LongBreakSwitchAction = 'startLongBreak' | 'switchToShortBreak';

export function getLongBreakSwitchAction(
  timerType: TimerTypes | null | undefined,
  preferences:
    | Pick<
        Preferences,
        | 'sessionHasLongBreak'
        | 'sessionShowLongBreakButton'
        | 'longBreakToBreakEnabled'
      >
    | null
    | undefined
): LongBreakSwitchAction | null {
  if (
    timerType === TIMER_TYPES.LONG_BREAK &&
    preferences?.longBreakToBreakEnabled === true
  ) {
    return 'switchToShortBreak';
  }

  if (
    (timerType === TIMER_TYPES.WORK || timerType === TIMER_TYPES.BREAK) &&
    preferences?.sessionHasLongBreak === true &&
    preferences.sessionShowLongBreakButton === true
  ) {
    return 'startLongBreak';
  }

  return null;
}
