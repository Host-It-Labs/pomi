import type { Task, Timer } from '@pomi/shared';
import { TASK_PRIORITIES, TIMER_TYPES } from '@pomi/shared/src/constants';
import type { TaskMode } from '../stores/uiStore';
import { isTaskOverdue } from './taskUi';

const PRIORITY_RANK = {
  [TASK_PRIORITIES.URGENT]: 0,
  [TASK_PRIORITIES.HIGH]: 1,
  [TASK_PRIORITIES.NORMAL]: 2,
  [TASK_PRIORITIES.LOW]: 3,
};

type TaskViewOptions = {
  tasks: Task[];
  timer?: TaskViewTimer | null;
  mode: TaskMode;
  today: string;
  currentTime: string;
  filterTimerType: boolean;
  hideVacationCovered: boolean;
};

export type TaskViewTimer = Pick<
  Timer,
  'type' | 'intention' | 'intentionSlugs' | 'subIntention' | 'subIntentions'
>;

export type TaskViewResult = {
  tasks: Task[];
  generalPreviewTasks: Task[];
};

export type TaskOrderingClock = {
  today: string;
  currentTime: string;
};

export function getDisplayedTaskMode(
  mode: TaskMode,
  hasTimerIntention: boolean
): TaskMode {
  return hasTimerIntention ? mode : 'general';
}

