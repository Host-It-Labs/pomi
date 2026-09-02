import type { UserAction, UserActionStatus } from '@pomi/shared';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UserActionsStore } from '../../src/user-actions/user-actions.store';

const redisUrl = process.env.REDIS_URL;
const users = ['recovery-integration-user-1', 'recovery-integration-user-2'];
const actions = [
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000302',
];

function recordKey(userId: string, actionId: string) {
  return `pomi:user-actions:{${userId}}:record:${actionId}`;
}

function recentKey(userId: string) {
  return `pomi:user-actions:{${userId}}:recent`;
}

async function cleanUser(redis: Redis, userId: string) {
  await redis.del(
    recentKey(userId),
    `pomi:user-actions:{${userId}}:queue`,
    `pomi:user-actions:{${userId}}:lock`,
    ...actions.flatMap(actionId => [
      recordKey(userId, actionId),
      `pomi:user-actions:{${userId}}:execution:${actionId}`,
      `pomi:user-actions:{${userId}}:tombstone:${actionId}`,
    ])
  );
}

describe.skipIf(!redisUrl)(
  'UserActionsStore recovery index integration',
  () => {
    let redis: Redis;
    let store: UserActionsStore;

    beforeAll(async () => {
      redis = new Redis(redisUrl as string);
      store = new UserActionsStore(redis);
      await Promise.all(users.map(userId => cleanUser(redis, userId)));
    });

    afterAll(async () => {
      await Promise.all(users.map(userId => cleanUser(redis, userId)));
      await redis.quit();
    });

    it('isolates indexed records, refreshes terminal state, and prunes expired records', async () => {
      const action: UserAction = { kind: 'timer', operation: 'pause' };
      const accepted = (
        actionId: string,
        updatedAt: number
      ): UserActionStatus => ({
        actionId,
        status: 'accepted',
        action,
        acceptedAt: updatedAt,
        updatedAt,
      });
      await store.submit(
        users[0],
        actions[0],
        accepted(actions[0], 1),
        { ...accepted(actions[0], 1), status: 'cancelled' },
        action
      );
      await store.submit(
        users[1],
        actions[1],
        accepted(actions[1], 2),
        { ...accepted(actions[1], 2), status: 'cancelled' },
        action
      );
      await store.write(users[0], {
        ...accepted(actions[0], 1),
        status: 'succeeded',
        completedAt: 3,
        updatedAt: 3,
      });

      await expect(store.listRecent(users[0])).resolves.toEqual([
        expect.objectContaining({
          actionId: actions[0],
          status: 'succeeded',
          updatedAt: 3,
        }),
      ]);
      await expect(store.listRecent(users[1])).resolves.toEqual([
        expect.objectContaining({ actionId: actions[1] }),
      ]);
      await expect(redis.ttl(recentKey(users[0]))).resolves.toBeGreaterThan(0);

      await redis.del(recordKey(users[0], actions[0]));
      await expect(store.listRecent(users[0])).resolves.toEqual([]);
      await expect(
        redis.zscore(recentKey(users[0]), actions[0])
      ).resolves.toBeNull();
    });
  }
);
