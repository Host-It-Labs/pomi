import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@choochmeque/tauri-plugin-notifications-api';
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
import { useInAppNotificationStoreBase } from '../stores/inAppNotificationStore';
import { translateNotification } from '../i18n/notificationLocalization';
import { isDesktop, isMac } from './osUtils';

export type DesktopNotificationType = ClientNotificationType;

export interface DesktopNotificationEvent {
  type: DesktopNotificationType;
  timer: Timer;
  timestamp: number;
  isLastWorkTimerInSession?: boolean;
  minutesLeft?: number;
  notificationTitle?: string;
  notificationBody?: string;
}

class DesktopNotificationHandler {
  private hasPermission = false;
  private lastNotificationTimerId: string | null = null;
  private lastLongBreakDetectedTimerId: string | null = null;
  private lastPausedReminderTimerId: string | null = null;
  private lastSoundPlayTime = 0;
  private getPreferences: (() => Preferences | null) | null = null;

  constructor() {
    this.checkPermission();
  }

  setPreferencesGetter(getter: () => Preferences | null) {
    this.getPreferences = getter;
  }

  private async checkPermission(): Promise<boolean> {
    if (!isDesktop) return false;

    try {
      this.hasPermission = await isPermissionGranted();
      return this.hasPermission;
    } catch (error) {
      console.error('Error checking notification permission:', error);
      return false;
    }
  }

  async requestPermissionIfNeeded(): Promise<boolean> {
    if (!isDesktop) return false;
    if (this.hasPermission) return true;

    try {
      const permission = await requestPermission();
      this.hasPermission = permission === 'granted';
      return this.hasPermission;
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return false;
    }
  }

  private isEventFresh(timestamp: number): boolean {
    return Date.now() - timestamp < NOTIFICATION_MAX_AGE_MS;
  }

