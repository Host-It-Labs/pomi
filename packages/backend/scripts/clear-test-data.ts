import Redis from 'ioredis';
import { In } from 'typeorm';
import dataSource from '../data-source';
import { Intention } from '../src/intentions/intentions.entity';
import { Preferences } from '../src/preferences/preferences.entity';
import { Statistic } from '../src/statistics/statistics.entity';
import { TaskEntity } from '../src/tasks/tasks.entity';
import { UserEntity } from '../src/users/users.entity';

const TIMER_KEY_SUFFIXES = [
  'timer',
  'current_timer',
  'session_state',
  'last_timer_completion',
  'idle_detected',
  'timer_undo_state',
  'timer_extension_state',
];

const TIMER_KEY_PATTERNS = TIMER_KEY_SUFFIXES.map(suffix => `user:*:${suffix}`);
const AUTH_RATE_LIMIT_KEY_PATTERN = 'pomi:auth-limits:*';
const REDIS_BATCH_SIZE = 500;
const DB_BATCH_SIZE = 500;

function getRedisUrl(): string {
  return process.env.REDIS_URL || 'redis://localhost:6379';
}

function getTimerKeysForUser(userId: string): string[] {
  return TIMER_KEY_SUFFIXES.map(suffix => `user:${userId}:${suffix}`);
}

function parseUserIdFromTimerKey(key: string): string | null {
  const match = key.match(/^user:([^:]+):/);
  return match?.[1] ?? null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  let cursor = '0';
  const keys: string[] = [];

  do {
    const [nextCursor, batch] = await redis.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      REDIS_BATCH_SIZE
    );
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');

  return keys;
}

async function scanTimerUserIds(redis: Redis): Promise<Set<string>> {
  const userIds = new Set<string>();

  for (const pattern of TIMER_KEY_PATTERNS) {
    const keys = await scanKeys(redis, pattern);
    for (const key of keys) {
      const userId = parseUserIdFromTimerKey(key);
      if (userId) {
        userIds.add(userId);
      }
    }
  }

  return userIds;
}

async function deleteRedisKeys(redis: Redis, keys: string[]): Promise<number> {
  let deleted = 0;

  for (const keyBatch of chunk([...new Set(keys)], REDIS_BATCH_SIZE)) {
    if (keyBatch.length === 0) {
      continue;
    }

    deleted += await redis.del(...keyBatch);
  }

  return deleted;
}

async function getExistingUserIds(userIds: string[]): Promise<Set<string>> {
  const usersRepository = dataSource.getRepository(UserEntity);
  const existingUserIds = new Set<string>();

  for (const userIdBatch of chunk(userIds, DB_BATCH_SIZE)) {
    if (userIdBatch.length === 0) {
      continue;
    }

    const users = await usersRepository.find({
      select: { id: true },
      where: { id: In(userIdBatch) },
    });

    for (const user of users) {
      existingUserIds.add(user.id);
    }
  }

  return existingUserIds;
}

async function getTestUserIds(): Promise<string[]> {
  const usersRepository = dataSource.getRepository(UserEntity);
  const users = await usersRepository
    .createQueryBuilder('user')
    .select('user.id', 'id')
    .where('user.username LIKE :testPrefix', { testPrefix: 'testuser%' })
    .orWhere('user.username LIKE :generatedPrefix', {
      generatedPrefix: 'user_%',
    })
    .getRawMany<{ id: string }>();

  return users.map(user => user.id);
}

async function clearRedisTimerState(
  redis: Redis,
  testUserIds: string[]
): Promise<number> {
  const redisTimerUserIds = await scanTimerUserIds(redis);
  const existingUserIds = await getExistingUserIds([...redisTimerUserIds]);
  const userIdsToClear = new Set(testUserIds);

  for (const userId of redisTimerUserIds) {
    if (!existingUserIds.has(userId)) {
      userIdsToClear.add(userId);
    }
  }

  const keysToDelete = [...userIdsToClear].flatMap(getTimerKeysForUser);
  return await deleteRedisKeys(redis, keysToDelete);
}

async function clearRedisAuthRateLimitState(redis: Redis): Promise<number> {
  const keys = await scanKeys(redis, AUTH_RATE_LIMIT_KEY_PATTERN);
  return await deleteRedisKeys(redis, keys);
}

async function clearDatabaseTestData(testUserIds: string[]): Promise<void> {
  if (testUserIds.length === 0) {
    return;
  }

  await dataSource.transaction(async manager => {
    await manager.query(
      'LOCK TABLE "preferences", "users" IN SHARE ROW EXCLUSIVE MODE'
    );
    await manager.getRepository(Intention).delete({ userId: In(testUserIds) });
    await manager.getRepository(Statistic).delete({ userId: In(testUserIds) });
    await manager.getRepository(TaskEntity).delete({ userId: In(testUserIds) });
    await manager
      .getRepository(Preferences)
      .delete({ userId: In(testUserIds) });
    await manager.getRepository(UserEntity).delete({ id: In(testUserIds) });
  });
}

async function clearTestData(): Promise<void> {
  await dataSource.initialize();

  const testUserIds = await getTestUserIds();
  const redis = new Redis(getRedisUrl());
  let deletedRedisTimerKeys = 0;
  let deletedRedisAuthRateLimitKeys = 0;
  try {
    deletedRedisTimerKeys = await clearRedisTimerState(redis, testUserIds);
    deletedRedisAuthRateLimitKeys = await clearRedisAuthRateLimitState(redis);
  } finally {
    redis.disconnect();
  }
  await clearDatabaseTestData(testUserIds);

  process.stdout.write(
    [
      'Cleared test data',
      `- users: ${testUserIds.length}`,
      `- redis timer keys: ${deletedRedisTimerKeys}`,
      `- redis auth-limit keys: ${deletedRedisAuthRateLimitKeys}`,
    ].join('\n') + '\n'
  );
}

void clearTestData()
  .catch(error => {
    console.error('Failed to clear test data', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });
