import { Inject, Injectable } from '@nestjs/common';
import type { UserAction, UserActionStatus } from '@pomi/shared';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

const RECORD_TTL_SECONDS = 7 * 24 * 60 * 60;
// Keep execution payloads only as long as a queued action can reasonably be
// recovered after a backend restart. Lifecycle records never contain these
// payloads; in particular, audio/import blobs are not emitted over sockets.
const EXECUTION_PAYLOAD_TTL_SECONDS = 24 * 60 * 60;
const TOMBSTONE_TTL_SECONDS = 10 * 60;
const RECENT_ACTION_LIMIT = 200;

const RELEASE_LOCK_SCRIPT = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  end
  return 0
`;

export type StoredUserAction = UserActionStatus;
export type UserActionStoreMutationResult = {
  status: StoredUserAction;
  created: boolean;
};

@Injectable()
export class UserActionsStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async submit(
    userId: string,
    actionId: string,
    accepted: StoredUserAction,
    cancelled: StoredUserAction,
    executionAction: UserAction
  ): Promise<UserActionStoreMutationResult> {
    const [raw, created] = (await this.redis.eval(
      `
      if redis.call('exists', KEYS[1]) == 1 then
        local existing = redis.call('get', KEYS[1])
        local existingStatus = cjson.decode(existing)
        redis.call('zadd', KEYS[5], existingStatus.updatedAt, ARGV[2])
        redis.call('expire', KEYS[5], ARGV[5])
        return {existing, 0}
      end
      if redis.call('exists', KEYS[2]) == 1 then
        redis.call('set', KEYS[1], ARGV[4], 'EX', ARGV[5])
        return {ARGV[4], 0}
      end
      redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[5])
      redis.call('set', KEYS[4], ARGV[3], 'EX', ARGV[6])
      redis.call('rpush', KEYS[3], ARGV[2])
      redis.call('zadd', KEYS[5], ARGV[7], ARGV[2])
      redis.call('expire', KEYS[5], ARGV[5])
      local recentCount = redis.call('zcard', KEYS[5])
      if recentCount > tonumber(ARGV[8]) then
        redis.call('zremrangebyrank', KEYS[5], 0, recentCount - tonumber(ARGV[8]) - 1)
      end
      return {ARGV[1], 1}
      `,
      5,
      this.recordKey(userId, actionId),
      this.tombstoneKey(userId, actionId),
      this.queueKey(userId),
      this.executionActionKey(userId, actionId),
      this.recentKey(userId),
      JSON.stringify(accepted),
      actionId,
      JSON.stringify(executionAction),
      JSON.stringify(cancelled),
      RECORD_TTL_SECONDS,
      EXECUTION_PAYLOAD_TTL_SECONDS,
      accepted.updatedAt,
      RECENT_ACTION_LIMIT
    )) as [string, number];
    return { status: this.parse(raw), created: created === 1 };
  }

  async readExecutionAction(
    userId: string,
    actionId: string
  ): Promise<UserAction | null> {
    const raw = await this.redis.get(this.executionActionKey(userId, actionId));
    return raw ? (JSON.parse(raw) as UserAction) : null;
  }

  async removeExecutionAction(userId: string, actionId: string): Promise<void> {
    await this.redis.del(this.executionActionKey(userId, actionId));
  }

  async cancel(
    userId: string,
    actionId: string,
    tombstone: StoredUserAction
  ): Promise<UserActionStoreMutationResult> {
    const [raw, created] = (await this.redis.eval(
      `
      local accepted = redis.call('get', KEYS[1])
      if accepted then return {accepted, 0} end
      local tombstone = redis.call('get', KEYS[2])
      if tombstone then return {tombstone, 0} end
      redis.call('set', KEYS[2], ARGV[1], 'EX', ARGV[2])
      return {ARGV[1], 1}
      `,
      2,
      this.recordKey(userId, actionId),
      this.tombstoneKey(userId, actionId),
      JSON.stringify(tombstone),
      TOMBSTONE_TTL_SECONDS
    )) as [string, number];
    return { status: this.parse(raw), created: created === 1 };
  }

  async read(
    userId: string,
    actionId: string
  ): Promise<StoredUserAction | null> {
    const raw = await this.redis.get(this.recordKey(userId, actionId));
    if (raw) return this.parse(raw);
    const tombstone = await this.redis.get(this.tombstoneKey(userId, actionId));
    return tombstone ? this.parse(tombstone) : null;
  }

  async write(userId: string, status: StoredUserAction): Promise<void> {
    const recentKey = this.recentKey(userId);
    await this.redis.eval(
      `
      redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[3])
      redis.call('zadd', KEYS[2], ARGV[2], ARGV[4])
      redis.call('expire', KEYS[2], ARGV[3])
      local recentCount = redis.call('zcard', KEYS[2])
      if recentCount > tonumber(ARGV[5]) then
        redis.call('zremrangebyrank', KEYS[2], 0, recentCount - tonumber(ARGV[5]) - 1)
      end
      return 1
      `,
      2,
      this.recordKey(userId, status.actionId),
      recentKey,
      JSON.stringify(status),
      status.updatedAt,
      RECORD_TTL_SECONDS,
      status.actionId,
      RECENT_ACTION_LIMIT
    );
  }

  async listRecent(userId: string): Promise<StoredUserAction[]> {
    const recentKey = this.recentKey(userId);
    const actionIds = await this.redis.zrevrange(
      recentKey,
      0,
      RECENT_ACTION_LIMIT - 1
    );
    if (actionIds.length === 0) return [];
    const rawRecords = await this.redis.mget(
      ...actionIds.map(actionId => this.recordKey(userId, actionId))
    );
    const staleActionIds: string[] = [];
    const statuses = rawRecords.flatMap((raw, index) => {
      if (!raw) {
        staleActionIds.push(actionIds[index]);
        return [];
      }
      return [this.parse(raw)];
    });
    if (staleActionIds.length > 0) {
      await this.redis.zrem(recentKey, ...staleActionIds);
    }
    return statuses;
  }

  async queueHead(userId: string): Promise<string | null> {
    return this.redis.lindex(this.queueKey(userId), 0);
  }

  async removeQueueHead(userId: string): Promise<void> {
    await this.redis.lpop(this.queueKey(userId));
  }

  async listQueuedUsers(): Promise<string[]> {
    const users = new Set<string>();
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        'pomi:user-actions:{*}:queue',
        'COUNT',
        100
      );
      cursor = nextCursor;
      keys.forEach(key => {
        const userId = /^pomi:user-actions:\{(.+)}:queue$/.exec(key)?.[1];
        if (userId) users.add(userId);
      });
    } while (cursor !== '0');
    return [...users];
  }

  async acquireLock(
    userId: string,
    token: string,
    ttlMs: number
  ): Promise<boolean> {
    const result = await this.redis.set(
      this.lockKey(userId),
      token,
      'PX',
      ttlMs,
      'NX'
    );
    return result === 'OK';
  }

  async renewLock(userId: string, token: string, ttlMs: number): Promise<void> {
    await this.redis.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) end return 0`,
      1,
      this.lockKey(userId),
      token,
      ttlMs
    );
  }

  async releaseLock(userId: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, this.lockKey(userId), token);
  }

  private parse(raw: string): StoredUserAction {
    return JSON.parse(raw) as StoredUserAction;
  }

  private recordKey(userId: string, actionId: string): string {
    return `pomi:user-actions:{${userId}}:record:${actionId}`;
  }

  private tombstoneKey(userId: string, actionId: string): string {
    return `pomi:user-actions:{${userId}}:tombstone:${actionId}`;
  }

  private executionActionKey(userId: string, actionId: string): string {
    return `pomi:user-actions:{${userId}}:execution:${actionId}`;
  }

  private queueKey(userId: string): string {
    return `pomi:user-actions:{${userId}}:queue`;
  }

  private recentKey(userId: string): string {
    return `pomi:user-actions:{${userId}}:recent`;
  }

  private lockKey(userId: string): string {
    return `pomi:user-actions:{${userId}}:lock`;
  }
}
