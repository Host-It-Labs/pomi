import type { Intention, List, Preferences, Task } from '@pomi/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VACATION_ITEM_COVERAGE_DESCRIPTION } from '../../constants/vacation';
import { TaskFormModal } from './TaskFormModal';

const enabledIntention = {
  id: 'enabled',
  slug: 'enabled',
  title: 'Enabled',
  emoji: '✅',
  type: 'work',
  parentIntentionId: null,
  isArchived: false,
  allowsTasks: true,
  vacationDefault: false,
} as Intention;
const disabledIntention = {
  ...enabledIntention,
  id: 'disabled',
  slug: 'disabled',
  title: 'Disabled',
  allowsTasks: false,
} as Intention;
const parentWithChild = {
  ...enabledIntention,
  id: 'parent-with-child',
  slug: 'parent-with-child',
  title: 'Parent with child',
} as Intention;
const childIntention = {
  ...enabledIntention,
  id: 'child-intention',
  slug: 'child-intention',
  title: 'Child intention',
  parentIntentionId: parentWithChild.id,
  parentIntention: parentWithChild,
} as Intention;
const list = {
  id: 'list-1',
  title: 'Launch',
  emoji: '🚀',
  isArchived: false,
  vacationDefault: true,
} as List;
const followUpTemplate = {
  id: 'follow-up-template',
  title: 'Send the follow-up',
  status: 'active',
  itemKind: 'task',
  followUpTaskId: null,
  followUpSourceTaskId: null,
} as Task;

const baseProps = {
  isOpen: true,
  intentions: [enabledIntention, disabledIntention],
  lists: [list],
  preferences: null,
  timer: null,
  taskMode: 'general' as const,
  onClose: vi.fn(),
  onCreate: vi.fn().mockResolvedValue(true),
  onUpdate: vi.fn().mockResolvedValue(true),
  onArchive: vi.fn().mockResolvedValue(true),
  onCreateListItem: vi.fn().mockResolvedValue(true),
  onConvertToListItem: vi.fn().mockResolvedValue(true),
};

