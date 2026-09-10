import { describe, expect, it, vi } from 'vitest';
import { TaskListChangeFeedService } from '../../src/realtime/task-list-change-feed.service';

describe('TaskListChangeFeedService', () => {
  it('returns one contiguous user-scoped revision envelope', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ revision: '4' }])
      .mockResolvedValueOnce([{ revision: '6' }])
      .mockResolvedValueOnce([
        {
          revision: '5',
          entityType: 'task',
          entityId: 'task-1',
          operation: 'upsert',
          payload: {
            id: 'task-1',
            status: 'active',
            itemKind: 'followUp',
            followUpSourceTaskId: '00000000-0000-4000-8000-000000000001',
            nextReminderAt: '2026-09-09T01:00:00.000Z',
          },
        },
        {
          revision: '6',
          entityType: 'listItem',
          entityId: 'list-1',
          operation: 'upsert',
          payload: {
            id: 'list-1',
            userId: 'user-1',
            listId: '00000000-0000-4000-8000-000000000002',
            title: 'Public item',
            dueDate: null,
            priority: 'normal',
            status: 'active',
            vacationEligible: false,
            description: 'internal',
            createdAt: '2026-09-09T00:00:00.000Z',
            updatedAt: '2026-09-09T01:00:00.000Z',
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: '00000000-0000-4000-8000-000000000001',
          title: 'Parent task',
        },
      ]);
    const service = new TaskListChangeFeedService({ query } as never);

    await expect(service.prime('user-1')).resolves.toBe(4);
    const result = await service.readNextEnvelope('user-1');
    expect(result).toMatchObject({
      fromRevision: 4,
      revision: 6,
      resetRequired: false,
      changes: [
        {
          revision: 5,
          entityId: 'task-1',
          payload: {
            itemKind: 'task',
            followUpParent: {
              id: '00000000-0000-4000-8000-000000000001',
              title: 'Parent task',
            },
          },
        },
        {
          revision: 6,
          entityId: 'list-1',
          payload: {
            itemKind: 'listItem',
            title: 'Public item',
          },
        },
      ],
    });
    expect(result.changes[0]?.payload).not.toHaveProperty('nextReminderAt');
    expect(result.changes[1]?.payload).not.toHaveProperty('description');
  });

  it('requires a snapshot when retained revisions are not contiguous', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ revision: '10' }])
      .mockResolvedValueOnce([{ revision: '12' }])
      .mockResolvedValueOnce([
        {
          revision: '12',
          entityType: 'task',
          entityId: 'task-2',
          operation: 'upsert',
          payload: { id: 'task-2' },
        },
      ]);
    const service = new TaskListChangeFeedService({ query } as never);

    await service.prime('user-1');
    await expect(service.readNextEnvelope('user-1')).resolves.toEqual({
      fromRevision: 10,
      revision: 12,
      resetRequired: true,
      changes: [],
    });
  });

  it('reads one repeatable Task and List snapshot with its revision', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'task-1',
          itemKind: 'followUp',
          dueDate: new Date(2026, 8, 11),
          createdAt: new Date('2026-09-09T00:00:00.000Z'),
          updatedAt: new Date('2026-09-09T01:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'list-1',
          createdAt: new Date('2026-09-09T00:00:00.000Z'),
          updatedAt: new Date('2026-09-09T01:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'item-1',
          userId: 'user-1',
          listId: 'list-1',
          title: 'Public item',
          dueDate: null,
          priority: 'normal',
          status: 'active',
          vacationEligible: false,
          description: 'internal',
          createdAt: new Date('2026-09-09T00:00:00.000Z'),
          updatedAt: new Date('2026-09-09T01:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([{ revision: '8' }]);
    const transaction = vi.fn(async (_isolation, callback) =>
      callback({ query })
    );
    const service = new TaskListChangeFeedService({ transaction } as never);

    const snapshot = await service.readSnapshot('user-1');
    expect(snapshot).toMatchObject({
      revision: 8,
      tasks: [
        {
          id: 'task-1',
          itemKind: 'task',
          followUpTaskId: null,
          dueDate: '2026-09-11',
          createdAt: '2026-09-09T00:00:00.000Z',
        },
      ],
      lists: [{ id: 'list-1', updatedAt: '2026-09-09T01:00:00.000Z' }],
      listItems: [
        {
          id: 'item-1',
          itemKind: 'listItem',
          title: 'Public item',
          createdAt: '2026-09-09T00:00:00.000Z',
        },
      ],
    });
    expect(snapshot.listItems[0]).not.toHaveProperty('description');
    expect(transaction).toHaveBeenCalledWith(
      'REPEATABLE READ',
      expect.any(Function)
    );
  });
});
