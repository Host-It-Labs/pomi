import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { PreferencesStore } from '../../src/preferences/preferences.store';

function createRedis() {
  const values = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && values.has(key)) {
        return null;
      }
      values.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => (values.delete(key) ? 1 : 0)),
    eval: vi.fn(
      async (
        _script: string,
        _keyCount: number,
        key: string,
        token: string
      ) => {
        if (values.get(key) !== token) {
          return 0;
        }
        values.delete(key);
        return 1;
      }
    ),
  };
}

function preferences(userId: string, language: string) {
  return { userId, language } as never;
}

describe('PreferencesStore', () => {
  it('single-flights a cold load across service instances', async () => {
    const redis = createRedis();
    const config = new ConfigService();
    const firstStore = new PreferencesStore(redis as never, config);
    const secondStore = new PreferencesStore(redis as never, config);
    const loader = vi.fn(async () => preferences('user-1', 'en'));

    const [first, second] = await Promise.all([
      firstStore.getOrLoad('user-1', loader, false),
      secondStore.getOrLoad('user-1', loader, false),
    ]);

    expect(first).toEqual(second);
    expect(loader).toHaveBeenCalledOnce();
  });

  it('publishes a write-through update to other service instances', async () => {
    const redis = createRedis();
    const config = new ConfigService();
    const firstStore = new PreferencesStore(redis as never, config);
    const secondStore = new PreferencesStore(redis as never, config);

    await firstStore.getOrLoad(
      'user-2',
      async () => preferences('user-2', 'en'),
      false
    );
    await firstStore.writeThrough('user-2', async () =>
      preferences('user-2', 'fr')
    );
    const loader = vi.fn(async () => preferences('user-2', 'de'));

    await expect(
      secondStore.getOrLoad('user-2', loader, false)
    ).resolves.toMatchObject({ language: 'fr' });
    expect(loader).not.toHaveBeenCalled();
  });

  it('supports instant cache disablement', async () => {
    const redis = createRedis();
    const config = new ConfigService({ PREFERENCES_CACHE_ENABLED: 'false' });
    const store = new PreferencesStore(redis as never, config);
    const loader = vi.fn(async () => preferences('user-3', 'en'));

    await store.getOrLoad('user-3', loader, false);
    await store.getOrLoad('user-3', loader, false);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('falls back to the database when Redis is unavailable', async () => {
    const redis = createRedis();
    redis.get.mockRejectedValue(new Error('Redis unavailable'));
    redis.set.mockRejectedValue(new Error('Redis unavailable'));
    const store = new PreferencesStore(redis as never, new ConfigService());
    const loader = vi.fn(async () => preferences('user-4', 'en'));

    await expect(
      store.getOrLoad('user-4', loader, false)
    ).resolves.toMatchObject({ language: 'en' });

    expect(loader).toHaveBeenCalledOnce();
  });
});
