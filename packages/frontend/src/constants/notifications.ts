import { TIMER_TYPES } from '@pomi/shared/src/constants';

export const NOTIFICATION_MAX_AGE_MS = 60000;
export const NOTIFICATION_SOUND_DEBOUNCE_MS = 2000;
export const MACOS_NOTIFICATION_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.Notifications-Settings.extension';

export const NOTIFICATION_SOUNDS = {
  TIMER_WARNING: 'timer-warning.mp3',
  WORK_COMPLETE: 'work-complete.mp3',
  SESSION_END: 'session-end.mp3',
  BREAK_COMPLETE: 'break-complete.mp3',
} as const;

export const IN_APP_NOTIFICATION_TYPES = {
  WORK: TIMER_TYPES.WORK,
  BREAK: TIMER_TYPES.BREAK,
  LONG_BREAK: TIMER_TYPES.LONG_BREAK,
  WARNING: 'warning',
} as const;

export type InAppNotificationType =
  (typeof IN_APP_NOTIFICATION_TYPES)[keyof typeof IN_APP_NOTIFICATION_TYPES];
