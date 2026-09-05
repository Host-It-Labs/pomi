import type { Intention, Preferences, Task, User } from '@pomi/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tasks: [] as Task[],
  intentions: [] as Intention[],
  loadTasks: vi.fn().mockResolvedValue(undefined),
  createTask: vi.fn().mockResolvedValue(true),
  updateTask: vi.fn().mockResolvedValue(true),
  reorderTasks: vi.fn().mockResolvedValue(true),
  loadVacationStatus: vi.fn().mockResolvedValue(undefined),
  updatePreferenceWithResult: vi.fn().mockResolvedValue(true),
  createOrResumeTimer: vi.fn().mockResolvedValue(undefined),
  setTaskMode: vi.fn(),
  clearTaskCreateRequest: vi.fn(),
}));

vi.mock('../stores/tasksStore', () => ({
  useTasksStore: {
    use: {
      tasks: () => mocks.tasks,
      completingTaskIds: () => [],
      isLoading: () => false,
      error: () => null,
      loadTasks: () => mocks.loadTasks,
      createTask: () => mocks.createTask,
      updateTask: () => mocks.updateTask,
      reorderTasks: () => mocks.reorderTasks,
    },
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: {
    use: {
      user: () =>
        ({ id: 'user-1', username: 'member', isAdmin: false }) as User,
    },
  },
}));

vi.mock('../stores/preferencesStore', () => ({
  usePreferencesStore: {
    use: {
      preferences: () =>
        ({
          listsExtension: false,
          vacationExtension: false,
          tasksShowVacationCovered: true,
        }) as Preferences,
      updatePreferenceWithResult: () => mocks.updatePreferenceWithResult,
    },
  },
}));

vi.mock('../stores/vacationStore', () => ({
  useVacationStore: {
    use: {
      status: () => ({ active: false }),
      loadStatus: () => mocks.loadVacationStatus,
    },
  },
}));

vi.mock('../stores/timerStore', () => ({
  useTimerStore: {
    use: {
      timer: () => null,
      createOrResumeTimer: () => mocks.createOrResumeTimer,
    },
  },
}));

vi.mock('../stores/uiStore', () => ({
  useUiStore: {
    use: {
      setTaskMode: () => mocks.setTaskMode,
      taskCreateRequested: () => false,
      taskCreateInitialTitle: () => '',
      clearTaskCreateRequest: () => mocks.clearTaskCreateRequest,
      intentionPickerOpenRequest: () => 0,
      taskSearchFocusRequest: () => 0,
      taskQuickCreateFocusRequest: () => 0,
      taskItemRevealRequest: () => null,
      clearTaskItemRevealRequest: () => vi.fn(),
    },
  },
}));

vi.mock('../utils/apiClient', () => ({
  apiClient: {
    tasks: {
      importStatus: vi
        .fn()
        .mockResolvedValue({ status: 200, body: { hasImportedTasks: true } }),
      list: vi.fn().mockResolvedValue({ status: 200, body: [] }),
      archive: vi.fn().mockResolvedValue({
        status: 200,
        body: { items: [], nextCursor: null },
      }),
    },
    intentions: {
      list: vi.fn(async () => ({ status: 200, body: mocks.intentions })),
    },
    lists: {
      list: vi.fn().mockResolvedValue({ status: 200, body: [] }),
      items: vi.fn().mockResolvedValue({ status: 200, body: [] }),
    },
  },
}));

vi.mock('../utils/userActionQueue', () => ({
  submitUserMutation: vi.fn(),
}));

vi.mock('../hooks/useTaskOrderingClock', () => ({
  useTaskOrderingClock: () => ({
    today: '2026-08-23',
    currentTime: '12:00',
  }),
}));

vi.mock('./taskDefaultSort', () => ({
  useDefaultTaskSort: vi.fn(),
}));

vi.mock('../utils/osUtils', () => ({
  isTauri: false,
  isAndroid: false,
  isDesktop: false,
  isMobile: false,
  isIos: false,
  isMac: false,
  isWindows: false,
  isLinux: false,
  isDebugMobileSimulator: false,
  platformName: 'web',
}));

vi.mock('../components/BackButton', () => ({
  BackButton: () => <button type="button">Back</button>,
}));

vi.mock('../components/tasks/TaskQuickCreateRow', () => ({
  TaskQuickCreateRow: () => null,
}));

vi.mock('../components/tasks/TaskFormModal', () => ({
  TaskFormModal: () => null,
}));

vi.mock('../components/tasks/TaskImportModal', () => ({
  TaskImportModal: () => null,
}));

vi.mock('../components/tasks/TaskDescriptionModal', () => ({
  TaskDescriptionButton: () => null,
  TaskDescriptionModal: () => null,
}));

vi.mock('../components/tasks/TaskInlineProperties', () => ({
  TaskInlineProperties: ({ task }: { task: Task }) => (
    <div data-testid={`task-inline-properties-${task.id}`}>Properties</div>
  ),
}));

vi.mock('../components/tasks/FavoriteIntentionFilters', () => ({
  FavoriteIntentionFilters: ({
    items,
    onSelect,
  }: {
    items: Array<{ value: string; title: string }>;
    onSelect: (value: string) => void;
  }) => (
    <div>
      {items.map(item => (
        <button
          key={item.value}
          type="button"
          onClick={() => onSelect(item.value)}
        >
          {item.title}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../components/toast/ToastContext', () => ({
  showToastFromStore: vi.fn(),
}));

import { apiClient } from '../utils/apiClient';
import { Tasks } from './Tasks';

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  if (!HTMLElement.prototype.scrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tasks = [];
  mocks.intentions = [];
});

describe('Tasks page interactions', () => {
  it('appends archive pages without replacing the visible history', async () => {
    vi.mocked(apiClient.tasks.archive)
      .mockResolvedValueOnce({
        status: 200,
        body: {
          items: [task({ id: 'archived-1', title: 'Archived one' })],
          nextCursor: 'next-page',
        },
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          items: [task({ id: 'archived-2', title: 'Archived two' })],
          nextCursor: null,
        },
        headers: new Headers(),
      });

    render(<Tasks />);
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));

    expect(await screen.findByText('Archived one')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Archived two')).toBeInTheDocument();
    expect(screen.getByText('Archived one')).toBeInTheDocument();
    expect(apiClient.tasks.archive).toHaveBeenLastCalledWith({
      query: { limit: 50, cursor: 'next-page' },
    });
  });

  it('reports a missing archive endpoint without legacy fallback requests', async () => {
    vi.mocked(apiClient.tasks.archive).mockResolvedValueOnce({
      status: 404,
      body: { message: 'Not found' },
      headers: new Headers(),
    } as never);
    render(<Tasks />);
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));

    expect(
      await screen.findByText('Failed to load archived Tasks.')
    ).toBeInTheDocument();
    expect(apiClient.tasks.list).not.toHaveBeenCalled();
  });

  it('does not run unbounded archive fallbacks for endpoint failures', async () => {
    vi.mocked(apiClient.tasks.archive).mockResolvedValueOnce({
      status: 500,
      body: { message: 'Unavailable' },
      headers: new Headers(),
    } as never);

    render(<Tasks />);
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));

    expect(
      await screen.findByText('Failed to load archived Tasks.')
    ).toBeInTheDocument();
    expect(apiClient.tasks.list).not.toHaveBeenCalled();
  });

  it('keeps all dated Tasks and individual actions in the list', async () => {
    mocks.tasks = [
      task({
        id: 'today-task',
        title: 'Today task',
        dueDate: '2026-08-23',
      }),
      task({
        id: 'later-task',
        title: 'Later task',
        dueDate: '2026-08-30',
      }),
    ];

    render(<Tasks />);

    await screen.findByText('Today task');
    expect(screen.getByText('Later task')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Calendar' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Select multiple Tasks' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('task-inline-properties-today-task')
    ).toBeInTheDocument();

    const completeButton = screen.getByRole('button', {
      name: 'Complete Today task',
    });
    expect(completeButton).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Edit Today task' })
    ).toBeEnabled();
    fireEvent.click(completeButton);

    await waitFor(() =>
      expect(mocks.updateTask).toHaveBeenCalledWith({
        id: 'today-task',
        status: 'completed',
      })
    );
  });

  it('keeps contextual follow-ups out of reorder targets and payloads', async () => {
    mocks.intentions = [intention()];
    mocks.tasks = [
      task({
        id: 'task-a',
        title: 'Task A',
        intentionSlug: 'focus',
        createdAt: '2026-08-23T12:00:00.000Z',
      }),
      task({
        id: 'follow-up',
        title: 'Contextual follow-up',
        intentionSlug: 'focus',
        followUpParent: { id: 'parent-task', title: 'Parent task' },
        createdAt: '2026-08-23T11:00:00.000Z',
      }),
      task({
        id: 'task-b',
        title: 'Task B',
        intentionSlug: 'focus',
        createdAt: '2026-08-23T10:00:00.000Z',
      }),
    ];

    render(<Tasks />);

    fireEvent.click(await screen.findByRole('button', { name: 'Focus' }));
    const taskADragHandle = await screen.findByRole('button', {
      name: 'Drag Task A',
    });
    expect(
      screen.queryByRole('button', { name: 'Drag Contextual follow-up' })
    ).not.toBeInTheDocument();

    const rects = new Map([
      ['task-a', 0],
      ['follow-up', 40],
      ['task-b', 80],
    ]);
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const top = rects.get(this.dataset.taskId ?? '') ?? 0;
        return domRect(top);
      });

    fireEvent.mouseDown(taskADragHandle, { button: 0, clientY: 10 });
    fireEvent.mouseMove(window, { clientY: 70 });

    expect(screen.getByTestId('task-list')).not.toHaveAttribute(
      'data-drop-target-id',
      'follow-up'
    );
    fireEvent.mouseUp(window, { clientY: 70 });
    expect(mocks.reorderTasks).not.toHaveBeenCalled();

    fireEvent.mouseDown(taskADragHandle, { button: 0, clientY: 10 });
    fireEvent.mouseUp(window, { clientY: 130 });

    await waitFor(() => expect(mocks.reorderTasks).toHaveBeenCalledOnce());
    const [updates] = mocks.reorderTasks.mock.calls[0] as [
      Array<{ id: string }>,
    ];
    expect(updates.map(update => update.id)).toEqual(['task-b', 'task-a']);
    expect(updates).not.toContainEqual(
      expect.objectContaining({ id: 'follow-up' })
    );

    rectSpy.mockRestore();
  });
});

