import type { UserAction, UserActionStatus } from '@pomi/shared';
import { describe, expect, it } from 'vitest';
import { UserActionsStore } from '../../src/user-actions/user-actions.store';

class FakeRedis {
  readonly evaluatedKeySets: string[][] = [];
  private readonly records = new Map<string, string>();
  private readonly tombstones = new Map<string, string>();
  private readonly queues = new Map<string, string[]>();
  private readonly locks = new Map<string, string>();
  private readonly sortedSets = new Map<string, Map<string, number>>();

  async eval(script: string, keyCount: number, ...args: string[]) {
    const keys = args.slice(0, keyCount);
    this.evaluatedKeySets.push(keys);
    const values = args.slice(keyCount);
    if (script.includes('rpush')) {
      const [recordKey, tombstoneKey, queueKey, executionKey, recentKey] = keys;
      if (this.records.has(recordKey)) {
        const recent =
          this.sortedSets.get(recentKey) ?? new Map<string, number>();
        recent.set(values[1], Number(values[6]));
        this.sortedSets.set(recentKey, recent);
        return [this.records.get(recordKey), 0];
      }
      if (this.tombstones.has(tombstoneKey)) {
        this.records.set(recordKey, values[3]);
        return [values[3], 0];
      }
      this.records.set(recordKey, values[0]);
      this.records.set(executionKey, values[2]);
      const queue = this.queues.get(queueKey) ?? [];
      queue.push(values[1]);
      this.queues.set(queueKey, queue);
      const recent =
        this.sortedSets.get(recentKey) ?? new Map<string, number>();
      recent.set(values[1], Number(values[6]));
      this.sortedSets.set(recentKey, recent);
      return [values[0], 1];
    }
    if (script.includes("redis.call('zadd'")) {
      const [recordKey, recentKey] = keys;
      this.records.set(recordKey, values[0]);
      const recent =
        this.sortedSets.get(recentKey) ?? new Map<string, number>();
      recent.set(values[3], Number(values[1]));
      this.sortedSets.set(recentKey, recent);
      return 1;
    }
    if (script.includes('local accepted')) {
      const [recordKey, tombstoneKey] = keys;
      if (this.records.has(recordKey)) return [this.records.get(recordKey), 0];
      if (this.tombstones.has(tombstoneKey)) {
        return [this.tombstones.get(tombstoneKey), 0];
      }
      this.tombstones.set(tombstoneKey, values[0]);
      return [values[0], 1];
    }
    if (script.includes('pexpire')) {
      return this.locks.get(keys[0]) === values[0] ? 1 : 0;
    }
    if (script.includes("redis.call('del'")) {
      if (this.locks.get(keys[0]) !== values[0]) return 0;
      this.locks.delete(keys[0]);
      return 1;
    }
    throw new Error(`Unknown script: ${script}`);
  }

  async get(key: string) {
    return this.records.get(key) ?? this.tombstones.get(key) ?? null;
  }

  async del(key: string) {
    return this.records.delete(key) ? 1 : 0;
  }

  async set(key: string, value: string, ...options: string[]) {
    if (options.includes('NX') && this.locks.has(key)) return null;
    this.locks.set(key, value);
    return 'OK';
  }

  async lindex(key: string, index: number) {
    return this.queues.get(key)?.[index] ?? null;
  }

  async lpop(key: string) {
    const queue = this.queues.get(key) ?? [];
    const value = queue.shift() ?? null;
    this.queues.set(key, queue);
    return value;
  }

  async scan() {
    return ['0', [...this.queues.keys()]];
  }

  async zrevrange(key: string, start: number, end: number) {
    return [...(this.sortedSets.get(key) ?? new Map()).entries()]
      .sort(
        (left, right) => right[1] - left[1] || right[0].localeCompare(left[0])
      )
      .slice(start, end + 1)
      .map(([member]) => member);
  }

  async mget(...keys: string[]) {
    return keys.map(key => this.records.get(key) ?? null);
  }

  async zrem(key: string, ...members: string[]) {
    const values = this.sortedSets.get(key);
    members.forEach(member => values?.delete(member));
    return members.length;
  }
}

function status(
  actionId: string,
  lifecycle: UserActionStatus['status'] = 'accepted'
): UserActionStatus {
  const now = Date.now();
  return {
    actionId,
    status: lifecycle,
    action: { kind: 'timer', operation: 'pause' },
    acceptedAt: now,
    updatedAt: now,
  };
}

const executionAction: UserAction = { kind: 'timer', operation: 'pause' };

describe('UserActionsStore', () => {
  it('keeps acceptance idempotent and prevents cancellation after acceptance', async () => {
    const store = new UserActionsStore(new FakeRedis() as never);
    const accepted = status('action-1');
    const cancelled = status('action-1', 'cancelled');

    await expect(
      store.submit('user-1', 'action-1', accepted, cancelled, executionAction)
    ).resolves.toMatchObject({
      status: { status: 'accepted' },
      created: true,
    });
    await expect(
      store.submit('user-1', 'action-1', accepted, cancelled, executionAction)
    ).resolves.toMatchObject({
      status: { status: 'accepted' },
      created: false,
    });
    await expect(
      store.readExecutionAction('user-1', 'action-1')
    ).resolves.toEqual(executionAction);
    await store.removeExecutionAction('user-1', 'action-1');
    await expect(
      store.readExecutionAction('user-1', 'action-1')
    ).resolves.toBeNull();
    await expect(
      store.cancel('user-1', 'action-1', cancelled)
    ).resolves.toMatchObject({
      status: { status: 'accepted' },
      created: false,
    });
  });

  it('keeps cancel-before-accept tombstoned and out of the queue', async () => {
    const store = new UserActionsStore(new FakeRedis() as never);
    const cancelled = status('action-2', 'cancelled');

    await expect(
      store.cancel('user-1', 'action-2', cancelled)
    ).resolves.toMatchObject({
      status: { status: 'cancelled' },
      created: true,
    });
    await expect(
      store.submit(
        'user-1',
        'action-2',
        status('action-2'),
        cancelled,
        executionAction
      )
    ).resolves.toMatchObject({
      status: { status: 'cancelled' },
      created: false,
    });
    await expect(store.queueHead('user-1')).resolves.toBeNull();
  });

  it('keeps FIFO order per user and isolates separate user queues', async () => {
    const redis = new FakeRedis();
    const store = new UserActionsStore(redis as never);

    for (const [userId, actionId] of [
      ['user-1', 'action-1'],
      ['user-1', 'action-2'],
      ['user-2', 'action-3'],
    ]) {
      await store.submit(
        userId,
        actionId,
        status(actionId),
        status(actionId, 'cancelled'),
        executionAction
      );
    }

    await expect(store.queueHead('user-1')).resolves.toBe('action-1');
    await expect(store.queueHead('user-2')).resolves.toBe('action-3');
    await store.removeQueueHead('user-1');
    await expect(store.queueHead('user-1')).resolves.toBe('action-2');
    await expect(store.listQueuedUsers()).resolves.toEqual([
      'user-1',
      'user-2',
    ]);
    for (const keys of redis.evaluatedKeySets) {
      const hashTags = keys.map(key => /\{([^}]+)}/.exec(key)?.[1]);
      expect(hashTags.every(tag => tag === hashTags[0])).toBe(true);
      expect(hashTags[0]).toBeTruthy();
    }
  });

  it('indexes recent lifecycle records per user without execution payloads', async () => {
    const store = new UserActionsStore(new FakeRedis() as never);
    const first = status('action-1');
    const second = { ...status('action-2'), updatedAt: first.updatedAt + 1 };

    await store.submit(
      'user-1',
      first.actionId,
      first,
      status(first.actionId, 'cancelled'),
      executionAction
    );
    await store.submit(
      'user-1',
      second.actionId,
      second,
      status(second.actionId, 'cancelled'),
      executionAction
    );
    await store.submit(
      'user-2',
      'other-action',
      status('other-action'),
      status('other-action', 'cancelled'),
      executionAction
    );

    await expect(store.listRecent('user-1')).resolves.toEqual([second, first]);
  });
});
