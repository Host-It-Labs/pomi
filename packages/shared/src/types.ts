import type { AppLanguage } from './constants';

export type TimerTypes = 'work' | 'break' | 'longBreak';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskStatus = 'active' | 'completed' | 'archived';
export type TaskRecurrenceAnchorMode = 'planned' | 'completion';
export type TaskCreationSource = 'manual' | 'assistant' | 'voice';
export type TaskDefaultDueDateMode = 'off' | 'tomorrow' | 'week' | 'custom';
export type TaskSortMode = 'default' | 'created-desc' | 'created-asc';
export type TaskPageViewMode = 'list' | 'calendar';
export type AssistantDebugLogKind = 'taskCapture' | 'voiceCommand';
export type AssistantDebugLogSource = 'typed' | 'dictation' | 'assistantVoice';
export type AssistantDebugLogStatus =
  'dictated' | 'succeeded' | 'fallback' | 'failed';
export type TaskLifecycleEventType = 'created' | 'completed' | 'archived';
export type AssistantUsageBudgetPeriod = 'daily' | 'monthly';
export type AssistantVoiceAction =
  | 'createTask'
  | 'createListItem'
  | 'startTimer'
  | 'pauseTimer'
  | 'addFiveMinutes'
  | 'none';
export type WatchTaskMode = 'intention' | 'general';
export type WatchTimerAction =
  | 'startOrResume'
  | 'selectIntention'
  | 'setIntentions'
  | 'pause'
  | 'addFiveMinutes'
  | 'reset'
  | 'skip';

export interface Timer {
  id: string;
  scheduleRevision?: string;
  startTime: number;
  duration: number;
  type: TimerTypes;
  status: 'running' | 'paused' | 'completed';
  remainingTime: number;
  userId?: string;
  hasNotifiedBeforeTimeNotification?: boolean;
  hasNotifiedLongBreakDetection?: boolean;
  hasNotifiedPausedTimerReminder?: boolean;
  intention?: string;
  intentionSlugs?: string[];
  subIntentions?: Record<string, string>;
  intentionTitle?: string;
  intentionEmoji?: string;
  intentionEmojis?: Record<string, string>;
  subIntention?: string;
  subIntentionTitle?: string;
  subIntentionEmoji?: string;
  subIntentionEmojis?: Record<string, string>;
  sessionPosition?: number;
  sessionTotal?: number;
  stackedSessions?: number;
  stackedSessionPlanReduction?: number;
  sessionIntentionEmojis?: Record<number, string>;
  originalDuration?: number;
  originalBreakDuration?: number;
  isExtension?: boolean;
  extensionOriginalTimerId?: string;
  extensionBaseDuration?: number;
  extensionNextTimerType?: TimerTypes;
  focusedTaskIds?: string[];
}

export interface TimerExtensionState {
  startTime: number;
  maxDuration?: number;
  intention?: string;
  intentionSlugs?: string[];
  subIntentions?: Record<string, string>;
  intentionTitle?: string;
  intentionEmoji?: string;
  intentionEmojis?: Record<string, string>;
  subIntention?: string;
  subIntentionTitle?: string;
  subIntentionEmoji?: string;
  subIntentionEmojis?: Record<string, string>;
  originalTimerId: string;
  originalDuration: number;
  extensionNextTimerType?: TimerTypes;
}

export type TimerSkipLogMode = 'none' | 'elapsed' | 'full';
export type TimerExtensionResolutionAction = 'logElapsed' | 'addFiveMinutes';

export interface TimerState {
  currentTimer: Timer | null;
  participants: string[];
}

export interface User {
  id: string;
  username: string;
  createdAt: string;
  isAdmin?: boolean;
}

export interface SystemInfo {
  hostingMode: 'hosted' | 'self-hosted';
  selfHosted: boolean;
}

export type UserDataTransferRow = Record<string, unknown>;

