import type { Preferences, Timer } from '@pomi/shared';
import { TIMER_STATUSES, TIMER_TYPES } from '@pomi/shared/src/constants';
import { getDisplayedSessionPosition } from './sessionDisplay';

export function getSessionTimeline(
  timer: Timer | null,
  preferences: Preferences | null,
  now: number
) {
  const position = timer ? (getDisplayedSessionPosition(timer) ?? 1) : 1;
  const total = Math.max(
    1,
    timer?.sessionTotal ?? preferences?.sessionPomodorosCount ?? 1
  );
  const remaining = Math.max(0, timer?.remainingTime ?? 0);
  const work = preferences?.workTimerDuration ?? timer?.duration ?? 0;
  const rest = preferences?.breakTimerDuration ?? 0;
  const canEstimate = !!timer && timer.status !== TIMER_STATUSES.COMPLETED;
  const timerEnd = canEstimate ? now + remaining : null;
  const ends = Array.from({ length: total }, (_, index) => {
    const ahead = index + 1 - position;
    if (!canEstimate || ahead < 0 || timer.type === TIMER_TYPES.LONG_BREAK)
      return null;
    return (
      now +
      remaining +
      (timer.type === TIMER_TYPES.BREAK ? work : 0) +
      ahead * (work + rest) +
      (timer.type === TIMER_TYPES.WORK && ahead > 0
        ? Math.max(0, (timer.stackedSessions ?? 1) - 1) * rest
        : 0)
    );
  });
  return {
    position,
    total,
    timerEnd,
    sessionEnd: ends[ends.length - 1] ?? null,
    ends,
  };
}

export function getSessionSegments(
  timer: Timer | null,
  preferences: Preferences | null
) {
  const total = Math.max(
    1,
    timer?.sessionTotal ?? preferences?.sessionPomodorosCount ?? 1
  );
  const position = Math.min(
    total,
    Math.max(1, timer ? (getDisplayedSessionPosition(timer) ?? 1) : 1)
  );
  const base = Math.max(
    1,
    timer?.originalDuration ??
      preferences?.workTimerDuration ??
      timer?.duration ??
      1
  );
  const extensionBase = timer?.isExtension
    ? (timer.extensionBaseDuration ?? base)
    : 0;
  const duration = extensionBase + (timer?.duration ?? base);
  const elapsed = duration - (timer?.remainingTime ?? duration);
  const weight =
    timer?.type === TIMER_TYPES.WORK ? Math.max(1, duration / base) : 1;
  const totalWeight = total - 1 + weight;
  let start = 0;
  return Array.from({ length: total }, (_, index) => {
    const sweep = (360 * (index + 1 === position ? weight : 1)) / totalWeight;
    const segment = {
      start,
      sweep,
      progress:
        index + 1 < position
          ? 1
          : index + 1 === position && timer?.type === TIMER_TYPES.WORK
            ? Math.min(1, Math.max(0, elapsed / duration))
            : 0,
    };
    start += sweep;
    return segment;
  });
}
