import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../../i18n';
import { TaskQuickCreateRow } from './TaskQuickCreateRow';

const mocks = vi.hoisted(() => ({
  assistantStatus: {
    aiTaskCaptureEnabled: true,
    tasksEnabled: true,
    speechCaptureEnabled: false,
    usageBudgetCapUsd: null,
  },
  loadAssistantStatus: vi.fn(),
  createTask: vi.fn(),
  mergeTasks: vi.fn(),
  prepareTaskFromText: vi.fn(),
  submitUserMutation: vi.fn(),
  showToast: vi.fn(),
  setExpanded: vi.fn(),
  setActiveTab: vi.fn(),
  requestTaskItemReveal: vi.fn(),
}));

vi.mock('../../stores/assistantStore', () => ({
  useAssistantStore: {
    use: {
      status: () => mocks.assistantStatus,
      loadStatus: () => mocks.loadAssistantStatus,
    },
  },
}));

vi.mock('../../stores/tasksStore', () => ({
  useTasksStore: {
    use: {
      createTask: () => mocks.createTask,
      mergeTasks: () => mocks.mergeTasks,
    },
  },
}));

vi.mock('../../stores/uiStore', () => ({
  useUiStore: {
    use: {
      setExpanded: () => mocks.setExpanded,
      setActiveTab: () => mocks.setActiveTab,
      requestTaskItemReveal: () => mocks.requestTaskItemReveal,
    },
  },
}));

vi.mock('../../utils/apiClient', () => ({
  apiClient: {
    assistant: {
      prepareTaskFromText: mocks.prepareTaskFromText,
      transcribeTaskInput: vi.fn(),
    },
  },
}));

vi.mock('../../utils/userActionQueue', () => ({
  submitUserMutation: mocks.submitUserMutation,
}));

vi.mock('../../utils/blobToBase64', () => ({
  blobToBase64: vi.fn(),
}));

vi.mock('../toast/ToastContext', () => ({
  showToastFromStore: mocks.showToast,
}));