export interface UserDataTimerRuntime {
  currentTimer: UserDataTransferRow | null;
  sessionState: UserDataTransferRow | null;
  lastCompletionTimestamp: number | null;
  idleDetected: boolean;
  undoState: UserDataTransferRow | null;
  undoHistory: UserDataTransferRow[];
  redoHistory: UserDataTransferRow[];
  extensionState: UserDataTransferRow | null;
}

export interface UserDataExport {
  version: 1;
  exportedAt: string;
  sourceUser: {
    id: string;
    username: string;
  };
  data: {
    preferences: UserDataTransferRow | null;
    intentions: UserDataTransferRow[];
    lists?: UserDataTransferRow[];
    vacationStates?: UserDataTransferRow[];
    statistics: UserDataTransferRow[];
    tasks: UserDataTransferRow[];
    taskEvents: UserDataTransferRow[];
    taskImportRuns?: UserDataTransferRow[];
    assistantDebugSetting: UserDataTransferRow | null;
    assistantDebugLogs: UserDataTransferRow[];
    assistantUsageEvents: UserDataTransferRow[];
    timerRuntime: UserDataTimerRuntime;
  };
}

export interface UserDataImportResult {
  success: boolean;
  imported: {
    preferences: number;
    intentions: number;
    lists?: number;
    vacationStates?: number;
    statistics: number;
    tasks: number;
    taskEvents: number;
    taskImportRuns?: number;
    assistantDebugSettings: number;
    assistantDebugLogs: number;
    assistantUsageEvents: number;
    timerRuntime: boolean;
  };
}

export interface Preferences {
  language: AppLanguage;
  workTimerDuration: number;
  breakTimerDuration: number;
  autoStartBreak: boolean;
  notifications: boolean;
  notifyOnWorkComplete: boolean;
  notifyOnBreakComplete: boolean;
  notifyBeforeWorkComplete: boolean;
  notifyBeforeTime: number;
  soundNotifications: boolean;
  pushNotifications: boolean;
  timeZone: string;
  globalShortcut: boolean;
  keyboardShortcuts: boolean;
  intentionExtension: boolean;
  intentionRequireSelection: boolean;
  intentionShowDailyCount: boolean;
  intentionBreakIntentions: boolean;
  intentionMultiSelect: boolean;
  intentionShowBreakIntentionsInLongBreak: boolean;
  intentionCustomDurations: boolean;
  intentionSubIntentions: boolean;
  intentionHabits: boolean;
  workTimerLogsExtension: boolean;
  sessionsExtension: boolean;
  sessionPomodorosCount: number;
  sessionHasLongBreak: boolean;
  sessionLongBreakDuration: number;
  sessionLongBreakAutoStart: boolean;
  sessionShowLongBreakButton: boolean;
  sessionShowEta: boolean;
  sessionStackTimers: boolean;
  sessionAutoDetectLongBreak: boolean;
  keepScreenAwake: boolean;
  undoAlerts: boolean;
  advancedSkip: boolean;
  timerExtension: boolean;
  timerExtrasSeen: boolean;
  sessionsExtrasSeen: boolean;
  intentionsExtrasSeen: boolean;
  assistantExtension: boolean;
  assistantTaskTranscriptsEnabled: boolean;
  assistantTaskTranscriptMinWords: number;
  destinationDescriptionsEnabled?: boolean;
  tasksExtension: boolean;
  listsExtension?: boolean;
  vacationExtension?: boolean;
  vacationCoverageConfigured?: boolean;
  tasksShowVacationCovered?: boolean;
  longBreakToBreakEnabled?: boolean;
  tasksShowSetupPrompts: boolean;
  tasksShowInMinimizedTimer: boolean;
  tasksAutoSwitchToIntentionMode: boolean;
  tasksDuringBreaks: boolean;
  taskDefaultDueDateMode: TaskDefaultDueDateMode;
  taskDefaultDueDateDays: number;
  taskDefaultSortMode: TaskSortMode;
  hiddenHelpTips: string[];
  taskReminderPriorities: TaskPriority[];
  taskBeforeDueReminderMinutes: number;
  taskUrgentReminderRepeatEnabled: boolean;
  taskUrgentReminderRepeatIntervalMinutes: number;
}

