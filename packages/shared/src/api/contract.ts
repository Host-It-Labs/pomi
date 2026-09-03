import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import {
  ASSISTANT_MAX_RECORDING_MINUTES,
  APP_LANGUAGE_VALUES,
  CLIENT_NOTIFICATION_TYPES,
  FEEDBACK_MAX_TEXT_LENGTH,
  FEEDBACK_TRANSCRIPTION_MAX_ENCODED_BYTES,
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_CREATION_SOURCES,
  TASK_FOLLOW_UP_DELAY_MAX_DAYS,
  TASK_IMPORT_MAX_ROWS,
  TASK_IMPORT_SOURCES,
  TASK_PRIORITIES,
  TASK_RECURRENCE_RULE_MAX_LENGTH,
  TASK_SORT_MODES,
  TASK_SLUG_MAX_LENGTH,
  TASK_STATUSES,
  TASK_TITLE_MAX_LENGTH,
  TIMER_TYPES,
} from '../constants';

const c = initContract();

const platformSchema = z.enum([
  'android',
  'ios',
  'web',
  'macos',
  'windows',
  'linux',
]);

const appLanguageSchema = z.enum(APP_LANGUAGE_VALUES);

const timerTypeSchema = z.enum([
  TIMER_TYPES.WORK,
  TIMER_TYPES.BREAK,
  TIMER_TYPES.LONG_BREAK,
]);

const taskPrioritySchema = z.enum([
  TASK_PRIORITIES.LOW,
  TASK_PRIORITIES.NORMAL,
  TASK_PRIORITIES.HIGH,
  TASK_PRIORITIES.URGENT,
]);

const taskStatusSchema = z.enum([
  TASK_STATUSES.ACTIVE,
  TASK_STATUSES.COMPLETED,
  TASK_STATUSES.ARCHIVED,
]);
const taskCreationSourceSchema = z.enum([
  TASK_CREATION_SOURCES.MANUAL,
  TASK_CREATION_SOURCES.ASSISTANT,
  TASK_CREATION_SOURCES.VOICE,
]);

const taskRecurrenceAnchorModeSchema = z.enum(['planned', 'completion']);
const taskDueTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const taskImportSourceSchema = z.nativeEnum(TASK_IMPORT_SOURCES);

const intentionTypeSchema = z.enum([
  TIMER_TYPES.WORK,
  TIMER_TYPES.BREAK,
  TIMER_TYPES.LONG_BREAK,
]);

const errorSchema = z.object({
  message: z.string(),
});

const successSchema = z.object({
  success: z.boolean(),
});

const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  createdAt: z.string(),
  isAdmin: z.boolean().optional(),
});

const systemInfoSchema = z.object({
  hostingMode: z.enum(['hosted', 'self-hosted']),
  selfHosted: z.boolean(),
});

const userDataTransferRowSchema = z.record(z.unknown());
const userDataTimerRuntimeSchema = z.object({
  currentTimer: userDataTransferRowSchema.nullable(),
  sessionState: userDataTransferRowSchema.nullable(),
  lastCompletionTimestamp: z.number().nullable(),
  idleDetected: z.boolean(),
  undoState: userDataTransferRowSchema.nullable(),
  undoHistory: z.array(userDataTransferRowSchema),
  redoHistory: z.array(userDataTransferRowSchema),
  extensionState: userDataTransferRowSchema.nullable(),
});
const userDataExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  sourceUser: z.object({
    id: z.string(),
    username: z.string(),
  }),
  data: z.object({
    preferences: userDataTransferRowSchema.nullable(),
    intentions: z.array(userDataTransferRowSchema),
    lists: z.array(userDataTransferRowSchema).optional(),
    vacationStates: z.array(userDataTransferRowSchema).optional(),
    statistics: z.array(userDataTransferRowSchema),
    tasks: z.array(userDataTransferRowSchema),
    taskEvents: z.array(userDataTransferRowSchema),
    taskImportRuns: z.array(userDataTransferRowSchema).optional(),
    assistantDebugSetting: userDataTransferRowSchema.nullable(),
    assistantDebugLogs: z.array(userDataTransferRowSchema),
    assistantUsageEvents: z.array(userDataTransferRowSchema),
    timerRuntime: userDataTimerRuntimeSchema,
  }),
});
const userDataImportResultSchema = z.object({
  success: z.boolean(),
  imported: z.object({
    preferences: z.number().int(),
    intentions: z.number().int(),
    lists: z.number().int().optional(),
    vacationStates: z.number().int().optional(),
    statistics: z.number().int(),
    tasks: z.number().int(),
    taskEvents: z.number().int(),
    taskImportRuns: z.number().int().optional(),
    assistantDebugSettings: z.number().int(),
    assistantDebugLogs: z.number().int(),
    assistantUsageEvents: z.number().int(),
    timerRuntime: z.boolean(),
  }),
});

const preferencesSchema = z.object({
  language: appLanguageSchema,
  workTimerDuration: z.number().int(),
  breakTimerDuration: z.number().int(),
  autoStartBreak: z.boolean(),
  autoStartWork: z.boolean().optional(),
  autoStartLongBreak: z.boolean().optional(),
  notifications: z.boolean(),
  notifyOnWorkComplete: z.boolean(),
  notifyOnBreakComplete: z.boolean(),
  notifyBeforeWorkComplete: z.boolean(),
  notifyBeforeTime: z.number().int(),
  soundNotifications: z.boolean(),
  pushNotifications: z.boolean(),
  timeZone: z.string(),
  globalShortcut: z.boolean(),
  keyboardShortcuts: z.boolean(),
  intentionExtension: z.boolean(),
  intentionRequireSelection: z.boolean(),
  intentionShowDailyCount: z.boolean(),
  intentionBreakIntentions: z.boolean(),
  intentionMultiSelect: z.boolean(),
  intentionShowBreakIntentionsInLongBreak: z.boolean(),
  intentionCustomDurations: z.boolean(),
  intentionSubIntentions: z.boolean(),
  intentionHabits: z.boolean(),
  workTimerLogsExtension: z.boolean(),
  sessionsExtension: z.boolean(),
  sessionPomodorosCount: z.number().int(),
  sessionHasLongBreak: z.boolean(),
  sessionLongBreakDuration: z.number().int(),
  resetBreakOnFirstIntention: z.boolean(),
  resetLongBreakOnFirstIntention: z.boolean(),
  resetWorkOnFirstIntention: z.boolean().optional(),
  sessionShowLongBreakButton: z.boolean(),
  sessionShowEta: z.boolean(),
  sessionStackTimers: z.boolean(),
  sessionAutoDetectLongBreak: z.boolean(),
  keepScreenAwake: z.boolean(),
  advancedSkip: z.boolean(),
  timerExtension: z.boolean(),
  timerExtrasSeen: z.boolean(),
  sessionsExtrasSeen: z.boolean(),
  intentionsExtrasSeen: z.boolean(),
  assistantExtension: z.boolean(),
  assistantTaskTranscriptsEnabled: z.boolean(),
  assistantTaskTranscriptMinWords: z.number().int().min(1),
  destinationDescriptionsEnabled: z.boolean().optional(),
  undoAlerts: z.boolean(),
  tasksExtension: z.boolean(),
  listsExtension: z.boolean().optional(),
  vacationExtension: z.boolean().optional(),
  vacationCoverageConfigured: z.boolean().optional(),
  tasksShowVacationCovered: z.boolean().optional(),
  longBreakToBreakEnabled: z.boolean().optional(),
  tasksShowSetupPrompts: z.boolean(),
  tasksShowInMinimizedTimer: z.boolean(),
  tasksAutoSwitchToIntentionMode: z.boolean(),
  tasksDuringBreaks: z.boolean(),
  taskDefaultDueDateMode: z.enum(['off', 'tomorrow', 'week', 'custom']),
  taskDefaultDueDateDays: z.number().int().min(1).max(365),
  taskDefaultSortMode: z.enum([
    TASK_SORT_MODES.DEFAULT,
    TASK_SORT_MODES.CREATED_DESC,
    TASK_SORT_MODES.CREATED_ASC,
  ]),
  hiddenHelpTips: z.array(z.string()).default([]),
  taskReminderPriorities: z.array(taskPrioritySchema),
  taskBeforeDueReminderMinutes: z.number().int().min(0),
  taskUrgentReminderRepeatEnabled: z.boolean(),
  taskUrgentReminderRepeatIntervalMinutes: z.number().int().min(1),
});

