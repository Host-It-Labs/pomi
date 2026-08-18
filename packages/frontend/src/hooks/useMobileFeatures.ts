import { TIMER_STATUSES, TIMER_TYPES } from '@pomi/shared/src/constants';
import { useEffect, useState } from 'react';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useTimerStore } from '../stores/timerStore';
import { apiClient } from '../utils/apiClient';
import { getBreakIntentionQueryTypes } from '../utils/breakIntentionPreview';
import { mobileNotificationHandler } from '../utils/mobileNotificationHandler';
import { isMobile } from '../utils/osUtils';
import { getSelectedTimerIntentions } from '../utils/timerIntentions';

let wakeLock: WakeLockSentinel | null = null;

export function useMobileFeatures() {
  const [isAppVisible, setIsAppVisible] = useState(true);
  const [
    isTimerIntentionKeepingScreenAwake,
    setIsTimerIntentionKeepingScreenAwake,
  ] = useState(false);
  const preferences = usePreferencesStore.use.preferences();
  const timer = useTimerStore.use.timer();
  const selectedIntentions = getSelectedTimerIntentions(timer);
  const selectedSubIntentions = Object.values(timer?.subIntentions ?? {});
  const selectedWakeIntentions = [
    ...selectedIntentions,
    ...selectedSubIntentions,
  ];
  const selectedIntentionsKey = selectedWakeIntentions.join('|');

  useEffect(() => {
    if (!isMobile) return;

    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setIsAppVisible(visible);
      mobileNotificationHandler.setAppVisibility(visible);
    };

    handleVisibilityChange();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!isMobile) return;

    const timerHasIntention =
      (timer?.type === TIMER_TYPES.WORK ||
        timer?.type === TIMER_TYPES.BREAK ||
        timer?.type === TIMER_TYPES.LONG_BREAK) &&
      selectedIntentions.length > 0;

    if (!timerHasIntention || timer?.status !== TIMER_STATUSES.RUNNING) {
      setIsTimerIntentionKeepingScreenAwake(false);
      return;
    }

    let isCancelled = false;
    const requests = getBreakIntentionQueryTypes(
      timer.type,
      preferences?.intentionShowBreakIntentionsInLongBreak
    );

    Promise.all(
      requests.map(type =>
        apiClient.intentions.list({
          query: {
            type,
            includeSubIntentions: preferences?.intentionSubIntentions
              ? true
              : undefined,
          },
        })
      )
    )
      .then(responses => {
        if (isCancelled) {
          return;
        }

        const allIntentions = responses
          .filter(response => response.status === 200)
          .flatMap(response => response.body);

        setIsTimerIntentionKeepingScreenAwake(
          allIntentions.some(
            intention =>
              selectedWakeIntentions.includes(intention.slug) &&
              intention.keepScreenAwake === true
          )
        );
      })
      .catch(() => {
        if (!isCancelled) {
          setIsTimerIntentionKeepingScreenAwake(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    preferences?.intentionShowBreakIntentionsInLongBreak,
    preferences?.intentionSubIntentions,
    selectedIntentionsKey,
    timer?.status,
    timer?.type,
  ]);

  useEffect(() => {
    if (!isMobile) return;

    const shouldKeepScreenAwake =
      timer?.status === TIMER_STATUSES.RUNNING &&
      (preferences?.keepScreenAwake || isTimerIntentionKeepingScreenAwake);

    if (!shouldKeepScreenAwake) {
      if (wakeLock) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
      }
      return;
    }

    const requestWakeLock = async () => {
      if (!('wakeLock' in navigator)) {
        console.warn('[WakeLock] Wake Lock API not supported');
        return;
      }

      try {
        if (!wakeLock && isAppVisible) {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeLock.addEventListener('release', () => {
            wakeLock = null;
          });
        }
      } catch (error) {
        console.error('[WakeLock] Failed to acquire wake lock:', error);
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLock) {
        await wakeLock.release().catch(() => {});
        wakeLock = null;
      }
    };

    if (isAppVisible) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    return () => {
      releaseWakeLock();
    };
  }, [
    isAppVisible,
    isTimerIntentionKeepingScreenAwake,
    preferences?.keepScreenAwake,
    timer?.status,
  ]);

  return {
    isAppVisible,
  };
}
