import {
  Task,
  TaskPriority,
  TaskFollowUpDefinition,
  TaskRecurrenceAnchorMode,
  TaskStatus,
  TimerTypes,
} from '@pomi/shared';
import { create } from 'zustand';
import { showToastFromStore } from '../components/toast/ToastContext';
import { translateCurrent } from '../i18n';
import { apiClient } from '../utils/apiClient';
import {
  getTaskOrderingClock,
  sortTasksForGeneralView,
  type TaskOrderingClock,
} from '../utils/taskView';
import { submitUserMutation } from '../utils/userActionQueue';
import { useAuthStoreBase } from './authStore';
import { createSelectors } from './createSelectors';
import { type HistoryActionId, useUiStore } from './uiStore';
import { usePreferencesStore } from './preferencesStore';

type TaskCreateInput = {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: TaskPriority;
  timerType?: TimerTypes;
  customDuration?: number | null;
  pinned?: boolean;
  intentionSlug?: string | null;
  subIntentionSlug?: string | null;
  recurrenceRule?: string | null;
  recurrenceInterval?: number | null;
  recurrenceAnchorMode?: TaskRecurrenceAnchorMode;
  followUpTaskId?: string | null;
  followUpDefinition?: TaskFollowUpDefinition | null;
  followUpDelayDays?: number | null;
  vacationEligible?: boolean;
};

type TaskUpdateInput = {
  id: string;
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: TaskPriority;
  timerType?: TimerTypes;
  customDuration?: number | null;
  pinned?: boolean;
  status?: TaskStatus;
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
};

type TaskHistoryEntry = {
  before: Task | null;
  after: Task | null;
  historyActionId?: HistoryActionId;
};

type TasksStore = {
  tasks: Task[];
  completingTaskIds: string[];
  isLoading: boolean;
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  loadTasks: () => Promise<void>;
  refreshTasks: () => Promise<void>;
  mergeTasks: (tasks: Task[]) => void;
  createTask: (task: TaskCreateInput) => Promise<boolean>;
  updateTask: (task: TaskUpdateInput) => Promise<boolean>;
  undoTaskAction: () => Promise<boolean>;
  redoTaskAction: () => Promise<boolean>;
};

const initialTasksState = {
  tasks: [],
  completingTaskIds: [],
  isLoading: false,
  error: null,
  canUndo: false,
  canRedo: false,
};

const undoHistory: TaskHistoryEntry[] = [];
const redoHistory: TaskHistoryEntry[] = [];
let loadRequestId = 0;
let loadTasksPromise: Promise<void> | null = null;
let refreshTasksPromise: Promise<void> | null = null;
let refreshTasksPending = false;
let refreshTasksGeneration = 0;
const taskMutationVersions = new Map<string, number>();
let taskResponseVersion = 0;
const taskResponseOverlays = new Map<
  string,
  { task: Task | null; version: number }
>();

function recordTaskResponse(task: Task | null, id: string | undefined) {
  if (!id) return;
  taskResponseVersion += 1;
  taskResponseOverlays.set(id, { task, version: taskResponseVersion });
}

function normalizeMutationResponse<T>(result: unknown, successStatus: number) {
  if (
    result &&
    typeof result === 'object' &&
    'status' in result &&
    'body' in result
  ) {
    return result as { status: number; body: T };
  }
  return { status: successStatus, body: result as T };
}

