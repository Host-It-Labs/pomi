import { useEffect, useState } from 'react';
import {
  getTaskOrderingClock,
  type TaskOrderingClock,
} from '../utils/taskView';

const MINUTE_MS = 60_000;

function getMillisecondsUntilNextMinute(now: Date) {
  return MINUTE_MS - (now.getSeconds() * 1_000 + now.getMilliseconds());
}

export function useTaskOrderingClock(): TaskOrderingClock {
  const [clock, setClock] = useState<TaskOrderingClock>(() =>
    getTaskOrderingClock(new Date())
  );

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const scheduleNextUpdate = () => {
      timeoutId = setTimeout(() => {
        setClock(getTaskOrderingClock(new Date()));
        scheduleNextUpdate();
      }, getMillisecondsUntilNextMinute(new Date()));
    };

    scheduleNextUpdate();
    return () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  return clock;
}