describe('TaskQuickCreateRow assistant errors', () => {
  beforeEach(() => {
    setLanguage('en', { persist: false });
    mocks.assistantStatus.aiTaskCaptureEnabled = true;
    mocks.loadAssistantStatus.mockReset().mockResolvedValue(undefined);
    mocks.createTask.mockReset().mockResolvedValue(true);
    mocks.mergeTasks.mockReset();
    mocks.prepareTaskFromText.mockReset().mockResolvedValue({
      status: 202,
      body: null,
    });
    mocks.submitUserMutation.mockReset();
    mocks.showToast.mockReset();
    mocks.setExpanded.mockReset();
    mocks.setActiveTab.mockReset();
    mocks.requestTaskItemReveal.mockReset();
  });

  it('preserves the submitted text when assistant capture is rejected', async () => {
    const feedback =
      'List items support title, due date, priority, and Vacation Coverage only';
    let rejectSubmission!: (reason?: unknown) => void;
    mocks.submitUserMutation.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectSubmission = reject;
      })
    );

    render(<TaskQuickCreateRow onOpenAdvanced={vi.fn()} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, {
      target: { value: 'Add milk to Groceries at 17:00' },
    });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() =>
      expect(mocks.submitUserMutation).toHaveBeenCalledOnce()
    );
    expect(input).toHaveAttribute('readonly');
    fireEvent.change(input, { target: { value: 'Changed while saving' } });

    rejectSubmission(new Error(feedback));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(feedback)
    );
    expect(input).not.toHaveAttribute('readonly');
    expect(input).toHaveValue('Add milk to Groceries at 17:00');
  });

  it('locks submitted text through reconciliation and blocks duplicate submit shortcuts', async () => {
    const capture = {
      tasks: [],
      listItems: [],
      usedFallback: false,
      message: 'Task created',
      costUsd: 0,
    };
    let resolvePreparation!: (value: { status: number; body: null }) => void;
    let resolveSubmission!: (value: {
      status: number;
      body: typeof capture;
    }) => void;
    mocks.prepareTaskFromText.mockReturnValue(
      new Promise(resolve => {
        resolvePreparation = resolve;
      })
    );
    mocks.submitUserMutation.mockReturnValue(
      new Promise(resolve => {
        resolveSubmission = resolve;
      })
    );
    const onCancel = vi.fn();

    render(<TaskQuickCreateRow onCancel={onCancel} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Create a focused task' } });
    const form = input.closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => expect(input).toHaveAttribute('readonly'));
    expect(input).toHaveAttribute('aria-busy', 'true');
    expect(input).toHaveClass('cursor-not-allowed');
    fireEvent.change(input, { target: { value: 'Changed while preparing' } });
    fireEvent.submit(form);
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(input, {
      key: 'n',
      code: 'KeyN',
      metaKey: true,
    });
    expect(input).toHaveValue('Create a focused task');
    expect(mocks.prepareTaskFromText).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();

    resolvePreparation({ status: 202, body: null });
    await waitFor(() =>
      expect(mocks.submitUserMutation).toHaveBeenCalledOnce()
    );
    expect(input).toHaveAttribute('readonly');

    const submission = mocks.submitUserMutation.mock.calls[0][0] as {
      reconcile?: (result: unknown) => Promise<void>;
    };
    await submission.reconcile?.(capture);
    expect(input).toHaveAttribute('readonly');

    resolveSubmission({ status: 201, body: capture });
    await waitFor(() => expect(input).not.toHaveAttribute('readonly'));
    expect(input).toHaveValue('');
  });

  it('exposes explicit batch guidance through native and touch-accessible help', () => {
    const guidance =
      'List multiple tasks or items explicitly in one prompt to create them together.';

    render(<TaskQuickCreateRow />);
    const input = screen.getByRole('textbox');
    const descriptionId = input.getAttribute('aria-describedby');

    expect(input).toHaveAttribute('title', guidance);
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)).toHaveTextContent(guidance);
    expect(input).not.toBeDisabled();
    fireEvent.touchStart(input);
    expect(input).toHaveAttribute('aria-describedby', descriptionId);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('carries the selected List through preparation and the confirmed action', async () => {
    const listId = '11111111-1111-4111-8111-111111111111';
    const capture = {
      tasks: [],
      listItems: [],
      usedFallback: false,
      message: 'List item added: Buy milk',
      costUsd: 0,
    };
    mocks.submitUserMutation.mockResolvedValue({ status: 201, body: capture });

    render(<TaskQuickCreateRow listId={listId} />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Buy milk' },
    });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);

    await waitFor(() =>
      expect(mocks.submitUserMutation).toHaveBeenCalledOnce()
    );
    expect(mocks.prepareTaskFromText).toHaveBeenCalledWith({
      body: expect.objectContaining({
        text: 'Buy milk',
        listId,
      }),
    });
    expect(mocks.submitUserMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'assistant',
        payload: {
          operation: 'commitPreparedTaskFromText',
          payload: {
            preparationId: expect.any(String),
            listId,
          },
        },
      })
    );
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('shows the List item title and a View action after Assistant capture', async () => {
    const listItem = {
      id: 'item-1',
      listId: 'list-1',
      title: 'Buy milk',
    };
    mocks.submitUserMutation.mockResolvedValue({
      status: 201,
      body: {
        tasks: [],
        listItems: [listItem],
        usedFallback: false,
        message: 'List item added: Buy milk',
        costUsd: 0,
      },
    });

    render(<TaskQuickCreateRow listId="list-1" />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Buy milk' },
    });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledOnce());
    expect(mocks.showToast).toHaveBeenCalledWith(
      'List item added: Buy milk',
      'success',
      5000,
      expect.objectContaining({ label: 'View' })
    );

    const viewAction = mocks.showToast.mock.calls[0][3] as {
      onClick: () => void;
    };
    viewAction.onClick();
    expect(mocks.setExpanded).toHaveBeenCalledWith(true);
    expect(mocks.setActiveTab).toHaveBeenCalledWith('tasks');
    expect(mocks.requestTaskItemReveal).toHaveBeenCalledWith({
      kind: 'listItem',
      id: 'item-1',
      listId: 'list-1',
    });
  });

  it('does not enqueue Assistant work after cancellation invalidates preparation', async () => {
    let resolvePreparation!: (value: { status: number; body: null }) => void;
    mocks.prepareTaskFromText.mockReturnValue(
      new Promise(resolve => {
        resolvePreparation = resolve;
      })
    );
    const onCancel = vi.fn();

    render(<TaskQuickCreateRow listId="list-1" onCancel={onCancel} />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Buy milk' },
    });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    resolvePreparation({ status: 202, body: null });

    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(mocks.submitUserMutation).not.toHaveBeenCalled();
  });

  it('ignores a settled Assistant submission after cancellation', async () => {
    let resolveSubmission!: (value: {
      status: number;
      body: {
        tasks: never[];
        listItems: never[];
        usedFallback: boolean;
        message: string;
        costUsd: number;
      };
    }) => void;
    mocks.submitUserMutation.mockReturnValue(
      new Promise(resolve => {
        resolveSubmission = resolve;
      })
    );
    const onCancel = vi.fn();
    const onCreated = vi.fn();

    render(
      <TaskQuickCreateRow
        listId="list-1"
        onCancel={onCancel}
        onCreated={onCreated}
      />
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Buy milk' },
    });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    await waitFor(() =>
      expect(mocks.submitUserMutation).toHaveBeenCalledOnce()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    resolveSubmission({
      status: 201,
      body: {
        tasks: [],
        listItems: [],
        usedFallback: false,
        message: 'List item added: Buy milk',
        costUsd: 0,
      },
    });

    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(onCreated).not.toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(mocks.mergeTasks).not.toHaveBeenCalled();
  });

  it('ignores a rejected Assistant submission after cancellation', async () => {
    let rejectSubmission!: (reason?: unknown) => void;
    mocks.submitUserMutation.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectSubmission = reject;
      })
    );
    const onCancel = vi.fn();

    render(<TaskQuickCreateRow listId="list-1" onCancel={onCancel} />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Buy milk' },
    });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    await waitFor(() =>
      expect(mocks.submitUserMutation).toHaveBeenCalledOnce()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    rejectSubmission(new Error('late Assistant failure'));

    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('creates one List item through the confirmed List action when Assistant is off', async () => {
    mocks.assistantStatus = {
      ...mocks.assistantStatus,
      aiTaskCaptureEnabled: false,
    };

    render(<TaskQuickCreateRow listId="list-1" />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Buy milk' },
    });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);

    await waitFor(() =>
      expect(mocks.submitUserMutation).toHaveBeenCalledOnce()
    );
    expect(mocks.submitUserMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'lists',
        payload: {
          operation: 'createItem',
          listId: 'list-1',
          title: 'Buy milk',
        },
      })
    );
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('shows a visible cancel control only when cancellation is provided', () => {
    const onCancel = vi.fn();

    const { rerender } = render(
      <TaskQuickCreateRow onOpenAdvanced={vi.fn()} onCancel={onCancel} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();

    rerender(<TaskQuickCreateRow onOpenAdvanced={vi.fn()} />);
    expect(
      screen.queryByRole('button', { name: 'Cancel' })
    ).not.toBeInTheDocument();
  });

  it('uses the create shortcut again to cancel an open quick-create draft', () => {
    const onCancel = vi.fn();
    render(<TaskQuickCreateRow listId="list-1" onCancel={onCancel} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Milk' } });
    fireEvent.keyDown(input, { code: 'KeyN', key: 'n', metaKey: true });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(input).toHaveValue('');
  });

  it('keeps direct task creation submission available without assistant capture', async () => {
    mocks.assistantStatus = {
      ...mocks.assistantStatus,
      aiTaskCaptureEnabled: false,
    };
    const onCreated = vi.fn();

    render(
      <TaskQuickCreateRow onOpenAdvanced={vi.fn()} onCreated={onCreated} />
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Add milk' },
    });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);

    await waitFor(() =>
      expect(mocks.createTask).toHaveBeenCalledWith({ title: 'Add milk' })
    );
    expect(onCreated).toHaveBeenCalledOnce();
  });
});
