import type { List, ListItem, Task } from '@pomi/shared';
import { describe, expect, it } from 'vitest';
import {
  mixTaskAndListItems,
  sortMixedTaskItems,
  type MixedTaskItem,
} from './mixedTaskItems';

const list = {
  id: 'list-1',
  title: 'Launch',
  emoji: '🚀',
} as List;

function task(overrides: Partial<Task>): Task {
  return {
    id: 'task-1',
    title: 'Task',
    dueDate: null,
    dueTime: null,
    priority: 'normal',
    pinnedAt: null,
    createdAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  } as Task;
}

function listItem(overrides: Partial<ListItem>): ListItem {
  return {
    id: 'item-1',
    listId: list.id,
    title: 'List item',
    dueDate: null,
    priority: 'normal',
    createdAt: '2026-07-01T09:00:00.000Z',
    ...overrides,
  } as ListItem;
}

function ids(entries: MixedTaskItem[]) {
  return entries.map(entry =>
    entry.kind === 'task' ? entry.task.id : entry.item.id
  );
}

describe('mixed Task and List item ordering', () => {
  it('keeps Pinned Tasks first and applies the shared due and priority order', () => {
    const entries: MixedTaskItem[] = [
      {
        kind: 'listItem',
        item: listItem({ id: 'urgent-item', priority: 'urgent' }),
        list,
      },
      {
        kind: 'task',
        task: task({ id: 'pinned-task', pinnedAt: '2026-07-02T10:00:00Z' }),
      },
      {
        kind: 'task',
        task: task({ id: 'low-task', priority: 'low' }),
      },
    ];

    expect(ids(sortMixedTaskItems(entries, 'default'))).toEqual([
      'pinned-task',
      'urgent-item',
      'low-task',
    ]);
  });

  it('applies creation ordering across both item kinds', () => {
    const entries: MixedTaskItem[] = [
      { kind: 'task', task: task({ id: 'older-task' }) },
      {
        kind: 'listItem',
        item: listItem({
          id: 'newer-item',
          createdAt: '2026-07-03T09:00:00.000Z',
        }),
        list,
      },
    ];

    expect(ids(sortMixedTaskItems(entries, 'created-desc'))).toEqual([
      'newer-item',
      'older-task',
    ]);
  });

  it('preserves an existing manual Task order when no List items are mixed in', () => {
    const manuallyOrderedTasks = [
      task({ id: 'newer-task', createdAt: '2026-07-03T09:00:00.000Z' }),
      task({ id: 'older-task', createdAt: '2026-07-01T09:00:00.000Z' }),
    ];

    expect(
      ids(mixTaskAndListItems(manuallyOrderedTasks, [], 'default'))
    ).toEqual(['newer-task', 'older-task']);
  });
});
