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
          payload: { id: 'task-1', status: 'active' },
        },
        {
          revision: '6',
          entityType: 'list',
          entityId: 'list-1',
          operation: 'delete',
          payload: null,
        },
      ]);
    const service = new TaskListChangeFeedService({ query } as never);

    await expect(service.prime('user-1')).resolves.toBe(4);
    await expect(service.readNextEnvelope('user-1')).resolves.toMatchObject({
      fromRevision: 4,
      revision: 6,
      resetRequired: false,
      changes: [
        { revision: 5, entityId: 'task-1' },
        { revision: 6, entityId: 'list-1', operation: 'delete' },
      ],
    });
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
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ revision: '8' }]);
    const transaction = vi.fn(async (_isolation, callback) =>
      callback({ query })
    );
    const service = new TaskListChangeFeedService({ transaction } as never);

    await expect(service.readSnapshot('user-1')).resolves.toMatchObject({
      revision: 8,
      tasks: [
        {
          id: 'task-1',
          itemKind: 'task',
          followUpTaskId: null,
          createdAt: '2026-09-09T00:00:00.000Z',
        },
      ],
      lists: [{ id: 'list-1', updatedAt: '2026-09-09T01:00:00.000Z' }],
      listItems: [],
    });
    expect(transaction).toHaveBeenCalledWith(
      'REPEATABLE READ',
      expect.any(Function)
    );
  });
});
