import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TIMER_TYPES,
  TaskLifecycleEventType,
  TaskPriority,
  TaskRecurrenceAnchorMode,
  TaskStatus,
  TimerTypes,
} from '@pomi/shared';
import * as bcrypt from 'bcrypt';
import { isDeepStrictEqual } from 'node:util';
import { addDays, format, startOfDay, subDays } from 'date-fns';
import dataSource from '../data-source';
import { AssistantDebugSettingEntity } from '../src/assistant/assistant-debug.entity';
import { DevelopmentFixtureMarkerEntity } from '../src/development-fixtures/development-fixture-marker.entity';
import { generateIntentionSlug } from '../src/intentions/intention-slug';
import { Intention } from '../src/intentions/intentions.entity';
import { Preferences } from '../src/preferences/preferences.entity';
import { Statistic } from '../src/statistics/statistics.entity';
import { TaskEntity, TaskEventEntity } from '../src/tasks/tasks.entity';
import { UserEntity } from '../src/users/users.entity';
import { fixtureCredentialFingerprint } from '../src/development-fixtures/fixture-credential';

const WORK_DURATION_MS = 25 * 60 * 1000;
const BREAK_DURATION_MS = 5 * 60 * 1000;
const LONG_BREAK_DURATION_MS = 15 * 60 * 1000;
const TEST_STATISTICS_DAYS = 365 * 3 + 30;
const STATISTICS_INSERT_CHUNK_SIZE = 300;

type SeedIntention = {
  title: string;
  emoji: string;
  type: 'work' | 'break' | 'longBreak';
  parentTitle?: string;
  hasCustomDuration?: boolean;
  customDuration?: number;
  keepScreenAwake?: boolean;
};

type SeedSession = {
  type: TimerTypes;
  slugs: string[];
  subIntentions?: Record<string, string>;
  duration: number;
  completedAt: number;
};

type SeedTask = {
  title: string;
  description?: string | null;
  dueOffsetDays: number | null;
  dueTime: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  timerType?: TimerTypes;
  customDuration?: number | null;
  intentionTitle: string;
  subIntentionTitle?: string | null;
  manualOrder?: number | null;
  manualOrderOverride?: boolean;
  recurrenceRule: string | null;
  recurrenceInterval?: number | null;
  recurrenceAnchorMode: TaskRecurrenceAnchorMode;
  followUpTitle?: string;
  followUpDelayDays?: number | null;
  vacationEligible?: boolean;
  eventOffsetDays?: number;
  eventType?: TaskLifecycleEventType;
};

type SeedUserFixtureOptions = {
  username: string;
  password: string;
  successLabel: string;
  isAdmin?: boolean;
  fixtureMarker?: {
    fixtureName: string;
    seedVersion: number;
  };
  seedData?: {
    intentions?: SeedIntention[];
    tasks?: SeedTask[];
    preferences?: (
      basePreferences: ReturnType<typeof buildFixturePreferences>
    ) => ReturnType<typeof buildFixturePreferences>;
  };
};

