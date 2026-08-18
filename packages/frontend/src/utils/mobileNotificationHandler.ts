import { Preferences, Timer, TimerTypes } from '@pomi/shared';
import type { ClientNotificationType } from '@pomi/shared/src/constants';
import {
  CLIENT_NOTIFICATION_TYPES,
  TIMER_TYPES,
} from '@pomi/shared/src/constants';
import {
  IN_APP_NOTIFICATION_TYPES,
  InAppNotificationType,
  NOTIFICATION_MAX_AGE_MS,
  NOTIFICATION_SOUND_DEBOUNCE_MS,
  NOTIFICATION_SOUNDS,
} from '../constants/notifications';
import { translateNotification } from '../i18n/notificationLocalization';
import { useInAppNotificationStoreBase } from '../stores/inAppNotificationStore';
import { isMobile } from './osUtils';

export type MobileNotificationType = ClientNotificationType;

export interface MobileNotificationEvent {
  type: MobileNotificationType;
  timer: Timer;
  timestamp: number;
  isLastWorkTimerInSession?: boolean;
  minutesLeft?: number;
  notificationTitle?: string;
  notificationBody?: string;
}

class MobileNotificationHandler {
  private lastNotificationTimerId: string | null = null;
  private lastLongBreakDetectedTimerId: string | null = null;
  private lastPausedReminderTimerId: string | null = null;
  private lastSoundPlayTime = 0;
  private getPreferences: (() => Preferences | null) | null = null;
  private isAppVisible = true;

  setPreferencesGetter(getter: () => Preferences | null) {
    this.getPreferences = getter;
  }

  setAppVisibility(visible: boolean) {
    this.isAppVisible = visible;
  }

  private isEventFresh(timestamp: number): boolean {
    return Date.now() - timestamp < NOTIFICATION_MAX_AGE_MS;
  }

  async handleNotificationEvent(event: MobileNotificationEvent) {
    if (!isMobile) return;
    if (!this.isAppVisible) return;
    if (!this.isEventFresh(event.timestamp)) {
      console.warn(
        '[MobileNotification] Ignoring stale notification event',
        Date.now() - event.timestamp,
        'ms old'
      );
      return;
    }

    if (event.type === CLIENT_NOTIFICATION_TYPES.COMPLETE) {
      await this.handleCompleteNotification(
        event.timer,
        event.isLastWorkTimerInSession ?? false
      );
    } else if (event.type === CLIENT_NOTIFICATION_TYPES.WARNING) {
      await this.handleWarningNotification(event.minutesLeft ?? 1);
    } else if (event.type === CLIENT_NOTIFICATION_TYPES.LONG_BREAK_DETECTED) {
      await this.handleLongBreakDetectedNotification(event.timer);
    } else if (event.type === CLIENT_NOTIFICATION_TYPES.PAUSED_TIMER_REMINDER) {
      await this.handlePausedTimerReminderNotification(event.timer);
    } else if (event.type === CLIENT_NOTIFICATION_TYPES.TASK_REMINDER) {
      await this.handleTaskNotification(event);
    }
  }

  private async handleCompleteNotification(
    timer: Timer,
    isLastWorkTimerInSession: boolean
  ) {
    const preferences = this.getPreferences?.();
    if (!preferences?.pushNotifications) return;

    if (this.lastNotificationTimerId === timer.id) {
      console.warn('[MobileNotification] Already notified for this timer');
      return;
    }

    const isWork = timer.type === TIMER_TYPES.WORK;
    const shouldNotify = isWork
      ? preferences.notifyOnWorkComplete
      : preferences.notifyOnBreakComplete;

    if (shouldNotify === false) return;

    const language = preferences.language;
    const title = this.getCompleteTitle(timer.type, language);
    const body = this.getCompleteBody(
      timer,
      isLastWorkTimerInSession,
      language
    );
    const sound = this.getCompleteSound(timer.type, isLastWorkTimerInSession);
    const notificationType = this.getNotificationType(timer.type);

    this.showInAppNotification(title, body, notificationType);
    await this.playSound(sound);

    this.lastNotificationTimerId = timer.id;
  }

  private async handleWarningNotification(minutesLeft: number) {
    const preferences = this.getPreferences?.();
    if (!preferences?.pushNotifications) return;
    if (!preferences.notifyBeforeWorkComplete) return;

    const language = preferences.language;
    const title = translateNotification(language, 'minutesLeft', {
      minutes: minutesLeft,
    });
    const body = translateNotification(language, 'timerEnding', {
      minutes: minutesLeft,
    });

    this.showInAppNotification(title, body, IN_APP_NOTIFICATION_TYPES.WARNING);
    await this.playSound(NOTIFICATION_SOUNDS.TIMER_WARNING);
  }

