import type { List, Preferences, Task } from '@pomi/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskFormModal } from './TaskFormModal';
import {
  buildSimpleTaskRecurrence,
  parseSimpleTaskRecurrence,
  TaskRecurrenceFields,
} from './TaskRecurrenceFields';

const noDefaultDueDate = {
  taskDefaultDueDateMode: 'off',
} as Preferences;

function task(overrides: Partial<Task>): Task {
  return {
    id: 'task-1',
    userId: 'user-1',
    title: 'Plan release',
    description: 'Ship safely',
    sourceTranscript: null,
    creationSource: 'manual',
    importSource: null,
    importSourceTaskId: null,
    dueDate: '2026-08-01',
    dueTime: '09:30',
    priority: 'high',
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

function renderTaskForm(
  overrides: Partial<React.ComponentProps<typeof TaskFormModal>>
) {
  const props: React.ComponentProps<typeof TaskFormModal> = {
    isOpen: true,
    task: null,
    intentions: [],
    preferences: noDefaultDueDate,
    timer: null,
    taskMode: 'general',
    onClose: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(true),
    onUpdate: vi.fn().mockResolvedValue(true),
    onArchive: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return { ...render(<TaskFormModal {...props} />), props };
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('Task recurrence model', () => {
  it('keeps reminder behavior in Settings instead of the Task editor', () => {
    renderTaskForm({});
    expect(screen.queryByLabelText('Task reminder')).not.toBeInTheDocument();
    expect(screen.queryByText('Due-time reminder')).not.toBeInTheDocument();
  });

  it('round-trips integer and decimal cadence without inventing RRULE fields', () => {
    expect(buildSimpleTaskRecurrence('1', 'DAILY')).toEqual({
      rule: 'FREQ=DAILY',
      interval: null,
    });
    expect(buildSimpleTaskRecurrence('2', 'WEEKLY')).toEqual({
      rule: 'FREQ=WEEKLY;INTERVAL=2',
      interval: null,
    });
    expect(buildSimpleTaskRecurrence('1.5', 'MONTHLY')).toEqual({
      rule: 'FREQ=MONTHLY',
      interval: 1.5,
    });
    expect(parseSimpleTaskRecurrence('FREQ=MONTHLY', 1.5)).toEqual({
      interval: '1.5',
      unit: 'MONTHLY',
    });
    expect(parseSimpleTaskRecurrence('FREQ=WEEKLY;BYDAY=MO')).toBeNull();
    expect(buildSimpleTaskRecurrence('0', 'DAILY')).toEqual({
      rule: null,
      interval: null,
    });
  });

  it('emits controlled cadence and anchor changes', async () => {
    const user = userEvent.setup();
    const onIntervalChange = vi.fn();
    const onUnitChange = vi.fn();
    const onAnchorModeChange = vi.fn();
    render(
      <TaskRecurrenceFields
        interval="2"
        unit="WEEKLY"
        anchorMode="planned"
        onIntervalChange={onIntervalChange}
        onUnitChange={onUnitChange}
        onAnchorModeChange={onAnchorModeChange}
        intervalAriaLabel="Cadence"
        unitAriaLabel="Unit"
        compact
      />
    );

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Cadence' }), {
      target: { value: '3' },
    });
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Unit' }),
      'MONTHLY'
    );
    await user.click(screen.getByRole('button', { name: 'completion' }));

    expect(onIntervalChange).toHaveBeenLastCalledWith('3');
    expect(onUnitChange).toHaveBeenCalledWith('MONTHLY');
    expect(onAnchorModeChange).toHaveBeenCalledWith('completion');
  });
});

describe('shared Task editor behavior', () => {
  it('keeps a typed draft when Intentions finish loading', async () => {
    const user = userEvent.setup();
    const { rerender, props } = renderTaskForm({});
    const title = screen.getByRole('textbox', { name: 'Task title' });
    await user.type(title, 'Draft survives');

    rerender(
      <TaskFormModal
        {...props}
        intentions={[
          {
            id: 'intention-1',
            userId: 'user-1',
            title: 'Focus',
            slug: 'focus',
            emoji: '🎯',
            type: 'work',
            isArchived: false,
            parentIntentionId: null,
          } as never,
        ]}
      />
    );

    expect(title).toHaveValue('Draft survives');
  });

  it('requires and focuses a due date before creating a recurring Task', async () => {
    const user = userEvent.setup();
    const { props } = renderTaskForm({ initialTitle: 'Recurring review' });

    await user.type(
      screen.getByRole('spinbutton', { name: 'Task recurrence interval' }),
      '1.5'
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Task recurrence unit' }),
      'WEEKLY'
    );
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(
      await screen.findByText('Due date is required for recurring tasks.')
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('Task due date')).toHaveFocus();
    });
    expect(props.onCreate).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Task due date'), '2026-08-03');
    await user.click(screen.getByRole('button', { name: 'completion' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(props.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Recurring review',
        dueDate: '2026-08-03',
        recurrenceRule: 'FREQ=WEEKLY',
        recurrenceInterval: 1.5,
        recurrenceAnchorMode: 'completion',
      })
    );
  });

  it('preserves an existing complex RRULE when unrelated fields change', async () => {
    const user = userEvent.setup();
    const existing = task({
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=8',
      recurrenceAnchorMode: 'completion',
    });
    const { props } = renderTaskForm({ task: existing });

    await user.clear(screen.getByRole('textbox', { name: 'Task description' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Task description' }),
      'Updated notes'
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: existing.id,
        description: 'Updated notes',
        recurrenceRule: existing.recurrenceRule,
        recurrenceInterval: existing.recurrenceInterval,
        recurrenceAnchorMode: 'completion',
      })
    );
  });
});

it('opens a List draft with inherited coverage as a clean form', async () => {
  const { props } = renderTaskForm({
    initialListId: 'list-1',
    lists: [
      { id: 'list-1', title: 'Groceries', vacationDefault: true } as List,
    ],
  });
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole('dialog', { name: /discard/i })
  ).not.toBeInTheDocument();
});