const preferencesUpdateSchema = preferencesSchema.partial();

const intentionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  emoji: z.string(),
  slug: z.string(),
  type: intentionTypeSchema,
  parentIntentionId: z.string().nullable(),
  parentIntention: z
    .object({
      id: z.string(),
      title: z.string(),
      emoji: z.string(),
      slug: z.string(),
    })
    .nullable()
    .optional(),
  hasCustomDuration: z.boolean(),
  customDuration: z.number().nullable(),
  keepScreenAwake: z.boolean(),
  isHabit: z.boolean(),
  isArchived: z.boolean(),
  isFavorite: z.boolean(),
  allowsTasks: z.boolean(),
  description: z.string().nullable(),
  vacationDefault: z.boolean(),
  usageCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const statisticsPeriodSchema = z.object({
  count: z.number().int(),
  duration: z.number().int(),
  change: z.number().int().nullable(),
  durationChange: z.number().int().nullable(),
});

const statisticsSummarySchema = z.object({
  today: statisticsPeriodSchema,
  week: statisticsPeriodSchema,
  month: statisticsPeriodSchema,
  year: statisticsPeriodSchema,
  heatmap: z.array(
    z.object({
      date: z.string(),
      count: z.number().int(),
      duration: z.number(),
    })
  ),
  heatmapThresholds: z.object({
    low: z.number().int(),
    medium: z.number().int(),
    high: z.number().int(),
    max: z.number().int(),
  }),
  availableIntentions: z.array(
    z.object({
      value: z.string(),
      label: z.string(),
      title: z.string(),
      emoji: z.string(),
      isArchived: z.boolean(),
      hasSubIntentions: z.boolean().optional(),
    })
  ),
  firstLogDate: z.string().nullable(),
});

const topIntentionStatSchema = z.object({
  slug: z.string(),
  label: z.string(),
  count: z.number().int(),
  duration: z.number().int(),
});

const topIntentionsPeriodSchema = z.enum(['today', 'week', 'month', 'year']);

const topIntentionsQuerySchema = z.object({
  period: topIntentionsPeriodSchema,
  type: intentionTypeSchema.optional(),
  parentIntention: z.string().optional(),
  metric: z.enum(['hours', 'count']).optional(),
});

const heatmapQuerySchema = z.object({
  year: z.coerce.number().int(),
  type: intentionTypeSchema.optional(),
  intention: z.string().optional(),
  subIntention: z.string().optional(),
});

const workTimerLogSchema = z.object({
  id: z.string(),
  type: timerTypeSchema,
  intention: z.string().optional(),
  intentionTitle: z.string().optional(),
  intentionEmoji: z.string().optional(),
  intentions: z.array(
    z.object({
      slug: z.string(),
      title: z.string().optional(),
      emoji: z.string().optional(),
      type: intentionTypeSchema.optional(),
      subIntention: z
        .object({
          slug: z.string(),
          title: z.string().optional(),
          emoji: z.string().optional(),
        })
        .optional(),
    })
  ),
  subIntentions: z.record(z.string()).optional(),
  duration: z.number().int(),
  completedAt: z.number().int(),
  date: z.string(),
});

const sessionCreateSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  language: appLanguageSchema.optional(),
});

const sessionResponseSchema = z.object({
  user: userSchema,
  token: z.string(),
  isNewUser: z.boolean(),
  language: appLanguageSchema,
});

const intentionsQuerySchema = z.object({
  type: intentionTypeSchema.optional(),
  isArchived: z
    .union([
      z.boolean(),
      z.enum(['true', 'false']).transform(v => v === 'true'),
    ])
    .optional(),
  parentSlug: z.string().optional(),
  includeSubIntentions: z
    .union([
      z.boolean(),
      z.enum(['true', 'false']).transform(v => v === 'true'),
    ])
    .optional(),
});

const intentionCreateSchema = z.object({
  title: z.string().min(1),
  emoji: z.string().min(1),
  type: intentionTypeSchema.optional(),
  hasCustomDuration: z.boolean().optional(),
  customDuration: z.number().int().min(1).optional(),
  keepScreenAwake: z.boolean().optional(),
  isHabit: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
  allowsTasks: z.boolean().optional(),
  parentIntentionId: z.string().nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});

const intentionUpdateSchema = z.object({
  title: z.string().min(1),
  emoji: z.string().min(1),
  type: intentionTypeSchema.optional(),
  hasCustomDuration: z.boolean().optional(),
  customDuration: z.number().int().min(1).optional(),
  keepScreenAwake: z.boolean().optional(),
  isHabit: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
  allowsTasks: z.boolean().optional(),
  parentIntentionId: z.string().nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});

const taskFollowUpDefinitionSchema = z.object({
  title: z.string().min(1).max(TASK_TITLE_MAX_LENGTH),
  description: z.string().max(TASK_DESCRIPTION_MAX_LENGTH).nullable(),
  dueTime: taskDueTimeSchema.nullable(),
  priority: taskPrioritySchema,
  timerType: timerTypeSchema,
  intentionSlug: z.string().max(TASK_SLUG_MAX_LENGTH).nullable(),
  subIntentionSlug: z.string().max(TASK_SLUG_MAX_LENGTH).nullable(),
  vacationEligible: z.boolean(),
});

const taskSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  sourceTranscript: z.string().nullable(),
  creationSource: taskCreationSourceSchema,
  importSource: z.string().nullable(),
  importSourceTaskId: z.string().nullable(),
  dueDate: z.string().nullable(),
  dueTime: taskDueTimeSchema.nullable(),
  manualOrder: z.number().int().nullable(),
  manualOrderOverride: z.boolean(),
  priority: taskPrioritySchema,
  status: taskStatusSchema,
  timerType: timerTypeSchema,
  customDuration: z.number().int().min(1).nullable(),
  pinnedAt: z.string().nullable(),
  intentionSlug: z.string().nullable(),
  subIntentionSlug: z.string().nullable(),
  recurrenceRule: z.string().nullable(),
  recurrenceInterval: z.number().min(1).nullable(),
  recurrenceAnchorMode: taskRecurrenceAnchorModeSchema,
  followUpTaskId: z.string().nullable(),
  followUpDefinition: taskFollowUpDefinitionSchema.nullable().optional(),
  followUpDelayDays: z
    .number()
    .int()
    .min(0)
    .max(TASK_FOLLOW_UP_DELAY_MAX_DAYS)
    .nullable(),
  followUpSourceTaskId: z.string().nullable(),
  followUpParent: z
    .object({ id: z.string(), title: z.string() })
    .nullable()
    .optional(),
  itemKind: z.literal('task'),
  vacationEligible: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const listSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  emoji: z.string().nullable(),
  description: z.string().nullable(),
  vacationDefault: z.boolean(),
  isArchived: z.boolean(),
  isFavorite: z.boolean(),
  sourceIntentionId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const listItemSchema = z.object({
  id: z.string(),
  userId: z.string(),
  listId: z.string(),
  title: z.string(),
  dueDate: z.string().nullable(),
  priority: taskPrioritySchema,
  status: taskStatusSchema,
  manualOrder: z.number().int().nullable(),
  manualOrderOverride: z.boolean(),
  itemKind: z.literal('listItem'),
  vacationEligible: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const vacationStateSchema = z.object({
  active: z.boolean(),
  runId: z.string().nullable(),
  startedOn: z.string().nullable(),
  endsOn: z.string().nullable(),
});

const taskCreateSchema = z.object({
  title: z.string().min(1).max(TASK_TITLE_MAX_LENGTH),
  description: z
    .string()
    .max(TASK_DESCRIPTION_MAX_LENGTH)
    .nullable()
    .optional(),
  dueDate: z.string().min(1).nullable().optional(),
  dueTime: taskDueTimeSchema.nullable().optional(),
  priority: taskPrioritySchema.optional(),
  timerType: timerTypeSchema.optional(),
  customDuration: z.number().int().min(1).nullable().optional(),
  pinned: z.boolean().optional(),
  intentionSlug: z.string().max(TASK_SLUG_MAX_LENGTH).nullable().optional(),
  subIntentionSlug: z.string().max(TASK_SLUG_MAX_LENGTH).nullable().optional(),
  recurrenceRule: z
    .string()
    .max(TASK_RECURRENCE_RULE_MAX_LENGTH)
    .nullable()
    .optional(),
  recurrenceInterval: z.number().min(1).nullable().optional(),
  recurrenceAnchorMode: taskRecurrenceAnchorModeSchema.optional(),
  followUpTaskId: z.string().nullable().optional(),
  followUpDefinition: taskFollowUpDefinitionSchema.nullable().optional(),
  followUpDelayDays: z
    .number()
    .int()
    .min(0)
    .max(TASK_FOLLOW_UP_DELAY_MAX_DAYS)
    .nullable()
    .optional(),
  vacationEligible: z.boolean().optional(),
});

const taskImportRowSchema = z.object({
  sourceId: z.string().min(1).max(TASK_SLUG_MAX_LENGTH),
  title: z.string().min(1).max(TASK_TITLE_MAX_LENGTH),
  dueDate: z.string().nullable().optional(),
  dueTime: taskDueTimeSchema.nullable().optional(),
  description: z
    .string()
    .max(TASK_DESCRIPTION_MAX_LENGTH)
    .nullable()
    .optional(),
  priority: taskPrioritySchema.optional(),
  timerType: timerTypeSchema.optional(),
  recurrenceRule: z
    .string()
    .max(TASK_RECURRENCE_RULE_MAX_LENGTH)
    .nullable()
    .optional(),
  recurrenceInterval: z.number().min(1).nullable().optional(),
  recurrenceAnchorMode: taskRecurrenceAnchorModeSchema.optional(),
  intentionSlug: z.string().max(TASK_SLUG_MAX_LENGTH).nullable().optional(),
  subIntentionSlug: z.string().max(TASK_SLUG_MAX_LENGTH).nullable().optional(),
  newIntentionTitle: z
    .string()
    .max(TASK_TITLE_MAX_LENGTH)
    .nullable()
    .optional(),
  newIntentionEmoji: z.string().max(16).nullable().optional(),
  newSubIntentionTitle: z
    .string()
    .max(TASK_TITLE_MAX_LENGTH)
    .nullable()
    .optional(),
  include: z.boolean(),
});

const taskImportSchema = z.object({
  source: taskImportSourceSchema,
  tasks: z.array(taskImportRowSchema).max(TASK_IMPORT_MAX_ROWS),
});

const taskImportSkippedRowSchema = z.object({
  sourceId: z.string().min(1),
  title: z.string(),
  reason: z.enum(['duplicate', 'invalid']),
  message: z.string(),
});

const taskImportResponseSchema = z.object({
  imported: z.array(taskSchema),
  skipped: z.array(taskImportSkippedRowSchema),
});

const taskImportStatusSchema = z.object({
  hasImportedTasks: z.boolean(),
});

const taskUpdateSchema = z.object({
  title: z.string().min(1).max(TASK_TITLE_MAX_LENGTH).optional(),
  description: z
    .string()
    .max(TASK_DESCRIPTION_MAX_LENGTH)
    .nullable()
    .optional(),
  dueDate: z.string().min(1).nullable().optional(),
  dueTime: taskDueTimeSchema.nullable().optional(),
  manualOrder: z.number().int().min(0).nullable().optional(),
  manualOrderOverride: z.boolean().optional(),
  priority: taskPrioritySchema.optional(),
  timerType: timerTypeSchema.optional(),
  customDuration: z.number().int().min(1).nullable().optional(),
  pinned: z.boolean().optional(),
  status: taskStatusSchema.optional(),
  intentionSlug: z.string().max(TASK_SLUG_MAX_LENGTH).nullable().optional(),
  subIntentionSlug: z.string().max(TASK_SLUG_MAX_LENGTH).nullable().optional(),
  recurrenceRule: z
    .string()
    .max(TASK_RECURRENCE_RULE_MAX_LENGTH)
    .nullable()
    .optional(),
  recurrenceInterval: z.number().min(1).nullable().optional(),
  recurrenceAnchorMode: taskRecurrenceAnchorModeSchema.optional(),
  expectedDueDate: z.string().min(1).nullable().optional(),
  expectedDueTime: taskDueTimeSchema.nullable().optional(),
  followUpTaskId: z.string().nullable().optional(),
  followUpDefinition: taskFollowUpDefinitionSchema.nullable().optional(),
  followUpDelayDays: z
    .number()
    .int()
    .min(0)
    .max(TASK_FOLLOW_UP_DELAY_MAX_DAYS)
    .nullable()
    .optional(),
  vacationEligible: z.boolean().optional(),
});

const taskReorderSchema = z.object({
  tasks: z
    .array(
      z.object({
        id: z.string(),
        manualOrder: z.number().int().min(0),
        manualOrderOverride: z.boolean().optional(),
      })
    )
    .min(1),
});

const taskStatisticsFilterSchema = z.enum([
  'created',
  'completed',
  'overdue',
  'onTime',
  'archived',
]);

const taskStatisticsSchema = z.object({
  overview: z.object({
    active: z.number().int(),
    recurring: z.number().int(),
    overdue: z.number().int(),
    undated: z.number().int(),
    pinned: z.number().int(),
  }),
  today: statisticsPeriodSchema,
  week: statisticsPeriodSchema,
  month: statisticsPeriodSchema,
  year: statisticsPeriodSchema,
  heatmap: z.array(
    z.object({
      date: z.string(),
      count: z.number().int(),
      duration: z.number(),
    })
  ),
  heatmapThresholds: z.object({
    low: z.number().int(),
    medium: z.number().int(),
    high: z.number().int(),
    max: z.number().int(),
  }),
  ranking: z.array(topIntentionStatSchema),
  firstLogDate: z.string().nullable(),
});

const assistantSettingsSchema = z.object({
  textModel: z.string().min(1).nullable(),
  transcriptionModel: z.string().min(1).nullable(),
  speechModel: z.string().min(1).nullable(),
  speechVoice: z.string().min(1).nullable(),
  assistantRecordingMaxMinutes: z
    .number()
    .int()
    .min(1)
    .max(ASSISTANT_MAX_RECORDING_MINUTES)
    .nullable(),
  usageBudgetPeriod: z.enum(['daily', 'monthly']),
  usageBudgetCapUsd: z.number().min(0).nullable(),
});

const assistantStatusSchema = z.object({
  apiKeyConfigured: z.boolean(),
  settingsConfigured: z.boolean(),
  aiTaskCaptureEnabled: z.boolean(),
  speechCaptureEnabled: z.boolean(),
  assistantEnabled: z.boolean(),
  tasksEnabled: z.boolean(),
  assistantRecordingMaxMinutes: z
    .number()
    .int()
    .min(1)
    .max(ASSISTANT_MAX_RECORDING_MINUTES)
    .nullable(),
  usageBudgetPeriod: z.enum(['daily', 'monthly']),
  usageBudgetCapUsd: z.number().nullable(),
  usageBudgetUsedUsd: z.number(),
});

const assistantModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  inputModalities: z.array(z.string()),
  outputModalities: z.array(z.string()),
  supportedParameters: z.array(z.string()),
  supportedVoices: z.array(z.string()).nullable(),
});

const assistantTaskDefaultsSchema = taskCreateSchema.omit({
  title: true,
});

const assistantTaskFromTextSchema = z.object({
  text: z.string().min(1).max(1_000_000),
  listId: z.string().uuid().nullable().optional(),
  defaults: assistantTaskDefaultsSchema.optional(),
  debugLogId: z.string().uuid().nullable().optional(),
});

const assistantTaskPreparationSchema = assistantTaskFromTextSchema.extend({
  preparationId: z.string().uuid(),
});

const assistantTaskCreationResponseSchema = z.object({
  tasks: z.array(taskSchema),
  listItems: z.array(listItemSchema),
  usedFallback: z.boolean(),
  message: z.string(),
  costUsd: z.number(),
});

