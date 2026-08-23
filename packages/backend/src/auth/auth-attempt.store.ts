import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { AuthRateLimitException } from './auth-rate-limit.exception';

const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

type LimitResult = {
  blocked: boolean;
  retryAfterSeconds: number;
};

type AuthLimitConfiguration = {
  attemptWindowSeconds: number;
  attemptOriginLimit: number;
  attemptIdentityLimit: number;
  registrationWindowSeconds: number;
  registrationOriginLimit: number;
  registrationGlobalLimit: number;
};

@Injectable()
export class AuthAttemptStore {
  private readonly configuration: AuthLimitConfiguration;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    configService: ConfigService
  ) {
    this.configuration = {
      attemptWindowSeconds: this.positiveInteger(
        configService,
        'AUTH_ATTEMPT_WINDOW_SECONDS',
        60
      ),
      attemptOriginLimit: this.positiveInteger(
        configService,
        'AUTH_ATTEMPT_ORIGIN_LIMIT',
        60
      ),
      attemptIdentityLimit: this.positiveInteger(
        configService,
        'AUTH_ATTEMPT_IDENTITY_LIMIT',
        10
      ),
      registrationWindowSeconds: this.positiveInteger(
        configService,
        'AUTH_REGISTRATION_WINDOW_SECONDS',
        3600
      ),
      registrationOriginLimit: this.positiveInteger(
        configService,
        'AUTH_REGISTRATION_ORIGIN_LIMIT',
        20
      ),
      registrationGlobalLimit: this.positiveInteger(
        configService,
        'AUTH_REGISTRATION_GLOBAL_LIMIT',
        200
      ),
    };
  }

  async assertAuthenticationAllowed(
    origin: string,
    identity: string
  ): Promise<void> {
    const limits = await Promise.all([
      this.consume(
        `attempt:origin:${this.digest(origin)}`,
        this.configuration.attemptOriginLimit,
        this.configuration.attemptWindowSeconds
      ),
      this.consume(
        `attempt:identity:${this.digest(identity)}`,
        this.configuration.attemptIdentityLimit,
        this.configuration.attemptWindowSeconds
      ),
    ]);
    this.throwWhenBlocked(limits);
  }

  async assertRegistrationAllowed(origin: string): Promise<void> {
    const limits = await Promise.all([
      this.consume(
        `registration:origin:${this.digest(origin)}`,
        this.configuration.registrationOriginLimit,
        this.configuration.registrationWindowSeconds
      ),
      this.consume(
        'registration:global',
        this.configuration.registrationGlobalLimit,
        this.configuration.registrationWindowSeconds
      ),
    ]);
    this.throwWhenBlocked(limits);
  }

  private async consume(
    suffix: string,
    limit: number,
    windowSeconds: number
  ): Promise<LimitResult> {
    const result = await this.redis.eval(
      FIXED_WINDOW_SCRIPT,
      1,
      `pomi:auth-limits:${suffix}`,
      windowSeconds
    );
    if (!Array.isArray(result) || result.length < 2) {
      throw new Error('Redis returned an invalid authentication limit result');
    }
    const count = Number(result[0]);
    const ttl = Number(result[1]);
    if (!Number.isFinite(count) || !Number.isFinite(ttl)) {
      throw new Error('Redis returned an invalid authentication limit value');
    }
    return {
      blocked: count > limit,
      retryAfterSeconds: Math.max(1, ttl),
    };
  }

  private throwWhenBlocked(results: LimitResult[]): void {
    const blocked = results.filter(result => result.blocked);
    if (blocked.length === 0) return;
    throw new AuthRateLimitException(
      Math.max(...blocked.map(result => result.retryAfterSeconds))
    );
  }

  private digest(value: string): string {
    return createHash('sha256')
      .update(value.trim().toLowerCase() || 'unknown')
      .digest('hex');
  }

  private positiveInteger(
    configService: ConfigService,
    name: string,
    fallback: number
  ): number {
    const raw = configService.get<string>(name);
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive integer`);
    }
    return value;
  }
}
