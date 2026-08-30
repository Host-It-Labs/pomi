import * as bcrypt from 'bcrypt';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../src/auth/auth.service';

describe('AuthService account language', () => {
  it('persists the requested language for a newly created account', async () => {
    const createdUser = {
      id: 'user-1',
      username: 'new-user',
      password: 'hashed-password',
      isAdmin: false,
      createdAt: new Date('2026-08-07T00:00:00.000Z'),
    };
    const preferences = {
      userId: createdUser.id,
      language: 'en' as const,
    };
    const getPreferences = vi.fn(async (_userId, language) => ({
      ...preferences,
      language: language ?? preferences.language,
    }));
    const service = new AuthService(
      {
        findUserByUsername: vi.fn(async () => null),
        countAdmins: vi.fn(async () => 0),
        createUser: vi.fn(async () => createdUser),
      } as never,
      { sign: vi.fn(() => 'token') } as never,
      {
        getPreferences,
      } as never,
      { isSelfHosted: vi.fn(() => false) } as never,
      {
        assertAuthenticationAllowed: vi.fn(),
        assertRegistrationAllowed: vi.fn(),
      } as never
    );

    const result = await service.authenticateUser(
      'new-user',
      'twelve chars',
      '127.0.0.1',
      'fr'
    );

    expect(getPreferences).toHaveBeenCalledWith('user-1', 'fr');
    expect(result).toMatchObject({
      isNewUser: true,
      language: 'fr',
      token: 'token',
    });
  });

  it('uses the stored language for an existing account', async () => {
    const password = await bcrypt.hash('password', 4);
    const getPreferences = vi.fn(async () => ({
      userId: 'user-2',
      language: 'ar',
    }));
    const service = new AuthService(
      {
        findUserByUsername: vi.fn(async () => ({
          id: 'user-2',
          username: 'existing-user',
          password,
          isAdmin: false,
          createdAt: new Date('2026-08-07T00:00:00.000Z'),
        })),
      } as never,
      { sign: vi.fn(() => 'token') } as never,
      { getPreferences } as never,
      { isSelfHosted: vi.fn(() => false) } as never,
      {
        assertAuthenticationAllowed: vi.fn(),
        assertRegistrationAllowed: vi.fn(),
      } as never
    );

    const result = await service.authenticateUser(
      'existing-user',
      'password',
      '127.0.0.1',
      'fr'
    );

    expect(result).toMatchObject({ isNewUser: false, language: 'ar' });
    expect(getPreferences).toHaveBeenCalledWith('user-2', 'fr');
  });
});