export interface TaskStatisticsSummary {
  overview: {
    active: number;
    recurring: number;
    overdue: number;
    undated: number;
    pinned: number;
  };
  today: PeriodStats;
  week: PeriodStats;
  month: PeriodStats;
  year: PeriodStats;
  heatmap: { date: string; count: number; duration: number }[];
  heatmapThresholds: {
    low: number;
    medium: number;
    high: number;
    max: number;
  };
  ranking: TopIntentionStat[];
  firstLogDate: string | null;
}

export type TaskStatisticsFilter =
  'created' | 'completed' | 'overdue' | 'onTime' | 'archived';

export interface TaskEventLog {
  id: string;
  taskId: string;
  eventType: 'completed' | 'archived';
  title: string;
  priority: TaskPriority;
  timerType: TimerTypes;
  intentionSlug: string | null;
  subIntentionSlug: string | null;
  dueDate: string | null;
  dueTime: string | null;
  isOverdue: boolean;
  occurredAt: number;
  date: string;
  canRevert: boolean;
}

export interface TimerStatistic {
  id: string;
  userId: string;
  date: string; // ISO date format YYYY-MM-DD
  type: TimerTypes; // 'work' or 'break'
  duration: number; // actual duration in milliseconds
  completedAt: number; // timestamp
  intention?: string;
  intentions?: string[];
  subIntentions?: Record<string, string>;
}

export interface PeriodStats {
  count: number;
  duration: number;
  change: number | null; // count percentage change compared to previous period
  durationChange: number | null; // duration percentage change compared to previous period
}

export interface StatisticsSummary {
  today: PeriodStats;
  week: PeriodStats;
  month: PeriodStats;
  year: PeriodStats;
  heatmap: { date: string; count: number; duration: number }[];
  heatmapThresholds: {
    low: number;
    medium: number;
    high: number;
    max: number;
  };
  availableIntentions: {
    value: string;
    label: string;
    title: string;
    emoji: string;
    isArchived: boolean;
    hasSubIntentions?: boolean;
  }[];
  firstLogDate: string | null;
}

export interface TopIntentionStat {
  slug: string;
  label: string;
  count: number;
  duration: number;
}

export interface WorkTimerLogIntention {
  slug: string;
  title?: string;
  emoji?: string;
  type?: IntentionType;
  subIntention?: {
    slug: string;
    title?: string;
    emoji?: string;
  };
}

export interface WorkTimerLog {
  id: string;
  type: TimerTypes;
  intention?: string;
  intentionTitle?: string;
  intentionEmoji?: string;
  intentions: WorkTimerLogIntention[];
  subIntentions?: Record<string, string>;
  duration: number;
  completedAt: number;
  date: string;
}

export type TopIntentionsPeriod = 'today' | 'week' | 'month' | 'year';

export type IntentionType = 'work' | 'break' | 'longBreak';

