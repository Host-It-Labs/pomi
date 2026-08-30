import type { Intention, Preferences, Task, Timer } from '@pomi/shared';
import { TIMER_STATUSES, TIMER_TYPES } from '@pomi/shared/src/constants';
import { getIntlLocale, getLanguage, translateCurrent } from '../i18n';
import type { TaskMode } from '../stores/uiStore';

type FocusTaskOnTimerOptions = {
  task: Task;
  timer: Timer | null;
  preferences: Preferences | null | undefined;
  createOrResumeTimer: (
    type?: Timer['type'],
    intention?: string,
    intentions?: string[],
    subIntentions?: Record<string, string>,
    focusedTaskId?: string,
    resetOnFirstIntention?: boolean,
    customDuration?: number | null
  ) => Promise<boolean>;
  updatePreferenceWithResult: (
    key: keyof Preferences,
    value: boolean
  ) => Promise<boolean>;
  setTaskMode?: (taskMode: TaskMode) => void;
};

export async function focusTaskOnTimer({
  task,
  timer,
  preferences,
  createOrResumeTimer,
  updatePreferenceWithResult,
  setTaskMode,
}: FocusTaskOnTimerOptions) {
  if (!task.intentionSlug) {
    return false;
  }
  if (
    timer?.status === TIMER_STATUSES.RUNNING &&
    timer.type !== task.timerType
  ) {
    return false;
  }

  if (
    task.timerType === TIMER_TYPES.BREAK &&
    preferences?.intentionBreakIntentions !== true
  ) {
    const didEnableBreakIntentions = await updatePreferenceWithResult(
      'intentionBreakIntentions',
      true
    );
    if (!didEnableBreakIntentions) return false;
  }

  const currentIntentions =
    timer?.type === task.timerType
      ? (timer.intentionSlugs ?? (timer.intention ? [timer.intention] : []))
      : [];
  const currentSubIntentions =
    timer?.type === task.timerType ? (timer.subIntentions ?? {}) : {};
  const hasDifferentIntention =
    currentIntentions.length > 0 &&
    !currentIntentions.includes(task.intentionSlug);
  let useMultiIntentions = preferences?.intentionMultiSelect === true;
  if (hasDifferentIntention && !useMultiIntentions) {
    const shouldEnableMultiIntentions = window.confirm(
      translateCurrent('task.enableMultiIntentionForPinned')
    );
    if (shouldEnableMultiIntentions) {
      const didEnable = await updatePreferenceWithResult(
        'intentionMultiSelect',
        true
      );
      if (!didEnable) return false;
      useMultiIntentions = true;
    }
  }

  const nextIntentions = useMultiIntentions
    ? currentIntentions.includes(task.intentionSlug)
      ? currentIntentions
      : [...currentIntentions, task.intentionSlug]
    : [task.intentionSlug];
  const nextSubIntentions = useMultiIntentions
    ? { ...currentSubIntentions }
    : {};
  if (task.subIntentionSlug) {
    nextSubIntentions[task.intentionSlug] = task.subIntentionSlug;
  } else {
    delete nextSubIntentions[task.intentionSlug];
  }

  const resetOnFirstIntention =
    task.timerType === TIMER_TYPES.BREAK
      ? preferences?.resetBreakOnFirstIntention === true
      : task.timerType === TIMER_TYPES.LONG_BREAK
        ? preferences?.resetLongBreakOnFirstIntention === true
        : false;

  const didFocus = await createOrResumeTimer(
    task.timerType,
    nextIntentions[0],
    nextIntentions,
    nextSubIntentions,
    task.id,
    resetOnFirstIntention,
    task.customDuration
  );
  if (!didFocus) return false;
  if (preferences?.tasksAutoSwitchToIntentionMode !== false) {
    setTaskMode?.('intention');
  }
  return true;
}

export function isInlineTaskPropertyUpdate(
  update: Partial<
    Pick<
      Task,
      | 'dueDate'
      | 'dueTime'
      | 'priority'
      | 'intentionSlug'
      | 'subIntentionSlug'
      | 'recurrenceRule'
      | 'recurrenceInterval'
      | 'recurrenceAnchorMode'
    >
  >
) {
  return [
    'dueDate',
    'dueTime',
    'priority',
    'intentionSlug',
    'subIntentionSlug',
    'recurrenceRule',
    'recurrenceInterval',
    'recurrenceAnchorMode',
  ].some(key => Object.prototype.hasOwnProperty.call(update, key));
}

