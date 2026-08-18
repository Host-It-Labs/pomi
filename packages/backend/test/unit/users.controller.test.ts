import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { UsersController } from '../../src/users/users.controller';

function createUsersService() {
  return {
    getUserTimers: vi.fn().mockResolvedValue(['timer-1']),
    updatePushToken: vi.fn().mockResolvedValue(undefined),
    hasPushToken: vi.fn().mockResolvedValue(true),
  };
}

async function invokeHandler(result: unknown): Promise<unknown> {
  expect(result).toBeTypeOf('function');
  return await (result as () => Promise<unknown>)();
}

describe('UsersController account ownership', () => {
  it('denies timer access for another account before reading timers', async () => {
    const usersService = createUsersService();
    const controller = new UsersController(usersService as never);

    await expect(
      invokeHandler(
        await controller.getUserTimers('user-a', { userId: 'user-b' })
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(usersService.getUserTimers).not.toHaveBeenCalled();
  });

  it('denies push-token updates for another account before saving', async () => {
    const usersService = createUsersService();
    const controller = new UsersController(usersService as never);

    await expect(
      invokeHandler(
        await controller.updatePushToken(
          'user-a',
          { userId: 'user-b' },
          { token: 'token', platform: 'android' }
        )
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(usersService.updatePushToken).not.toHaveBeenCalled();
  });

  it('denies push-token presence checks for another account before reading', async () => {
    const usersService = createUsersService();
    const controller = new UsersController(usersService as never);

    await expect(
      invokeHandler(
        await controller.checkPushToken('user-a', { userId: 'user-b' })
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(usersService.hasPushToken).not.toHaveBeenCalled();
  });

  it('preserves self-service access for all account-scoped routes', async () => {
    const usersService = createUsersService();
    const controller = new UsersController(usersService as never);

    await expect(
      invokeHandler(
        await controller.getUserTimers('user-a', { userId: 'user-a' })
      )
    ).resolves.toEqual({ status: 200, body: ['timer-1'] });
    await expect(
      invokeHandler(
        await controller.updatePushToken(
          'user-a',
          { userId: 'user-a' },
          { token: 'token', platform: 'android' }
        )
      )
    ).resolves.toEqual({ status: 200, body: { success: true } });
    await expect(
      invokeHandler(
        await controller.checkPushToken('user-a', { userId: 'user-a' })
      )
    ).resolves.toEqual({ status: 200, body: { hasToken: true } });

    expect(usersService.getUserTimers).toHaveBeenCalledWith('user-a');
    expect(usersService.updatePushToken).toHaveBeenCalledWith(
      'user-a',
      'token',
      'android'
    );
    expect(usersService.hasPushToken).toHaveBeenCalledWith('user-a');
  });
});