describe('shared Task editor destinations', () => {
  it('keeps the editor dialog names stable for automation and accessibility', () => {
    const { rerender } = render(<TaskFormModal {...baseProps} task={null} />);
    expect(screen.getByRole('dialog', { name: 'Add task' })).toBeVisible();

    const existingTask = {
      ...followUpTemplate,
      id: 'task-1',
      title: 'Existing task',
    } as Task;
    rerender(<TaskFormModal {...baseProps} task={existingTask} />);
    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeVisible();
  });

  it('filters disabled Intention trees and switches to List-supported fields', async () => {
    render(<TaskFormModal {...baseProps} task={null} />);

    const destination = await screen.findByLabelText('Intention / List');
    expect(screen.getByRole('option', { name: /Enabled/ })).toBeVisible();
    expect(screen.queryByRole('option', { name: /Disabled/ })).toBeNull();

    fireEvent.change(destination, { target: { value: `list:${list.id}` } });
    await waitFor(() =>
      expect(screen.queryByLabelText('Task description')).toBeNull()
    );
    expect(screen.queryByLabelText('Task Timer type')).toBeNull();
    expect(screen.getByLabelText('Vacation Coverage')).toBeChecked();
    expect(screen.getByText(VACATION_ITEM_COVERAGE_DESCRIPTION)).toBeVisible();
  });

  it('does not send the inherited Default Task due date for a new List item', async () => {
    const onCreateListItem = vi.fn().mockResolvedValue(true);
    render(
      <TaskFormModal
        {...baseProps}
        task={null}
        initialTitle="Prepare launch"
        preferences={{ taskDefaultDueDateMode: 'tomorrow' } as Preferences}
        onCreateListItem={onCreateListItem}
      />
    );

    fireEvent.change(await screen.findByLabelText('Intention / List'), {
      target: { value: `list:${list.id}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(onCreateListItem).toHaveBeenCalledWith(
        list.id,
        expect.objectContaining({ dueDate: null })
      )
    );
  });

  it('sends an explicitly edited due date for a new List item', async () => {
    const onCreateListItem = vi.fn().mockResolvedValue(true);
    render(
      <TaskFormModal
        {...baseProps}
        task={null}
        initialTitle="Prepare launch"
        preferences={{ taskDefaultDueDateMode: 'tomorrow' } as Preferences}
        onCreateListItem={onCreateListItem}
      />
    );

    fireEvent.change(await screen.findByLabelText('Intention / List'), {
      target: { value: `list:${list.id}` },
    });
    fireEvent.change(screen.getByLabelText('Task due date'), {
      target: { value: '2099-01-02' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(onCreateListItem).toHaveBeenCalledWith(
        list.id,
        expect.objectContaining({ dueDate: '2099-01-02' })
      )
    );
  });

  it('does not preselect a disabled Intention from the creation context', async () => {
    render(
      <TaskFormModal
        {...baseProps}
        task={null}
        defaultIntentionSelection={{
          intentionSlug: disabledIntention.slug,
          subIntentionSlug: null,
        }}
      />
    );

    expect(await screen.findByLabelText('Intention / List')).toHaveValue(
      'general'
    );
  });

  it('creates a parent-owned follow-up definition with its delay', async () => {
    const onCreate = vi.fn().mockResolvedValue(true);
    render(
      <TaskFormModal
        {...baseProps}
        task={null}
        initialTitle="Review the source"
        onCreate={onCreate}
      />
    );

    fireEvent.click(await screen.findByLabelText('Create a follow-up'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Create a follow-up help' })
    );
    expect(screen.getByRole('note')).toHaveTextContent(
      'For recurring Tasks, a new follow-up is created after every completion.'
    );
    fireEvent.change(screen.getByLabelText('Follow-up title'), {
      target: { value: 'Send the follow-up' },
    });
    expect(screen.getByLabelText('Follow-up delay (days)')).toHaveValue(0);
    fireEvent.change(screen.getByLabelText('Follow-up delay (days)'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          followUpTaskId: null,
          followUpDefinition: {
            title: 'Send the follow-up',
            description: null,
            dueTime: null,
            priority: 'normal',
            timerType: 'work',
            intentionSlug: null,
            subIntentionSlug: null,
            vacationEligible: false,
          },
          followUpDelayDays: 3,
        })
      )
    );
  });

  it('requires a child when a follow-up parent has active children', async () => {
    render(
      <TaskFormModal
        {...baseProps}
        intentions={[parentWithChild, childIntention]}
        task={null}
      />
    );

    fireEvent.click(await screen.findByLabelText('Create a follow-up'));
    fireEvent.change(screen.getByLabelText('Follow-up Intention'), {
      target: { value: parentWithChild.slug },
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Follow-up Sub-intention')).toHaveValue(
        childIntention.slug
      )
    );
    expect(screen.queryByRole('option', { name: 'None' })).toBeNull();
  });

  it('preserves an existing Task due date when moving it to a List', async () => {
    const onConvertToListItem = vi.fn().mockResolvedValue(true);
    const existingTask = {
      id: 'task-1',
      title: 'Ship release',
      description: null,
      dueDate: '2026-08-01',
      dueTime: '09:30',
      priority: 'normal',
      timerType: 'work',
      intentionSlug: null,
      subIntentionSlug: null,
      recurrenceRule: null,
      recurrenceInterval: null,
      recurrenceAnchorMode: 'planned',
      vacationEligible: false,
    } as Task;
    render(
      <TaskFormModal
        {...baseProps}
        task={existingTask}
        onConvertToListItem={onConvertToListItem}
      />
    );

    fireEvent.change(await screen.findByLabelText('Intention / List'), {
      target: { value: `list:${list.id}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to List' }));

    await waitFor(() =>
      expect(onConvertToListItem).toHaveBeenCalledWith(
        existingTask.id,
        list.id,
        expect.objectContaining({ dueDate: existingTask.dueDate })
      )
    );
  });

  it('persists a direct Vacation Coverage override on an existing Task', async () => {
    const onUpdate = vi.fn().mockResolvedValue(true);
    const task = {
      id: 'task-1',
      title: 'Ship release',
      description: null,
      dueDate: null,
      dueTime: null,
      priority: 'normal',
      timerType: 'work',
      intentionSlug: null,
      subIntentionSlug: null,
      recurrenceRule: null,
      recurrenceInterval: null,
      recurrenceAnchorMode: 'planned',
      vacationEligible: false,
    } as Task;
    render(<TaskFormModal {...baseProps} task={task} onUpdate={onUpdate} />);

    const vacation = await screen.findByLabelText('Vacation Coverage');
    fireEvent.click(vacation);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: task.id, vacationEligible: true })
      )
    );
  });

  it('creates and edits a Task custom duration in whole minutes', async () => {
    const onCreate = vi.fn().mockResolvedValue(true);
    const { unmount } = render(
      <TaskFormModal
        {...baseProps}
        task={null}
        initialTitle="Focus block"
        onCreate={onCreate}
      />
    );

    const duration = await screen.findByLabelText('Custom duration');
    fireEvent.change(duration, { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ customDuration: 1_800_000 })
      )
    );
    unmount();

    const existingTask = {
      id: 'task-duration',
      title: 'Focus block',
      description: null,
      dueDate: null,
      dueTime: null,
      priority: 'normal',
      timerType: 'work',
      customDuration: 1_800_000,
      intentionSlug: null,
      subIntentionSlug: null,
      recurrenceRule: null,
      recurrenceInterval: null,
      recurrenceAnchorMode: 'planned',
      vacationEligible: false,
    } as Task;
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(
      <TaskFormModal {...baseProps} task={existingTask} onUpdate={onUpdate} />
    );

    const editedDuration = await screen.findByLabelText('Custom duration');
    expect(editedDuration).toHaveValue(30);
    fireEvent.change(editedDuration, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: existingTask.id,
          customDuration: null,
        })
      )
    );
  });

  it('rejects a non-positive Task custom duration before saving', async () => {
    const onCreate = vi.fn().mockResolvedValue(true);
    render(
      <TaskFormModal
        {...baseProps}
        task={null}
        initialTitle="Invalid duration"
        onCreate={onCreate}
      />
    );

    fireEvent.change(await screen.findByLabelText('Custom duration'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(onCreate).not.toHaveBeenCalled();
  });
});
