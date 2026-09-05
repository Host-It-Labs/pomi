import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../src/auth/auth.service';

describe('AuthService refresh', () => {
  it('loads account dependencies before rotating the refresh credential', async () => {
    const order: string[] = [];
    const user = {
      id: 'user-1',
      username: 'member',
      password: 'hashed',
      isAdmin: false,
      createdAt: new Date(),
    };
    const service = new AuthService(
      {
        findUserById: vi.fn(async () => {
          order.push('user');
          return user;
        }),
      } as never,
      { sign: vi.fn(() => 'access-token') } as never,
      {
        getPreferences: vi.fn(async () => {
          order.push('preferences');
          return { language: 'en' };
        }),
      } as never,
      {} as never,
      {} as never,
      {
        getRefreshSessionUserId: vi.fn(async () => {
          order.push('inspect');
          return user.id;
        }),
        refreshSession: vi.fn(async () => {
          order.push('rotate');
          return { sessionId: 'session-1', refreshToken: 'replacement' };
        }),
      } as never
    );

    const result = await service.refreshSession('presented-refresh-token');

    expect(order).toEqual(['inspect', 'user', 'preferences', 'rotate']);
    expect(result).toMatchObject({
      token: 'access-token',
      refreshToken: 'replacement',
    });
  });

  it('does not rotate when account dependencies cannot be loaded', async () => {
    const refreshSession = vi.fn();
    const service = new AuthService(
      { findUserById: vi.fn(async () => ({ id: 'user-1' })) } as never,
      {} as never,
      {
        getPreferences: vi.fn(async () => {
          throw new Error('preferences unavailable');
        }),
      } as never,
      {} as never,
      {} as never,
      {
        getRefreshSessionUserId: vi.fn(async () => 'user-1'),
        refreshSession,
      } as never
    );

    await expect(
      service.refreshSession('presented-refresh-token')
    ).rejects.toThrow('preferences unavailable');
    expect(refreshSession).not.toHaveBeenCalled();
  });
});
