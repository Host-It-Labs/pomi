import { describe, expect, it, vi } from 'vitest';
import { AuthController } from '../../src/auth/auth.controller';
import { AuthRateLimitException } from '../../src/auth/auth-rate-limit.exception';
import { AuthService } from '../../src/auth/auth.service';

describe('authentication abuse controls', () => {
  it('stops a bounded request before database or bcrypt work', async () => {
    const findUserByUsername = vi.fn();
    const service = new AuthService(
      { findUserByUsername } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        assertAuthenticationAllowed: vi.fn(async () => {
          throw new AuthRateLimitException(30);
        }),
      } as never
    );

    await expect(
      service.authenticateUser('user', 'password', '203.0.113.4')
    ).rejects.toBeInstanceOf(AuthRateLimitException);
    expect(findUserByUsername).not.toHaveBeenCalled();
  });

  it('checks registration capacity before creating an unknown account', async () => {
    const createUser = vi.fn();
    const service = new AuthService(
      { findUserByUsername: vi.fn(async () => null), createUser } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        assertAuthenticationAllowed: vi.fn(),
        assertRegistrationAllowed: vi.fn(async () => {
          throw new AuthRateLimitException(120);
        }),
      } as never
    );

    await expect(
      service.authenticateUser('new-user', 'twelve chars', '203.0.113.4')
    ).rejects.toBeInstanceOf(AuthRateLimitException);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('adds deterministic retry guidance to limited responses', async () => {
    const controller = new AuthController(
      {
        authenticateUser: vi.fn(async () => {
          throw new AuthRateLimitException(45);
        }),
      } as never,
      {} as never,
      {} as never
    );
    const setHeader = vi.fn();

    const handler = await controller.authenticate(
      { username: 'user', password: 'password' },
      { ip: '203.0.113.4', socket: {} } as never,
      { setHeader } as never
    );

    await expect((handler as () => Promise<unknown>)()).rejects.toBeInstanceOf(
      AuthRateLimitException
    );
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '45');
  });
});
