export const TIMER_TYPES = {
  WORK: 'work',
  BREAK: 'break',
  LONG_BREAK: 'longBreak',
} as const;

/**
 * Languages supported by the Pomi UI and native clients.
 *
 * Keep these values stable: they are persisted in user preferences and sent
 * over the shared API contract.
 */
export const APP_LANGUAGES = {
  ENGLISH: 'en',
  CHINESE_SIMPLIFIED: 'zh-Hans',
  HINDI: 'hi',
  SPANISH: 'es',
  ARABIC: 'ar',
  FRENCH: 'fr',
  BENGALI: 'bn',
  PORTUGUESE_BRAZIL: 'pt-BR',
  INDONESIAN: 'id',
  URDU: 'ur',
} as const;

export type AppLanguage = (typeof APP_LANGUAGES)[keyof typeof APP_LANGUAGES];

export const APP_LANGUAGE_VALUES = Object.values(APP_LANGUAGES) as [
  AppLanguage,
  ...AppLanguage[],
];

export const DEFAULT_APP_LANGUAGE: AppLanguage = APP_LANGUAGES.ENGLISH;

export const APP_LANGUAGE_INFO: Record<
  AppLanguage,
  {
    locale: string;
    nativeName: string;
    direction: 'ltr' | 'rtl';
  }
> = {
  [APP_LANGUAGES.ENGLISH]: {
    locale: 'en',
    nativeName: 'English',
    direction: 'ltr',
  },
  [APP_LANGUAGES.CHINESE_SIMPLIFIED]: {
    locale: 'zh-Hans',
    nativeName: '简体中文',
    direction: 'ltr',
  },
  [APP_LANGUAGES.HINDI]: {
    locale: 'hi',
    nativeName: 'हिन्दी',
    direction: 'ltr',
  },
  [APP_LANGUAGES.SPANISH]: {
    locale: 'es',
    nativeName: 'Español',
    direction: 'ltr',
  },
  [APP_LANGUAGES.ARABIC]: {
    locale: 'ar',
    nativeName: 'العربية',
    direction: 'rtl',
  },
  [APP_LANGUAGES.FRENCH]: {
    locale: 'fr',
    nativeName: 'Français',
    direction: 'ltr',
  },
  [APP_LANGUAGES.BENGALI]: {
    locale: 'bn',
    nativeName: 'বাংলা',
    direction: 'ltr',
  },
  [APP_LANGUAGES.PORTUGUESE_BRAZIL]: {
    locale: 'pt-BR',
    nativeName: 'Português (Brasil)',
    direction: 'ltr',
  },
  [APP_LANGUAGES.INDONESIAN]: {
    locale: 'id',
    nativeName: 'Bahasa Indonesia',
    direction: 'ltr',
  },
  [APP_LANGUAGES.URDU]: {
    locale: 'ur',
    nativeName: 'اردو',
    direction: 'rtl',
  },
};

const APP_LANGUAGE_ALIASES: Record<string, AppLanguage> = {
  en: APP_LANGUAGES.ENGLISH,
  'en-us': APP_LANGUAGES.ENGLISH,
  'en-gb': APP_LANGUAGES.ENGLISH,
  zh: APP_LANGUAGES.CHINESE_SIMPLIFIED,
  'zh-cn': APP_LANGUAGES.CHINESE_SIMPLIFIED,
  'zh-hans': APP_LANGUAGES.CHINESE_SIMPLIFIED,
  'zh-sg': APP_LANGUAGES.CHINESE_SIMPLIFIED,
  'zh-tw': APP_LANGUAGES.CHINESE_SIMPLIFIED,
  'zh-hk': APP_LANGUAGES.CHINESE_SIMPLIFIED,
  hi: APP_LANGUAGES.HINDI,
  'hi-in': APP_LANGUAGES.HINDI,
  es: APP_LANGUAGES.SPANISH,
  'es-es': APP_LANGUAGES.SPANISH,
  'es-mx': APP_LANGUAGES.SPANISH,
  ar: APP_LANGUAGES.ARABIC,
  'ar-sa': APP_LANGUAGES.ARABIC,
  'ar-eg': APP_LANGUAGES.ARABIC,
  fr: APP_LANGUAGES.FRENCH,
  'fr-fr': APP_LANGUAGES.FRENCH,
  'fr-ca': APP_LANGUAGES.FRENCH,
  bn: APP_LANGUAGES.BENGALI,
  'bn-bd': APP_LANGUAGES.BENGALI,
  'bn-in': APP_LANGUAGES.BENGALI,
  pt: APP_LANGUAGES.PORTUGUESE_BRAZIL,
  'pt-br': APP_LANGUAGES.PORTUGUESE_BRAZIL,
  'pt-pt': APP_LANGUAGES.PORTUGUESE_BRAZIL,
  id: APP_LANGUAGES.INDONESIAN,
  in: APP_LANGUAGES.INDONESIAN,
  'id-id': APP_LANGUAGES.INDONESIAN,
  ur: APP_LANGUAGES.URDU,
  'ur-pk': APP_LANGUAGES.URDU,
  'ur-in': APP_LANGUAGES.URDU,
};

