import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  submitUserMutation: vi.fn(),
  showToast: vi.fn(),
  authListener: undefined as
    | undefined
    | ((
        state: { token: string | null },
        previous: { token: string | null }
      ) => void),
}));

vi.mock('../utils/apiClient', () => ({
  apiClient: { tasks: { list: mocks.list } },
}));
vi.mock('../utils/userActionQueue', () => ({
  submitUserMutation: mocks.submitUserMutation,
}));
vi.mock('./authStore', () => ({
  useAuthStoreBase: {
    subscribe: vi.fn(listener => {
      mocks.authListener = listener;
    }),
  },
}));
vi.mock('./preferencesStore', () => ({
  usePreferencesStore: { getState: () => ({ preferences: null }) },
}));
vi.mock('./uiStore', () => ({
  useUiStore: {
    getState: () => ({
      clearHistorySource: vi.fn(),
      recordHistoryAction: vi.fn(),
      recordHistoryUndo: vi.fn(),
      recordHistoryRedo: vi.fn(),
    }),
  },
}));
vi.mock('../components/toast/ToastContext', () => ({
  showToastFromStore: mocks.showToast,
}));

beforeEach(() => {
  mocks.list.mockReset();
  mocks.submitUserMutation.mockReset();
  mocks.showToast.mockReset();
});

