import { describe, expect, it } from 'vitest';
import {
  parseCorsOrigins,
  isCorsOriginAllowed,
  resolveDatabaseUrl,
  resolveRedisUrl,
  validateEnvironment,
} from '../../src/config/environment';

describe('backend environment validation', () => {
  it('fails closed when production secrets are missing', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'production' })).toThrow(
      'DATABASE_URL or PostgreSQL connection fields, REDIS_URL or REDIS_PASSWORD, JWT_SECRET, CORS_ORIGINS'
    );
  });

  it('constructs encoded service URLs from Docker connection fields', () => {
    const environment = {
      POSTGRES_USER: 'pomi@example',
      POSTGRES_PASSWORD: 'db:pass/word%#',
      POSTGRES_DB: 'pomi data',
      REDIS_PASSWORD: 'redis:pass/word%#',
    };

    expect(resolveDatabaseUrl(environment)).toBe(
      'postgres://pomi%40example:db%3Apass%2Fword%25%23@db:5432/pomi%20data'
    );
    expect(resolveRedisUrl(environment)).toBe(
      'redis://:redis%3Apass%2Fword%25%23@redis:6379'
    );
  });

  it('prefers explicit service URLs over Docker connection fields', () => {
    expect(
      resolveDatabaseUrl({
        DATABASE_URL: 'postgres://managed.example/pomi',
        POSTGRES_PASSWORD: 'ignored',
      })
    ).toBe('postgres://managed.example/pomi');
    expect(
      resolveRedisUrl({
        REDIS_URL: 'rediss://managed.example',
        REDIS_PASSWORD: 'ignored',
      })
    ).toBe('rediss://managed.example');
  });

  it('rejects weak production JWT secrets', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://database.example/pomi',
        REDIS_URL: 'rediss://redis.example/pomi',
        JWT_SECRET: 'your-secret-key',
        CORS_ORIGINS: 'https://focus.example',
      })
    ).toThrow('JWT_SECRET must be at least 32 characters');
  });

  it('accepts complete production configuration', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://database.example/pomi',
        REDIS_URL: 'rediss://redis.example/pomi',
        JWT_SECRET: 'a-production-secret-with-more-than-32-characters',
        CORS_ORIGINS: 'https://focus.example',
      })
    ).toMatchObject({ NODE_ENV: 'production' });
  });

  it('normalizes Docker connection fields for production consumers', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'production',
        POSTGRES_USER: 'pomi',
        POSTGRES_PASSWORD: 'db@pass',
        POSTGRES_DB: 'pomi',
        REDIS_PASSWORD: 'redis@pass',
        JWT_SECRET: 'a-production-secret-with-more-than-32-characters',
        CORS_ORIGINS: 'tauri://localhost',
      })
    ).toMatchObject({
      DATABASE_URL: 'postgres://pomi:db%40pass@db:5432/pomi',
      REDIS_URL: 'redis://:redis%40pass@redis:6379',
      APN_PRODUCTION: false,
    });
  });

  it('parses a comma-separated origin allowlist', () => {
    expect(
      parseCorsOrigins(
        'https://focus.example, http://localhost:1420',
        'production'
      )
    ).toEqual(['https://focus.example', 'http://localhost:1420']);
  });

  it('accepts explicitly configured native and opaque origins', () => {
    expect(
      parseCorsOrigins(
        'tauri://localhost,http://tauri.localhost,https://tauri.localhost,null,app://pomi',
        'production'
      )
    ).toEqual([
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
      'null',
      'app://pomi',
    ]);
  });

  it('rejects origins containing paths', () => {
    expect(() =>
      parseCorsOrigins('https://focus.example/path', 'production')
    ).toThrow('CORS origin must not contain a path');
  });

  it('parses APN_PRODUCTION environment strings as booleans', () => {
    expect(validateEnvironment({ APN_PRODUCTION: 'false' })).toMatchObject({
      APN_PRODUCTION: false,
    });
    expect(validateEnvironment({ APN_PRODUCTION: 'true' })).toMatchObject({
      APN_PRODUCTION: true,
    });
    expect(() => validateEnvironment({ APN_PRODUCTION: 'yes' })).toThrow(
      'APN_PRODUCTION must be true or false'
    );
  });

  it('applies the same allowlist to websocket origins', () => {
    expect(
      isCorsOriginAllowed(
        'https://focus.example',
        'https://focus.example',
        'production'
      )
    ).toBe(true);
    expect(
      isCorsOriginAllowed(
        'https://attacker.example',
        'https://focus.example',
        'production'
      )
    ).toBe(false);
  });

  it('allows loopback origins on dynamic ports only outside production', () => {
    expect(
      isCorsOriginAllowed('http://localhost:1424', undefined, 'development')
    ).toBe(true);
    expect(
      isCorsOriginAllowed('http://127.0.0.1:4173', undefined, 'test')
    ).toBe(true);
    expect(
      isCorsOriginAllowed(
        'http://localhost:1424',
        'https://focus.example',
        'production'
      )
    ).toBe(false);
  });
});