class FixturePhaseError extends Error {
  constructor(
    readonly phase: string,
    cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

function buildFixturePreferences(userId: string) {
  return {
    userId,
    language: 'en' as const,
    workTimerDuration: WORK_DURATION_MS,
    breakTimerDuration: BREAK_DURATION_MS,
    autoStartBreak: true,
    notifications: false,
    notifyOnWorkComplete: true,
    notifyOnBreakComplete: true,
    notifyBeforeWorkComplete: true,
    notifyBeforeTime: 2 * 60 * 1000,
    soundNotifications: false,
    pushNotifications: false,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    globalShortcut: false,
    keyboardShortcuts: true,
    intentionExtension: true,
    intentionRequireSelection: true,
    intentionShowDailyCount: true,
    intentionBreakIntentions: true,
    intentionMultiSelect: true,
    intentionShowBreakIntentionsInLongBreak: true,
    intentionCustomDurations: true,
    intentionSubIntentions: true,
    intentionHabits: true,
    assistantExtension: true,
    assistantTaskTranscriptsEnabled: true,
    assistantTaskTranscriptMinWords: 15,
    workTimerLogsExtension: true,
    sessionsExtension: true,
    sessionPomodorosCount: 4,
    sessionHasLongBreak: true,
    sessionLongBreakDuration: LONG_BREAK_DURATION_MS,
    resetBreakOnFirstIntention: true,
    resetLongBreakOnFirstIntention: true,
    sessionShowLongBreakButton: true,
    longBreakToBreakEnabled: true,
    sessionShowEta: true,
    sessionStackTimers: true,
    sessionAutoDetectLongBreak: true,
    keepScreenAwake: false,
    undoAlerts: true,
    tasksExtension: true,
    tasksShowSetupPrompts: true,
    tasksShowInMinimizedTimer: true,
    tasksAutoSwitchToIntentionMode: true,
    tasksDuringBreaks: true,
    vacationExtension: true,
    vacationCoverageConfigured: true,
    tasksShowVacationCovered: false,
    taskDefaultDueDateMode: 'tomorrow' as const,
    taskDefaultDueDateDays: 1,
    taskDefaultSortMode: 'default' as const,
    hiddenHelpTips: [],
    taskReminderPriorities: [TASK_PRIORITIES.HIGH, TASK_PRIORITIES.URGENT],
    taskBeforeDueReminderMinutes: 0,
    taskUrgentReminderRepeatEnabled: false,
    taskUrgentReminderRepeatIntervalMinutes: 30,
    advancedSkip: true,
    timerExtension: true,
    timerExtrasSeen: true,
    sessionsExtrasSeen: true,
    intentionsExtrasSeen: true,
  };
}

function buildFixturePreferencesForUser(
  userId: string,
  options: SeedUserFixtureOptions
) {
  const preferences = buildFixturePreferences(userId);

  return options.seedData?.preferences
    ? options.seedData.preferences(preferences)
    : preferences;
}

function getSeedIntentions(options: SeedUserFixtureOptions) {
  return options.seedData?.intentions ?? seedIntentions;
}

function getSeedTasks(options: SeedUserFixtureOptions) {
  return options.seedData?.tasks ?? seedTasks;
}

const seedIntentions: SeedIntention[] = [
  { title: 'Inbox', emoji: '📬', type: 'work' },
  { title: 'Budget', emoji: '💸', type: 'work' },
  { title: 'Groceries', emoji: '🛒', type: 'work' },
  { title: 'Laundry', emoji: '🧺', type: 'work' },
  { title: 'Workout', emoji: '🏋️', type: 'work' },
  { title: 'Read', emoji: '📚', type: 'work' },
  { title: 'Errands', emoji: '🧾', type: 'work' },
  { title: 'Calls', emoji: '📞', type: 'work' },
  { title: 'Social', emoji: '🤝', type: 'work' },
  { title: 'Debug', emoji: '🐛', type: 'work' },
  { title: 'Code', emoji: '💻', type: 'work' },
  {
    title: 'Focus',
    emoji: '🎯',
    type: 'work',
    hasCustomDuration: true,
    customDuration: 40 * 60 * 1000,
    keepScreenAwake: true,
  },
  { title: 'Planning', emoji: '🗺️', type: 'work', parentTitle: 'Focus' },
  {
    title: 'Deep Work',
    emoji: '🧠',
    type: 'work',
    parentTitle: 'Focus',
    hasCustomDuration: true,
    customDuration: 50 * 60 * 1000,
    keepScreenAwake: true,
  },
  { title: 'Review', emoji: '🔎', type: 'work', parentTitle: 'Focus' },
  { title: 'Feature', emoji: '✨', type: 'work', parentTitle: 'Code' },
  { title: 'Refactor', emoji: '🧼', type: 'work', parentTitle: 'Code' },
  { title: 'Fix', emoji: '🩹', type: 'work', parentTitle: 'Debug' },
  { title: 'Triage', emoji: '🚦', type: 'work', parentTitle: 'Debug' },
  { title: 'Friends', emoji: '🫂', type: 'work', parentTitle: 'Social' },
  { title: 'Family', emoji: '🏡', type: 'work', parentTitle: 'Social' },
  { title: 'Follow Up', emoji: '✉️', type: 'work', parentTitle: 'Social' },
  { title: 'Stretch', emoji: '🧘', type: 'break' },
  { title: 'Hydrate', emoji: '💧', type: 'break' },
  { title: 'Walk', emoji: '🚶', type: 'break' },
  { title: 'Tea', emoji: '🍵', type: 'break' },
  {
    title: 'Breathe',
    emoji: '🌬️',
    type: 'break',
    hasCustomDuration: true,
    customDuration: 10 * 60 * 1000,
  },
  { title: 'Mobility', emoji: '🦵', type: 'break', parentTitle: 'Stretch' },
  {
    title: 'Box Breathing',
    emoji: '🫁',
    type: 'break',
    parentTitle: 'Breathe',
  },
  {
    title: 'Reset',
    emoji: '🌿',
    type: 'longBreak',
    hasCustomDuration: true,
    customDuration: LONG_BREAK_DURATION_MS,
  },
  { title: 'Lunch', emoji: '🍱', type: 'longBreak' },
  { title: 'Outside', emoji: '☀️', type: 'longBreak' },
  { title: 'Meal Prep', emoji: '🥗', type: 'longBreak', parentTitle: 'Lunch' },
  { title: 'Sunlight', emoji: '🌤️', type: 'longBreak', parentTitle: 'Outside' },
];

const baseSeedTasks: SeedTask[] = [
  {
    title: 'Clear inbox backlog',
    dueOffsetDays: -2,
    dueTime: '09:00',
    priority: TASK_PRIORITIES.HIGH,
    status: TASK_STATUSES.ACTIVE,
    vacationEligible: true,
    intentionTitle: 'Inbox',
    recurrenceRule: null,
    recurrenceAnchorMode: 'planned',
  },
  {
    title: 'Fix urgent production bug',
    dueOffsetDays: -1,
    dueTime: '16:00',
    priority: TASK_PRIORITIES.URGENT,
    status: TASK_STATUSES.ACTIVE,
    intentionTitle: 'Debug',
    subIntentionTitle: 'Fix',
    recurrenceRule: null,
    recurrenceAnchorMode: 'planned',
  },
  {
    title: 'Plan next feature slice',
    description:
      'Representative dated Task for property filtering and multi-Task selection.',
    dueOffsetDays: 1,
    dueTime: '10:30',
    priority: TASK_PRIORITIES.NORMAL,
    status: TASK_STATUSES.ACTIVE,
    intentionTitle: 'Focus',
    subIntentionTitle: 'Planning',
    customDuration: 30 * 60 * 1000,
    recurrenceRule: null,
    recurrenceAnchorMode: 'planned',
  },
  {
    title: 'Finish report — explicit evening time',
    description:
      'Representative Assistant capture with an explicit 24-hour due time.',
    dueOffsetDays: 1,
    dueTime: '19:00',
    priority: TASK_PRIORITIES.NORMAL,
    status: TASK_STATUSES.ACTIVE,
    intentionTitle: 'Code',
    subIntentionTitle: 'Feature',
    recurrenceRule: null,
    recurrenceAnchorMode: 'planned',
  },
  {
    title: 'Prepare afternoon handoff',
    description: 'Representative Assistant capture with a daypart due time.',
    dueOffsetDays: 1,
    dueTime: '14:00',
    priority: TASK_PRIORITIES.NORMAL,
    status: TASK_STATUSES.ACTIVE,
    intentionTitle: 'Focus',
    subIntentionTitle: 'Planning',
    recurrenceRule: null,
    recurrenceAnchorMode: 'planned',
  },
  {
    title: 'Confirm later follow-up',
    description:
      'Representative Assistant capture awaiting an explicit due time.',
    dueOffsetDays: 1,
    dueTime: null,
    priority: TASK_PRIORITIES.NORMAL,
    status: TASK_STATUSES.ACTIVE,
    intentionTitle: 'Inbox',
    recurrenceRule: null,
    recurrenceAnchorMode: 'planned',
  },
  {
    title:
      'Capture a deliberately long product idea that demonstrates title truncation and the delayed full-title tooltip',
    dueOffsetDays: null,
    dueTime: null,
    priority: TASK_PRIORITIES.LOW,
    status: TASK_STATUSES.ACTIVE,
    intentionTitle: 'Inbox',
    manualOrder: 1,
    manualOrderOverride: true,
    recurrenceRule: null,
    recurrenceAnchorMode: 'planned',
  },
  {
    title: 'Daily hydration',
    dueOffsetDays: 0,
    dueTime: '14:00',
    priority: TASK_PRIORITIES.NORMAL,
    status: TASK_STATUSES.ACTIVE,
    intentionTitle: 'Workout',
    recurrenceRule: 'FREQ=DAILY;INTERVAL=1',
    recurrenceInterval: 2.5,
    recurrenceAnchorMode: 'completion',
  },
  {
    title: 'Mobility reset',
    dueOffsetDays: 2,
    dueTime: '15:15',
    priority: TASK_PRIORITIES.NORMAL,
    status: TASK_STATUSES.ACTIVE,
    intentionTitle: 'Workout',
    recurrenceRule: null,
    recurrenceAnchorMode: 'planned',
  },
  {
    title: 'Weekly deep work review',
    dueOffsetDays: 3,
    dueTime: '11:00',
    priority: TASK_PRIORITIES.HIGH,
    status: TASK_STATUSES.ACTIVE,
    intentionTitle: 'Focus',
    subIntentionTitle: 'Deep Work',
    recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR',
    recurrenceAnchorMode: 'planned',
    followUpTitle: 'Send the project follow-up',
    followUpDelayDays: 2,
  },
  {
    title: 'Finish feature draft',
    dueOffsetDays: -1,
    dueTime: '18:00',
    priority: TASK_PRIORITIES.HIGH,
    status: TASK_STATUSES.COMPLETED,
    intentionTitle: 'Code',
    subIntentionTitle: 'Feature',
    recurrenceRule: null,
    recurrenceAnchorMode: 'planned',
    eventOffsetDays: -1,
    eventType: TASK_STATUSES.COMPLETED,
  },
  {
    title: 'Archive stale errands',
    dueOffsetDays: -7,
    dueTime: null,
    priority: TASK_PRIORITIES.LOW,
    status: TASK_STATUSES.ARCHIVED,
    intentionTitle: 'Errands',
    recurrenceRule: null,
    recurrenceAnchorMode: 'planned',
    eventOffsetDays: 0,
    eventType: TASK_STATUSES.ARCHIVED,
  },
  {
    title: 'Take a hydration break',
    dueOffsetDays: 0,
    dueTime: null,
    priority: TASK_PRIORITIES.NORMAL,
    status: TASK_STATUSES.ACTIVE,
    timerType: TIMER_TYPES.BREAK,
    intentionTitle: 'Hydrate',
    recurrenceRule: 'FREQ=DAILY;INTERVAL=1',
    recurrenceAnchorMode: 'planned',
  },
  {
    title: 'Prepare tomorrow’s lunch',
    dueOffsetDays: 4,
    dueTime: '18:30',
    priority: TASK_PRIORITIES.URGENT,
    status: TASK_STATUSES.ACTIVE,
    timerType: TIMER_TYPES.LONG_BREAK,
    intentionTitle: 'Lunch',
    subIntentionTitle: 'Meal Prep',
    recurrenceRule: null,
    recurrenceAnchorMode: 'planned',
  },
];

const SEED_TASK_CATALOG: Array<{
  title: string;
  intentionTitle: string;
  subIntentionTitle?: string;
}> = [
  {
    title: 'Reply to Maya about dinner',
    intentionTitle: 'Social',
    subIntentionTitle: 'Friends',
  },
  {
    title: 'Call Dad about the weekend',
    intentionTitle: 'Social',
    subIntentionTitle: 'Family',
  },
  { title: 'Schedule the dentist appointment', intentionTitle: 'Calls' },
  { title: 'Return the library books', intentionTitle: 'Errands' },
  { title: 'Reconcile the monthly budget', intentionTitle: 'Budget' },
  { title: 'Review the grocery list', intentionTitle: 'Groceries' },
  { title: 'Fold and put away laundry', intentionTitle: 'Laundry' },
  { title: 'Plan the next strength workout', intentionTitle: 'Workout' },
  { title: 'Finish the current chapter', intentionTitle: 'Read' },
  {
    title: 'Triage the crash report',
    intentionTitle: 'Debug',
    subIntentionTitle: 'Triage',
  },
  {
    title: 'Verify the authentication fix',
    intentionTitle: 'Debug',
    subIntentionTitle: 'Fix',
  },
  {
    title: 'Draft the sync engine slice',
    intentionTitle: 'Code',
    subIntentionTitle: 'Feature',
  },
  {
    title: 'Simplify notification delivery',
    intentionTitle: 'Code',
    subIntentionTitle: 'Refactor',
  },
  {
    title: 'Outline weekly priorities',
    intentionTitle: 'Focus',
    subIntentionTitle: 'Planning',
  },
  {
    title: 'Review roadmap assumptions',
    intentionTitle: 'Focus',
    subIntentionTitle: 'Review',
  },
  {
    title: 'Prepare a deep work block',
    intentionTitle: 'Focus',
    subIntentionTitle: 'Deep Work',
  },
  { title: 'Clear unread inbox messages', intentionTitle: 'Inbox' },
  { title: 'Compare subscription renewals', intentionTitle: 'Budget' },
  { title: 'Pick up the parcel', intentionTitle: 'Errands' },
  { title: 'Write reading notes', intentionTitle: 'Read' },
  {
    title: 'Confirm the family train tickets',
    intentionTitle: 'Social',
    subIntentionTitle: 'Family',
  },
  {
    title: 'Refine the Tasks empty state',
    intentionTitle: 'Code',
    subIntentionTitle: 'Refactor',
  },
  {
    title: 'Investigate the timer regression',
    intentionTitle: 'Debug',
    subIntentionTitle: 'Triage',
  },
];

const SEED_TASK_BATCH_LABELS = ['This week', 'Next pass', 'Later review'];

const GENERATED_TASK_RECURRENCE_RULES: Array<{
  rule: string | null;
  interval: number | null;
  anchor: TaskRecurrenceAnchorMode;
}> = [
  { rule: null, interval: null, anchor: 'planned' },
  { rule: 'FREQ=DAILY;INTERVAL=1', interval: 2.5, anchor: 'completion' },
  {
    rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR',
    interval: null,
    anchor: 'planned',
  },
  {
    rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
    interval: null,
    anchor: 'completion',
  },
  {
    rule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15',
    interval: null,
    anchor: 'planned',
  },
];

function buildGeneratedSeedTasks(): SeedTask[] {
  const priorities = [
    TASK_PRIORITIES.LOW,
    TASK_PRIORITIES.NORMAL,
    TASK_PRIORITIES.HIGH,
    TASK_PRIORITIES.URGENT,
  ];
  const statuses = [
    TASK_STATUSES.ACTIVE,
    TASK_STATUSES.ACTIVE,
    TASK_STATUSES.ACTIVE,
    TASK_STATUSES.COMPLETED,
    TASK_STATUSES.ARCHIVED,
  ];

  return Array.from(
    { length: SEED_TASK_CATALOG.length * SEED_TASK_BATCH_LABELS.length },
    (_, index) => {
      const catalogItem = SEED_TASK_CATALOG[index % SEED_TASK_CATALOG.length];
      const batchLabel =
        SEED_TASK_BATCH_LABELS[Math.floor(index / SEED_TASK_CATALOG.length)];
      const recurrence =
        GENERATED_TASK_RECURRENCE_RULES[
          index % GENERATED_TASK_RECURRENCE_RULES.length
        ];
      const status = statuses[index % statuses.length];
      const isHistorical = status !== TASK_STATUSES.ACTIVE;
      const dueOffsetDays =
        !isHistorical && index % 6 === 0
          ? null
          : isHistorical
            ? -(index + 3)
            : (index % 14) - 3;
      const dueHour = 8 + (index % 10);
      const manualOrderOverride =
        status === TASK_STATUSES.ACTIVE && dueOffsetDays === null;

      return {
        title: `${catalogItem.title} — ${batchLabel}`,
        dueOffsetDays,
        dueTime:
          dueOffsetDays === null || index % 7 === 0
            ? null
            : `${String(dueHour).padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`,
        priority: priorities[index % priorities.length],
        status,
        intentionTitle: catalogItem.intentionTitle,
        subIntentionTitle: catalogItem.subIntentionTitle,
        manualOrder: manualOrderOverride ? index % 4 : null,
        manualOrderOverride,
        recurrenceRule: recurrence.rule,
        recurrenceInterval: recurrence.interval,
        recurrenceAnchorMode: recurrence.anchor,
        eventOffsetDays: isHistorical ? -Math.max(0, index - 2) : undefined,
        eventType: isHistorical ? status : undefined,
      };
    }
  );
}

const seedTasks: SeedTask[] = [...baseSeedTasks, ...buildGeneratedSeedTasks()];

function slugify(title: string): string {
  return generateIntentionSlug(title);
}

function resolveSeedTaskAssignment(
  task: SeedTask,
  intentionsByTypeAndSlug: Map<string, Intention>
): { intentionSlug: string; subIntentionSlug: string | null } {
  const timerType = task.timerType ?? TIMER_TYPES.WORK;
  const parent = intentionsByTypeAndSlug.get(
    `${timerType}:${slugify(task.intentionTitle)}`
  );
  if (!parent || parent.parentIntentionId) {
    throw new Error(
      `Task ${task.title} references missing parent intention ${task.intentionTitle}`
    );
  }

  if (!task.subIntentionTitle) {
    return { intentionSlug: parent.slug, subIntentionSlug: null };
  }

  const child = intentionsByTypeAndSlug.get(
    `${timerType}:${slugify(task.subIntentionTitle)}`
  );
  if (!child || child.parentIntentionId !== parent.id) {
    throw new Error(
      `Task ${task.title} references invalid sub-intention ${task.subIntentionTitle} for ${task.intentionTitle}`
    );
  }

  return { intentionSlug: parent.slug, subIntentionSlug: child.slug };
}

function getSeedTaskDueDate(task: SeedTask): string | null {
  if (task.dueOffsetDays === null) {
    return null;
  }

  return format(
    addDays(startOfDay(new Date()), task.dueOffsetDays),
    'yyyy-MM-dd'
  );
}

function getSeedTaskEventDate(task: SeedTask): Date | undefined {
  if (task.eventOffsetDays === undefined) {
    return undefined;
  }

  return addDays(startOfDay(new Date()), task.eventOffsetDays);
}

function pickSlugs(
  slugs: string[],
  dayIndex: number,
  offset: number
): string[] {
  const primary = slugs[(dayIndex + offset) % slugs.length];
  const secondary = slugs[(dayIndex + offset + 3) % slugs.length];

  if ((dayIndex + offset) % 3 === 0 && secondary !== primary) {
    return [primary, secondary];
  }

  return [primary];
}

function pickSubIntentions(
  slugs: string[],
  subSlugsByParentSlug: Record<string, string[]>,
  dayIndex: number,
  offset: number
): Record<string, string> | undefined {
  const selected = slugs.reduce(
    (accumulator, slug, index) => {
      const childSlugs = subSlugsByParentSlug[slug] ?? [];
      if (childSlugs.length === 0) {
        return accumulator;
      }

      accumulator[slug] =
        childSlugs[(dayIndex + offset + index) % childSlugs.length];
      return accumulator;
    },
    {} as Record<string, string>
  );

  return Object.keys(selected).length > 0 ? selected : undefined;
}

function buildTypeCycle(
  dayIndex: number,
  workSlugs: string[],
  breakSlugs: string[],
  longBreakSlugs: string[],
  subSlugsByParentSlug: Record<string, string[]>
): SeedSession[] {
  const today = new Date();
  const dayDate = subDays(today, dayIndex);
  const dayStart = startOfDay(dayDate).getTime();
  const dayOfWeek = dayDate.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const workCount = isWeekend ? 2 + (dayIndex % 2) : 5 + (dayIndex % 3);
  const breakCount = Math.max(1, Math.floor(workCount / 2));
  const longBreakCount = workCount >= 6 ? 1 : 0;

  const sessions: SeedSession[] = [];
  let minuteCursor = 8 * 60;

  for (let i = 0; i < workCount; i += 1) {
    const slugs = pickSlugs(workSlugs, dayIndex, i);
    sessions.push({
      type: TIMER_TYPES.WORK,
      slugs,
      subIntentions: pickSubIntentions(
        slugs,
        subSlugsByParentSlug,
        dayIndex,
        i
      ),
      duration: WORK_DURATION_MS,
      completedAt: dayStart + minuteCursor * 60 * 1000,
    });
    minuteCursor += 35;
  }

  for (let i = 0; i < breakCount; i += 1) {
    const slugs = [breakSlugs[(dayIndex + i) % breakSlugs.length]];
    sessions.push({
      type: TIMER_TYPES.BREAK,
      slugs,
      subIntentions: pickSubIntentions(
        slugs,
        subSlugsByParentSlug,
        dayIndex,
        i
      ),
      duration: BREAK_DURATION_MS,
      completedAt: dayStart + minuteCursor * 60 * 1000,
    });
    minuteCursor += 10;
  }

  for (let i = 0; i < longBreakCount; i += 1) {
    const slugs = [longBreakSlugs[(dayIndex + i) % longBreakSlugs.length]];
    sessions.push({
      type: TIMER_TYPES.LONG_BREAK,
      slugs,
      subIntentions: pickSubIntentions(
        slugs,
        subSlugsByParentSlug,
        dayIndex,
        i
      ),
      duration: LONG_BREAK_DURATION_MS,
      completedAt: dayStart + minuteCursor * 60 * 1000,
    });
    minuteCursor += 20;
  }

  return sessions;
}

type FixtureStatsCounts = {
  work: number;
  break: number;
  longBreak: number;
  total: number;
};

function getFixtureStatsCountsKey(counts: FixtureStatsCounts): string {
  return `${counts.work}:${counts.break}:${counts.longBreak}:${counts.total}`;
}

function getExpectedFixtureStatsCounts(): FixtureStatsCounts {
  const counts: FixtureStatsCounts = {
    work: 0,
    break: 0,
    longBreak: 0,
    total: 0,
  };
  const seedDayOfWeek = new Date().getDay();
  for (let dayIndex = 0; dayIndex < TEST_STATISTICS_DAYS; dayIndex += 1) {
    const dayOfWeek = (seedDayOfWeek - (dayIndex % 7) + 7) % 7;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const workCount = isWeekend ? 2 + (dayIndex % 2) : 5 + (dayIndex % 3);
    const breakCount = Math.max(1, Math.floor(workCount / 2));
    const longBreakCount = workCount >= 6 ? 1 : 0;
    counts.work += workCount;
    counts.break += breakCount;
    counts.longBreak += longBreakCount;
    counts.total += workCount + breakCount + longBreakCount;
  }
  return counts;
}

function fixtureValueMatches(actualValue: unknown, expectedValue: unknown) {
  if (Array.isArray(actualValue) || Array.isArray(expectedValue)) {
    return (
      JSON.stringify(actualValue ?? null) ===
      JSON.stringify(expectedValue ?? null)
    );
  }
  return actualValue === expectedValue;
}

async function findFixtureHealthIssues(
  options: SeedUserFixtureOptions,
  user: UserEntity
): Promise<string[]> {
  const issues: string[] = [];
  if (!(await bcrypt.compare(options.password, user.password))) {
    issues.push('password does not match fixture credentials');
  }

  const preferences = await dataSource.getRepository(Preferences).find({
    where: { userId: user.id },
  });
  if (preferences.length !== 1) {
    issues.push(`expected 1 preferences row, found ${preferences.length}`);
  } else {
    const expected = buildFixturePreferencesForUser(user.id, options);
    for (const [key, expectedValue] of Object.entries(expected)) {
      const actualValue = (
        preferences[0] as unknown as Record<string, unknown>
      )[key];
      if (!fixtureValueMatches(actualValue, expectedValue)) {
        issues.push(`preference ${key} does not match fixture`);
      }
    }
  }

  const expectedIntentions = getSeedIntentions(options);
  const intentions = await dataSource.getRepository(Intention).find({
    where: { userId: user.id },
  });
  if (intentions.length !== expectedIntentions.length) {
    issues.push(
      `expected ${expectedIntentions.length} canonical intentions, found ${intentions.length}`
    );
  }
  const intentionsByTypeAndSlug = new Map(
    intentions.map(intention => [
      `${intention.type}:${intention.slug}`,
      intention,
    ])
  );
  for (const expected of expectedIntentions) {
    const intention = intentionsByTypeAndSlug.get(
      `${expected.type}:${slugify(expected.title)}`
    );
    const parent = expected.parentTitle
      ? intentionsByTypeAndSlug.get(
          `${expected.type}:${slugify(expected.parentTitle)}`
        )
      : null;
    if (
      !intention ||
      (expected.parentTitle !== undefined && !parent) ||
      intention.title !== expected.title ||
      intention.emoji !== expected.emoji ||
      intention.parentIntentionId !== (parent?.id ?? null) ||
      intention.hasCustomDuration !== (expected.hasCustomDuration === true) ||
      intention.customDuration !==
        (expected.hasCustomDuration
          ? (expected.customDuration ?? null)
          : null) ||
      intention.keepScreenAwake !== (expected.keepScreenAwake === true)
    ) {
      issues.push(
        `canonical intention ${expected.type}:${expected.title} is missing or changed`
      );
    }
  }

  const expectedTasks = getSeedTasks(options);
  const tasks = await dataSource.getRepository(TaskEntity).find({
    where: { userId: user.id },
  });
  if (tasks.length !== expectedTasks.length) {
    issues.push(
      `expected ${expectedTasks.length} canonical tasks, found ${tasks.length}`
    );
  }
  const tasksByTitle = new Map(tasks.map(task => [task.title, task]));
  for (const expected of expectedTasks) {
    const task = tasksByTitle.get(expected.title);
    let assignment: ReturnType<typeof resolveSeedTaskAssignment> | null = null;
    try {
      assignment = resolveSeedTaskAssignment(expected, intentionsByTypeAndSlug);
    } catch {
      // The canonical intention issue above already describes this mismatch.
    }
    const expectedFields: Partial<TaskEntity> = {
      description: expected.description ?? null,
      dueDate: getSeedTaskDueDate(expected),
      dueTime: expected.dueTime,
      manualOrder: expected.manualOrder ?? null,
      manualOrderOverride: expected.manualOrderOverride ?? false,
      priority: expected.priority,
      status: expected.status,
      timerType: expected.timerType ?? TIMER_TYPES.WORK,
      customDuration: expected.customDuration ?? null,
      intentionSlug: assignment?.intentionSlug ?? null,
      subIntentionSlug: assignment?.subIntentionSlug ?? null,
      recurrenceRule: expected.recurrenceRule,
      recurrenceInterval: expected.recurrenceInterval ?? null,
      recurrenceAnchorMode: expected.recurrenceAnchorMode,
      followUpTaskId: null,
      followUpDefinition: expected.followUpTitle
        ? {
            title: expected.followUpTitle,
            description: null,
            dueTime: null,
            priority: TASK_PRIORITIES.NORMAL,
            timerType: expected.timerType ?? TIMER_TYPES.WORK,
            intentionSlug: assignment?.intentionSlug ?? null,
            subIntentionSlug: assignment?.subIntentionSlug ?? null,
            vacationEligible: expected.vacationEligible ?? false,
          }
        : null,
      followUpDelayDays: expected.followUpTitle
        ? (expected.followUpDelayDays ?? 0)
        : null,
      followUpSourceTaskId: null,
      vacationEligible: expected.vacationEligible ?? false,
    };
    if (
      !task ||
      Object.entries(expectedFields).some(
        ([key, value]) =>
          !isDeepStrictEqual(
            (task as unknown as Record<string, unknown>)[key],
            value
          )
      )
    ) {
      issues.push(`canonical task ${expected.title} is missing or changed`);
    }
  }

  const rawCounts = await dataSource
    .getRepository(Statistic)
    .createQueryBuilder('statistic')
    .select('statistic.type', 'type')
    .addSelect('COUNT(*)', 'count')
    .where('statistic.userId = :userId', { userId: user.id })
    .groupBy('statistic.type')
    .getRawMany<{ type: TimerTypes; count: string }>();
  const countByType = new Map(
    rawCounts.map(row => [row.type, Number(row.count)])
  );
  const counts: FixtureStatsCounts = {
    work: countByType.get(TIMER_TYPES.WORK) ?? 0,
    break: countByType.get(TIMER_TYPES.BREAK) ?? 0,
    longBreak: countByType.get(TIMER_TYPES.LONG_BREAK) ?? 0,
    total: rawCounts.reduce((total, row) => total + Number(row.count), 0),
  };
  if (
    getFixtureStatsCountsKey(counts) !==
    getFixtureStatsCountsKey(getExpectedFixtureStatsCounts())
  ) {
    issues.push('statistics counts do not match fixture');
  }
  const latest = await dataSource
    .getRepository(Statistic)
    .createQueryBuilder('statistic')
    .select('MAX(statistic.completedAt)', 'latestCompletedAt')
    .where('statistic.userId = :userId', { userId: user.id })
    .getRawOne<{ latestCompletedAt: string | null }>();
  if (
    Number(latest?.latestCompletedAt ?? 0) < startOfDay(new Date()).getTime()
  ) {
    issues.push('statistics are stale for the current day');
  }

  return issues;
}

async function initializeSeedDataSource(runMigrations: boolean) {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  if (runMigrations) await dataSource.runMigrations();
}

export async function ensureSeedUserFixture(
  options: SeedUserFixtureOptions
): Promise<void> {
  if (!options.fixtureMarker) {
    throw new Error('Fixture marker configuration is required for ensure');
  }

  try {
    await initializeSeedDataSource(false);
  } catch (error) {
    throw new FixturePhaseError('database initialization or migrations', error);
  }
  let marker: DevelopmentFixtureMarkerEntity | null;
  try {
    marker = await dataSource
      .getRepository(DevelopmentFixtureMarkerEntity)
      .createQueryBuilder('marker')
      .innerJoinAndSelect('marker.user', 'user')
      .where('marker.fixtureName = :fixtureName', {
        fixtureName: options.fixtureMarker.fixtureName,
      })
      .getOne();
  } catch (error) {
    throw new FixturePhaseError('fixture marker lookup', error);
  }
  const expectedFingerprint = fixtureCredentialFingerprint(
    options.username,
    options.password
  );
  const markerIsHealthy =
    marker?.user.username === options.username &&
    marker.user.isAdmin === (options.isAdmin === true) &&
    marker.seedVersion === options.fixtureMarker.seedVersion &&
    marker.credentialFingerprint === expectedFingerprint;
  let issues: string[] = [];
  if (markerIsHealthy && marker) {
    try {
      issues = await findFixtureHealthIssues(options, marker.user);
    } catch (error) {
      throw new FixturePhaseError('fixture content validation', error);
    }
  }

  if (markerIsHealthy && issues.length === 0) {
    process.stdout.write(`${options.successLabel} fixture is healthy\n`);
    return;
  }

  process.stdout.write(
    [
      `${options.successLabel} fixture needs rebuild`,
      ...(markerIsHealthy
        ? issues.map(issue => `- ${issue}`)
        : ['- fixture marker is missing or changed']),
    ].join('\n') + '\n'
  );

  try {
    await seedUserFixture(options);
  } catch (error) {
    throw new FixturePhaseError('automatic Copyme rebuild', error);
  }
}

export async function seedUserFixture({
  username,
  password,
  successLabel,
  isAdmin = false,
  fixtureMarker,
  seedData,
}: SeedUserFixtureOptions): Promise<void> {
  await initializeSeedDataSource(true);
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const userRepository = queryRunner.manager.getRepository(UserEntity);
    const preferencesRepository =
      queryRunner.manager.getRepository(Preferences);
    const intentionsRepository = queryRunner.manager.getRepository(Intention);
    const statisticsRepository = queryRunner.manager.getRepository(Statistic);
    const tasksRepository = queryRunner.manager.getRepository(TaskEntity);
    const taskEventsRepository =
      queryRunner.manager.getRepository(TaskEventEntity);
    const assistantDebugSettingsRepository = queryRunner.manager.getRepository(
      AssistantDebugSettingEntity
    );
    const fixtureMarkerRepository = queryRunner.manager.getRepository(
      DevelopmentFixtureMarkerEntity
    );

    const hashedPassword = await bcrypt.hash(password, 10);
    const existingUser = await userRepository.findOne({ where: { username } });

    if (existingUser) {
      await taskEventsRepository.delete({ userId: existingUser.id });
      await tasksRepository.delete({ userId: existingUser.id });
      await statisticsRepository.delete({ userId: existingUser.id });
      await intentionsRepository.delete({ userId: existingUser.id });
      await preferencesRepository.delete({ userId: existingUser.id });
      await userRepository.delete({ id: existingUser.id });
    }

    const savedUser = await userRepository.save(
      userRepository.create({
        username,
        password: hashedPassword,
        isAdmin,
        fcmToken: `${username}-fcm-token`,
        apnToken: `${username}-apn-token`,
      })
    );

    await preferencesRepository.save(
      preferencesRepository.create(
        buildFixturePreferencesForUser(savedUser.id, {
          username,
          password,
          successLabel,
          seedData,
        })
      )
    );
    if (fixtureMarker) {
      await assistantDebugSettingsRepository.save(
        assistantDebugSettingsRepository.create({
          userId: savedUser.id,
          enabled: true,
        })
      );
    }

    const userSeedIntentions = getSeedIntentions({
      username,
      password,
      successLabel,
      seedData,
    });
    const userSeedTasks = getSeedTasks({
      username,
      password,
      successLabel,
      seedData,
    });
    const topLevelSeedIntentions = userSeedIntentions.filter(
      item => !item.parentTitle
    );
    const subSeedIntentions = userSeedIntentions.filter(
      item => item.parentTitle
    );
    const savedTopLevelIntentions = await intentionsRepository.save(
      topLevelSeedIntentions.map(item =>
        intentionsRepository.create({
          userId: savedUser.id,
          title: item.title,
          emoji: item.emoji,
          slug: slugify(item.title),
          type: item.type,
          hasCustomDuration: item.hasCustomDuration === true,
          customDuration: item.hasCustomDuration ? item.customDuration : null,
          keepScreenAwake: item.keepScreenAwake === true,
          usageCount: 0,
        })
      )
    );
    const parentByTypeAndSlug = new Map(
      savedTopLevelIntentions.map(intention => [
        `${intention.type}:${intention.slug}`,
        intention,
      ])
    );
    const savedSubIntentions = await intentionsRepository.save(
      subSeedIntentions.map(item => {
        const parent = parentByTypeAndSlug.get(
          `${item.type}:${slugify(item.parentTitle ?? '')}`
        );
        if (!parent) {
          throw new Error(`Missing parent intention for ${item.title}`);
        }

        return intentionsRepository.create({
          userId: savedUser.id,
          title: item.title,
          emoji: item.emoji,
          slug: slugify(item.title),
          type: item.type,
          parentIntentionId: parent.id,
          hasCustomDuration: item.hasCustomDuration === true,
          customDuration: item.hasCustomDuration ? item.customDuration : null,
          keepScreenAwake: item.keepScreenAwake === true,
          usageCount: 0,
        });
      })
    );
    const savedIntentions = [...savedTopLevelIntentions, ...savedSubIntentions];
    const parentSlugById = new Map(
      savedTopLevelIntentions.map(intention => [intention.id, intention.slug])
    );
    const subSlugsByParentSlug = savedSubIntentions.reduce(
      (accumulator, intention) => {
        const parentSlug = intention.parentIntentionId
          ? parentSlugById.get(intention.parentIntentionId)
          : undefined;
        if (!parentSlug) {
          return accumulator;
        }

        accumulator[parentSlug] = [
          ...(accumulator[parentSlug] ?? []),
          intention.slug,
        ];
        return accumulator;
      },
      {} as Record<string, string[]>
    );

    const workSlugs = savedTopLevelIntentions
      .filter(intention => intention.type === TIMER_TYPES.WORK)
      .map(intention => intention.slug);
    const breakSlugs = savedTopLevelIntentions
      .filter(intention => intention.type === TIMER_TYPES.BREAK)
      .map(intention => intention.slug);
    const longBreakSlugs = savedTopLevelIntentions
      .filter(intention => intention.type === TIMER_TYPES.LONG_BREAK)
      .map(intention => intention.slug);

    const statisticsToSave: Statistic[] = [];
    const intentionUsage: Record<string, number> = {};

    for (let day = 0; day < TEST_STATISTICS_DAYS; day += 1) {
      const sessions = buildTypeCycle(
        day,
        workSlugs,
        breakSlugs,
        longBreakSlugs,
        subSlugsByParentSlug
      );

      for (const session of sessions) {
        const completedDate = new Date(session.completedAt);
        const date = format(completedDate, 'yyyy-MM-dd');

        for (const slug of session.slugs) {
          intentionUsage[slug] = (intentionUsage[slug] || 0) + 1;
        }
        for (const subSlug of Object.values(session.subIntentions ?? {})) {
          intentionUsage[subSlug] = (intentionUsage[subSlug] || 0) + 1;
        }

        statisticsToSave.push(
          statisticsRepository.create({
            userId: savedUser.id,
            type: session.type,
            date,
            duration: session.duration,
            completedAt: session.completedAt,
            intention: session.slugs[0] ?? null,
            intentions: session.slugs.length > 0 ? session.slugs : null,
            subIntentions: session.subIntentions ?? null,
          })
        );
      }
    }

    for (
      let offset = 0;
      offset < statisticsToSave.length;
      offset += STATISTICS_INSERT_CHUNK_SIZE
    ) {
      await statisticsRepository.save(
        statisticsToSave.slice(offset, offset + STATISTICS_INSERT_CHUNK_SIZE)
      );
    }

    for (const intention of savedIntentions) {
      intention.usageCount = intentionUsage[intention.slug] || 0;
    }
    await intentionsRepository.save(savedIntentions);

    const savedIntentionsByTypeAndSlug = new Map(
      savedIntentions.map(intention => [
        `${intention.type}:${intention.slug}`,
        intention,
      ])
    );
    const tasksToSave = userSeedTasks.map(task => {
      const assignment = resolveSeedTaskAssignment(
        task,
        savedIntentionsByTypeAndSlug
      );
      return tasksRepository.create({
        userId: savedUser.id,
        title: task.title,
        description: task.description ?? null,
        dueDate: getSeedTaskDueDate(task),
        dueTime: task.dueTime,
        manualOrder: task.manualOrder ?? null,
        manualOrderOverride: task.manualOrderOverride ?? false,
        priority: task.priority,
        status: task.status,
        timerType: task.timerType ?? TIMER_TYPES.WORK,
        customDuration: task.customDuration ?? null,
        intentionSlug: assignment.intentionSlug,
        subIntentionSlug: assignment.subIntentionSlug,
        recurrenceRule: task.recurrenceRule,
        recurrenceInterval: task.recurrenceInterval ?? null,
        recurrenceAnchorMode: task.recurrenceAnchorMode,
        followUpTaskId: null,
        followUpDefinition: task.followUpTitle
          ? {
              title: task.followUpTitle,
              description: null,
              dueTime: null,
              priority: TASK_PRIORITIES.NORMAL,
              timerType: task.timerType ?? TIMER_TYPES.WORK,
              intentionSlug: assignment.intentionSlug,
              subIntentionSlug: assignment.subIntentionSlug,
              vacationEligible: task.vacationEligible ?? false,
            }
          : null,
        followUpDelayDays: task.followUpTitle
          ? (task.followUpDelayDays ?? 0)
          : null,
        followUpSourceTaskId: null,
        vacationEligible: task.vacationEligible ?? false,
      });
    });
    const savedTasks = await tasksRepository.save(tasksToSave);
    const seedTaskByTitle = new Map(
      userSeedTasks.map(task => [task.title, task])
    );
    const taskEventsToSave = savedTasks.flatMap(task => {
      const seedTask = seedTaskByTitle.get(task.title);
      const occurredAt = seedTask ? getSeedTaskEventDate(seedTask) : undefined;
      const events = [
        taskEventsRepository.create({
          userId: savedUser.id,
          taskId: task.id,
          eventType: 'created',
          titleSnapshot: task.title,
          prioritySnapshot: task.priority,
          timerTypeSnapshot: task.timerType,
          intentionSlugSnapshot: task.intentionSlug,
          subIntentionSlugSnapshot: task.subIntentionSlug,
          dueDate: task.dueDate,
          dueTime: task.dueTime,
          recurrenceSequenceIndex: task.recurrenceSequenceIndex,
          recurrenceRuleSnapshot: task.recurrenceRule,
          recurrenceIntervalSnapshot: task.recurrenceInterval,
          recurrenceAnchorModeSnapshot: task.recurrenceAnchorMode,
          isOverdue: false,
          occurredAt: task.createdAt,
        }),
      ];
      if (seedTask?.eventType && occurredAt) {
        events.push(
          taskEventsRepository.create({
            userId: savedUser.id,
            taskId: task.id,
            eventType: seedTask.eventType,
            titleSnapshot: task.title,
            prioritySnapshot: task.priority,
            timerTypeSnapshot: task.timerType,
            intentionSlugSnapshot: task.intentionSlug,
            subIntentionSlugSnapshot: task.subIntentionSlug,
            dueDate: task.dueDate,
            dueTime: task.dueTime,
            recurrenceSequenceIndex: task.recurrenceSequenceIndex,
            recurrenceRuleSnapshot: task.recurrenceRule,
            recurrenceIntervalSnapshot: task.recurrenceInterval,
            recurrenceAnchorModeSnapshot: task.recurrenceAnchorMode,
            isOverdue:
              task.dueDate !== null &&
              occurredAt.getTime() >
                (task.dueTime
                  ? new Date(`${task.dueDate}T${task.dueTime}:00`).getTime()
                  : new Date(`${task.dueDate}T00:00:00`).getTime() +
                    86_400_000),
            occurredAt,
          })
        );
      }
      return events;
    });
    await taskEventsRepository.save(taskEventsToSave);

    const workStatsCount = statisticsToSave.filter(
      item => item.type === TIMER_TYPES.WORK
    ).length;
    const breakStatsCount = statisticsToSave.filter(
      item => item.type === TIMER_TYPES.BREAK
    ).length;
    const longBreakStatsCount = statisticsToSave.filter(
      item => item.type === TIMER_TYPES.LONG_BREAK
    ).length;

    if (fixtureMarker) {
      await fixtureMarkerRepository.save(
        fixtureMarkerRepository.create({
          userId: savedUser.id,
          fixtureName: fixtureMarker.fixtureName,
          seedVersion: fixtureMarker.seedVersion,
          credentialFingerprint: fixtureCredentialFingerprint(
            username,
            password
          ),
        })
      );
    }
    await queryRunner.commitTransaction();

    process.stdout.write(
      [
        `${successLabel} seeded successfully`,
        `- username: ${username}`,
        `- password: ${password}`,
        `- userId: ${savedUser.id}`,
        `- intentions: ${savedIntentions.length}`,
        `- tasks: ${savedTasks.length}`,
        `- task events: ${taskEventsToSave.length}`,
        `- work stats: ${workStatsCount}`,
        `- break stats: ${breakStatsCount}`,
        `- long break stats: ${longBreakStatsCount}`,
        `- total stats: ${statisticsToSave.length}`,
      ].join('\n') + '\n'
    );
  } catch (error) {
    if (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }
    throw error;
  } finally {
    await queryRunner.release();
  }
}

export async function runSeedUserFixture(
  options: SeedUserFixtureOptions
): Promise<void> {
  await seedUserFixture(options)
    .catch(error => {
      console.error(`Failed to seed ${options.username} user`, error);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }
    });
}

export async function runEnsureSeedUserFixture(
  options: SeedUserFixtureOptions
): Promise<void> {
  await ensureSeedUserFixture(options)
    .catch(error => {
      const phase = error instanceof FixturePhaseError ? error.phase : 'ensure';
      const cause = error instanceof Error ? error.message : String(error);
      console.error(
        `${options.successLabel} failed during ${phase}: ${cause}\nRecovery: pnpm reseed:copyme`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }
    });
}
