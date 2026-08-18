import { IntentionType } from '@pomi/shared';
import { TIMER_TYPES } from '@pomi/shared/src/constants';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePreferencesStore } from '../stores/preferencesStore';
import { apiClient } from '../utils/apiClient';
import { getBreakIntentionQueryTypes } from '../utils/breakIntentionPreview';
import { isTauri } from '../utils/osUtils';
import {
  connectionState,
  subscribeToConnectionState,
} from '../utils/socketManager';

const DAY_CHECK_INTERVAL_MS = 10000;

const getTodayKey = () => new Date().toDateString();
export const getTypedCountKey = (type: IntentionType, slug: string) =>
  `${type}:${slug}`;

const getTodayRange = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    start: start.getTime(),
    end: end.getTime(),
  };
};

export function useTodayIntentionsCount(
  type: IntentionType = TIMER_TYPES.WORK
) {
  const [count, setCount] = useState<number | null>(null);
  const [countBySlug, setCountBySlug] = useState<Record<string, number>>({});
  const [subCountBySlug, setSubCountBySlug] = useState<Record<string, number>>(
    {}
  );
  const [countByTypedSlug, setCountByTypedSlug] = useState<
    Record<string, number>
  >({});
  const [subCountByTypedSlug, setSubCountByTypedSlug] = useState<
    Record<string, number>
  >({});
  const [isLoading, setIsLoading] = useState(false);
  const preferences = usePreferencesStore.use.preferences();
  const lastCheckDateRef = useRef<string>(getTodayKey());
  const shouldFetchCount =
    preferences?.intentionShowDailyCount === true ||
    preferences?.intentionHabits === true;
  const queryTypes = useMemo(
    () =>
      getBreakIntentionQueryTypes(
        type,
        preferences?.intentionShowBreakIntentionsInLongBreak
      ),
    [preferences?.intentionShowBreakIntentionsInLongBreak, type]
  );

  const clearCountState = useCallback(() => {
    setCount(null);
    setCountBySlug({});
    setSubCountBySlug({});
    setCountByTypedSlug({});
    setSubCountByTypedSlug({});
  }, []);

  const fetchCount = useCallback(async () => {
    if (!shouldFetchCount) {
      clearCountState();
      setIsLoading(false);
      return;
    }

    const requestedDate = getTodayKey();
    const todayRange = getTodayRange();
    setIsLoading(true);
    try {
      const responses = await Promise.all(
        queryTypes.map(queryType =>
          apiClient.statistics.intentionsToday({
            query: {
              type: queryType,
              start: todayRange.start,
              end: todayRange.end,
            },
          })
        )
      );

      const currentDate = getTodayKey();
      if (requestedDate !== currentDate) {
        lastCheckDateRef.current = currentDate;
        clearCountState();
        return;
      }

      const successfulResponses = responses
        .map((response, index) => ({
          response,
          queryType: queryTypes[index],
        }))
        .filter(({ response }) => response.status === 200);

      if (successfulResponses.length > 0) {
        const nextCountBySlug: Record<string, number> = {};
        const nextSubCountBySlug: Record<string, number> = {};
        const nextCountByTypedSlug: Record<string, number> = {};
        const nextSubCountByTypedSlug: Record<string, number> = {};
        let nextCount = 0;

        successfulResponses.forEach(({ response, queryType }) => {
          if (response.status !== 200) return;

          nextCount += response.body.count;
          Object.entries(response.body.bySlug).forEach(([slug, value]) => {
            nextCountBySlug[slug] = (nextCountBySlug[slug] ?? 0) + value;
            nextCountByTypedSlug[getTypedCountKey(queryType, slug)] = value;
          });
          Object.entries(response.body.subBySlug ?? {}).forEach(
            ([slug, value]) => {
              nextSubCountBySlug[slug] =
                (nextSubCountBySlug[slug] ?? 0) + value;
              nextSubCountByTypedSlug[getTypedCountKey(queryType, slug)] =
                value;
            }
          );
        });

        setCount(nextCount);
        setCountBySlug(nextCountBySlug);
        setSubCountBySlug(nextSubCountBySlug);
        setCountByTypedSlug(nextCountByTypedSlug);
        setSubCountByTypedSlug(nextSubCountByTypedSlug);
        lastCheckDateRef.current = currentDate;
      }
    } catch (error) {
      console.error('Failed to fetch today intentions count:', error);
    } finally {
      if (requestedDate === getTodayKey()) {
        setIsLoading(false);
      }
    }
  }, [clearCountState, queryTypes, shouldFetchCount]);

  const refreshCurrentDayCount = useCallback(() => {
    const currentDate = getTodayKey();
    if (currentDate !== lastCheckDateRef.current) {
      lastCheckDateRef.current = currentDate;
      clearCountState();
    }

    fetchCount();
  }, [clearCountState, fetchCount]);

  const refreshAfterDayChange = useCallback(() => {
    const currentDate = getTodayKey();
    if (currentDate === lastCheckDateRef.current) return;

    lastCheckDateRef.current = currentDate;
    clearCountState();
    fetchCount();
  }, [clearCountState, fetchCount]);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  useEffect(() => {
    if (!shouldFetchCount) return;

    const checkMidnight = () => {
      refreshAfterDayChange();
    };

    const interval = setInterval(checkMidnight, DAY_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshAfterDayChange, shouldFetchCount]);

  useEffect(() => {
    if (!shouldFetchCount) return;

    const refreshOnForeground = () => {
      refreshCurrentDayCount();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshOnForeground();
      }
    };

    refreshAfterDayChange();

    window.addEventListener('focus', refreshOnForeground);
    window.addEventListener('online', refreshOnForeground);
    window.addEventListener('pageshow', refreshOnForeground);
    window.addEventListener('resume', refreshOnForeground as EventListener);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    let unlistenResume: (() => void) | undefined;
    if (isTauri) {
      listen('tauri://resumed', refreshOnForeground)
        .then(unsub => {
          unlistenResume = unsub;
        })
        .catch(() => {});
    }

    return () => {
      window.removeEventListener('focus', refreshOnForeground);
      window.removeEventListener('online', refreshOnForeground);
      window.removeEventListener('pageshow', refreshOnForeground);
      window.removeEventListener(
        'resume',
        refreshOnForeground as EventListener
      );
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (unlistenResume) {
        unlistenResume();
      }
    };
  }, [refreshAfterDayChange, refreshCurrentDayCount, shouldFetchCount]);

  // Refresh on socket reconnect (e.g., after sleep/resume)
  useEffect(() => {
    if (!shouldFetchCount) return;

    let wasDisconnected = false;
    const unsubscribe = subscribeToConnectionState(() => {
      if (!connectionState.isConnected) {
        wasDisconnected = true;
      } else if (wasDisconnected || connectionState.isConnected) {
        wasDisconnected = false;
        refreshCurrentDayCount();
      }
    });

    return unsubscribe;
  }, [refreshCurrentDayCount, shouldFetchCount]);

  return {
    count,
    countBySlug,
    subCountBySlug,
    countByTypedSlug,
    subCountByTypedSlug,
    isLoading,
    refetch: fetchCount,
  };
}