const useTasksStoreBase = create<TasksStore>((set, get) => ({
  ...initialTasksState,
  loadTasks: async () => {
    if (loadTasksPromise) {
      return loadTasksPromise;
    }

    const requestId = ++loadRequestId;
    const responseVersionAtStart = taskResponseVersion;
    const currentPromise = (async () => {
      set(state => ({
        isLoading: state.tasks.length === 0,
        error: null,
      }));
      try {
        const response = await apiClient.tasks.list({
          query: { status: 'active' },
        });
        if (requestId !== loadRequestId) return;
        if (response.status === 200) {
          const concurrentResponses = [
            ...taskResponseOverlays.entries(),
          ].filter(([, overlay]) => overlay.version > responseVersionAtStart);
          set(state => {
            const completingIds = new Set(state.completingTaskIds);
            const completingSnapshots = state.tasks.filter(task =>
              completingIds.has(task.id)
            );
            const withCompletingTasks = completingSnapshots.reduce(
              (activeTasks, task) => upsertTask(activeTasks, task),
              response.body
            );
            return {
              tasks: sortTasks(
                concurrentResponses.reduce((activeTasks, [id, overlay]) => {
                  if (overlay.task) {
                    return upsertTask(activeTasks, overlay.task);
                  }
                  return activeTasks.filter(task => task.id !== id);
                }, withCompletingTasks),
                getTaskOrderingClock(new Date())
              ),
              isLoading: false,
              error: null,
            };
          });
          taskResponseOverlays.forEach((overlay, id) => {
            if (overlay.version <= responseVersionAtStart) {
              taskResponseOverlays.delete(id);
            }
          });
          return;
        }
        set({ isLoading: false, error: translateCurrent('task.loadFailed') });
      } catch (error) {
        if (requestId !== loadRequestId) return;
        console.error('Failed to load tasks:', error);
        set({ isLoading: false, error: translateCurrent('task.loadFailed') });
      }
    })();
    loadTasksPromise = currentPromise;
    try {
      await currentPromise;
    } finally {
      if (loadTasksPromise === currentPromise) {
        loadTasksPromise = null;
      }
    }
  },
  refreshTasks: async () => {
    const generation = refreshTasksGeneration;
    refreshTasksPending = true;
    if (refreshTasksPromise) return refreshTasksPromise;
    const currentPromise = (async () => {
      while (refreshTasksPending && generation === refreshTasksGeneration) {
        refreshTasksPending = false;
        if (loadTasksPromise) await loadTasksPromise;
        if (generation !== refreshTasksGeneration) return;
        await get().loadTasks();
      }
    })();
    refreshTasksPromise = currentPromise;
    try {
      await currentPromise;
    } finally {
      if (refreshTasksPromise === currentPromise) {
        refreshTasksPromise = null;
      }
    }
  },
  mergeTasks: tasks => {
    tasks.forEach(task => recordTaskResponse(task, task.id));
    set(state => ({
      tasks: sortTasks(
        tasks.reduce(
          (currentTasks, task) => upsertTask(currentTasks, task),
          state.tasks
        ),
        getTaskOrderingClock(new Date())
      ),
      error: null,
    }));
  },
  createTask: async task => {
    try {
      const body = {
        ...task,
        dueDate:
          task.dueDate === undefined ? getDefaultTaskDueDate() : task.dueDate,
      };
      const result = await submitUserMutation({
        kind: 'tasks',
        label: translateCurrent('task.create'),
        payload: { operation: 'create', ...body },
      });
      const response = normalizeMutationResponse<Task>(result, 201);
      if (response.status === 201) {
        recordTaskResponse(response.body, response.body.id);
        pushTaskHistory({ before: null, after: response.body });
        set(state => ({
          tasks: sortTasks(
            upsertTask(state.tasks, response.body),
            getTaskOrderingClock(new Date())
          ),
          error: null,
          canUndo: undoHistory.length > 0,
          canRedo: false,
        }));
        return true;
      }
      set({ error: translateCurrent('task.creationFailed') });
      return false;
    } catch (error) {
      console.error('Failed to create task:', error);
      await get().loadTasks();
      set({ error: translateCurrent('task.creationFailed') });
      return false;
    }
  },
  updateTask: async ({ id, ...updates }) => {
    const mutationVersion = (taskMutationVersions.get(id) ?? 0) + 1;
    taskMutationVersions.set(id, mutationVersion);
    const before = get().tasks.find(task => task.id === id) ?? null;
    const isCompletion =
      updates.status === 'completed' && before?.status === 'active';
    const completionDelay = isCompletion
      ? new Promise<void>(resolve => setTimeout(resolve, 1500))
      : null;

    if (isCompletion) {
      if (get().completingTaskIds.includes(id)) return false;
      set(state => ({
        completingTaskIds: [...state.completingTaskIds, id],
      }));
    }
    if (updates.status === 'active') {
      set(state => ({
        completingTaskIds: state.completingTaskIds.filter(
          taskId => taskId !== id
        ),
      }));
    }

    try {
      const actionUpdates =
        isCompletion && before
          ? {
              ...updates,
              expectedDueDate: before.dueDate,
              expectedDueTime: before.dueTime,
            }
          : updates;
      const result = await submitUserMutation({
        kind: 'tasks',
        label: translateCurrent('task.updateAction'),
        payload: { operation: 'update', taskId: id, ...actionUpdates },
      });
      const response = normalizeMutationResponse<Task>(result, 200);
      if (response.status === 200) {
        if (completionDelay) await completionDelay;
        if (taskMutationVersions.get(id) !== mutationVersion) return true;
        pushTaskHistory({ before, after: response.body });
        recordTaskResponse(
          response.body.status === 'active' ? response.body : null,
          response.body.id
        );
        set(state => {
          return {
            tasks:
              response.body.status === 'active'
                ? sortTasks(
                    upsertTask(state.tasks, response.body),
                    getTaskOrderingClock(new Date())
                  )
                : state.tasks.filter(task => task.id !== response.body.id),
            error: null,
            completingTaskIds: state.completingTaskIds.filter(
              taskId => taskId !== id
            ),
            canUndo: undoHistory.length > 0,
            canRedo: false,
          };
        });
        return true;
      }
      if (taskMutationVersions.get(id) !== mutationVersion) return false;
      await get().loadTasks();
      set(state => ({
        error: translateCurrent('task.updateFailed'),
        completingTaskIds: state.completingTaskIds.filter(
          taskId => taskId !== id
        ),
      }));
      showToastFromStore(translateCurrent('task.updateFailed'), 'error');
      return false;
    } catch (error) {
      if (taskMutationVersions.get(id) !== mutationVersion) return false;
      console.error('Failed to update task:', error);
      await get().loadTasks();
      set(state => ({
        error: translateCurrent('task.updateFailed'),
        completingTaskIds: state.completingTaskIds.filter(
          taskId => taskId !== id
        ),
      }));
      showToastFromStore(translateCurrent('task.updateFailed'), 'error');
      return false;
    }
  },
  undoTaskAction: async () => {
    const entry = undoHistory.pop();
    if (!entry) {
      return false;
    }

    const ok = await applyTaskSnapshot(entry.before, entry.after);
    if (!ok) {
      undoHistory.push(entry);
      return false;
    }

    redoHistory.push(entry);
    useUiStore.getState().recordHistoryUndo('task', entry.historyActionId);
    set({
      canUndo: undoHistory.length > 0,
      canRedo: true,
    });
    return true;
  },
  redoTaskAction: async () => {
    const entry = redoHistory.pop();
    if (!entry) {
      return false;
    }

    const ok = await applyTaskSnapshot(entry.after, entry.before);
    if (!ok) {
      redoHistory.push(entry);
      return false;
    }

    undoHistory.push(entry);
    useUiStore.getState().recordHistoryRedo('task', entry.historyActionId);
    set({
      canUndo: true,
      canRedo: redoHistory.length > 0,
    });
    return true;
  },
}));