const assistantVoiceCommandSchema = z.object({
  audioBase64: z.string().min(1),
  mimeType: z.string().min(1).max(128),
});

const assistantVoiceCommandResponseSchema = z.object({
  actions: z.array(
    z.enum([
      'createTask',
      'createListItem',
      'startTimer',
      'pauseTimer',
      'addFiveMinutes',
      'none',
    ])
  ),
  transcript: z.string(),
  responseLanguage: z.string().min(1).max(32).optional(),
  message: z.string(),
  tasks: z.array(taskSchema),
  listItems: z.array(listItemSchema),
  usedFallback: z.boolean(),
  costUsd: z.number(),
  spokenAudioBase64: z.string().nullable(),
  spokenAudioMimeType: z.string().nullable(),
});

const assistantTranscriptionResponseSchema = z.object({
  transcript: z.string(),
  costUsd: z.number(),
  debugLogId: z.string().uuid().nullable(),
});

const assistantTaskTranscriptionSchema = assistantVoiceCommandSchema.extend({
  debugLogId: z.string().uuid().nullable().optional(),
});

const assistantVoiceTranscriptSchema = z.object({
  transcript: z.string().min(1).max(1_000_000),
  transcriptionCostUsd: z.number().min(0).optional(),
  debugLogId: z.string().uuid().nullable().optional(),
});

const assistantVoicePreparationSchema = z.discriminatedUnion('kind', [
  assistantVoiceCommandSchema.extend({
    kind: z.literal('audio'),
    preparationId: z.string().uuid(),
    debugLogId: z.string().uuid().nullable().optional(),
  }),
  assistantVoiceTranscriptSchema.extend({
    kind: z.literal('transcript'),
    preparationId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal('chunks'),
    preparationId: z.string().uuid(),
  }),
]);

const assistantVoiceChunkManifestSchema = z.object({
  preparationId: z.string().uuid(),
  manifest: z
    .array(
      z.object({
        audioSha256: z.string().regex(/^[a-f0-9]{64}$/),
        mimeType: z.string().min(1).max(128),
      })
    )
    .min(2),
});

const assistantVoiceChunkTranscriptionSchema =
  assistantVoiceCommandSchema.extend({
    preparationId: z.string().uuid(),
    index: z.number().int().min(0),
    debugLogId: z.string().uuid().nullable().optional(),
  });

const assistantVoiceFinalizationSchema = z.object({
  preparationId: z.string().uuid(),
});

const assistantDebugStatusSchema = z.object({
  enabled: z.boolean(),
});

const assistantDebugProcessedOutputSchema = z.object({
  tasks: z.array(taskCreateSchema),
  timerCommand: z
    .object({
      action: z.enum(['startTimer', 'pauseTimer', 'addFiveMinutes', 'none']),
      timerType: timerTypeSchema.optional(),
      intentionSlugs: z.array(z.string()),
      subIntentions: z.record(z.string()),
    })
    .optional(),
});

const assistantDebugModelCallAttemptSchema = z.object({
  request: z.record(z.unknown()),
  status: z.number().int().nullable(),
  response: z.any(),
  error: z.string().nullable(),
});

const assistantDebugModelCallSchema = z.object({
  provider: z.literal('openrouter'),
  endpoint: z.string().url(),
  stage: z.enum(['transcription', 'initial', 'repair', 'review']),
  request: z.record(z.unknown()),
  attempts: z.array(assistantDebugModelCallAttemptSchema),
  response: z.any(),
  content: z.string().nullable(),
  costUsd: z.number(),
  durationMs: z.number(),
});

const assistantDebugLogSchema = z.object({
  id: z.string(),
  kind: z.enum(['taskCapture', 'voiceCommand']),
  source: z.enum(['typed', 'dictation', 'assistantVoice']),
  status: z.enum(['dictated', 'succeeded', 'fallback', 'failed']),
  userPrompt: z.string().nullable(),
  processedOutput: assistantDebugProcessedOutputSchema.nullable(),
  invalidParserOutput: z.string().nullable(),
  resolutionNotes: z.array(z.string()),
  timings: z.object({
    transcriptionMs: z.number().optional(),
    contextMs: z.number().optional(),
    modelRequestMs: z.number().optional(),
    modelRepairMs: z.number().optional(),
    modelReviewMs: z.number().optional(),
    outputProcessingMs: z.number().optional(),
    validationMs: z.number().optional(),
    taskCreationMs: z.number().optional(),
    timerActionMs: z.number().optional(),
    speechSynthesisMs: z.number().optional(),
    totalMs: z.number().optional(),
  }),
  modelCalls: z.array(assistantDebugModelCallSchema),
  flagged: z.boolean(),
  error: z.string().nullable(),
  createdAt: z.string(),
});

const assistantDebugLogExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  logs: z.array(assistantDebugLogSchema),
});

const watchTaskModeSchema = z.enum(['intention', 'general']);

const watchIntentionSummarySchema = z.object({
  slug: z.string(),
  title: z.string().nullable(),
  emoji: z.string().nullable(),
  subSlug: z.string().nullable(),
  subTitle: z.string().nullable(),
  subEmoji: z.string().nullable(),
});

const watchTimerSummarySchema = z.object({
  id: z.string(),
  type: timerTypeSchema,
  status: z.enum(['running', 'paused', 'completed']),
  duration: z.number().int(),
  remainingTime: z.number().int(),
  endsAtMs: z.number().int().nullable(),
  progress: z.number().min(0).max(1),
  intentions: z.array(watchIntentionSummarySchema),
  sessionPosition: z.number().int().nullable(),
  sessionTotal: z.number().int().nullable(),
  stackedSessions: z.number().int().nullable(),
  isExtension: z.boolean(),
});

const watchAssistantSummarySchema = z.object({
  assistantEnabled: z.boolean(),
  speechCaptureEnabled: z.boolean(),
  aiTaskCaptureEnabled: z.boolean(),
  assistantRecordingMaxMinutes: z
    .number()
    .int()
    .min(1)
    .max(ASSISTANT_MAX_RECORDING_MINUTES)
    .nullable(),
  usageBudgetPeriod: z.enum(['daily', 'monthly']),
  usageBudgetCapUsd: z.number().nullable(),
  usageBudgetUsedUsd: z.number(),
  usageBudgetRemainingUsd: z.number().nullable(),
});

const watchIntentionOptionSchema = z.object({
  slug: z.string(),
  title: z.string(),
  emoji: z.string(),
  type: timerTypeSchema,
  subIntentions: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      emoji: z.string(),
    })
  ),
});

const watchTaskSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  priority: taskPrioritySchema,
  timerType: timerTypeSchema,
  dueDate: z.string().nullable(),
  dueTime: taskDueTimeSchema.nullable(),
  intentionSlug: z.string().nullable(),
  subIntentionSlug: z.string().nullable(),
  intentionTitle: z.string().nullable(),
  intentionEmoji: z.string().nullable(),
  subIntentionTitle: z.string().nullable(),
  subIntentionEmoji: z.string().nullable(),
  followUpParent: z.object({ id: z.string(), title: z.string() }).nullable(),
  isFocused: z.boolean(),
  isLinkedToTimer: z.boolean(),
  isOverdue: z.boolean(),
});

const watchStatusSchema = z.object({
  serverNowMs: z.number().int(),
  language: appLanguageSchema,
  taskMode: watchTaskModeSchema,
  timer: watchTimerSummarySchema.nullable(),
  assistant: watchAssistantSummarySchema,
  timerControls: z.object({
    canStartOrResume: z.boolean(),
    canPause: z.boolean(),
    canAddFiveMinutes: z.boolean(),
    canReset: z.boolean(),
    canSkip: z.boolean(),
    requiresIntentionSelection: z.boolean(),
    intentionRequireSelection: z.boolean(),
    intentionMultiSelect: z.boolean(),
    advancedSkip: z.boolean(),
    sessionsEnabled: z.boolean(),
    canStartLongBreak: z.boolean(),
    resetBreakOnFirstIntention: z.boolean(),
    resetLongBreakOnFirstIntention: z.boolean(),
    resetWorkOnFirstIntention: z.boolean().optional(),
  }),
  tasks: z.array(watchTaskSummarySchema),
  totalVisibleTasks: z.number().int(),
  totalActiveTasks: z.number().int(),
});

const taskEventLogSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  eventType: z.enum([TASK_STATUSES.COMPLETED, TASK_STATUSES.ARCHIVED]),
  title: z.string(),
  priority: taskPrioritySchema,
  timerType: timerTypeSchema,
  intentionSlug: z.string().nullable(),
  subIntentionSlug: z.string().nullable(),
  dueDate: z.string().nullable(),
  dueTime: taskDueTimeSchema.nullable(),
  isOverdue: z.boolean(),
  occurredAt: z.number().int(),
  date: z.string(),
  canRevert: z.boolean(),
});

const statisticsQuerySchema = z.object({
  intention: z.string().optional(),
  subIntention: z.string().optional(),
  type: intentionTypeSchema.optional(),
});

const workTimerLogsQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const workTimerLogUpdateSchema = z.object({
  intention: z.string().nullable().optional(),
  intentions: z.array(z.string()).optional(),
  subIntentions: z.record(z.string()).optional(),
  duration: z
    .number()
    .int()
    .min(1)
    .max(24 * 60 * 60 * 1000),
});

const todayIntentionsSchema = z.object({
  count: z.number().int(),
  bySlug: z.record(z.number().int()),
  subBySlug: z.record(z.number().int()).optional(),
});

const notificationProviderSchema = z.object({
  arePushNotificationsEnabled: z.boolean(),
});

const notificationTestSchema = z.object({
  type: z.enum([
    CLIENT_NOTIFICATION_TYPES.COMPLETE,
    CLIENT_NOTIFICATION_TYPES.WARNING,
    CLIENT_NOTIFICATION_TYPES.LONG_BREAK_DETECTED,
    CLIENT_NOTIFICATION_TYPES.PAUSED_TIMER_REMINDER,
  ]),
  timerType: timerTypeSchema,
  minutesLeft: z.number().int().min(1).optional(),
  isLastWorkTimerInSession: z.boolean().optional(),
});

const userActionIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const userActionSchema = z
  .union([
    z.object({
      kind: z.literal('timer'),
      operation: z.enum([
        'createOrResume',
        'selectIntention',
        'setIntentions',
        'pause',
        'reset',
        'skip',
        'addFiveMinutes',
        'undo',
        'redo',
        'clearHistory',
        'stack',
        'setSessionPosition',
        'removeFocusedTask',
        'resolveExtension',
        'convertLongBreakToBreak',
      ]),
      timerType: timerTypeSchema.optional(),
      intention: z.string().optional(),
      intentions: z.array(z.string()).optional(),
      subIntentions: z.record(z.string()).optional(),
      focusedTaskId: z.string().optional(),
      customDuration: z.number().int().min(1).nullable().optional(),
      taskId: z.string().optional(),
      position: z.number().int().optional(),
      extensionAction: z.enum(['logElapsed', 'addFiveMinutes']).optional(),
      requestedLogMode: z.enum(['none', 'elapsed', 'full']).optional(),
      resetOnFirstIntention: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal('tasks'),
      operation: z.enum([
        'create',
        'update',
        'reorder',
        'import',
        'complete',
        'revert',
      ]),
      taskId: z.string().min(1).max(128).optional(),
      eventId: z.string().min(1).max(128).optional(),
      title: z.string().min(1).max(TASK_TITLE_MAX_LENGTH).optional(),
      description: z
        .string()
        .max(TASK_DESCRIPTION_MAX_LENGTH)
        .nullable()
        .optional(),
      dueDate: z.string().min(1).nullable().optional(),
      dueTime: taskDueTimeSchema.nullable().optional(),
      priority: taskPrioritySchema.optional(),
      timerType: timerTypeSchema.optional(),
      customDuration: z.number().int().min(1).nullable().optional(),
      pinned: z.boolean().optional(),
      status: taskStatusSchema.optional(),
      manualOrder: z.number().int().min(0).nullable().optional(),
      manualOrderOverride: z.boolean().optional(),
      intentionSlug: z.string().max(TASK_SLUG_MAX_LENGTH).nullable().optional(),
      subIntentionSlug: z
        .string()
        .max(TASK_SLUG_MAX_LENGTH)
        .nullable()
        .optional(),
      recurrenceRule: z
        .string()
        .max(TASK_RECURRENCE_RULE_MAX_LENGTH)
        .nullable()
        .optional(),
      recurrenceInterval: z.number().min(1).nullable().optional(),
      recurrenceAnchorMode: taskRecurrenceAnchorModeSchema.optional(),
      expectedDueDate: z.string().min(1).nullable().optional(),
      expectedDueTime: taskDueTimeSchema.nullable().optional(),
      followUpTaskId: z.string().nullable().optional(),
      followUpDefinition: taskFollowUpDefinitionSchema.nullable().optional(),
      followUpDelayDays: z
        .number()
        .int()
        .min(0)
        .max(TASK_FOLLOW_UP_DELAY_MAX_DAYS)
        .nullable()
        .optional(),
      vacationEligible: z.boolean().optional(),
      creationSource: taskCreationSourceSchema.optional(),
      reorder: z
        .array(
          z.object({
            id: z.string().min(1).max(128),
            manualOrder: z.number().int().min(0),
            manualOrderOverride: z.boolean().optional(),
          })
        )
        .max(TASK_IMPORT_MAX_ROWS)
        .optional(),
      importSource: z.string().min(1).max(128).optional(),
      rows: z.array(taskImportRowSchema).max(TASK_IMPORT_MAX_ROWS).optional(),
    }),
    z.object({
      kind: z.literal('intentions'),
      operation: z.enum([
        'create',
        'update',
        'delete',
        'archive',
        'unarchive',
        'reparent',
      ]),
      slug: z.string().optional(),
      title: z.string().optional(),
      emoji: z.string().optional(),
      type: intentionTypeSchema.optional(),
      hasCustomDuration: z.boolean().optional(),
      customDuration: z.number().int().optional(),
      keepScreenAwake: z.boolean().optional(),
      isHabit: z.boolean().optional(),
      isFavorite: z.boolean().optional(),
      allowsTasks: z.boolean().optional(),
      parentIntentionId: z.string().nullable().optional(),
      parentSlug: z.string().optional(),
      keepStats: z.boolean().optional(),
      description: z.string().max(1000).nullable().optional(),
    }),
    z.object({
      kind: z.literal('preferences'),
      operation: z.enum(['update', 'toggle']),
      updates: preferencesUpdateSchema.optional(),
      key: z.string().optional(),
    }),
    z.object({
      kind: z.literal('assistant'),
      operation: z.enum([
        'createTaskFromText',
        'commitPreparedTaskFromText',
        'commitPreparedVoiceCommand',
        'updateSettings',
        'updateDebugStatus',
        'updateDebugLogFlag',
        'clearDebugLogs',
      ]),
      payload: z.record(z.unknown()).optional(),
    }),
    z.object({
      kind: z.literal('workTimerLog'),
      operation: z.enum(['update', 'delete']),
      logId: z.string(),
      payload: z.record(z.unknown()).optional(),
    }),
    z.object({
      kind: z.literal('system'),
      operation: z.literal('importUserData'),
      payload: z.record(z.unknown()),
    }),
    z.object({
      kind: z.literal('notifications'),
      operation: z.literal('test'),
      payload: notificationTestSchema,
    }),
    z.object({
      kind: z.literal('feedback'),
      operation: z.literal('submit'),
      text: z.string().trim().min(1).max(FEEDBACK_MAX_TEXT_LENGTH),
      diagnostics: z
        .object({
          appVersion: z.string().max(100).optional(),
          platform: z.string().max(100).optional(),
          path: z.string().max(500).optional(),
          viewport: z.string().max(100).optional(),
        })
        .optional(),
    }),
    z
      .object({
        kind: z.literal('lists'),
        operation: z.enum([
          'create',
          'update',
          'createItem',
          'updateItem',
          'resetCompletedItems',
          'convertIntention',
          'convertToIntention',
          'convertTaskToListItem',
          'convertListItemToTask',
        ]),
        intentionSlug: z.string().optional(),
        listId: z.string().optional(),
        itemId: z.string().optional(),
        taskId: z.string().optional(),
        subIntentionSlug: z.string().nullable().optional(),
        title: z.string().trim().min(1).max(500).optional(),
        emoji: z.string().max(16).nullable().optional(),
        description: z.string().max(1000).nullable().optional(),
        dueDate: z.string().nullable().optional(),
        priority: taskPrioritySchema.optional(),
        status: taskStatusSchema.optional(),
        vacationDefault: z.boolean().optional(),
        vacationEligible: z.boolean().optional(),
        isArchived: z.boolean().optional(),
        isFavorite: z.boolean().optional(),
      })
      .superRefine((action, context) => {
        if (action.operation === 'createItem' && !action.title) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['title'],
            message: 'Title is required',
          });
        }
        if (
          action.operation === 'convertTaskToListItem' &&
          (!action.taskId || !action.listId)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['taskId'],
            message: 'Task and List are required',
          });
        }
        if (
          action.operation === 'convertListItemToTask' &&
          (!action.itemId || !action.intentionSlug)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['itemId'],
            message: 'List item and Intention are required',
          });
        }
      }),
    z.object({
      kind: z.literal('vacation'),
      operation: z.enum(['configure', 'activate', 'deactivate']),
      endsOn: z.string().nullable().optional(),
      intentionSlugs: z.array(z.string()).optional(),
      listIds: z.array(z.string().uuid()).optional(),
      excludedItemIds: z.array(z.string().uuid()).optional(),
    }),
  ])
  .superRefine((action, context) => {
    if (action.kind === 'timer') {
      if (action.operation === 'createOrResume' && !action.timerType) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['timerType'],
          message: 'Timer type is required',
        });
      }
      if (
        action.operation === 'setSessionPosition' &&
        action.position === undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['position'],
          message: 'Position is required',
        });
      }
      if (action.operation === 'resolveExtension' && !action.extensionAction) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['extensionAction'],
          message: 'Extension action is required',
        });
      }
      if (action.operation === 'selectIntention' && !action.intention) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['intention'],
          message: 'Intention is required',
        });
      }
      if (action.operation === 'setIntentions' && !action.intentions) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['intentions'],
          message: 'Intentions are required',
        });
      }
    }
    if (action.kind === 'tasks') {
      if (action.operation === 'create' && !action.title) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['title'],
          message: 'Task title is required',
        });
      }
      if (['update', 'complete'].includes(action.operation) && !action.taskId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['taskId'],
          message: 'Task ID is required',
        });
      }
      if (action.operation === 'revert' && !action.eventId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['eventId'],
          message: 'Event ID is required',
        });
      }
      if (action.operation === 'reorder' && !action.reorder) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reorder'],
          message: 'Reorder payload is required',
        });
      }
      if (
        action.operation === 'import' &&
        (!action.importSource || !action.rows)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows'],
          message: 'Import source and rows are required',
        });
      }
    }
    if (action.kind === 'intentions') {
      if (action.operation === 'create' && (!action.title || !action.emoji)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['title'],
          message: 'Intention title and emoji are required',
        });
      }
      if (
        ['update', 'delete', 'archive', 'unarchive', 'reparent'].includes(
          action.operation
        ) &&
        !action.slug
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['slug'],
          message: 'Intention slug is required',
        });
      }
      if (action.operation === 'update' && (!action.title || !action.emoji)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['title'],
          message: 'Intention title and emoji are required',
        });
      }
      if (
        action.operation === 'reparent' &&
        !(action.parentSlug ?? action.parentIntentionId)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['parentSlug'],
          message: 'Parent intention is required',
        });
      }
    }
    if (action.kind === 'preferences') {
      if (action.operation === 'update' && !action.updates) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['updates'],
          message: 'Preference updates are required',
        });
      }
      if (action.operation === 'toggle' && !action.key) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['key'],
          message: 'Preference key is required',
        });
      }
    }
    if (
      action.kind === 'workTimerLog' &&
      action.operation === 'update' &&
      !action.payload
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payload'],
        message: 'Log update payload is required',
      });
    }
    if (
      action.kind === 'assistant' &&
      (action.operation === 'createTaskFromText' ||
        action.operation === 'commitPreparedTaskFromText' ||
        action.operation === 'commitPreparedVoiceCommand') &&
      !action.payload
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payload'],
        message: 'Assistant payload is required',
      });
    }
    if (
      action.kind === 'assistant' &&
      (action.operation === 'commitPreparedTaskFromText' ||
        action.operation === 'commitPreparedVoiceCommand') &&
      !z.string().uuid().safeParse(action.payload?.preparationId).success
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payload', 'preparationId'],
        message: 'Assistant preparation ID must be a UUID',
      });
    }
  });