function task(overrides: Partial<Task>): Task {
  return {
    id: 'task-1',
    userId: 'user-1',
    title: 'Task',
    description: null,
    sourceTranscript: null,
    creationSource: 'manual',
    importSource: null,
    importSourceTaskId: null,
    dueDate: null,
    dueTime: null,
    manualOrder: null,
    manualOrderOverride: false,
    priority: 'normal',
    status: 'active',
    timerType: 'work',
    customDuration: null,
    pinnedAt: null,
    intentionSlug: null,
    subIntentionSlug: null,
    recurrenceRule: null,
    recurrenceInterval: null,
    recurrenceAnchorMode: 'planned',
    followUpTaskId: null,
    followUpDelayDays: null,
    followUpSourceTaskId: null,
    itemKind: 'task',
    vacationEligible: false,
    createdAt: '2026-08-23T10:00:00.000Z',
    updatedAt: '2026-08-23T10:00:00.000Z',
    ...overrides,
  };
}

function intention(): Intention {
  return {
    id: 'focus-id',
    userId: 'user-1',
    slug: 'focus',
    title: 'Focus',
    emoji: '🎯',
    type: 'work',
    parentIntentionId: null,
    hasCustomDuration: false,
    customDuration: null,
    keepScreenAwake: false,
    isHabit: false,
    isArchived: false,
    isFavorite: true,
    allowsTasks: true,
    usageCount: 0,
    createdAt: '2026-08-23T10:00:00.000Z',
    updatedAt: '2026-08-23T10:00:00.000Z',
  };
}

function domRect(top: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom: top + 40,
    left: 0,
    right: 100,
    width: 100,
    height: 40,
    toJSON: () => ({}),
  } as DOMRect;
}