  async handleNotificationEvent(event: DesktopNotificationEvent) {
    if (!isDesktop) return;

    if (!this.isEventFresh(event.timestamp)) {
      console.warn(
        '[DesktopNotification] Ignoring stale notification event',
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
    if (!preferences) return;
    if (preferences.notifications === false) return;

    if (this.lastNotificationTimerId === timer.id) {
      console.warn('[DesktopNotification] Already notified for this timer');
      return;
    }

    const isWork = timer.type === TIMER_TYPES.WORK;
    const shouldNotify = isWork
      ? preferences.notifyOnWorkComplete
      : preferences.notifyOnBreakComplete;

    if (shouldNotify === false) return;

    const title = this.getCompleteTitle(timer.type, preferences.language);
    const body = this.getCompleteBody(timer.type, preferences.language);
    const sound = this.getCompleteSound(timer.type, isLastWorkTimerInSession);

    if (preferences.pushNotifications) {
      await this.showPushNotification(
        title,
        body,
        this.getPushNotificationSound(preferences, sound)
      );
    }

    this.showForegroundInAppNotification(
      title,
      body,
      this.getNotificationType(timer.type)
    );

    if (this.shouldPlayWebAudioSound(preferences)) {
      await this.playSound(sound);
    }

    this.lastNotificationTimerId = timer.id;
  }

  private async handleWarningNotification(minutesLeft: number) {
    const preferences = this.getPreferences?.();
    if (!preferences) return;
    if (preferences.notifications === false) return;
    if (!preferences.notifyBeforeWorkComplete) return;

    const language = preferences.language;
    const title = translateNotification(language, 'minutesLeft', {
      minutes: minutesLeft,
    });
    const body = translateNotification(language, 'timerEnding', {
      minutes: minutesLeft,
    });

    if (preferences.pushNotifications) {
      await this.showPushNotification(
        title,
        body,
        this.getPushNotificationSound(
          preferences,
          NOTIFICATION_SOUNDS.TIMER_WARNING
        )
      );
    }

    this.showForegroundInAppNotification(
      title,
      body,
      IN_APP_NOTIFICATION_TYPES.WARNING
    );

    if (this.shouldPlayWebAudioSound(preferences)) {
      await this.playSound(NOTIFICATION_SOUNDS.TIMER_WARNING);
    }
  }

  private async handleLongBreakDetectedNotification(timer: Timer) {
    const preferences = this.getPreferences?.();
    if (!preferences) return;
    if (preferences.notifications === false) return;

    if (this.lastLongBreakDetectedTimerId === timer.id) {
      console.warn('[DesktopNotification] Already notified for long break');
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
    const sound = NOTIFICATION_SOUNDS.BREAK_COMPLETE;

    if (preferences.pushNotifications) {
      await this.showPushNotification(
        title,
        body,
        this.getPushNotificationSound(preferences, sound)
      );
    }

    this.showForegroundInAppNotification(
      title,
      body,
      IN_APP_NOTIFICATION_TYPES.LONG_BREAK
    );

    if (this.shouldPlayWebAudioSound(preferences)) {
      await this.playSound(sound);
    }

    this.lastLongBreakDetectedTimerId = timer.id;
  }

  private async handlePausedTimerReminderNotification(timer: Timer) {
    const preferences = this.getPreferences?.();
    if (!preferences) return;
    if (preferences.notifications === false) return;

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
    const sound = NOTIFICATION_SOUNDS.TIMER_WARNING;

    if (preferences.pushNotifications) {
      await this.showPushNotification(
        title,
        body,
        this.getPushNotificationSound(preferences, sound)
      );
    }

    this.showForegroundInAppNotification(
      title,
      body,
      IN_APP_NOTIFICATION_TYPES.WARNING
    );

    if (this.shouldPlayWebAudioSound(preferences)) {
      await this.playSound(sound);
    }

    this.lastPausedReminderTimerId = timer.id;
  }

  private async handleTaskNotification(event: DesktopNotificationEvent) {
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
    const sound = NOTIFICATION_SOUNDS.TIMER_WARNING;

    if (preferences.pushNotifications) {
      await this.showPushNotification(
        title,
        body,
        this.getPushNotificationSound(preferences, sound)
      );
    }

    this.showForegroundInAppNotification(
      title,
      body,
      IN_APP_NOTIFICATION_TYPES.WARNING
    );

    if (this.shouldPlayWebAudioSound(preferences)) {
      await this.playSound(sound);
    }
  }

  private getCompleteTitle(
    type: TimerTypes,
    language: string | null | undefined
  ): string {
    switch (type) {
      case TIMER_TYPES.WORK:
        return translateNotification(
          language,
          'desktopWorkComplete',
          undefined
        );
      case TIMER_TYPES.LONG_BREAK:
        return translateNotification(language, 'longBreakComplete', undefined);
      default:
        return translateNotification(language, 'breakComplete', undefined);
    }
  }

  private getCompleteBody(
    type: TimerTypes,
    language: string | null | undefined
  ): string {
    return type === TIMER_TYPES.WORK
      ? translateNotification(language, 'desktopWorkBody', undefined)
      : translateNotification(language, 'desktopBreakBody', undefined);
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

  private isAppForeground(): boolean {
    if (typeof document === 'undefined') {
      return false;
    }

    return (
      document.visibilityState === 'visible' &&
      (typeof document.hasFocus !== 'function' || document.hasFocus())
    );
  }

  private getPushNotificationSound(
    preferences: Preferences,
    sound: string
  ): string | undefined {
    if (!preferences.soundNotifications) {
      return undefined;
    }

    if (isMac && this.isAppForeground()) {
      return undefined;
    }

    return sound;
  }

  private shouldPlayWebAudioSound(preferences: Preferences): boolean {
    if (!preferences.soundNotifications) {
      return false;
    }

    return !isMac || this.isAppForeground();
  }

  private showForegroundInAppNotification(
    title: string,
    body: string,
    type: InAppNotificationType
  ) {
    if (!this.isAppForeground()) {
      return;
    }

    useInAppNotificationStoreBase.getState().showNotification({
      title,
      body,
      type,
    });
  }

  private async playSound(sound: string): Promise<void> {
    const now = Date.now();

    if (now - this.lastSoundPlayTime < NOTIFICATION_SOUND_DEBOUNCE_MS) {
      console.warn('[DesktopNotification] Debouncing sound playback');
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

  private async showPushNotification(
    title: string,
    body: string,
    sound: string | undefined
  ): Promise<void> {
    try {
      const permissionGranted = await this.requestPermissionIfNeeded();
      if (permissionGranted) {
        const notification = {
          title,
          body,
          ...(sound ? { sound: this.getNativeNotificationSound(sound) } : {}),
        };
        await sendNotification(notification);
      }
    } catch (error) {
      console.error('Error showing notification:', error);
    }
  }

  private getNativeNotificationSound(sound: string): string {
    return isMac ? sound.replace(/\.mp3$/, '.wav') : `sounds/${sound}`;
  }
}

export const desktopNotificationHandler = new DesktopNotificationHandler();
