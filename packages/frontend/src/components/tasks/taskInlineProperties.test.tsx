import type { Intention, List, ListItem, Task } from '@pomi/shared';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TaskInlineProperties } from './TaskInlineProperties';

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});

afterEach(cleanup);

function task(overrides: Partial<Task>): Task {
  return {
    id: 'task-release',
    userId: 'user-1',
    title: 'Ship release notes',
    description: null,
    sourceTranscript: null,
    creationSource: 'manual',
    importSource: null,
    importSourceTaskId: null,
    dueDate: '2026-08-03',
    dueTime: '09:30',
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
    createdAt: '2026-07-26T08:00:00.000Z',
    updatedAt: '2026-07-26T08:00:00.000Z',
    ...overrides,
    itemKind: 'task',
    vacationEligible: overrides.vacationEligible ?? false,
  };
}

const intentions: Intention[] = [
  {
    id: 'parent',
    userId: 'user-1',
    title: 'Release',
    slug: 'release',
    emoji: '🚀',
    type: 'work',
    isArchived: false,
    parentIntentionId: null,
    hasCustomDuration: false,
    keepScreenAwake: false,
    isHabit: false,
    isFavorite: false,
    allowsTasks: true,
    usageCount: 0,
    createdAt: '2026-07-26T08:00:00.000Z',
    updatedAt: '2026-07-26T08:00:00.000Z',
  },
  {
    id: 'child',
    userId: 'user-1',
    title: 'Documentation',
    slug: 'documentation',
    emoji: '📝',
    type: 'work',
    isArchived: false,
    parentIntentionId: 'parent',
    hasCustomDuration: false,
    keepScreenAwake: false,
    isHabit: false,
    isFavorite: false,
    allowsTasks: true,
    usageCount: 0,
    createdAt: '2026-07-26T08:00:00.000Z',
    updatedAt: '2026-07-26T08:00:00.000Z',
  },
];

const lists: List[] = [
  {
    id: 'list-groceries',
    userId: 'user-1',
    title: 'Groceries',
    emoji: '🛒',
    description: null,
    vacationDefault: false,
    isArchived: false,
    isFavorite: false,
    sourceIntentionId: null,
    createdAt: '2026-07-26T08:00:00.000Z',
    updatedAt: '2026-07-26T08:00:00.000Z',
  },
];

function renderProperties(
  currentTask = task({}),
  onUpdate = vi.fn().mockResolvedValue(true),
  onConvertToListItem = vi.fn().mockResolvedValue(true)
) {
  render(
    <TaskInlineProperties
      task={currentTask}
      intentions={intentions}
      lists={lists}
      onUpdate={onUpdate}
      onConvertToListItem={onConvertToListItem}
      onOpenEditor={vi.fn()}
      showIntention
      compact={false}
      isOverdue={false}
    />
  );
  return { onUpdate, onConvertToListItem };
}

