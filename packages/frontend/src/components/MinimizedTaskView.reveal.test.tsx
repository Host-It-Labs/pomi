import type { Preferences, Task } from '@pomi/shared';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tasks: [] as Task[],
  isMobile: false,
  loadTasks: vi.fn().mockResolvedValue(undefined),
  updateTask: vi.fn().mockResolvedValue(true),
  loadVacationStatus: vi.fn().mockResolvedValue(undefined),
  updatePreferenceWithResult: vi.fn().mockResolvedValue(true),
  createOrResumeTimer: vi.fn().mockResolvedValue(undefined),
  setTaskMode: vi.fn(),
  setActiveTab: vi.fn(),
  setExpanded: vi.fn(),
  requestTaskCreate: vi.fn(),
  requestTaskEdit: vi.fn(),
  clearTaskEditRequest: vi.fn(),
  showToastFromStore: vi.fn(),
}));

vi.mock('../stores/tasksStore', () => ({
  useTasksStore: {
    use: {
      tasks: () => mocks.tasks,
      completingTaskIds: () => [],
      isLoading: () => false,
      error: () => null,
      loadTasks: () => mocks.loadTasks,
      createTask: () => vi.fn().mockResolvedValue(true),
      updateTask: () => mocks.updateTask,
    },
  },
}));

