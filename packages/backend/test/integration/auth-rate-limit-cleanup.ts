import type Redis from 'ioredis';

const AUTH_RATE_LIMIT_KEY_PATTERN = 'pomi:auth-limits:*';
const SCAN_BATCH_SIZE = 500;

export async function clearAuthRateLimitKeys(redis: Redis): Promise<number> {
  let cursor = '0';
  let deleted = 0;

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      AUTH_RATE_LIMIT_KEY_PATTERN,
      'COUNT',
      SCAN_BATCH_SIZE
    );
    cursor = nextCursor;
    if (keys.length > 0) {
      deleted += await redis.del(...keys);
    }
  } while (cursor !== '0');

  return deleted;
}