function pushTaskHistory(entry: TaskHistoryEntry) {
  undoHistory.push(entry);
  redoHistory.length = 0;
  entry.historyActionId = useUiStore.getState().recordHistoryAction('task');
}

async function applyTaskSnapshot(
  snapshot: Task | null,
  fallback: Task | null
): Promise<boolean> {
  const target = snapshot ?? fallback;
  if (!target) {
    return false;
  }

  try {
    const body: Omit<TaskUpdateInput, 'id'> = snapshot
      ? snapshot.status === 'completed'
        ? {
            status: snapshot.status,
            expectedDueDate: fallback?.dueDate ?? snapshot.dueDate,
            expectedDueTime: fallback?.dueTime ?? snapshot.dueTime,
          }
        : getTaskUpdatePayload(snapshot)
      : { status: 'archived' };
    const result = await submitUserMutation({
      kind: 'tasks',
      label: snapshot
        ? translateCurrent('task.undoChange')
        : translateCurrent('task.archiveAction'),
      payload: { operation: 'update', taskId: target.id, ...body },
    });
    const response = normalizeMutationResponse<Task>(result, 200);
    if (response.status !== 200) {
      await useTasksStoreBase.getState().loadTasks();
      showToastFromStore(translateCurrent('task.historyUpdateFailed'), 'error');
      return false;
    }

    useTasksStoreBase.setState(state => ({
      tasks:
        response.body.status === 'active'
          ? sortTasks(
              upsertTask(state.tasks, response.body),
              getTaskOrderingClock(new Date())
            )
          : state.tasks.filter(task => task.id !== response.body.id),
      error: null,
    }));
    return true;
  } catch (error) {
    console.error('Failed to apply task history:', error);
    await useTasksStoreBase.getState().loadTasks();
    showToastFromStore(translateCurrent('task.historyUpdateFailed'), 'error');
    return false;
  }
}

function getTaskUpdatePayload(task: Task): Omit<TaskUpdateInput, 'id'> {
  return {
    title: task.title,
    description: task.description,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    priority: task.priority,
    timerType: task.timerType,
    customDuration: task.customDuration,
    pinned: task.pinnedAt !== null,
    status: task.status,
    intentionSlug: task.intentionSlug,
    subIntentionSlug: task.subIntentionSlug,
    recurrenceRule: task.recurrenceRule,
    recurrenceInterval: task.recurrenceInterval,
    recurrenceAnchorMode: task.recurrenceAnchorMode,
    followUpTaskId: task.followUpTaskId,
    followUpDefinition: task.followUpDefinition,
    followUpDelayDays: task.followUpDelayDays,
    vacationEligible: task.vacationEligible,
  };
}

const sortTasks = (tasks: Task[], orderingClock: TaskOrderingClock) =>
  sortTasksForGeneralView(
    tasks,
    orderingClock.today,
    orderingClock.currentTime
  );

const upsertTask = (tasks: Task[], nextTask: Task) => {
  const hasTask = tasks.some(task => task.id === nextTask.id);
  if (hasTask) {
    return tasks.map(task => (task.id === nextTask.id ? nextTask : task));
  }

  return [...tasks, nextTask];
};

function getDefaultTaskDueDate() {
  const preferences = usePreferencesStore.getState().preferences;
  const mode = preferences?.taskDefaultDueDateMode ?? 'tomorrow';
  if (mode === 'off') {
    return null;
  }
  const days =
    mode === 'week'
      ? 7
      : mode === 'custom'
        ? (preferences?.taskDefaultDueDateDays ?? 1)
        : 1;
  const date = new Date();
  date.setDate(date.getDate() + days);

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export const useTasksStore = createSelectors(useTasksStoreBase);

useAuthStoreBase.subscribe((state, prevState) => {
  if (state.token === prevState.token) {
    return;
  }

  undoHistory.length = 0;
  redoHistory.length = 0;
  loadRequestId += 1;
  loadTasksPromise = null;
  refreshTasksGeneration += 1;
  refreshTasksPromise = null;
  refreshTasksPending = false;
  taskResponseOverlays.clear();
  taskResponseVersion = 0;
  useUiStore.getState().clearHistorySource('task');
  useTasksStoreBase.setState(initialTasksState);
});