export interface Intention {
  id: string;
  userId: string;
  title: string;
  emoji: string;
  slug: string;
  type: IntentionType;
  parentIntentionId: string | null;
  parentIntention?: {
    id: string;
    title: string;
    emoji: string;
    slug: string;
  } | null;
  hasCustomDuration: boolean;
  customDuration?: number | null;
  keepScreenAwake: boolean;
  isHabit: boolean;
  isArchived: boolean;
  isFavorite: boolean;
  allowsTasks: boolean;
  description?: string | null;
  vacationDefault?: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  sourceTranscript: string | null;
  creationSource: TaskCreationSource;
  importSource: string | null;
  importSourceTaskId: string | null;
  dueDate: string | null;
  dueTime: string | null;
  manualOrder: number | null;
  manualOrderOverride: boolean;
  priority: TaskPriority;
  status: TaskStatus;
  timerType: TimerTypes;
  pinnedAt: string | null;
  intentionSlug: string | null;
  subIntentionSlug: string | null;
  recurrenceRule: string | null;
  recurrenceInterval: number | null;
  recurrenceAnchorMode: TaskRecurrenceAnchorMode;
  followUpTaskId: string | null;
  followUpDefinition?: TaskFollowUpDefinition | null;
  followUpDelayDays: number | null;
  followUpSourceTaskId: string | null;
  followUpParent?: TaskFollowUpParent | null;
  itemKind: 'task';
  vacationEligible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskFollowUpDefinition {
  title: string;
  description: string | null;
  dueTime: string | null;
  priority: TaskPriority;
  timerType: TimerTypes;
  intentionSlug: string | null;
  subIntentionSlug: string | null;
  vacationEligible: boolean;
}

export interface TaskFollowUpParent {
  id: string;
  title: string;
}

export interface List {
  id: string;
  userId: string;
  title: string;
  emoji: string | null;
  description: string | null;
  vacationDefault: boolean;
  isArchived: boolean;
  isFavorite: boolean;
  sourceIntentionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListItem {
  id: string;
  userId: string;
  listId: string;
  title: string;
  dueDate: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  manualOrder: number | null;
  manualOrderOverride: boolean;
  itemKind: 'listItem';
  vacationEligible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VacationState {
  active: boolean;
  runId: string | null;
  startedOn: string | null;
  endsOn: string | null;
}

export interface TaskImportSkippedTask {
  sourceId: string;
  title: string;
  reason: 'duplicate' | 'invalid';
  message: string;
}

export interface TaskImportResult {
  imported: Task[];
  skipped: TaskImportSkippedTask[];
}

export interface TaskImportStatus {
  hasImportedTasks: boolean;
}

export interface AssistantSettings {
  textModel: string | null;
  transcriptionModel: string | null;
  speechModel: string | null;
  speechVoice: string | null;
  assistantRecordingMaxMinutes: number | null;
  usageBudgetPeriod: AssistantUsageBudgetPeriod;
  usageBudgetCapUsd: number | null;
}

export interface AssistantStatus {
  apiKeyConfigured: boolean;
  settingsConfigured: boolean;
  aiTaskCaptureEnabled: boolean;
  speechCaptureEnabled: boolean;
  assistantEnabled: boolean;
  tasksEnabled: boolean;
  assistantRecordingMaxMinutes: number | null;
  usageBudgetPeriod: AssistantUsageBudgetPeriod;
  usageBudgetCapUsd: number | null;
  usageBudgetUsedUsd: number;
}

export interface AssistantModelOption {
  id: string;
  name: string;
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[];
  supportedVoices: string[] | null;
}

export interface AssistantTaskCreationResult {
  tasks: Task[];
  listItems: ListItem[];
  usedFallback: boolean;
  message: string;
  costUsd: number;
}

export interface AssistantVoiceCommandResult {
  actions: AssistantVoiceAction[];
  transcript: string;
  /** BCP-47 language selected for the spoken confirmation, when detected. */
  responseLanguage?: string;
  message: string;
  tasks: Task[];
  listItems: ListItem[];
  usedFallback: boolean;
  costUsd: number;
  spokenAudioBase64: string | null;
  spokenAudioMimeType: string | null;
}

export interface AssistantTranscriptionResult {
  transcript: string;
  costUsd: number;
  debugLogId: string | null;
}

export interface AssistantDebugStatus {
  enabled: boolean;
}

export interface AssistantTaskDraft {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: TaskPriority;
  timerType?: TimerTypes;
  recurrenceRule?: string | null;
  recurrenceInterval?: number | null;
  recurrenceAnchorMode?: TaskRecurrenceAnchorMode;
  intentionSlug?: string | null;
  subIntentionSlug?: string | null;
}

export interface AssistantTimerCommand {
  action: Exclude<AssistantVoiceAction, 'createTask' | 'createListItem'>;
  timerType?: TimerTypes;
  intentionSlugs: string[];
  subIntentions: Record<string, string>;
}

export interface AssistantDebugProcessedOutput {
  tasks: AssistantTaskDraft[];
  timerCommand?: AssistantTimerCommand;
}

export type AssistantDebugModelCallStage =
  'transcription' | 'initial' | 'repair' | 'review';

export interface AssistantDebugModelCallAttempt {
  request: Record<string, unknown>;
  status: number | null;
  response?: unknown;
  error: string | null;
}

export interface AssistantDebugModelCall {
  provider: 'openrouter';
  endpoint: string;
  stage: AssistantDebugModelCallStage;
  request: Record<string, unknown>;
  attempts: AssistantDebugModelCallAttempt[];
  response?: unknown;
  content: string | null;
  costUsd: number;
  durationMs: number;
}

export interface AssistantDebugLogEntry {
  id: string;
  kind: AssistantDebugLogKind;
  source: AssistantDebugLogSource;
  status: AssistantDebugLogStatus;
  userPrompt: string | null;
  processedOutput: AssistantDebugProcessedOutput | null;
  invalidParserOutput: string | null;
  resolutionNotes: string[];
  timings: AssistantDebugTimings;
  modelCalls: AssistantDebugModelCall[];
  flagged: boolean;
  error: string | null;
  createdAt: string;
}

export interface AssistantDebugLogExport {
  version: 1;
  exportedAt: string;
  logs: AssistantDebugLogEntry[];
}

export interface AssistantDebugTimings {
  transcriptionMs?: number;
  contextMs?: number;
  modelRequestMs?: number;
  modelRepairMs?: number;
  modelReviewMs?: number;
  outputProcessingMs?: number;
  validationMs?: number;
  taskCreationMs?: number;
  timerActionMs?: number;
  speechSynthesisMs?: number;
  totalMs?: number;
}

export interface WatchIntentionSummary {
  slug: string;
  title: string | null;
  emoji: string | null;
  subSlug: string | null;
  subTitle: string | null;
  subEmoji: string | null;
}

export interface WatchTimerSummary {
  id: string;
  type: TimerTypes;
  status: Timer['status'];
  duration: number;
  remainingTime: number;
  endsAtMs: number | null;
  progress: number;
  intentions: WatchIntentionSummary[];
  sessionPosition: number | null;
  sessionTotal: number | null;
  stackedSessions: number | null;
  isExtension: boolean;
}

export interface WatchAssistantSummary {
  assistantEnabled: boolean;
  speechCaptureEnabled: boolean;
  aiTaskCaptureEnabled: boolean;
  assistantRecordingMaxMinutes: number | null;
  usageBudgetPeriod: AssistantUsageBudgetPeriod;
  usageBudgetCapUsd: number | null;
  usageBudgetUsedUsd: number;
  usageBudgetRemainingUsd: number | null;
}

export interface WatchTaskSummary {
  id: string;
  title: string;
  priority: TaskPriority;
  timerType: TimerTypes;
  dueDate: string | null;
  dueTime: string | null;
  intentionSlug: string | null;
  subIntentionSlug: string | null;
  intentionTitle: string | null;
  intentionEmoji: string | null;
  subIntentionTitle: string | null;
  subIntentionEmoji: string | null;
  followUpParent: TaskFollowUpParent | null;
  isFocused: boolean;
  isLinkedToTimer: boolean;
  isOverdue: boolean;
}

export interface WatchIntentionOption {
  slug: string;
  title: string;
  emoji: string;
  type: TimerTypes;
  subIntentions: WatchSubIntentionOption[];
}

export interface WatchSubIntentionOption {
  slug: string;
  title: string;
  emoji: string;
}

export interface WatchStatus {
  serverNowMs: number;
  language: AppLanguage;
  taskMode: WatchTaskMode;
  timer: WatchTimerSummary | null;
  assistant: WatchAssistantSummary;
  timerControls: {
    canStartOrResume: boolean;
    canPause: boolean;
    canAddFiveMinutes: boolean;
    canReset: boolean;
    canSkip: boolean;
    requiresIntentionSelection: boolean;
    intentionRequireSelection: boolean;
    intentionMultiSelect: boolean;
    advancedSkip: boolean;
    sessionsEnabled: boolean;
    canStartLongBreak: boolean;
  };
  tasks: WatchTaskSummary[];
  totalVisibleTasks: number;
  totalActiveTasks: number;
}
