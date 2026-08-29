import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../src/auth/auth.service';

describe('new account password policy', () => {
  it('rejects short passwords before creating an unknown account', async () => {
    const createUser = vi.fn();
    const assertRegistrationAllowed = vi.fn();
    const service = new AuthService(
      {
        findUserByUsername: vi.fn(async () => null),
        createUser,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        assertAuthenticationAllowed: vi.fn(),
        assertRegistrationAllowed,
      } as never
    );

    await expect(
      service.authenticateUser('new-user', 'too-short', '203.0.113.4')
    ).rejects.toThrow(
      new BadRequestException(
        'Password must be at least 12 characters and contain a non-whitespace character'
      )
    );
    expect(assertRegistrationAllowed).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  it('counts Unicode code points instead of UTF-16 code units', async () => {
    const createUser = vi.fn();
    const service = new AuthService(
      {
        findUserByUsername: vi.fn(async () => null),
        createUser,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        assertAuthenticationAllowed: vi.fn(),
        assertRegistrationAllowed: vi.fn(),
      } as never
    );

    await expect(
      service.authenticateUser('new-user', '😀'.repeat(6), '203.0.113.4')
    ).rejects.toThrow(
      new BadRequestException(
        'Password must be at least 12 characters and contain a non-whitespace character'
      )
    );
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only passwords even when they meet the length', async () => {
    const service = new AuthService(
      { findUserByUsername: vi.fn(async () => null) } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        assertAuthenticationAllowed: vi.fn(),
        assertRegistrationAllowed: vi.fn(),
      } as never
    );

    await expect(
      service.authenticateUser('new-user', ' '.repeat(12), '203.0.113.4')
    ).rejects.toThrow(
      'Password must be at least 12 characters and contain a non-whitespace character'
    );
  });

  it('allows a simple twelve-character passphrase for a new account', async () => {
    const createdUser = {
      id: 'user-1',
      username: 'new-user',
      password: 'hashed-password',
      isAdmin: false,
      createdAt: new Date('2026-08-29T00:00:00.000Z'),
    };
    const createUser = vi.fn(async () => createdUser);
    const service = new AuthService(
      {
        findUserByUsername: vi.fn(async () => null),
        countAdmins: vi.fn(async () => 0),
        createUser,
      } as never,
      { sign: vi.fn(() => 'token') } as never,
      {
        getPreferences: vi.fn(async () => ({
          userId: createdUser.id,
          language: 'en' as const,
        })),
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
      '203.0.113.4'
    );

    expect(result).toMatchObject({ isNewUser: true, token: 'token' });
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'new-user' })
    );
  });

  it('keeps existing accounts usable with shorter legacy passwords', async () => {
    const password = await bcrypt.hash('short', 4);
    const service = new AuthService(
      {
        findUserByUsername: vi.fn(async () => ({
          id: 'user-2',
          username: 'legacy-user',
          password,
          isAdmin: false,
          createdAt: new Date('2026-08-29T00:00:00.000Z'),
        })),
      } as never,
      { sign: vi.fn(() => 'token') } as never,
      {
        getPreferences: vi.fn(async () => ({
          userId: 'user-2',
          language: 'en' as const,
        })),
      } as never,
      {} as never,
      {
        assertAuthenticationAllowed: vi.fn(),
        assertRegistrationAllowed: vi.fn(),
      } as never
    );

    const result = await service.authenticateUser(
      'legacy-user',
      'short',
      '203.0.113.4'
    );

    expect(result).toMatchObject({ isNewUser: false, token: 'token' });
  });
});