export function getTaskOrderingClock(now: Date): TaskOrderingClock {
  return {
    today: [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-'),
    currentTime: [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
    ].join(':'),
  };
}

export function sortTasksForGeneralView(
  tasks: Task[],
  today: string,
  currentTime: string
) {
  return [...tasks].sort((a, b) =>
    compareTasksForGeneralView(a, b, today, currentTime)
  );
}

export function compareTasksForGeneralView(
  a: Task,
  b: Task,
  today: string,
  currentTime: string
) {
  const aPinned = a.pinnedAt !== null;
  const bPinned = b.pinnedAt !== null;
  if (aPinned !== bPinned) {
    return aPinned ? -1 : 1;
  }

  if (aPinned && bPinned) {
    return (a.pinnedAt ?? '').localeCompare(b.pinnedAt ?? '');
  }

  return compareTasksByDueAndPriority(a, b, today, currentTime);
}

export function buildTaskView({
  tasks,
  timer,
  mode,
  today,
  currentTime,
  filterTimerType,
  hideVacationCovered,
}: TaskViewOptions): TaskViewResult {
  const candidateTasks = hideVacationCovered
    ? tasks.filter(task => !task.vacationEligible)
    : tasks;
  const pinnedTasks = candidateTasks
    .filter(task => task.pinnedAt !== null)
    .sort((a, b) => (a.pinnedAt ?? '').localeCompare(b.pinnedAt ?? ''));
  const pinnedOrder = new Map(
    pinnedTasks.map((task, index) => [task.id, index])
  );
  const hasTimerFilter = getTimerIntentions(timer).length > 0;

  const visibleTasks = filterTimerType
    ? candidateTasks.filter(
        task => task.timerType === (timer?.type ?? TIMER_TYPES.WORK)
      )
    : candidateTasks;
  const filteredTasks =
    mode === 'general' || !hasTimerFilter
      ? visibleTasks
      : visibleTasks.filter(
          task => pinnedOrder.has(task.id) || isTaskLinkedToTimer(task, timer)
        );

  const sortMode = mode === 'intention' && hasTimerFilter ? mode : 'general';
  const sortedGeneralPreviewTasks =
    mode === 'intention' && hasTimerFilter
      ? sortTasksForGeneralView(
          visibleTasks.filter(task => !filteredTasks.includes(task)),
          today,
          currentTime
        )
      : [];

  const automaticallySortedTasks =
    sortMode === 'general'
      ? sortTasksForGeneralView(filteredTasks, today, currentTime)
      : [...filteredTasks].sort((a, b) =>
          compareTasksForView(
            a,
            b,
            pinnedOrder,
            timer,
            today,
            currentTime,
            sortMode
          )
        );

  return {
    tasks: automaticallySortedTasks,
    generalPreviewTasks: sortedGeneralPreviewTasks,
  };
}

function compareTasksForView(
  a: Task,
  b: Task,
  focusedOrder: Map<string, number>,
  timer: TaskViewTimer | null | undefined,
  today: string,
  currentTime: string,
  mode: TaskMode
) {
  const aGroup = getTaskGroup(a, focusedOrder, timer, mode);
  const bGroup = getTaskGroup(b, focusedOrder, timer, mode);
  if (aGroup !== bGroup) {
    return aGroup - bGroup;
  }

  const aFocusOrder = focusedOrder.get(a.id);
  const bFocusOrder = focusedOrder.get(b.id);
  if (aFocusOrder !== undefined && bFocusOrder !== undefined) {
    return aFocusOrder - bFocusOrder;
  }

  return compareTasksByDueAndPriority(a, b, today, currentTime);
}

function getTaskGroup(
  task: Task,
  focusedOrder: Map<string, number>,
  timer: TaskViewTimer | null | undefined,
  mode: TaskMode
) {
  const baseGroup = getBaseTaskGroup(task, focusedOrder, timer, mode);
  return baseGroup;
}

function getBaseTaskGroup(
  task: Task,
  focusedOrder: Map<string, number>,
  timer: TaskViewTimer | null | undefined,
  mode: TaskMode
) {
  if (focusedOrder.has(task.id)) {
    return 0;
  }
  if (mode === 'general') {
    return 1;
  }
  if (isTaskLinkedToTimer(task, timer)) {
    return 1;
  }
  if (!task.intentionSlug) {
    return 2;
  }
  return 3;
}

export type TaskOrderingItem = Pick<
  Task,
  'id' | 'dueDate' | 'priority' | 'createdAt'
> & {
  dueTime?: string | null;
};

export function compareTasksByDueAndPriority(
  a: TaskOrderingItem,
  b: TaskOrderingItem,
  today: string,
  currentTime: string
) {
  const now = new Date(`${today}T${currentTime}:00`);
  const aOverdue = isTaskOverdue(
    { dueDate: a.dueDate, dueTime: a.dueTime ?? null },
    now
  );
  const bOverdue = isTaskOverdue(
    { dueDate: b.dueDate, dueTime: b.dueTime ?? null },
    now
  );
  if (aOverdue !== bOverdue) {
    return aOverdue ? -1 : 1;
  }

  if (a.dueDate === null || b.dueDate === null) {
    if (a.dueDate !== b.dueDate) {
      return a.dueDate === null ? 1 : -1;
    }

    return comparePriority(a, b) || b.createdAt.localeCompare(a.createdAt);
  }

  if (aOverdue && bOverdue) {
    return (
      comparePriority(a, b) ||
      a.dueDate.localeCompare(b.dueDate) ||
      compareDueTime(a, b) ||
      a.createdAt.localeCompare(b.createdAt)
    );
  }

  if (a.dueDate !== b.dueDate) {
    return a.dueDate.localeCompare(b.dueDate);
  }

  return (
    compareDueTime(a, b) ||
    comparePriority(a, b) ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

function compareDueTime(a: TaskOrderingItem, b: TaskOrderingItem) {
  const aDueTime = a.dueTime ?? '99:99';
  const bDueTime = b.dueTime ?? '99:99';
  if (aDueTime !== bDueTime) {
    return aDueTime.localeCompare(bDueTime);
  }

  return 0;
}

function comparePriority(a: TaskOrderingItem, b: TaskOrderingItem) {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

export function isTaskLinkedToTimer(
  task: Task,
  timer: TaskViewTimer | null | undefined
) {
  if (!task.intentionSlug || !timer) {
    return false;
  }
  if (task.timerType !== timer.type) {
    return false;
  }

  const timerIntentions = getTimerIntentions(timer);
  if (!timerIntentions.includes(task.intentionSlug)) {
    return false;
  }

  const timerSubIntention =
    timer.subIntentions?.[task.intentionSlug] ??
    (timer.intention === task.intentionSlug ? timer.subIntention : undefined);
  if (!timerSubIntention) {
    return true;
  }

  return !task.subIntentionSlug || task.subIntentionSlug === timerSubIntention;
}

function getTimerIntentions(timer: TaskViewTimer | null | undefined) {
  return timer?.intentionSlugs ?? (timer?.intention ? [timer.intention] : []);
}
