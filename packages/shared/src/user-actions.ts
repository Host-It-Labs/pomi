import type {
  TaskCreationSource,
  TaskPriority,
  TaskRecurrenceAnchorMode,
  TaskFollowUpDefinition,
  TaskStatus,
  TimerTypes,
} from './types';
import type { TaskImportSource } from './constants';

/**
 * The lifecycle of a mutation submitted through the action gateway.
 * `accepted` means the gateway durably queued the action; `running` means a
 * worker is applying it. Terminal states are never replayed by a worker.
 */
export type UserActionLifecycle =
  'accepted' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface TimerUserAction {
  kind: 'timer';
  operation:
    | 'createOrResume'
    | 'selectIntention'
    | 'setIntentions'
    | 'pause'
    | 'reset'
    | 'skip'
    | 'addFiveMinutes'
    | 'undo'
    | 'redo'
    | 'clearHistory'
    | 'stack'
    | 'setSessionPosition'
    | 'removeFocusedTask'
    | 'resolveExtension'
    | 'convertLongBreakToBreak';
  timerType?: TimerTypes;
  intention?: string;
  intentions?: string[];
  subIntentions?: Record<string, string>;
  focusedTaskId?: string;
  customDuration?: number | null;
  taskId?: string;
  position?: number;
  extensionAction?: 'logElapsed' | 'addFiveMinutes';
  requestedLogMode?: 'none' | 'elapsed' | 'full';
  resetOnFirstIntention?: boolean;
}

export type TaskImportUserActionRow = {
  sourceId: string;
  title: string;
  dueDate?: string | null;
  dueTime?: string | null;
  description?: string | null;
  priority?: TaskPriority;
  timerType?: TimerTypes;
  recurrenceRule?: string | null;
  recurrenceInterval?: number | null;
  recurrenceAnchorMode?: TaskRecurrenceAnchorMode;
  intentionSlug?: string | null;
  subIntentionSlug?: string | null;
  newIntentionTitle?: string | null;
  newIntentionEmoji?: string | null;
  newSubIntentionTitle?: string | null;
  include: boolean;
};

export interface TasksUserAction {
  kind: 'tasks';
  operation: 'create' | 'update' | 'reorder' | 'import' | 'complete' | 'revert';
  taskId?: string;
  eventId?: string;
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: TaskPriority;
  timerType?: TimerTypes;
  customDuration?: number | null;
  pinned?: boolean;
  status?: TaskStatus;
  manualOrder?: number | null;
  manualOrderOverride?: boolean;
  intentionSlug?: string | null;
  subIntentionSlug?: string | null;
  recurrenceRule?: string | null;
  recurrenceInterval?: number | null;
  recurrenceAnchorMode?: TaskRecurrenceAnchorMode;
  expectedDueDate?: string | null;
  expectedDueTime?: string | null;
  followUpTaskId?: string | null;
  followUpDefinition?: TaskFollowUpDefinition | null;
  followUpDelayDays?: number | null;
  vacationEligible?: boolean;
  creationSource?: TaskCreationSource;
  reorder?: Array<{
    id: string;
    manualOrder: number;
    manualOrderOverride?: boolean;
  }>;
  importSource?: TaskImportSource;
  rows?: TaskImportUserActionRow[];
}

export interface IntentionsUserAction {
  kind: 'intentions';
  operation:
    'create' | 'update' | 'delete' | 'archive' | 'unarchive' | 'reparent';
  slug?: string;
  title?: string;
  emoji?: string;
  type?: TimerTypes;
  hasCustomDuration?: boolean;
  customDuration?: number;
  keepScreenAwake?: boolean;
  isHabit?: boolean;
  isFavorite?: boolean;
  allowsTasks?: boolean;
  parentIntentionId?: string | null;
  parentSlug?: string;
  keepStats?: boolean;
  description?: string | null;
}

export interface PreferencesUserAction {
  kind: 'preferences';
  operation: 'update' | 'toggle';
  updates?: Record<string, unknown>;
  key?: string;
}

export interface AssistantUserAction {
  kind: 'assistant';
  operation:
    | 'createTaskFromText'
    | 'commitPreparedTaskFromText'
    | 'commitPreparedVoiceCommand'
    | 'updateSettings'
    | 'updateDebugStatus'
    | 'updateDebugLogFlag'
    | 'clearDebugLogs';
  payload?: Record<string, unknown>;
}

export interface WorkTimerLogUserAction {
  kind: 'workTimerLog';
  operation: 'update' | 'delete';
  logId: string;
  payload?: Record<string, unknown>;
}

export interface SystemUserAction {
  kind: 'system';
  operation: 'importUserData';
  payload: Record<string, unknown>;
}

export interface NotificationsUserAction {
  kind: 'notifications';
  operation: 'test';
  payload: {
    type: 'complete' | 'warning' | 'longBreakDetected' | 'pausedTimerReminder';
    timerType: TimerTypes;
    minutesLeft?: number;
    isLastWorkTimerInSession?: boolean;
  };
}

export interface FeedbackUserAction {
  kind: 'feedback';
  operation: 'submit';
  text: string;
  diagnostics?: {
    appVersion?: string;
    platform?: string;
    path?: string;
    viewport?: string;
  };
}

export interface ListsUserAction {
  kind: 'lists';
  operation:
    | 'create'
    | 'update'
    | 'createItem'
    | 'updateItem'
    | 'resetCompletedItems'
    | 'convertIntention'
    | 'convertToIntention'
    | 'convertTaskToListItem';
  intentionSlug?: string;
  listId?: string;
  itemId?: string;
  taskId?: string;
  title?: string;
  emoji?: string | null;
  description?: string | null;
  dueDate?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  vacationDefault?: boolean;
  vacationEligible?: boolean;
  isArchived?: boolean;
  isFavorite?: boolean;
}

export interface VacationUserAction {
  kind: 'vacation';
  operation: 'configure' | 'activate' | 'deactivate';
  endsOn?: string | null;
  intentionSlugs?: string[];
  listIds?: string[];
  excludedItemIds?: string[];
}

export interface CancelledUserAction {
  kind: 'cancellation';
}

/** Every user-facing mutation must use one of these validated variants. */
export type UserAction =
  | TimerUserAction
  | TasksUserAction
  | IntentionsUserAction
  | PreferencesUserAction
  | AssistantUserAction
  | WorkTimerLogUserAction
  | SystemUserAction
  | NotificationsUserAction
  | FeedbackUserAction
  | ListsUserAction
  | VacationUserAction;

export interface UserActionStatus<T = unknown> {
  actionId: string;
  status: UserActionLifecycle;
  action: UserAction | CancelledUserAction;
  result?: T;
  error?: { message: string };
  /** Set when a worker died after entering `running`; the mutation is not replayed. */
  outcomeUnknown?: boolean;
  acceptedAt: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
}
