export const ANDROID_NOTIFICATION_CHANNEL_IDS = {
  WORK_COMPLETE: 'pomi_work_complete_alarm_v3',
  BREAK_COMPLETE: 'pomi_break_complete_alarm_v3',
  WARNINGS: 'pomi_warnings_alarm_v3',
  SESSION_END: 'pomi_session_end_alarm_v3',
  GENERAL: 'pomi_notifications',
} as const;

export const ANDROID_NOTIFICATION_SOUNDS = {
  TIMER_WARNING: 'timer_warning',
  WORK_COMPLETE: 'work_complete',
  BREAK_COMPLETE: 'break_complete',
  SESSION_END: 'session_end',
} as const;
