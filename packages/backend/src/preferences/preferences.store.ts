import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { PomiLogger } from '../logging/pomi-logger';
import { formatSafeError } from '../logging/sanitize-log';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { Preferences } from './preferences.entity';

const CACHE_TTL_SECONDS = 300;
const CACHE_TTL_MIN_SECONDS = 30;
const CACHE_TTL_MAX_SECONDS = 3_600;
const LOCK_TTL_MS = 10_000;
const LOCK_RETRY_COUNT = 20;
const LOCK_RETRY_DELAY_MS = 25;

@Injectable()
export class PreferencesStore {
  private readonly logger = new PomiLogger(PreferencesStore.name);
  private readonly inFlightLoads = new Map<string, Promise<Preferences>>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService
  ) {}

  async getOrLoad(
    userId: string,
    loader: () => Promise<Preferences>,
    forceRefresh: boolean
  ): Promise<Preferences> {
    if (!this.isEnabled()) {
      return loader();
    }

    if (!forceRefresh) {
      const cached = await this.read(userId);
      if (cached) {
        return cached;
      }
      const existingLoad = this.inFlightLoads.get(userId);
      if (existingLoad) {
        return existingLoad;
      }
    }

    const load = this.loadAndCache(userId, loader, forceRefresh).finally(() => {
      if (this.inFlightLoads.get(userId) === load) {
        this.inFlightLoads.delete(userId);
      }
    });
    this.inFlightLoads.set(userId, load);
    return load;
  }

  async writeThrough(
    userId: string,
    writer: () => Promise<Preferences>
  ): Promise<Preferences> {
    if (!this.isEnabled()) {
      return writer();
    }

    const lockToken = await this.acquireLock(userId);
    try {
      await this.remove(userId);
      const preferences = await writer();
      if (lockToken) {
        await this.write(userId, preferences);
      }
      return preferences;
    } catch (error) {
      await this.remove(userId);
      throw error;
    } finally {
      if (lockToken) {
        await this.releaseLock(userId, lockToken);
      }
    }
  }

  private async loadAndCache(
    userId: string,
    loader: () => Promise<Preferences>,
    forceRefresh: boolean
  ): Promise<Preferences> {
    const lockToken = await this.acquireLock(userId);
    if (!lockToken) {
      return loader();
    }

    try {
      if (!forceRefresh) {
        const cached = await this.read(userId);
        if (cached) {
          return cached;
        }
      }
      const preferences = await loader();
      await this.write(userId, preferences);
      return preferences;
    } finally {
      await this.releaseLock(userId, lockToken);
    }
  }

  private async read(userId: string): Promise<Preferences | null> {
    try {
      const value = await this.redis.get(this.cacheKey(userId));
      if (!value) {
        return null;
      }
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || parsed.userId !== userId) {
        await this.remove(userId);
        return null;
      }
      return parsed as Preferences;
    } catch (error) {
      this.logFallback('read', error);
      return null;
    }
  }

  private async write(userId: string, preferences: Preferences): Promise<void> {
    try {
      await this.redis.set(
        this.cacheKey(userId),
        JSON.stringify(preferences),
        'EX',
        this.ttlSeconds()
      );
    } catch (error) {
      this.logFallback('write', error);
    }
  }

  private async remove(userId: string): Promise<void> {
    try {
      await this.redis.del(this.cacheKey(userId));
    } catch (error) {
      this.logFallback('invalidate', error);
    }
  }

  private async acquireLock(userId: string): Promise<string | null> {
    const token = randomUUID();
    try {
      for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
        const acquired = await this.redis.set(
          this.lockKey(userId),
          token,
          'PX',
          LOCK_TTL_MS,
          'NX'
        );
        if (acquired === 'OK') {
          return token;
        }
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
      }
    } catch (error) {
      this.logFallback('lock', error);
    }
    return null;
  }

  private async releaseLock(userId: string, token: string): Promise<void> {
    try {
      await this.redis.eval(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
        1,
        this.lockKey(userId),
        token
      );
    } catch (error) {
      this.logFallback('unlock', error);
    }
  }

  private isEnabled(): boolean {
    return (
      this.configService.get<string>('PREFERENCES_CACHE_ENABLED') !== 'false'
    );
  }

  private ttlSeconds(): number {
    const configured = Number(
      this.configService.get<string>('PREFERENCES_CACHE_TTL_SECONDS')
    );
    if (!Number.isFinite(configured)) {
      return CACHE_TTL_SECONDS;
    }
    return Math.min(
      CACHE_TTL_MAX_SECONDS,
      Math.max(CACHE_TTL_MIN_SECONDS, Math.trunc(configured))
    );
  }

  private cacheKey(userId: string): string {
    return `preferences:v1:${userId}`;
  }

  private lockKey(userId: string): string {
    return `preferences:v1:${userId}:lock`;
  }

  private logFallback(operation: string, error: unknown): void {
    this.logger.warn(
      `Preferences cache ${operation} unavailable (${formatSafeError(error)})`
    );
  }
}
