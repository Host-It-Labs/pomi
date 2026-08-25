import type { Intention, Task } from '@pomi/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  buildTaskBulkUpdate,
  buildTaskBulkAssignmentOptions,
  runTaskBulkUpdates,
  TaskBulkActionModal,
} from './TaskBulkActionModal';

const assignment = {
  value: 'planning::weekly',
  label: 'Planning / Weekly',
  intentionSlug: 'planning',
  subIntentionSlug: 'weekly',
};

describe('bulk Task updates', () => {
  it('builds confirmed completion, archive, and priority updates', () => {
    expect(
      buildTaskBulkUpdate({
        taskId: 'one',
        action: 'complete',
        priority: 'normal',
        assignment,
      })
    ).toEqual({ id: 'one', status: 'completed' });
    expect(
      buildTaskBulkUpdate({
        taskId: 'two',
        action: 'archive',
        priority: 'normal',
        assignment,
      })
    ).toEqual({ id: 'two', status: 'archived' });
    expect(
      buildTaskBulkUpdate({
        taskId: 'three',
        action: 'priority',
        priority: 'urgent',
        assignment,
      })
    ).toEqual({ id: 'three', priority: 'urgent' });
  });

  it('builds a compatible Intention assignment with its Sub-intention', () => {
    expect(
      buildTaskBulkUpdate({
        taskId: 'one',
        action: 'intention',
        priority: 'normal',
        assignment,
      })
    ).toEqual({
      id: 'one',
      intentionSlug: 'planning',
      subIntentionSlug: 'weekly',
    });
  });

  it('starts every update before awaiting results and returns unchanged Tasks for retry', async () => {
    const calls: string[] = [];
    const pending = runTaskBulkUpdates(
      [
        { id: 'one', priority: 'urgent' },
        { id: 'two', priority: 'urgent' },
        { id: 'three', priority: 'urgent' },
      ],
      async update => {
        calls.push(update.id);
        if (update.id === 'two') return false;
        if (update.id === 'three') throw new Error('offline');
        return true;
      }
    );

    expect(calls).toEqual(['one', 'two', 'three']);
    const failedTaskIds = await pending;
    expect(failedTaskIds).toEqual(['two', 'three']);
  });

  it('uses all leaf Intentions for the selected Timer type', () => {
    const intentions = [
      {
        id: 'work-parent',
        slug: 'planning',
        title: 'Planning',
        emoji: '🗺️',
        type: 'work',
        isArchived: false,
        parentIntentionId: null,
        allowsTasks: true,
      },
      {
        id: 'work-child',
        slug: 'weekly',
        title: 'Weekly',
        emoji: '📅',
        type: 'work',
        isArchived: false,
        parentIntentionId: 'work-parent',
        allowsTasks: true,
      },
      {
        id: 'break-leaf',
        slug: 'walk',
        title: 'Walk',
        emoji: '🚶',
        type: 'break',
        isArchived: false,
        parentIntentionId: null,
        allowsTasks: true,
      },
    ] as Intention[];

    expect(
      buildTaskBulkAssignmentOptions(intentions, 'work', 'No Intention')
    ).toEqual([
      {
        value: 'none',
        label: 'No Intention',
        intentionSlug: null,
        subIntentionSlug: null,
      },
      {
        value: 'planning::weekly',
        label: '🗺️ Planning / 📅 Weekly',
        intentionSlug: 'planning',
        subIntentionSlug: 'weekly',
      },
    ]);
    expect(
      buildTaskBulkAssignmentOptions(intentions, 'break', 'No Intention')
    ).toEqual([
      expect.objectContaining({ value: 'none' }),
      expect.objectContaining({ value: 'walk::', intentionSlug: 'walk' }),
    ]);
  });

  it('excludes task-disabled Parent Intentions and their child trees', () => {
    const intentions = [
      {
        id: 'disabled-parent',
        slug: 'private',
        title: 'Private',
        emoji: '🔒',
        type: 'work',
        isArchived: false,
        parentIntentionId: null,
        allowsTasks: false,
      },
      {
        id: 'disabled-child',
        slug: 'private-child',
        title: 'Private child',
        emoji: '🔐',
        type: 'work',
        isArchived: false,
        parentIntentionId: 'disabled-parent',
        allowsTasks: true,
      },
      {
        id: 'enabled-leaf',
        slug: 'planning',
        title: 'Planning',
        emoji: '🗺️',
        type: 'work',
        isArchived: false,
        parentIntentionId: null,
        allowsTasks: true,
      },
    ] as Intention[];

    expect(
      buildTaskBulkAssignmentOptions(intentions, 'work', 'No Intention')
    ).toEqual([
      expect.objectContaining({ value: 'none' }),
      expect.objectContaining({
        value: 'planning::',
        intentionSlug: 'planning',
      }),
    ]);
  });

  it('confirms one explicit update for every selected Task', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskBulkActionModal
        isOpen
        selectedTasks={[
          { id: 'one', title: 'One' } as Task,
          { id: 'two', title: 'Two' } as Task,
        ]}
        assignmentOptions={[
          {
            value: 'none',
            label: 'No Intention',
            intentionSlug: null,
            subIntentionSlug: null,
          },
        ]}
        assignmentUnavailableReason={null}
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    await user.selectOptions(screen.getByLabelText('Update'), 'priority');
    await user.selectOptions(screen.getByLabelText('Task priority'), 'urgent');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onConfirm).toHaveBeenCalledWith([
      { id: 'one', priority: 'urgent' },
      { id: 'two', priority: 'urgent' },
    ]);
  });

  it('allows mixed Timer types to clear their Intentions', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskBulkActionModal
        isOpen
        selectedTasks={[
          { id: 'one', title: 'One' } as Task,
          { id: 'two', title: 'Two' } as Task,
        ]}
        assignmentOptions={[
          {
            value: 'none',
            label: 'No Intention',
            intentionSlug: null,
            subIntentionSlug: null,
          },
        ]}
        assignmentUnavailableReason="Choose Tasks with the same Timer type to assign an Intention."
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    await user.selectOptions(screen.getByLabelText('Update'), 'intention');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onConfirm).toHaveBeenCalledWith([
      { id: 'one', intentionSlug: null, subIntentionSlug: null },
      { id: 'two', intentionSlug: null, subIntentionSlug: null },
    ]);
  });
});