describe('inline Task properties', () => {
  it('makes linked intention selection an explicit confirmed Task update', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderProperties();

    await user.click(
      screen.getByRole('button', {
        name: 'Intention / List: Ship release notes',
      })
    );
    await user.click(screen.getByRole('option', { name: /Release$/ }));
    await user.click(screen.getByRole('button', { name: /documentation/i }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onUpdate).toHaveBeenCalledWith({
      id: 'task-release',
      intentionSlug: 'release',
      subIntentionSlug: 'documentation',
    });
  });

  it('moves a Task to a List from the same custom assignment picker', async () => {
    const user = userEvent.setup();
    const { onConvertToListItem } = renderProperties();

    await user.click(
      screen.getByRole('button', {
        name: 'Intention / List: Ship release notes',
      })
    );
    expect(document.body).toHaveStyle({ overflow: 'hidden' });
    await user.click(screen.getByRole('option', { name: /Groceries/ }));
    expect(document.body.style.overflow).toBe('');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onConvertToListItem).toHaveBeenCalledWith(
      'task-release',
      'list-groceries',
      {
        title: 'Ship release notes',
        dueDate: '2026-08-03',
        priority: 'normal',
        vacationEligible: false,
      }
    );
  });

  it('uses the same controls to move a List item back to an Intention', async () => {
    const user = userEvent.setup();
    const onConvertListItemToTask = vi.fn().mockResolvedValue(true);
    const listItem: ListItem = {
      id: 'item-tomatoes',
      userId: 'user-1',
      listId: lists[0].id,
      title: 'Tomatoes',
      dueDate: null,
      priority: 'normal',
      status: 'active',
      manualOrder: null,
      manualOrderOverride: false,
      itemKind: 'listItem',
      vacationEligible: false,
      createdAt: '2026-07-26T08:00:00.000Z',
      updatedAt: '2026-07-26T08:00:00.000Z',
    };

    render(
      <TaskInlineProperties
        task={listItem}
        intentions={intentions}
        currentList={lists[0]}
        onUpdate={vi.fn().mockResolvedValue(true)}
        onConvertListItemToTask={onConvertListItemToTask}
        onOpenEditor={vi.fn()}
        showIntention
        compact={false}
        isOverdue={false}
      />
    );

    await user.click(
      screen.getByRole('button', { name: 'Intention / List: Tomatoes' })
    );
    await user.click(screen.getByRole('option', { name: /Release$/ }));
    await user.click(screen.getByRole('button', { name: /documentation/i }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onConvertListItemToTask).toHaveBeenCalledWith(
      'item-tomatoes',
      'release',
      'documentation'
    );
  });

  it('clears a non-recurring due date and time but protects recurrence scheduling', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderProperties();

    await user.click(
      screen.getByRole('button', {
        name: 'Change due date for Ship release notes',
      })
    );
    await user.click(screen.getByRole('button', { name: 'Remove due date' }));

    expect(onUpdate).toHaveBeenCalledWith({
      id: 'task-release',
      dueDate: null,
      dueTime: null,
    });

    renderProperties(
      task({ recurrenceRule: 'FREQ=WEEKLY', recurrenceInterval: null })
    );
    await user.click(
      screen.getAllByRole('button', {
        name: 'Change due date for Ship release notes',
      })[1]
    );
    expect(
      screen.getByRole('button', { name: 'Remove due date' })
    ).toBeDisabled();
  });

  it('saves a changed due date when the popover is dismissed outside', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderProperties();

    await user.click(
      screen.getByRole('button', {
        name: 'Change due date for Ship release notes',
      })
    );
    const input = screen.getByLabelText('Due date');
    await user.clear(input);
    await user.type(input, '2026-08-12');

    expect(screen.getByRole('button', { name: 'Apply' })).toBeVisible();
    await user.click(document.body);

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({
        id: 'task-release',
        dueDate: '2026-08-12',
      })
    );
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed outside due-date update open with its draft intact', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderProperties(
      task({}),
      vi.fn().mockResolvedValue(false)
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Change due date for Ship release notes',
      })
    );
    const input = screen.getByLabelText('Due date');
    await user.clear(input);
    await user.type(input, '2026-08-12');
    await user.click(document.body);

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate).toHaveBeenCalledWith({
      id: 'task-release',
      dueDate: '2026-08-12',
    });
    expect(screen.getByTestId('task-due-date-popover')).toBeVisible();
    expect(screen.getByLabelText('Due date')).toHaveValue('2026-08-12');
  });

  it('saves the same due-date draft through Apply', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderProperties();

    await user.click(
      screen.getByRole('button', {
        name: 'Change due date for Ship release notes',
      })
    );
    const input = screen.getByLabelText('Due date');
    await user.clear(input);
    await user.type(input, '2026-08-12');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({
        id: 'task-release',
        dueDate: '2026-08-12',
      })
    );
  });

  it('closes the native calendar after selection while keeping the popover open', async () => {
    const user = userEvent.setup();
    renderProperties();

    await user.click(
      screen.getByRole('button', {
        name: 'Change due date for Ship release notes',
      })
    );
    const input = screen.getByLabelText('Due date');
    input.focus();
    fireEvent.change(input, { target: { value: '2026-08-12' } });

    expect(input).not.toHaveFocus();
    expect(screen.getByTestId('task-due-date-popover')).toBeVisible();
  });

  it('keeps the due-date draft when Cancel closes the popover', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderProperties();

    await user.click(
      screen.getByRole('button', {
        name: 'Change due date for Ship release notes',
      })
    );
    const input = screen.getByLabelText('Due date');
    await user.clear(input);
    await user.type(input, '2026-08-12');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('keeps the due-date draft when Escape closes the popover', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderProperties();

    await user.click(
      screen.getByRole('button', {
        name: 'Change due date for Ship release notes',
      })
    );
    const input = screen.getByLabelText('Due date');
    await user.clear(input);
    await user.type(input, '2026-08-12');
    await user.keyboard('{Escape}');

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('clears a due date when an empty draft is dismissed outside', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderProperties();

    await user.click(
      screen.getByRole('button', {
        name: 'Change due date for Ship release notes',
      })
    );
    await user.clear(screen.getByLabelText('Due date'));
    await user.click(document.body);

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({
        id: 'task-release',
        dueDate: null,
        dueTime: null,
      })
    );
  });
});
