import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../src/auth/auth.service';

describe('hosted social authentication', () => {
  it('creates a normal Pomi session from a server-verified identity', async () => {
    const user = {
      id: 'user-1',
      username: 'focus-user',
      email: 'focus@example.com',
      password: '',
      isAdmin: false,
      createdAt: new Date('2026-08-11T00:00:00.000Z'),
    };
    const service = new AuthService(
      {} as never,
      { sign: vi.fn(() => 'pomi-token') } as never,
      { getPreferences: vi.fn(async () => ({ language: 'en' })) } as never,
      { isSelfHosted: vi.fn(() => false) } as never,
      {
        verify: vi.fn(async () => ({
          provider: 'google',
          subject: 'google-subject',
          email: user.email,
          emailVerified: true,
        })),
      } as never,
      { findOrCreate: vi.fn(async () => ({ user, isNewUser: true })) } as never
    );

    const result = await service.authenticateSocial({
      provider: 'google',
      identityToken: 'identity-token',
      state: 'acba9a4b-dc08-45a8-9db7-699fdb8eb8aa',
      nonce: '49f85a1d-0cf9-4ccd-b292-976b376801b9',
      language: 'en',
    });

    expect(result).toMatchObject({ token: 'pomi-token', isNewUser: true });
    expect(result.user).not.toHaveProperty('password');
  });
});