describe('Tasks store network loading', () => {
  it('shares one active-list request across concurrent refresh triggers', async () => {
    let resolveList!: (value: { status: number; body: never[] }) => void;
    const listPromise = new Promise<{ status: number; body: never[] }>(
      resolve => {
        resolveList = resolve;
      }
    );
    mocks.list.mockReturnValue(listPromise);
    const { useTasksStore } = await import('./tasksStore');

    const socketRefresh = useTasksStore.getState().loadTasks();
    const actionReconcile = useTasksStore.getState().loadTasks();

    expect(mocks.list).toHaveBeenCalledOnce();
    resolveList({ status: 200, body: [] });
    await Promise.all([socketRefresh, actionReconcile]);
    expect(useTasksStore.getState().isLoading).toBe(false);
  });

  it('runs a trailing authoritative load when realtime updates arrive during a load', async () => {
    let resolveInitial!: (value: { status: number; body: never[] }) => void;
    let resolveRefresh!: (value: { status: number; body: never[] }) => void;
    mocks.list
      .mockReturnValueOnce(
        new Promise<{ status: number; body: never[] }>(resolve => {
          resolveInitial = resolve;
        })
      )
      .mockReturnValueOnce(
        new Promise<{ status: number; body: never[] }>(resolve => {
          resolveRefresh = resolve;
        })
      );
    const { useTasksStore } = await import('./tasksStore');

    const initialLoad = useTasksStore.getState().loadTasks();
    const realtimeRefresh = useTasksStore.getState().refreshTasks();
    expect(mocks.list).toHaveBeenCalledOnce();

    resolveInitial({ status: 200, body: [] });
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    resolveRefresh({ status: 200, body: [] });
    await Promise.all([initialLoad, realtimeRefresh]);
  });

  it('cancels a pending realtime refresh when the account changes', async () => {
    let resolveInitial!: (value: { status: number; body: never[] }) => void;
    mocks.list.mockReturnValueOnce(
      new Promise<{ status: number; body: never[] }>(resolve => {
        resolveInitial = resolve;
      })
    );
    const { useTasksStore } = await import('./tasksStore');

    const initialLoad = useTasksStore.getState().loadTasks();
    const realtimeRefresh = useTasksStore.getState().refreshTasks();
    mocks.authListener?.({ token: null }, { token: 'old-token' });
    resolveInitial({ status: 200, body: [] });
    await Promise.all([initialLoad, realtimeRefresh]);

    expect(mocks.list).toHaveBeenCalledOnce();
    expect(useTasksStore.getState().error).toBeNull();
  });

  it('preserves authoritative created Tasks across an older list response', async () => {
    let resolveList!: (value: { status: number; body: never[] }) => void;
    mocks.list.mockReturnValue(
      new Promise<{ status: number; body: never[] }>(resolve => {
        resolveList = resolve;
      })
    );
    const { useTasksStore } = await import('./tasksStore');
    const pendingLoad = useTasksStore.getState().loadTasks();
    const createdTask = {
      id: 'task-new',
      title: 'Created while loading',
      status: 'active',
      priority: 'normal',
      timerType: 'work',
      createdAt: '2026-07-27T12:00:00.000Z',
    };
    useTasksStore.getState().mergeTasks([createdTask as never]);

    resolveList({ status: 200, body: [] });
    await pendingLoad;

    expect(useTasksStore.getState().tasks).toEqual([createdTask]);
  });

  it('applies an authoritative create result without refetching the task list', async () => {
    const createdTask = {
      id: 'task-created',
      title: 'Created task',
      status: 'active',
      priority: 'normal',
      timerType: 'work',
      createdAt: '2026-07-27T12:00:00.000Z',
    };
    mocks.submitUserMutation.mockResolvedValue({
      status: 201,
      body: createdTask,
    });
    const { useTasksStore } = await import('./tasksStore');

    await expect(
      useTasksStore.getState().createTask({ title: createdTask.title })
    ).resolves.toBe(true);

    expect(mocks.submitUserMutation).toHaveBeenCalledWith(
      expect.not.objectContaining({ reconcile: expect.any(Function) })
    );
    expect(mocks.list).not.toHaveBeenCalled();
    expect(useTasksStore.getState().tasks).toContainEqual(createdTask);
  });

  it('preserves a create response that wins while an older list is in flight', async () => {
    let resolveList!: (value: { status: number; body: never[] }) => void;
    mocks.list.mockReturnValue(
      new Promise<{ status: number; body: never[] }>(resolve => {
        resolveList = resolve;
      })
    );
    const createdTask = {
      id: 'task-created-during-load',
      title: 'Created during load',
      status: 'active',
      priority: 'normal',
      timerType: 'work',
      createdAt: '2026-07-27T12:00:00.000Z',
    };
    mocks.submitUserMutation.mockResolvedValue({
      status: 201,
      body: createdTask,
    });
    const { useTasksStore } = await import('./tasksStore');

    const pendingLoad = useTasksStore.getState().loadTasks();
    await useTasksStore.getState().createTask({ title: createdTask.title });
    resolveList({ status: 200, body: [] });
    await pendingLoad;

    expect(useTasksStore.getState().tasks).toContainEqual(createdTask);
  });

  it('reloads authoritative tasks when a create outcome is unknown', async () => {
    const committedTask = {
      id: 'task-unknown-outcome',
      title: 'Committed before worker stopped',
      status: 'active',
      priority: 'normal',
      timerType: 'work',
      createdAt: '2026-07-27T12:00:00.000Z',
    };
    mocks.submitUserMutation.mockRejectedValue(
      new Error('Action worker stopped before completion')
    );
    mocks.list.mockResolvedValue({ status: 200, body: [committedTask] });
    const { useTasksStore } = await import('./tasksStore');

    await expect(
      useTasksStore.getState().createTask({ title: committedTask.title })
    ).resolves.toBe(false);

    expect(mocks.list).toHaveBeenCalledOnce();
    expect(useTasksStore.getState().tasks).toContainEqual(committedTask);
  });

  it('applies an authoritative update result without refetching the task list', async () => {
    const originalTask = {
      id: 'task-updated',
      title: 'Before',
      status: 'active',
      priority: 'normal',
      timerType: 'work',
      createdAt: '2026-07-27T12:00:00.000Z',
    };
    const updatedTask = { ...originalTask, title: 'After' };
    const { useTasksStore } = await import('./tasksStore');
    useTasksStore.getState().mergeTasks([originalTask as never]);
    mocks.submitUserMutation.mockResolvedValue({
      status: 200,
      body: updatedTask,
    });

    await expect(
      useTasksStore
        .getState()
        .updateTask({ id: originalTask.id, title: updatedTask.title })
    ).resolves.toBe(true);

    expect(mocks.submitUserMutation).toHaveBeenCalledWith(
      expect.not.objectContaining({ reconcile: expect.any(Function) })
    );
    expect(mocks.list).not.toHaveBeenCalled();
    expect(useTasksStore.getState().tasks).toContainEqual(updatedTask);
  });

  it('restores saved task data and reports feedback when an update outcome is unknown', async () => {
    const originalTask = {
      id: 'task-update-unknown-outcome',
      title: 'Before',
      status: 'active',
      priority: 'normal',
      timerType: 'work',
      dueDate: '2026-08-03',
      dueTime: '09:30',
      createdAt: '2026-07-27T12:00:00.000Z',
    };
    const savedTask = {
      ...originalTask,
      dueDate: '2026-08-12',
      dueTime: '09:30',
    };
    mocks.submitUserMutation.mockRejectedValue(
      new Error('Action worker stopped before completion')
    );
    mocks.list.mockResolvedValue({ status: 200, body: [savedTask] });
    const { useTasksStore } = await import('./tasksStore');
    useTasksStore.getState().mergeTasks([originalTask as never]);

    await expect(
      useTasksStore.getState().updateTask({
        id: originalTask.id,
        dueDate: savedTask.dueDate,
        dueTime: savedTask.dueTime,
      })
    ).resolves.toBe(false);

    expect(mocks.list).toHaveBeenCalledWith({
      query: { status: 'active' },
    });
    expect(useTasksStore.getState().tasks).toEqual([savedTask]);
    expect(useTasksStore.getState().error).toBeTruthy();
    expect(mocks.showToast).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).toHaveBeenCalledWith(
      useTasksStore.getState().error,
      'error'
    );
  });
});
