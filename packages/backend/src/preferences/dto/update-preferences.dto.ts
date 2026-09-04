import { Type } from 'class-transformer';
import {
  APP_LANGUAGE_VALUES,
  HELP_TIP_IDS,
  TASK_DEFAULT_DUE_DATE_MODES,
  TASK_PRIORITIES,
  TASK_SORT_MODES,
  TaskPriority,
} from '@pomi/shared';
import {
  IsArray,
  ArrayUnique,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdatePreferencesDto {
  @IsOptional()
  @IsIn(APP_LANGUAGE_VALUES)
  language?: (typeof APP_LANGUAGE_VALUES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  workTimerDuration?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  breakTimerDuration?: number;

  @IsOptional()
  @IsBoolean()
  autoStartBreak?: boolean;

  @IsOptional()
  @IsBoolean()
  autoStartWork?: boolean;

  @IsOptional()
  @IsBoolean()
  autoStartLongBreak?: boolean;

  @IsOptional()
  @IsBoolean()
  notifications?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnWorkComplete?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnBreakComplete?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyBeforeWorkComplete?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  notifyBeforeTime?: number;

  @IsOptional()
  @IsBoolean()
  soundNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  pushNotifications?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timeZone?: string;

  @IsOptional()
  @IsBoolean()
  globalShortcut?: boolean;

  @IsOptional()
  @IsBoolean()
  keyboardShortcuts?: boolean;

  @IsOptional()
  @IsBoolean()
  intentionExtension?: boolean;

  @IsOptional()
  @IsBoolean()
  intentionRequireSelection?: boolean;

  @IsOptional()
  @IsBoolean()
  intentionShowDailyCount?: boolean;

  @IsOptional()
  @IsBoolean()
  intentionBreakIntentions?: boolean;

  @IsOptional()
  @IsBoolean()
  intentionMultiSelect?: boolean;

  @IsOptional()
  @IsBoolean()
  intentionShowBreakIntentionsInLongBreak?: boolean;

  @IsOptional()
  @IsBoolean()
  intentionCustomDurations?: boolean;

  @IsOptional()
  @IsBoolean()
  intentionSubIntentions?: boolean;

  @IsOptional()
  @IsBoolean()
  intentionHabits?: boolean;

  @IsOptional()
  @IsBoolean()
  intentionPrioritizeUnfinishedHabits?: boolean;

  @IsOptional()
  @IsBoolean()
  workTimerLogsExtension?: boolean;

  @IsOptional()
  @IsBoolean()
  sessionsExtension?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sessionPomodorosCount?: number;

  @IsOptional()
  @IsBoolean()
  sessionHasLongBreak?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sessionLongBreakDuration?: number;

  @IsOptional()
  @IsBoolean()
  resetBreakOnFirstIntention?: boolean;

  @IsOptional()
  @IsBoolean()
  resetLongBreakOnFirstIntention?: boolean;

  @IsOptional()
  @IsBoolean()
  resetWorkOnFirstIntention?: boolean;

  @IsOptional()
  @IsBoolean()
  sessionShowLongBreakButton?: boolean;

  @IsOptional()
  @IsBoolean()
  sessionShowEta?: boolean;

  @IsOptional()
  @IsBoolean()
  sessionStackTimers?: boolean;

  @IsOptional()
  @IsBoolean()
  sessionAutoDetectLongBreak?: boolean;

  @IsOptional()
  @IsBoolean()
  keepScreenAwake?: boolean;

  @IsOptional()
  @IsBoolean()
  undoAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  tasksExtension?: boolean;

  @IsOptional()
  @IsBoolean()
  tasksShowSetupPrompts?: boolean;

  @IsOptional()
  @IsBoolean()
  tasksShowInMinimizedTimer?: boolean;

  @IsOptional()
  @IsBoolean()
  tasksAutoSwitchToIntentionMode?: boolean;

  @IsOptional()
  @IsBoolean()
  tasksDuringBreaks?: boolean;

  @IsOptional()
  @IsIn(Object.values(TASK_DEFAULT_DUE_DATE_MODES))
  taskDefaultDueDateMode?: 'off' | 'tomorrow' | 'week' | 'custom';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  taskDefaultDueDateDays?: number;

  @IsOptional()
  @IsIn(Object.values(TASK_SORT_MODES))
  taskDefaultSortMode?: 'default' | 'created-desc' | 'created-asc';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(Object.values(HELP_TIP_IDS), { each: true })
  hiddenHelpTips?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(Object.values(TASK_PRIORITIES), { each: true })
  taskReminderPriorities?: TaskPriority[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  taskBeforeDueReminderMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  taskUrgentReminderRepeatIntervalMinutes?: number;

  @IsOptional()
  @IsBoolean()
  taskUrgentReminderRepeatEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  advancedSkip?: boolean;

  @IsOptional()
  @IsBoolean()
  timerExtension?: boolean;

  @IsOptional()
  @IsBoolean()
  timerExtrasSeen?: boolean;

  @IsOptional()
  @IsBoolean()
  sessionsExtrasSeen?: boolean;

  @IsOptional()
  @IsBoolean()
  intentionsExtrasSeen?: boolean;

  @IsOptional()
  @IsBoolean()
  assistantExtension?: boolean;

  @IsOptional()
  @IsBoolean()
  assistantTaskTranscriptsEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  assistantTaskTranscriptMinWords?: number;

  @IsOptional()
  @IsBoolean()
  destinationDescriptionsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  listsExtension?: boolean;

  @IsOptional()
  @IsBoolean()
  vacationExtension?: boolean;

  @IsOptional()
  @IsBoolean()
  vacationCoverageConfigured?: boolean;

  @IsOptional()
  @IsBoolean()
  tasksShowVacationCovered?: boolean;

  @IsOptional()
  @IsBoolean()
  longBreakToBreakEnabled?: boolean;
}
