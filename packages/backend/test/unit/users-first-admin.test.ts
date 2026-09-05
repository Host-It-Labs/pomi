import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { UsersService } from '../../src/users/users.service';

const BOOTSTRAP_TOKEN = 'A'.repeat(48);

function createService(configuredToken: string | undefined) {
  let hasAdmin = false;
  let nextId = 1;
  const saved: Array<Record<string, unknown>> = [];
  const query = vi.fn(async () => undefined);
  const transactionalRepository = {
    exists: vi.fn(async () => hasAdmin),
    create: vi.fn((value: Record<string, unknown>) => ({ ...value })),
    save: vi.fn(async (value: Record<string, unknown>) => {
      const persisted = { id: `user-${nextId++}`, ...value };
      if (persisted.isAdmin === true) hasAdmin = true;
      saved.push(persisted);
      return persisted;
    }),
  };
  const service = new UsersService(
    {} as never,
    {} as never,
    {
      transaction: async (callback: (manager: unknown) => Promise<unknown>) =>
        callback({
          query,
          getRepository: () => transactionalRepository,
        }),
    } as never,
    { get: () => configuredToken } as never
  );
  return { query, saved, service };
}

describe('first self-hosted administrator claim', () => {
  it('returns the same safe failure for missing and incorrect setup tokens', () => {
    const { service } = createService(BOOTSTRAP_TOKEN);
    const capture = (token?: string) => {
      try {
        service.assertFirstAdminBootstrapToken(token);
      } catch (error) {
        return error as UnauthorizedException;
      }
      throw new Error('Expected bootstrap validation to fail');
    };

    expect(capture().getResponse()).toEqual(capture('wrong').getResponse());
    expect(capture().message).toBe('Invalid admin bootstrap token');
  });

  it('fails closed when the configured setup token is missing or weak', () => {
    expect(() =>
      createService(undefined).service.assertFirstAdminBootstrapToken(
        BOOTSTRAP_TOKEN
      )
    ).toThrow(UnauthorizedException);
    expect(() =>
      createService('too-short').service.assertFirstAdminBootstrapToken(
        'too-short'
      )
    ).toThrow(UnauthorizedException);
  });

  it('serializes administrator claims and grants the role only once', async () => {
    const { query, saved, service } = createService(BOOTSTRAP_TOKEN);

    await service.createUser({
      username: 'first',
      password: 'hash-1',
      isAdmin: true,
      adminBootstrapToken: BOOTSTRAP_TOKEN,
    });
    await service.createUser({
      username: 'second',
      password: 'hash-2',
      isAdmin: true,
      adminBootstrapToken: BOOTSTRAP_TOKEN,
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[0]?.[0])).toContain('pg_advisory_xact_lock');
    expect(saved.map(user => user.isAdmin)).toEqual([true, false]);
    expect(saved.every(user => !('adminBootstrapToken' in user))).toBe(true);
  });
});