export function formatTaskDue(task: Pick<Task, 'dueDate' | 'dueTime'>) {
  if (!task.dueDate) {
    return translateCurrent('task.noDueDate');
  }

  const [year, month, day] = task.dueDate.split('-').map(Number);
  if (!year || !month || !day) {
    return task.dueDate;
  }

  const now = new Date();
  const today = startOfDay(now);
  const dueDay = new Date(year, month - 1, day);
  const dayDiff = Math.round((dueDay.getTime() - today.getTime()) / 86400000);

  if (!task.dueTime) {
    if (dayDiff === 0) return translateCurrent('task.dueToday');
    if (dayDiff === 1) return translateCurrent('task.dueTomorrow');
    return translateCurrent('task.dueRelative', {
      relative: formatRelativeTime(dayDiff, 'day'),
    });
  }

  const [hour, minute] = task.dueTime.split(':').map(Number);
  const due = new Date(year, month - 1, day, hour || 0, minute || 0);
  const diff = due.getTime() - now.getTime();
  const absDiff = Math.abs(diff);
  const unit =
    absDiff < 3600000
      ? { count: Math.max(1, Math.round(absDiff / 60000)), name: 'minute' }
      : absDiff < 86400000
        ? { count: Math.max(1, Math.round(absDiff / 3600000)), name: 'hour' }
        : { count: Math.max(1, Math.round(absDiff / 86400000)), name: 'day' };
  return translateCurrent('task.dueRelative', {
    relative: formatRelativeTime(
      diff >= 0 ? unit.count : -unit.count,
      unit.name as Intl.RelativeTimeFormatUnit
    ),
  });
}

export function formatCompactTaskDue(task: Pick<Task, 'dueDate' | 'dueTime'>) {
  if (!task.dueDate) return null;

  const [year, month, day] = task.dueDate.split('-').map(Number);
  if (!year || !month || !day) return task.dueDate;

  const now = new Date();
  const dueDay = new Date(year, month - 1, day);
  const dayDiff = Math.round(
    (dueDay.getTime() - startOfDay(now).getTime()) / 86400000
  );

  if (!task.dueTime) {
    if (dayDiff === 0) return translateCurrent('common.today');
    if (dayDiff === 1) return translateCurrent('common.tomorrow');
    if (dayDiff < 0) return `−${Math.abs(dayDiff)}d`;
    if (dayDiff <= 7) return `${dayDiff}d`;
    return formatMonthDay(dueDay);
  }

  const [hour, minute] = task.dueTime.split(':').map(Number);
  const due = new Date(year, month - 1, day, hour || 0, minute || 0);
  const difference = due.getTime() - now.getTime();
  const absoluteDifference = Math.abs(difference);
  const prefix = difference < 0 ? '−' : '';

  if (absoluteDifference < 3600000) {
    return `${prefix}${Math.max(1, Math.round(absoluteDifference / 60000))}m`;
  }
  if (absoluteDifference < 86400000) {
    return `${prefix}${Math.max(1, Math.round(absoluteDifference / 3600000))}h`;
  }

  const days = Math.max(1, Math.round(absoluteDifference / 86400000));
  if (difference < 0) return `−${days}d`;
  if (days <= 7) return `${prefix}${days}d`;
  return formatMonthDay(dueDay);
}

export function getTaskPriorityAccentClass(priority: Task['priority']) {
  if (priority === 'urgent') return 'bg-red-400';
  if (priority === 'high') return 'bg-amber-400';
  if (priority === 'low') return 'bg-sky-500/70';
  return 'bg-slate-600';
}

export function getTaskPriorityBadgeClass(priority: Task['priority']) {
  if (priority === 'urgent') {
    return 'border-red-500/35 bg-red-500/10 text-red-200';
  }
  if (priority === 'high') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  }
  if (priority === 'low') {
    return 'border-sky-500/25 bg-sky-500/10 text-sky-200/80';
  }
  return 'border-slate-700/50 bg-slate-800/35 text-slate-400';
}