  private async handleLongBreakDetectedNotification(timer: Timer) {
    const preferences = this.getPreferences?.();
    if (!preferences?.pushNotifications) return;

    if (this.lastLongBreakDetectedTimerId === timer.id) {
      console.warn('[MobileNotification] Already notified for long break');
      return;
    }

    if (preferences.notifyOnBreakComplete === false) return;

    const language = preferences.language;
    const title = translateNotification(
      language,
      'longBreakDetected',
      undefined
    );
    const body = translateNotification(
      language,
      'longBreakDetectedBody',
      undefined
    );

    this.showInAppNotification(
      title,
      body,
      IN_APP_NOTIFICATION_TYPES.LONG_BREAK
    );
    await this.playSound(NOTIFICATION_SOUNDS.BREAK_COMPLETE);

    this.lastLongBreakDetectedTimerId = timer.id;
  }

  private async handlePausedTimerReminderNotification(timer: Timer) {
    const preferences = this.getPreferences?.();
    if (!preferences?.pushNotifications) return;

    if (this.lastPausedReminderTimerId === timer.id) {
      return;
    }

    const language = preferences.language;
    const title = translateNotification(
      language,
      'pausedTimerReminder',
      undefined
    );
    const body = translateNotification(
      language,
      'pausedTimerReminderBody',
      undefined
    );

    this.showInAppNotification(title, body, IN_APP_NOTIFICATION_TYPES.WARNING);
    await this.playSound(NOTIFICATION_SOUNDS.TIMER_WARNING);

    this.lastPausedReminderTimerId = timer.id;
  }

  private async handleTaskNotification(event: MobileNotificationEvent) {
    const preferences = this.getPreferences?.();
    if (!preferences) return;
    if (preferences.notifications === false) return;
    const language = preferences.language;
    const title =
      event.notificationTitle ??
      translateNotification(language, 'taskDue', undefined);
    const body =
      event.notificationBody ??
      translateNotification(language, 'taskNeedsAttention', undefined);
    this.showInAppNotification(title, body, IN_APP_NOTIFICATION_TYPES.WARNING);
    if (preferences.soundNotifications) {
      await this.playSound(NOTIFICATION_SOUNDS.TIMER_WARNING);
    }
  }

  private getCompleteTitle(
    type: TimerTypes,
    language: string | null | undefined
  ): string {
    switch (type) {
      case TIMER_TYPES.WORK:
        return translateNotification(language, 'workComplete', undefined);
      case TIMER_TYPES.LONG_BREAK:
        return translateNotification(language, 'longBreakComplete', undefined);
      default:
        return translateNotification(language, 'breakComplete', undefined);
    }
  }

  private getCompleteBody(
    timer: Timer,
    isLastWorkTimerInSession: boolean,
    language: string | null | undefined
  ): string {
    if (timer.type === TIMER_TYPES.WORK) {
      if (timer.sessionPosition && timer.sessionTotal) {
        if (isLastWorkTimerInSession) {
          return translateNotification(language, 'sessionComplete', undefined);
        }
        return translateNotification(language, 'workTimersDone', {
          position: timer.sessionPosition,
          total: timer.sessionTotal,
        });
      }
      return translateNotification(language, 'breakTime', undefined);
    }
    return translateNotification(language, 'readyToWork', undefined);
  }

  private getCompleteSound(
    type: TimerTypes,
    isLastWorkTimerInSession: boolean
  ): string {
    if (type === TIMER_TYPES.WORK) {
      return isLastWorkTimerInSession
        ? NOTIFICATION_SOUNDS.SESSION_END
        : NOTIFICATION_SOUNDS.WORK_COMPLETE;
    }
    return NOTIFICATION_SOUNDS.BREAK_COMPLETE;
  }

  private getNotificationType(type: TimerTypes): InAppNotificationType {
    switch (type) {
      case TIMER_TYPES.WORK:
        return IN_APP_NOTIFICATION_TYPES.WORK;
      case TIMER_TYPES.LONG_BREAK:
        return IN_APP_NOTIFICATION_TYPES.LONG_BREAK;
      default:
        return IN_APP_NOTIFICATION_TYPES.BREAK;
    }
  }

  private showInAppNotification(
    title: string,
    body: string,
    type: InAppNotificationType
  ) {
    useInAppNotificationStoreBase.getState().showNotification({
      title,
      body,
      type,
    });
  }

  private async playSound(sound: string): Promise<void> {
    const now = Date.now();
    if (now - this.lastSoundPlayTime < NOTIFICATION_SOUND_DEBOUNCE_MS) {
      console.warn('[MobileNotification] Debouncing sound playback');
      return;
    }

    try {
      const audio = new Audio(`/sounds/${sound}`);
      await audio.play();
      this.lastSoundPlayTime = now;
    } catch (error) {
      console.error('Error playing notification sound:', error);
    }
  }
}

export const mobileNotificationHandler = new MobileNotificationHandler();