vi.mock('../stores/preferencesStore', () => ({
  usePreferencesStore: {
    use: {
      preferences: () =>
        ({
          tasksExtension: false,
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
      timer: () => ({ type: 'work' }),
      createOrResumeTimer: () => mocks.createOrResumeTimer,
    },
  },
}));

vi.mock('../stores/uiStore', () => ({
  useUiStore: {
    use: {
      taskMode: () => 'general',
      setTaskMode: () => mocks.setTaskMode,
      setActiveTab: () => mocks.setActiveTab,
      setExpanded: () => mocks.setExpanded,
      requestTaskCreate: () => mocks.requestTaskCreate,
      taskEditRequestedId: () => null,
      requestTaskEdit: () => mocks.requestTaskEdit,
      clearTaskEditRequest: () => mocks.clearTaskEditRequest,
      taskSearchFocusRequest: () => 0,
    },
  },
}));

vi.mock('../hooks/useTaskOrderingClock', () => ({
  useTaskOrderingClock: () => ({
    today: '2026-08-23',
    currentTime: '12:00',
  }),
}));

vi.mock('../utils/apiClient', () => ({
  apiClient: {
    intentions: {
      list: vi.fn().mockResolvedValue({ status: 200, body: [] }),
    },
    lists: {
      list: vi.fn().mockResolvedValue({ status: 200, body: [] }),
    },
  },
}));

vi.mock('../utils/osUtils', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/osUtils')>();
  return {
    ...actual,
    get isMobile() {
      return mocks.isMobile;
    },
  };
});

vi.mock('./tasks/TaskInlineProperties', () => ({
  TaskInlineProperties: ({
    onUpdate,
  }: {
    onUpdate: (update: { id: string; dueDate: string }) => Promise<boolean>;
  }) => (
    <button
      type="button"
      onClick={() => void onUpdate({ id: 'task-4', dueDate: '2026-08-24' })}
    >
      Update task
    </button>
  ),
}));

vi.mock('./tasks/CompletionButton', () => ({
  CompletionButton: ({ label }: { label: string }) => <span>{label}</span>,
}));

vi.mock('./tasks/TaskTimerTypeBadge', () => ({
  TaskTimerTypeBadge: () => null,
}));

vi.mock('./tasks/TaskQuickCreateRow', () => ({
  TaskQuickCreateRow: ({ onCancel }: { onCancel?: () => void }) => (
    <button type="button" onClick={onCancel}>
      Cancel quick create
    </button>
  ),
}));

vi.mock('./tasks/TaskDescriptionModal', () => ({
  TaskDescriptionButton: () => null,
  TaskDescriptionModal: () => null,
}));

vi.mock('./tasks/MobileSwipeActionRow', () => ({
  MobileSwipeActionRow: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('./tasks/TaskArchiveConfirmationModal', () => ({
  TaskArchiveConfirmationModal: () => null,
}));

vi.mock('./tasks/OverflowTaskTitle', () => ({
  OverflowTaskTitle: ({ title }: { title: string }) => <span>{title}</span>,
}));

vi.mock('./tasks/TaskFollowUpContext', () => ({
  TaskFollowUpContext: () => null,
}));

vi.mock('./TaskModeToggle', () => ({
  TaskModeToggle: () => null,
}));

vi.mock('./ui/Button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock('./ui/CompactIconButton', () => ({
  CompactIconButton: ({
    children,
    label,
    onClick,
  }: {
    children: ReactNode;
    label: string;
    onClick: () => void;
  }) => (
    <button type="button" aria-label={label} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('./ui/IntentionEmojiPair', () => ({
  IntentionEmojiPair: () => null,
}));

vi.mock('./ui/KeyboardShortcut', () => ({
  KeyboardShortcut: () => null,
}));

vi.mock('./toast/ToastContext', () => ({
  showToastFromStore: (...args: unknown[]) => mocks.showToastFromStore(...args),
}));

import { MinimizedTaskView } from './MinimizedTaskView';

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isMobile = false;
  mocks.tasks = [1, 2, 3, 4].map(index => task(`task-${index}`, index));
});

describe('MinimizedTaskView updated-task reveal', () => {
  it('keeps one Add task entry point and exposes a non-interactive empty state', () => {
    mocks.tasks = [];

    render(<MinimizedTaskView visibleRowLimit={3} />);

    expect(screen.getAllByRole('button', { name: 'Add task' })).toHaveLength(1);
    expect(screen.getByText('No tasks')).toBeInTheDocument();
  });

  it('returns to the mini view through the visible quick-create cancel control', () => {
    render(<MinimizedTaskView compact visibleRowLimit={3} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(
      screen.getByRole('button', { name: 'Cancel quick create' })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel quick create' })
    );

    expect(
      screen.queryByRole('button', { name: 'Cancel quick create' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add task' })
    ).toBeInTheDocument();
  });

  it.each([true, false])(
    'moves to the updated Task page in the %s timer surface',
    async compact => {
      render(<MinimizedTaskView compact={compact} visibleRowLimit={3} />);

      fireEvent.click(
        screen.getAllByRole('button', { name: 'Update task' })[0]
      );
      await waitFor(() =>
        expect(mocks.showToastFromStore).toHaveBeenCalledOnce()
      );

      const action = mocks.showToastFromStore.mock.calls[0]?.[3] as {
        onClick: () => void;
      };
      action.onClick();

      await waitFor(() => {
        expect(
          screen
            .getAllByTestId('minimized-task-row')
            .some(row => row.dataset.taskId === 'task-4')
        ).toBe(true);
      });
      expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    }
  );

  it('scrolls to the updated Task in the expanded mobile surface', async () => {
    mocks.isMobile = true;
    render(<MinimizedTaskView visibleRowLimit={3} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Update task' })[0]);
    await waitFor(() =>
      expect(mocks.showToastFromStore).toHaveBeenCalledOnce()
    );

    const action = mocks.showToastFromStore.mock.calls[0]?.[3] as {
      onClick: () => void;
    };
    action.onClick();

    await waitFor(() =>
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'nearest',
      })
    );
  });
});

function task(id: string, order: number): Task {
  return {
    id,
    userId: 'user-1',
    title: id,
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
    createdAt: `2026-08-${String(24 - order).padStart(2, '0')}T10:00:00.000Z`,
    updatedAt: `2026-08-${String(24 - order).padStart(2, '0')}T10:00:00.000Z`,
  };
}
