import { UnauthorizedException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionEntity } from '../../src/auth/auth-session.entity';
import { decryptRefreshSecret } from '../../src/auth/session-crypto';
import { SessionService } from '../../src/auth/session.service';

const JWT_SECRET = 'session-test-secret';

function createRepository() {
  const rows = new Map<string, AuthSessionEntity>();
  const repository = {
    create: (value: Partial<AuthSessionEntity>) => value as AuthSessionEntity,
    save: async (value: AuthSessionEntity) => {
      rows.set(value.id, value);
      return value;
    },
    findOne: async ({ where }: { where: Partial<AuthSessionEntity> }) => {
      const row = where.id ? rows.get(where.id) : undefined;
      if (!row) return null;
      if (where.userId && row.userId !== where.userId) return null;
      return row;
    },
    update: async (
      criteria: Partial<AuthSessionEntity>,
      patch: Partial<AuthSessionEntity>
    ) => {
      let affected = 0;
      for (const row of rows.values()) {
        if (criteria.id && row.id !== criteria.id) continue;
        if (criteria.userId && row.userId !== criteria.userId) continue;
        if (criteria.familyId && row.familyId !== criteria.familyId) continue;
        if (criteria.revokedAt && row.revokedAt !== null) continue;
        Object.assign(row, patch);
        affected += 1;
      }
      return { affected };
    },
  };
  Object.assign(repository, {
    manager: {
      transaction: async (callback: (manager: unknown) => Promise<unknown>) =>
        callback({ getRepository: () => repository }),
    },
  });
  return { repository, rows };
}

function createService(legacyDeadline?: string) {
  const { repository, rows } = createRepository();
  const service = new SessionService(
    repository as never,
    {
      getOrThrow: () => JWT_SECRET,
      get: () => legacyDeadline,
    } as never
  );
  return { service, rows };
}

describe('SessionService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores only hashed and encrypted refresh secrets', async () => {
    const { service, rows } = createService();
    const created = await service.createSession(
      '00000000-0000-4000-8000-000000000010',
      'web'
    );
    const [sessionId, refreshSecret] = created.refreshToken.split('.');
    const row = rows.get(sessionId);

    expect(row).toBeDefined();
    expect(row?.refreshTokenHash).not.toContain(refreshSecret);
    expect(row?.currentRefreshTokenCiphertext).not.toContain(refreshSecret);
    expect(
      decryptRefreshSecret(
        requireValue(row?.currentRefreshTokenCiphertext),
        JWT_SECRET
      )
    ).toBe(refreshSecret);
  });

  it('encrypts browser refresh cookies and rejects tampered values', async () => {
    const { service } = createService();
    const created = await service.createSession(
      '00000000-0000-4000-8000-000000000010',
      'web'
    );
    const protectedCookie = service.protectRefreshCookie(created.refreshToken);

    expect(protectedCookie).not.toContain(created.refreshToken);
    expect(service.readProtectedRefreshCookie(protectedCookie)).toBe(
      created.refreshToken
    );
    const replacement = protectedCookie.endsWith('A') ? 'B' : 'A';
    expect(
      service.readProtectedRefreshCookie(
        `${protectedCookie.slice(0, -1)}${replacement}`
      )
    ).toBeNull();
  });

  it('rotates refresh secrets and tolerates one concurrent retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
    const { service } = createService();
    const created = await service.createSession(
      '00000000-0000-4000-8000-000000000010',
      'web'
    );

    const rotated = await service.refreshSession(created.refreshToken, 'web');
    const concurrent = await service.refreshSession(
      created.refreshToken,
      'web'
    );

    expect(rotated.refreshToken).not.toBe(created.refreshToken);
    expect(concurrent.refreshToken).toBe(rotated.refreshToken);
  });

  it('revokes the session family when an old refresh secret is replayed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
    const { service, rows } = createService();
    const created = await service.createSession(
      '00000000-0000-4000-8000-000000000010',
      'web'
    );
    await service.refreshSession(created.refreshToken, 'web');
    await vi.advanceTimersByTimeAsync(31_000);

    await expect(
      service.refreshSession(created.refreshToken, 'web')
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(rows.get(created.sessionId)?.revocationReason).toBe(
      'refresh-replay'
    );
    await expect(
      service.refreshSession(`${created.sessionId}.${'A'.repeat(43)}`, 'web')
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('expires inactive sessions and rejects malformed refresh tokens safely', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
    const { service, rows } = createService();
    const created = await service.createSession(
      '00000000-0000-4000-8000-000000000010',
      'android'
    );
    const row = requireValue(rows.get(created.sessionId));
    row.expiresAt = new Date(Date.now() - 1);

    await expect(
      service.refreshSession(created.refreshToken, 'android')
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(row.revocationReason).toBe('expired');
    await expect(
      service.refreshSession('not-a-token', 'android')
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts legacy access tokens only inside the configured migration window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
    const future = createService('2026-09-02T12:00:00.000Z').service;
    const past = createService('2026-08-31T12:00:00.000Z').service;
    const payload = { exp: Math.floor(Date.now() / 1000) + 60 };

    expect(future.isLegacyTokenAllowed(payload)).toBe(true);
    expect(past.isLegacyTokenAllowed(payload)).toBe(false);
    expect(future.isLegacyTokenAllowed({ exp: 0 })).toBe(false);
  });
});

function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing value');
  return value;
}
