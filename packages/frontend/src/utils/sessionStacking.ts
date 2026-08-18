import type { Preferences, Timer } from '@pomi/shared';
import { TIMER_TYPES } from '@pomi/shared/src/constants';

export function canStackSessionTimer(
  timer:
    | Pick<Timer, 'isExtension' | 'type' | 'sessionPosition' | 'sessionTotal'>
    | null
    | undefined,
  preferences:
    | Pick<Preferences, 'sessionsExtension' | 'sessionStackTimers'>
    | null
    | undefined
) {
  const position = timer?.sessionPosition;
  const total = timer?.sessionTotal;
  return (
    preferences?.sessionsExtension === true &&
    preferences.sessionStackTimers === true &&
    timer?.isExtension !== true &&
    timer?.type === TIMER_TYPES.WORK &&
    Number.isInteger(position) &&
    Number.isInteger(total) &&
    (position ?? 0) > 0 &&
    (position ?? 0) <= (total ?? 0)
  );
}