export function formatTaskRecurrence(
  recurrenceRule: string | null | undefined,
  recurrenceAnchorMode?: Task['recurrenceAnchorMode'],
  recurrenceInterval?: number | null
) {
  if (!recurrenceRule) {
    return null;
  }

  const frequency = recurrenceRule.match(/FREQ=(DAILY|WEEKLY|MONTHLY)/)?.[1];
  const interval =
    recurrenceInterval ??
    Number(recurrenceRule.match(/INTERVAL=(\d+)/)?.[1] ?? '1');
  const normalizedInterval = Number.isFinite(interval)
    ? Math.max(1, interval)
    : 1;
  const anchor = translateCurrent(
    recurrenceAnchorMode === 'completion'
      ? 'task.recurrenceAfterDone'
      : 'task.recurrenceFromDue'
  );

  if (frequency === 'DAILY') {
    return formatRecurrenceInterval(normalizedInterval, 'day', anchor);
  }
  if (frequency === 'WEEKLY') {
    return formatRecurrenceInterval(normalizedInterval, 'week', anchor);
  }
  if (frequency === 'MONTHLY') {
    return formatRecurrenceInterval(normalizedInterval, 'month', anchor);
  }

  return translateCurrent('task.repeatsAnchor', { anchor });
}

export function formatCompactTaskRecurrence(
  recurrenceRule: string | null | undefined,
  recurrenceInterval?: number | null
) {
  if (!recurrenceRule) {
    return null;
  }

  const frequency = recurrenceRule.match(/FREQ=(DAILY|WEEKLY|MONTHLY)/)?.[1];
  const interval =
    recurrenceInterval ??
    Number(recurrenceRule.match(/INTERVAL=(\d+)/)?.[1] ?? '1');
  const normalizedInterval = Number.isFinite(interval)
    ? Math.max(1, interval)
    : 1;

  if (frequency === 'DAILY') {
    return formatCompactUnit(normalizedInterval, 'day');
  }
  if (frequency === 'WEEKLY') {
    return formatCompactUnit(normalizedInterval, 'week');
  }
  if (frequency === 'MONTHLY') {
    return formatCompactUnit(normalizedInterval, 'month');
  }

  return translateCurrent('task.repeats');
}

export function isTaskOverdue(
  task: Pick<Task, 'dueDate' | 'dueTime'>,
  now?: Date
) {
  const boundary = getTaskDueBoundary(task);
  if (!boundary) {
    return false;
  }

  return (now ?? new Date()).getTime() > boundary.getTime();
}

function getTaskDueBoundary(task: Pick<Task, 'dueDate' | 'dueTime'>) {
  if (!task.dueDate) {
    return null;
  }

  const [year, month, day] = task.dueDate.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }

  if (!task.dueTime) {
    const dueDayEnd = new Date(year, month - 1, day);
    dueDayEnd.setDate(dueDayEnd.getDate() + 1);
    return dueDayEnd;
  }

  const [hour, minute] = task.dueTime.split(':').map(Number);
  return new Date(year, month - 1, day, hour || 0, minute || 0);
}

export function getTaskIntentionEmojis(task: Task, intentions: Intention[]) {
  const parent = intentions.find(
    intention =>
      intention.slug === task.intentionSlug &&
      intention.type === task.timerType &&
      !intention.parentIntentionId
  );
  const sub = intentions.find(
    intention =>
      intention.slug === task.subIntentionSlug &&
      intention.type === task.timerType &&
      intention.parentIntentionId === parent?.id
  );
  return {
    parentEmoji: parent?.emoji,
    subEmoji: sub?.emoji,
  };
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatRelativeTime(count: number, unit: Intl.RelativeTimeFormatUnit) {
  return new Intl.RelativeTimeFormat(getIntlLocale(getLanguage()), {
    numeric: 'always',
  }).format(count, unit);
}

function formatUnit(
  count: number,
  unit: 'day' | 'week' | 'month',
  unitDisplay: 'long' | 'short'
) {
  return new Intl.NumberFormat(getIntlLocale(getLanguage()), {
    style: 'unit',
    unit,
    unitDisplay,
  }).format(count);
}

function formatRecurrenceInterval(
  count: number,
  unit: 'day' | 'week' | 'month',
  anchor: string
) {
  return translateCurrent('task.repeatsEvery', {
    interval: formatUnit(count, unit, 'long'),
    anchor,
  });
}

function formatCompactUnit(count: number, unit: 'day' | 'week' | 'month') {
  if (getLanguage() === 'en') {
    return count === 1 ? unit : `${count} ${unit}s`;
  }
  return formatUnit(count, unit, 'short');
}

function formatMonthDay(date: Date) {
  return new Intl.DateTimeFormat(getIntlLocale(getLanguage()), {
    month: 'short',
    day: 'numeric',
  }).format(date);
}