const userActionStatusSchema = z.object({
  actionId: userActionIdSchema,
  status: z.enum(['accepted', 'running', 'succeeded', 'failed', 'cancelled']),
  action: z.union([
    userActionSchema,
    z.object({ kind: z.literal('cancellation') }),
  ]),
  result: z.unknown().optional(),
  error: errorSchema.optional(),
  outcomeUnknown: z.boolean().optional(),
  acceptedAt: z.number().int(),
  startedAt: z.number().int().optional(),
  completedAt: z.number().int().optional(),
  updatedAt: z.number().int(),
});

export { userActionIdSchema, userActionSchema, userActionStatusSchema };

const pushTokenUpdateSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['android', 'ios']),
});

export const apiContract = c.router({
  userActions: c.router({
    submit: {
      method: 'POST',
      path: '/user-actions',
      body: z.object({
        actionId: userActionIdSchema,
        action: userActionSchema,
      }),
      responses: {
        202: userActionStatusSchema,
        400: errorSchema,
        401: errorSchema,
      },
    },
    status: {
      method: 'GET',
      path: '/user-actions/:id',
      pathParams: z.object({ id: userActionIdSchema }),
      query: z.object({
        waitMs: z.coerce.number().int().min(0).max(30000).optional(),
      }),
      responses: {
        200: userActionStatusSchema,
        401: errorSchema,
        404: errorSchema,
      },
    },
    cancel: {
      method: 'DELETE',
      path: '/user-actions/:id',
      pathParams: z.object({ id: userActionIdSchema }),
      responses: {
        200: userActionStatusSchema,
        401: errorSchema,
      },
    },
  }),
  watch: c.router({
    status: {
      method: 'GET',
      path: '/watch/status',
      query: z.object({
        taskMode: watchTaskModeSchema.optional(),
        limit: z.coerce.number().int().min(0).max(12).optional(),
      }),
      responses: {
        200: watchStatusSchema,
        401: errorSchema,
      },
    },
    intentions: {
      method: 'GET',
      path: '/watch/intentions',
      responses: {
        200: z.array(watchIntentionOptionSchema),
        401: errorSchema,
      },
    },
  }),
  sessions: c.router({
    create: {
      method: 'POST',
      path: '/sessions',
      body: sessionCreateSchema,
      responses: {
        200: sessionResponseSchema,
        400: errorSchema,
        401: errorSchema,
        409: errorSchema,
        429: errorSchema,
      },
    },
    deleteCurrent: {
      method: 'DELETE',
      path: '/sessions/current',
      query: z.object({
        platform: platformSchema,
      }),
      responses: {
        200: successSchema,
        401: errorSchema,
      },
    },
  }),
  system: c.router({
    get: {
      method: 'GET',
      path: '/system',
      responses: {
        200: systemInfoSchema,
      },
    },
    debugSentry: {
      method: 'POST',
      path: '/system/debug-sentry',
      body: z.object({}),
      responses: {
        200: successSchema,
        403: errorSchema,
        401: errorSchema,
      },
    },
    exportUserData: {
      method: 'GET',
      path: '/system/user-data/export',
      responses: {
        200: userDataExportSchema,
        403: errorSchema,
        401: errorSchema,
      },
    },
    importUserData: {
      method: 'POST',
      path: '/system/user-data/import',
      body: userDataExportSchema,
      responses: {
        200: userDataImportResultSchema,
        400: errorSchema,
        403: errorSchema,
        401: errorSchema,
      },
    },
  }),
  preferences: c.router({
    get: {
      method: 'GET',
      path: '/preferences',
      responses: {
        200: preferencesSchema,
      },
    },
    update: {
      method: 'PUT',
      path: '/preferences',
      body: preferencesUpdateSchema,
      responses: {
        200: preferencesSchema,
        500: errorSchema,
      },
    },
  }),
  intentions: c.router({
    list: {
      method: 'GET',
      path: '/intentions',
      query: intentionsQuerySchema,
      responses: {
        200: z.array(intentionSchema),
      },
    },
    create: {
      method: 'POST',
      path: '/intentions',
      body: intentionCreateSchema,
      responses: {
        201: intentionSchema,
        409: errorSchema,
      },
    },
    update: {
      method: 'PATCH',
      path: '/intentions/:slug',
      pathParams: z.object({
        slug: z.string(),
      }),
      body: intentionUpdateSchema,
      responses: {
        200: intentionSchema,
        404: errorSchema,
      },
    },
    reparent: {
      method: 'PATCH',
      path: '/intentions/:slug/reparent',
      pathParams: z.object({
        slug: z.string(),
      }),
      body: z.object({
        type: intentionTypeSchema.optional(),
        parentSlug: z.string().min(1),
      }),
      responses: {
        200: intentionSchema,
        400: errorSchema,
        404: errorSchema,
      },
    },
    archive: {
      method: 'PATCH',
      path: '/intentions/:slug/archive',
      pathParams: z.object({
        slug: z.string(),
      }),
      query: z.object({
        type: intentionTypeSchema.optional(),
      }),
      body: z.object({}),
      responses: {
        200: intentionSchema,
        404: errorSchema,
      },
    },
    unarchive: {
      method: 'PATCH',
      path: '/intentions/:slug/unarchive',
      pathParams: z.object({
        slug: z.string(),
      }),
      query: z.object({
        type: intentionTypeSchema.optional(),
      }),
      body: z.object({}),
      responses: {
        200: intentionSchema,
        404: errorSchema,
      },
    },
    delete: {
      method: 'DELETE',
      path: '/intentions/:slug',
      pathParams: z.object({
        slug: z.string(),
      }),
      query: z.object({
        type: intentionTypeSchema.optional(),
        keepStats: z
          .union([
            z.boolean(),
            z.enum(['true', 'false']).transform(v => v === 'true'),
          ])
          .optional(),
      }),
      responses: {
        204: c.noBody(),
      },
    },
  }),
  tasks: c.router({
    importStatus: {
      method: 'GET',
      path: '/tasks/import-status',
      responses: {
        200: taskImportStatusSchema,
      },
    },
    statistics: {
      method: 'GET',
      path: '/tasks/statistics',
      query: z.object({
        filter: taskStatisticsFilterSchema.optional(),
        rankingPeriod: topIntentionsPeriodSchema.optional(),
      }),
      responses: {
        200: taskStatisticsSchema,
      },
    },
    logs: {
      method: 'GET',
      path: '/tasks/logs',
      query: workTimerLogsQuerySchema,
      responses: {
        200: z.array(taskEventLogSchema),
      },
    },
    revertLog: {
      method: 'POST',
      path: '/tasks/logs/:id/revert',
      pathParams: z.object({
        id: z.string(),
      }),
      body: z.object({}),
      responses: {
        200: taskSchema,
        400: errorSchema,
        404: errorSchema,
      },
    },
    list: {
      method: 'GET',
      path: '/tasks',
      query: z.object({
        status: taskStatusSchema.optional(),
      }),
      responses: {
        200: z.array(taskSchema),
      },
    },
    create: {
      method: 'POST',
      path: '/tasks',
      body: taskCreateSchema,
      responses: {
        201: taskSchema,
        400: errorSchema,
      },
    },
    update: {
      method: 'PATCH',
      path: '/tasks/:id',
      pathParams: z.object({
        id: z.string(),
      }),
      body: taskUpdateSchema,
      responses: {
        200: taskSchema,
        400: errorSchema,
        404: errorSchema,
      },
    },
    reorder: {
      method: 'POST',
      path: '/tasks/reorder',
      body: taskReorderSchema,
      responses: {
        200: z.array(taskSchema),
        400: errorSchema,
      },
    },
    import: {
      method: 'POST',
      path: '/tasks/import',
      body: taskImportSchema,
      responses: {
        200: taskImportResponseSchema,
      },
    },
  }),
  lists: c.router({
    list: {
      method: 'GET',
      path: '/lists',
      query: z.object({
        includeArchived: z
          .enum(['true', 'false'])
          .transform(value => value === 'true')
          .optional(),
      }),
      responses: { 200: z.array(listSchema) },
    },
    items: {
      method: 'GET',
      path: '/lists/items',
      query: z.object({
        listId: z.string().optional(),
        status: taskStatusSchema.optional(),
      }),
      responses: { 200: z.array(listItemSchema) },
    },
    create: {
      method: 'POST',
      path: '/lists',
      body: z.object({
        title: z.string().trim().min(1).max(120),
        emoji: z.string().trim().max(16).nullable().optional(),
        description: z.string().trim().max(1000).nullable().optional(),
      }),
      responses: { 201: listSchema, 400: errorSchema, 409: errorSchema },
    },
    update: {
      method: 'PATCH',
      path: '/lists/:id',
      pathParams: z.object({ id: z.string() }),
      body: z.object({
        title: z.string().trim().min(1).max(120).optional(),
        emoji: z.string().trim().max(16).nullable().optional(),
        description: z.string().trim().max(1000).nullable().optional(),
        vacationDefault: z.boolean().optional(),
        isArchived: z.boolean().optional(),
        isFavorite: z.boolean().optional(),
      }),
      responses: { 200: listSchema, 400: errorSchema, 404: errorSchema },
    },
    createItem: {
      method: 'POST',
      path: '/lists/:id/items',
      pathParams: z.object({ id: z.string() }),
      body: z.object({
        title: z.string().trim().min(1).max(500),
        dueDate: z.string().nullable().optional(),
        priority: taskPrioritySchema.optional(),
        vacationEligible: z.boolean().optional(),
      }),
      responses: { 201: listItemSchema, 400: errorSchema, 404: errorSchema },
    },
    updateItem: {
      method: 'PATCH',
      path: '/lists/items/:id',
      pathParams: z.object({ id: z.string() }),
      body: z.object({
        title: z.string().trim().min(1).max(500).optional(),
        dueDate: z.string().nullable().optional(),
        priority: taskPrioritySchema.optional(),
        status: taskStatusSchema.optional(),
        vacationEligible: z.boolean().optional(),
      }),
      responses: { 200: listItemSchema, 400: errorSchema, 404: errorSchema },
    },
  }),
  vacation: c.router({
    status: {
      method: 'GET',
      path: '/vacation',
      responses: { 200: vacationStateSchema },
    },
    configure: {
      method: 'PUT',
      path: '/vacation/eligibility',
      body: z.object({
        intentionSlugs: z.array(z.string()),
        listIds: z.array(z.string().uuid()),
        excludedItemIds: z.array(z.string().uuid()).default([]),
      }),
      responses: { 200: successSchema, 400: errorSchema },
    },
    activate: {
      method: 'POST',
      path: '/vacation/activate',
      body: z.object({ endsOn: z.string().nullable().optional() }),
      responses: { 200: vacationStateSchema, 400: errorSchema },
    },
    deactivate: {
      method: 'POST',
      path: '/vacation/deactivate',
      body: z.object({}),
      responses: { 200: vacationStateSchema },
    },
  }),
  feedback: c.router({
    transcribe: {
      method: 'POST',
      path: '/feedback/transcribe',
      body: z.object({
        audioBase64: z
          .string()
          .min(1)
          .max(FEEDBACK_TRANSCRIPTION_MAX_ENCODED_BYTES),
        mimeType: z.string().min(1).max(100),
        idempotencyKey: z.string().uuid(),
      }),
      responses: {
        200: z.object({ transcript: z.string(), costUsd: z.number() }),
        400: errorSchema,
        403: errorSchema,
      },
    },
  }),
  descriptions: c.router({
    generate: {
      method: 'POST',
      path: '/descriptions/generate',
      body: z.object({}),
      responses: {
        200: z.object({
          drafts: z.array(
            z.object({
              kind: z.enum(['intention', 'list']),
              id: z.string(),
              title: z.string(),
              description: z.string().max(240),
            })
          ),
          costUsd: z.number(),
        }),
        400: errorSchema,
        403: errorSchema,
      },
    },
  }),
  assistant: c.router({
    status: {
      method: 'GET',
      path: '/assistant/status',
      responses: {
        200: assistantStatusSchema,
      },
    },
    settings: {
      method: 'GET',
      path: '/assistant/settings',
      responses: {
        200: assistantSettingsSchema.extend({
          apiKeyConfigured: z.boolean(),
        }),
        403: errorSchema,
      },
    },
    updateSettings: {
      method: 'PATCH',
      path: '/assistant/settings',
      body: assistantSettingsSchema.partial(),
      responses: {
        200: assistantSettingsSchema.extend({
          apiKeyConfigured: z.boolean(),
        }),
        400: errorSchema,
        403: errorSchema,
      },
    },
    models: {
      method: 'GET',
      path: '/assistant/models',
      query: z.object({
        inputModalities: z.string().optional(),
        outputModalities: z.string().optional(),
      }),
      responses: {
        200: z.array(assistantModelSchema),
        400: errorSchema,
        403: errorSchema,
      },
    },
    createTaskFromText: {
      method: 'POST',
      path: '/assistant/tasks/from-text',
      body: assistantTaskFromTextSchema,
      responses: {
        201: assistantTaskCreationResponseSchema,
        400: errorSchema,
        403: errorSchema,
      },
    },
    prepareTaskFromText: {
      method: 'POST',
      path: '/assistant/tasks/prepare-from-text',
      body: assistantTaskPreparationSchema,
      responses: {
        202: z.object({ preparationId: z.string().uuid() }),
        400: errorSchema,
        403: errorSchema,
        409: errorSchema,
        503: errorSchema,
      },
    },
    transcribeTaskInput: {
      method: 'POST',
      path: '/assistant/tasks/transcribe',
      body: assistantTaskTranscriptionSchema,
      responses: {
        200: assistantTranscriptionResponseSchema,
        400: errorSchema,
        403: errorSchema,
      },
    },
    prepareVoiceCommand: {
      method: 'POST',
      path: '/assistant/voice-command/prepare',
      body: assistantVoicePreparationSchema,
      responses: {
        202: z.object({ preparationId: z.string().uuid() }),
        400: errorSchema,
        403: errorSchema,
        409: errorSchema,
        503: errorSchema,
      },
    },
    finalizeVoiceCommand: {
      method: 'POST',
      path: '/assistant/voice-command/finalize',
      body: assistantVoiceFinalizationSchema,
      responses: {
        200: assistantVoiceCommandResponseSchema,
        400: errorSchema,
        403: errorSchema,
        404: errorSchema,
        503: errorSchema,
      },
    },
    transcribeVoiceChunk: {
      method: 'POST',
      path: '/assistant/voice-command/chunk',
      body: assistantVoiceChunkTranscriptionSchema,
      responses: {
        200: assistantTranscriptionResponseSchema,
        400: errorSchema,
        403: errorSchema,
        409: errorSchema,
        503: errorSchema,
      },
    },
    registerVoiceChunks: {
      method: 'POST',
      path: '/assistant/voice-command/chunks',
      body: assistantVoiceChunkManifestSchema,
      responses: {
        202: z.object({ preparationId: z.string().uuid() }),
        400: errorSchema,
        403: errorSchema,
        409: errorSchema,
        503: errorSchema,
      },
    },
    debugStatus: {
      method: 'GET',
      path: '/assistant/debug',
      responses: {
        200: assistantDebugStatusSchema,
        403: errorSchema,
      },
    },
    updateDebugStatus: {
      method: 'PATCH',
      path: '/assistant/debug',
      body: assistantDebugStatusSchema,
      responses: {
        200: assistantDebugStatusSchema,
        403: errorSchema,
      },
    },
    debugLogs: {
      method: 'GET',
      path: '/assistant/debug/logs',
      responses: {
        200: z.array(assistantDebugLogSchema),
        403: errorSchema,
      },
    },
    updateDebugLogFlag: {
      method: 'PATCH',
      path: '/assistant/debug/logs/:id',
      pathParams: z.object({ id: z.string().uuid() }),
      body: z.object({ flagged: z.boolean() }),
      responses: {
        200: assistantDebugLogSchema,
        403: errorSchema,
        404: errorSchema,
      },
    },
    exportFlaggedDebugLogs: {
      method: 'GET',
      path: '/assistant/debug/logs/export',
      responses: {
        200: assistantDebugLogExportSchema,
        403: errorSchema,
      },
    },
    clearDebugLogs: {
      method: 'DELETE',
      path: '/assistant/debug/logs',
      responses: {
        200: successSchema,
        403: errorSchema,
      },
    },
  }),
  statistics: c.router({
    summary: {
      method: 'GET',
      path: '/statistics',
      query: statisticsQuerySchema,
      responses: {
        200: statisticsSummarySchema,
        204: c.noBody(),
        500: errorSchema,
      },
    },
    intentionsToday: {
      method: 'GET',
      path: '/statistics/intentions/today',
      query: z.object({
        type: intentionTypeSchema.optional(),
        start: z.coerce.number().int().min(0).optional(),
        end: z.coerce.number().int().min(0).optional(),
      }),
      responses: {
        200: todayIntentionsSchema,
      },
    },
    topIntentions: {
      method: 'GET',
      path: '/statistics/top-intentions',
      query: topIntentionsQuerySchema,
      responses: {
        200: z.array(topIntentionStatSchema),
      },
    },
    heatmap: {
      method: 'GET',
      path: '/statistics/heatmap',
      query: heatmapQuerySchema,
      responses: {
        200: z.object({
          heatmap: z.array(
            z.object({
              date: z.string(),
              count: z.number().int(),
              duration: z.number(),
            })
          ),
          heatmapThresholds: z.object({
            low: z.number().int(),
            medium: z.number().int(),
            high: z.number().int(),
            max: z.number().int(),
          }),
        }),
      },
    },
  }),
  workTimerLogs: c.router({
    list: {
      method: 'GET',
      path: '/work-timer-logs',
      query: workTimerLogsQuerySchema,
      responses: {
        200: z.array(workTimerLogSchema),
        500: errorSchema,
      },
    },
    update: {
      method: 'PATCH',
      path: '/work-timer-logs/:id',
      pathParams: z.object({
        id: z.string(),
      }),
      body: workTimerLogUpdateSchema,
      responses: {
        200: workTimerLogSchema,
        400: errorSchema,
        404: errorSchema,
      },
    },
    delete: {
      method: 'DELETE',
      path: '/work-timer-logs/:id',
      pathParams: z.object({
        id: z.string(),
      }),
      responses: {
        204: c.noBody(),
        404: errorSchema,
      },
    },
  }),
  users: c.router({
    byUsername: {
      method: 'GET',
      path: '/users/by-username/:username',
      pathParams: z.object({
        username: z.string(),
      }),
      responses: {
        200: userSchema.nullable(),
      },
    },
    timers: {
      method: 'GET',
      path: '/users/:userId/timers',
      pathParams: z.object({
        userId: z.string(),
      }),
      responses: {
        200: z.array(z.string()),
      },
    },
    updatePushToken: {
      method: 'PUT',
      path: '/users/:userId/push-token',
      pathParams: z.object({
        userId: z.string(),
      }),
      body: pushTokenUpdateSchema,
      responses: {
        200: successSchema,
      },
    },
    getPushToken: {
      method: 'GET',
      path: '/users/:userId/push-token',
      pathParams: z.object({
        userId: z.string(),
      }),
      responses: {
        200: z.object({
          hasToken: z.boolean(),
        }),
      },
    },
  }),
  notifications: c.router({
    provider: {
      method: 'GET',
      path: '/notification-providers/current',
      responses: {
        200: notificationProviderSchema,
      },
    },
    test: {
      method: 'POST',
      path: '/notification-tests',
      body: notificationTestSchema,
      responses: {
        200: successSchema,
        400: errorSchema,
      },
    },
  }),
});

export type ApiContract = typeof apiContract;
