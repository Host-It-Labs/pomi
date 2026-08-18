import Redis from 'ioredis';
import { DEFAULT_REDIS_URL } from '../src/redis/redis.constants';

const APPLY = process.argv.includes('--apply');
const SCAN_COUNT = 500;
const SOURCE_PATTERNS = [
  'pomi:user-actions:record:*',
  'pomi:user-actions:tombstone:*',
  'pomi:user-actions:execution:*',
];

export function taggedUserActionKey(source: string): string | null {
  const match =
    /^pomi:user-actions:(record|tombstone|execution):([^:]+):(.+)$/.exec(
      source
    );
  if (!match) return null;
  const [, kind, userId, actionId] = match;
  return `pomi:user-actions:{${userId}}:${kind}:${actionId}`;
}

async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      SCAN_COUNT
    );
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

export async function assertUserActionCutoverDrained(
  redis: Redis
): Promise<void> {
  const [legacyQueues, legacyLocks, taggedQueues, taggedLocks] =
    await Promise.all([
      scanKeys(redis, 'pomi:user-actions:queue:*'),
      scanKeys(redis, 'pomi:user-actions:lock:*'),
      scanKeys(redis, 'pomi:user-actions:{*}:queue'),
      scanKeys(redis, 'pomi:user-actions:{*}:lock'),
    ]);
  if (
    legacyQueues.length > 0 ||
    legacyLocks.length > 0 ||
    taggedQueues.length > 0 ||
    taggedLocks.length > 0
  ) {
    throw new Error(
      `Cutover is not drained: ${legacyQueues.length} legacy queues, ${legacyLocks.length} legacy locks, ${taggedQueues.length} tagged queues, and ${taggedLocks.length} tagged locks remain`
    );
  }
}

async function main() {
  const redis = new Redis(process.env.REDIS_URL || DEFAULT_REDIS_URL);
  try {
    await assertUserActionCutoverDrained(redis);
    const sourceGroups = await Promise.all([
      ...SOURCE_PATTERNS.map(pattern => scanKeys(redis, pattern)),
    ]);

    const migrations = sourceGroups
      .flat()
      .map(source => ({ source, target: taggedUserActionKey(source) }))
      .filter(
        (entry): entry is { source: string; target: string } =>
          entry.target !== null
      );
    for (const { source, target } of migrations) {
      if ((await redis.exists(target)) !== 0) {
        throw new Error(`Tagged target already exists: ${target}`);
      }
      const ttl = await redis.pttl(source);
      if (ttl < 0) {
        throw new Error(`Legacy key is missing or has no expiry: ${source}`);
      }
    }

    process.stdout.write(
      `${APPLY ? 'Migrating' : 'Dry run:'} ${migrations.length} user-action keys\n`
    );
    if (!APPLY) {
      process.stdout.write(
        'No keys changed. Re-run with --apply during the cutover.\n'
      );
      return;
    }
    for (const { source, target } of migrations) {
      const renamed = await redis.renamenx(source, target);
      if (renamed !== 1) {
        throw new Error(`Migration collision while renaming ${source}`);
      }
    }
    process.stdout.write(
      `Migrated ${migrations.length} keys with TTLs preserved.\n`
    );
  } finally {
    redis.disconnect();
  }
}

if (require.main === module) {
  void main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