/** Normalize a BCP-47-ish locale to one of the supported Pomi languages. */
export function normalizeAppLanguage(value: unknown): AppLanguage | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/_/g, '-').toLowerCase();
  return (
    APP_LANGUAGE_ALIASES[normalized] ??
    APP_LANGUAGE_ALIASES[normalized.split('-')[0]] ??
    null
  );
}

export function isAppLanguage(value: unknown): value is AppLanguage {
  return normalizeAppLanguage(value) === value;
}

export function getAppLanguageDirection(language: AppLanguage): 'ltr' | 'rtl' {
  return APP_LANGUAGE_INFO[language].direction;
}

export const TIMER_TYPE_VALUES = Object.values(TIMER_TYPES);

export const TIMER_STATUSES = {
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
} as const;

export const TASK_PRIORITIES = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;

export const TASK_STATUSES = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
} as const;

export const TASK_MANUAL_ORDER_BOTTOM = 2_147_483_647;

export const TASK_TITLE_MAX_LENGTH = 500;
export const TASK_DESCRIPTION_MAX_LENGTH = 10_000;
export const TASK_SLUG_MAX_LENGTH = 255;
export const TASK_RECURRENCE_RULE_MAX_LENGTH = 512;
export const TASK_IMPORT_MAX_ROWS = 5_000;
export const TASK_FOLLOW_UP_DELAY_MAX_DAYS = 3_650;
export const ASSISTANT_MAX_RECORDING_MINUTES = 120;

export const TASK_DEFAULT_DUE_DATE_MODES = {
  OFF: 'off',
  TOMORROW: 'tomorrow',
  WEEK: 'week',
  CUSTOM: 'custom',
} as const;

export const TASK_SORT_MODES = {
  DEFAULT: 'default',
  CREATED_DESC: 'created-desc',
  CREATED_ASC: 'created-asc',
} as const;

export const TASK_IMPORT_SOURCES = {
  VIKUNJA: 'vikunja',
} as const;

export const TASK_CREATION_SOURCES = {
  MANUAL: 'manual',
  ASSISTANT: 'assistant',
  VOICE: 'voice',
} as const;

export const HELP_TIP_IDS = {
  CROSS_TYPE_TASK_FOCUS: 'crossTypeTaskFocus',
} as const;

export const SOCKET_EVENTS = {
  SERVER_READY: 'serverReady',
  SESSION_EXPIRED: 'sessionExpired',
  CREATE_OR_RESUME_TIMER: 'createOrResumeTimer',
  REMOVE_FOCUSED_TASK: 'removeFocusedTask',
  PAUSE_TIMER: 'pauseTimer',
  RESET_TIMER: 'resetTimer',
  SKIP_TIMER: 'skipTimer',
  UNDO_TIMER_ACTION: 'undoTimerAction',
  REDO_TIMER_ACTION: 'redoTimerAction',
  CLEAR_TIMER_HISTORY: 'clearTimerHistory',
  ADD_FIVE_MINUTES_TIMER: 'addFiveMinutesTimer',
  STACK_TIMER: 'stackTimer',
  SET_SESSION_POSITION: 'setSessionPosition',
  GET_CURRENT_TIMER: 'getCurrentTimer',
  TIMER_UPDATE: 'timerUpdate',
  TIMER_ERROR: 'timerError',
  TIMER_HISTORY_UPDATE: 'timerHistoryUpdate',
  TASKS_UPDATE: 'tasksUpdate',
  PREFERENCES_UPDATE: 'preferencesUpdate',
  PUSH_TOKEN_REQUIRED: 'pushTokenRequired',
  DESKTOP_NOTIFICATION: 'desktopNotification',
  MOBILE_NOTIFICATION: 'mobileNotification',
  EXTENSION_STATE_UPDATE: 'extensionStateUpdate',
  RESOLVE_TIMER_EXTENSION: 'resolveTimerExtension',
  USER_ACTION_UPDATE: 'USER_ACTION_UPDATE',
} as const;

export const CLIENT_NOTIFICATION_TYPES = {
  COMPLETE: 'complete',
  WARNING: 'warning',
  LONG_BREAK_DETECTED: 'longBreakDetected',
  PAUSED_TIMER_REMINDER: 'pausedTimerReminder',
  TASK_REMINDER: 'taskReminder',
} as const;

export type ClientNotificationType =
  (typeof CLIENT_NOTIFICATION_TYPES)[keyof typeof CLIENT_NOTIFICATION_TYPES];

/** Stable OS-level groups shared by Timer and Task notification delivery. */
export const NOTIFICATION_GROUPS = {
  TIMER: 'pomi-timer',
  TASK: 'pomi-task',
} as const;

export type NotificationGroup =
  (typeof NOTIFICATION_GROUPS)[keyof typeof NOTIFICATION_GROUPS];

/**
 * Notification keys shared by backend delivery and client rendering.
 * Platform-specific presentation keys remain local to the relevant client.
 */
export const NOTIFICATION_KEYS = {
  WORK_COMPLETE: 'workComplete',
  LONG_BREAK_COMPLETE: 'longBreakComplete',
  BREAK_COMPLETE: 'breakComplete',
  LONG_BREAK_DETECTED: 'longBreakDetected',
  PAUSED_TIMER_REMINDER: 'pausedTimerReminder',
  BREAK_TIME: 'breakTime',
  READY_TO_WORK: 'readyToWork',
  LONG_BREAK_DETECTED_BODY: 'longBreakDetectedBody',
  PAUSED_TIMER_REMINDER_BODY: 'pausedTimerReminderBody',
  MINUTES_LEFT: 'minutesLeft',
  TIMER_ENDING: 'timerEnding',
  TASK_DUE: 'taskDue',
  WORK_TIMERS_DONE: 'workTimersDone',
} as const;

export type NotificationKey =
  (typeof NOTIFICATION_KEYS)[keyof typeof NOTIFICATION_KEYS];

export const NOTIFICATION_KEY_VALUES = Object.values(NOTIFICATION_KEYS) as [
  NotificationKey,
  ...NotificationKey[],
];

export const PUSH_PLATFORMS = {
  ANDROID: 'android',
  IOS: 'ios',
  IOS_LIVE_ACTIVITY: 'ios-live-activity',
} as const;

export type PushPlatform = (typeof PUSH_PLATFORMS)[keyof typeof PUSH_PLATFORMS];

export type TaskImportSource =
  (typeof TASK_IMPORT_SOURCES)[keyof typeof TASK_IMPORT_SOURCES];

export const NOTIFICATION_TITLES = {
  WORK_COMPLETE: 'Work Timer Complete!',
  LONG_BREAK_COMPLETE: 'Long Break Complete!',
  BREAK_COMPLETE: 'Break Complete!',
  LONG_BREAK_DETECTED: 'Long Break Detected',
  PAUSED_TIMER_REMINDER: 'Timer Still Paused',
} as const;

export const NOTIFICATION_BODIES = {
  BREAK_TIME: 'Time for a break.',
  READY_TO_WORK: 'Ready to get back to it?',
  LONG_BREAK_DETECTED: 'Session reset to start after long break.',
  PAUSED_TIMER_REMINDER: 'Your work timer has been paused for over 5 minutes.',
} as const;

export const getMinutesLeftTitle = (minutesLeft: number): string =>
  `${minutesLeft} Minutes Left`;

export const getWorkTimerEndingBody = (minutesLeft: number): string =>
  `Your work timer will end in ${minutesLeft} minutes.`;

export const ACCENT_HEX_COLORS = {
  indigo: '#4f46e5',
  green: '#10b981',
  purple: '#9333ea',
} as const;
