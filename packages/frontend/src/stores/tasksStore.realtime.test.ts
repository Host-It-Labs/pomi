import type { Task } from '@pomi/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { useTasksStore } from './tasksStore';

const task = (id: string, status: Task['status'] = 'active') =>
  ({
    id,
    status,
    title: id,
    dueDate: null,
    priority: 'normal',
    createdAt: '2026-09-09T00:00:00.000Z',
  }) as Task;

afterEach(() => useTasksStore.setState({ tasks: [], completingTaskIds: [] }));

describe('TasksStore realtime changes', () => {
  it('applies single-record upserts and tombstones', () => {
    useTasksStore.setState({ tasks: [task('remove')] });

    useTasksStore.getState().applyRealtimeChanges([
      {
        revision: 1,
        entityType: 'task',
        entityId: 'remove',
        operation: 'delete',
        payload: null,
      },
      {
        revision: 2,
        entityType: 'task',
        entityId: 'add',
        operation: 'upsert',
        payload: task('add'),
      },
    ]);

    expect(useTasksStore.getState().tasks.map(item => item.id)).toEqual([
      'add',
    ]);
  });

  it('keeps a locally completing Task until its mutation delay finishes', () => {
    useTasksStore.setState({
      tasks: [task('completing')],
      completingTaskIds: ['completing'],
    });

    useTasksStore.getState().applyRealtimeChanges([
      {
        revision: 1,
        entityType: 'task',
        entityId: 'completing',
        operation: 'upsert',
        payload: task('completing', 'completed'),
      },
    ]);

    expect(useTasksStore.getState().tasks.map(item => item.id)).toEqual([
      'completing',
    ]);
  });

  it('updates follow-up parent context when the parent title changes', () => {
    useTasksStore.setState({
      tasks: [
        task('parent'),
        {
          ...task('follow-up'),
          followUpSourceTaskId: 'parent',
          followUpParent: { id: 'parent', title: 'Previous title' },
        },
      ],
    });

    useTasksStore.getState().applyRealtimeChanges([
      {
        revision: 1,
        entityType: 'task',
        entityId: 'parent',
        operation: 'upsert',
        payload: { ...task('parent'), title: 'Updated title' },
      },
    ]);

    expect(
      useTasksStore.getState().tasks.find(item => item.id === 'follow-up')
        ?.followUpParent
    ).toEqual({ id: 'parent', title: 'Updated title' });
  });
});
