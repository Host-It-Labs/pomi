import { UnauthorizedException } from '@nestjs/common';
import { SOCKET_EVENTS } from '@pomi/shared';
import { describe, expect, it, vi } from 'vitest';
import { AuthGuard } from '../../src/auth/auth.guard';
import { TimerGateway } from '../../src/timer/timer.gateway';

function createExecutionContext(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

function createEventSource() {
  return { subscribe: () => undefined };
}

describe('stale-user authentication', () => {
  it('rejects a valid REST token for a deleted user', async () => {
    const request = { headers: { authorization: 'Bearer valid-token' } };
    const guard = new AuthGuard(
      { verifyAsync: async () => ({ sub: 'deleted-user' }) } as never,
      { userExists: async () => false } as never
    );

    await expect(
      guard.canActivate(createExecutionContext(request) as never)
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(request).not.toHaveProperty('user');
  });

  it('exposes the REST payload for an existing user', async () => {
    const payload = { sub: 'active-user' };
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer valid-token' },
    };
    const guard = new AuthGuard(
      { verifyAsync: async () => payload } as never,
      { userExists: async () => true } as never
    );

    await expect(
      guard.canActivate(createExecutionContext(request) as never)
    ).resolves.toBe(true);
    expect(request.user).toBe(payload);
  });

  it('disconnects a deleted socket user before loading user state', async () => {
    let hasPushTokenCalls = 0;
    let timerStateCalls = 0;
    let disconnectCalls = 0;
    const gateway = new TimerGateway(
      {
        onTimerUpdate: createEventSource(),
        onClientNotification: createEventSource(),
        onExtensionStateUpdate: createEventSource(),
        onTimerHistoryUpdate: createEventSource(),
        getTimerByUserId: async () => {
          timerStateCalls += 1;
          return null;
        },
      } as never,
      { verify: () => ({ sub: 'deleted-user' }) } as never,
      {
        findUserById: async () => null,
        hasPushToken: async () => {
          hasPushTokenCalls += 1;
          return false;
        },
      } as never,
      { onPreferencesUpdate: createEventSource() } as never,
      {
        onTasksUpdate: createEventSource(),
        onUserActionUpdate: createEventSource(),
      } as never
    );
    const client = {
      id: 'socket-1',
      handshake: { auth: { token: 'valid-token' }, headers: {} },
      disconnect: () => {
        disconnectCalls += 1;
      },
      emit: () => undefined,
    };

    await gateway.handleConnection(client as never);

    expect(disconnectCalls).toBe(1);
    expect(hasPushTokenCalls).toBe(0);
    expect(timerStateCalls).toBe(0);
  });

  it('rejects hosted socket access without an active subscription', async () => {
    let timerStateCalls = 0;
    let disconnectCalls = 0;
    const gateway = new TimerGateway(
      {
        onTimerUpdate: createEventSource(),
        onClientNotification: createEventSource(),
        onExtensionStateUpdate: createEventSource(),
        onTimerHistoryUpdate: createEventSource(),
        getTimerByUserId: async () => {
          timerStateCalls += 1;
          return null;
        },
      } as never,
      { verify: () => ({ sub: 'unpaid-user' }) } as never,
      {
        findUserById: async () => ({ id: 'unpaid-user' }),
      } as never,
      { onPreferencesUpdate: createEventSource() } as never,
      {
        onTasksUpdate: createEventSource(),
        onUserActionUpdate: createEventSource(),
      } as never,
      { hasProductAccess: async () => false } as never,
      { get: () => 'hosted' } as never
    );
    const client = {
      id: 'socket-unpaid',
      handshake: { auth: { token: 'valid-token' }, headers: {} },
      disconnect: () => {
        disconnectCalls += 1;
      },
      emit: () => undefined,
    };

    await gateway.handleConnection(client as never);

    expect(disconnectCalls).toBe(1);
    expect(timerStateCalls).toBe(0);
  });

  it('revalidates socket users before every message action', async () => {
    let userLookupCount = 0;
    let disconnectCalls = 0;
    let packetMiddleware:
      | ((packet: unknown[], next: (error?: Error) => void) => void)
      | undefined;
    const gateway = new TimerGateway(
      {
        onTimerUpdate: createEventSource(),
        onClientNotification: createEventSource(),
        onExtensionStateUpdate: createEventSource(),
        onTimerHistoryUpdate: createEventSource(),
        getTimerByUserId: async () => ({ id: 'timer-1' }),
        getExtensionState: async () => null,
        getTimerHistoryStatus: async () => ({
          canUndo: false,
          canRedo: false,
        }),
      } as never,
      { verify: () => ({ sub: 'active-user' }) } as never,
      {
        findUserById: async () => {
          userLookupCount += 1;
          return { id: 'active-user' };
        },
        userExists: async () => {
          userLookupCount += 1;
          return false;
        },
        hasPushToken: async () => true,
      } as never,
      { onPreferencesUpdate: createEventSource() } as never,
      {
        onTasksUpdate: createEventSource(),
        onUserActionUpdate: createEventSource(),
      } as never
    );
    const client = {
      id: 'socket-2',
      handshake: { auth: { token: 'valid-token' }, headers: {} },
      data: {},
      use: (middleware: typeof packetMiddleware) => {
        packetMiddleware = middleware;
      },
      join: () => undefined,
      disconnect: () => {
        disconnectCalls += 1;
      },
      emit: () => undefined,
    };

    await gateway.handleConnection(client as never);
    expect(packetMiddleware).toBeTypeOf('function');

    const middlewareError = await new Promise<Error | undefined>(resolve => {
      packetMiddleware?.(['pauseTimer'], error => resolve(error));
    });

    expect(middlewareError).toBeInstanceOf(UnauthorizedException);
    expect(userLookupCount).toBe(2);
    expect(disconnectCalls).toBe(1);
  });

  it('disconnects a socket when its token expires between messages', async () => {
    let verifyCalls = 0;
    let disconnectCalls = 0;
    let packetMiddleware:
      | ((packet: unknown[], next: (error?: Error) => void) => void)
      | undefined;
    const gateway = new TimerGateway(
      {
        onTimerUpdate: createEventSource(),
        onClientNotification: createEventSource(),
        onExtensionStateUpdate: createEventSource(),
        onTimerHistoryUpdate: createEventSource(),
        getTimerByUserId: async () => null,
        createOrResumeTimer: async () => null,
        getExtensionState: async () => null,
        getTimerHistoryStatus: async () => ({ canUndo: false, canRedo: false }),
      } as never,
      {
        verify: () => {
          verifyCalls += 1;
          if (verifyCalls > 1) throw new Error('jwt expired');
          return { sub: 'active-user' };
        },
      } as never,
      {
        findUserById: async () => ({ id: 'active-user' }),
        userExists: async () => true,
        hasPushToken: async () => false,
      } as never,
      { onPreferencesUpdate: createEventSource() } as never,
      {
        onTasksUpdate: createEventSource(),
        onUserActionUpdate: createEventSource(),
      } as never
    );
    const emittedEvents: unknown[][] = [];
    const client = {
      id: 'socket-expired',
      handshake: { auth: { token: 'valid-then-expired' }, headers: {} },
      data: {},
      use: (middleware: typeof packetMiddleware) => {
        packetMiddleware = middleware;
      },
      join: () => undefined,
      disconnect: () => {
        disconnectCalls += 1;
      },
      emit: (...event: unknown[]) => {
        emittedEvents.push(event);
      },
    };

    await gateway.handleConnection(client as never);
    const middlewareError = await new Promise<Error | undefined>(resolve => {
      packetMiddleware?.(['pauseTimer'], error => resolve(error));
    });

    expect(middlewareError).toEqual(
      new UnauthorizedException('Socket authorization failed')
    );
    expect(verifyCalls).toBe(2);
    expect(disconnectCalls).toBe(1);
    expect(emittedEvents).toContainEqual([
      SOCKET_EVENTS.SESSION_EXPIRED,
      { message: 'Your session has expired. Please sign in again.' },
    ]);
  });

  it('disconnects an idle socket when its JWT expires', async () => {
    vi.useFakeTimers();
    try {
      let disconnectCalls = 0;
      const emittedEvents: unknown[][] = [];
      const gateway = new TimerGateway(
        {
          onTimerUpdate: createEventSource(),
          onClientNotification: createEventSource(),
          onExtensionStateUpdate: createEventSource(),
          onTimerHistoryUpdate: createEventSource(),
          getTimerByUserId: async () => null,
          createOrResumeTimer: async () => null,
          getExtensionState: async () => null,
          getTimerHistoryStatus: async () => ({
            canUndo: false,
            canRedo: false,
          }),
        } as never,
        {
          verify: () => ({
            sub: 'active-user',
            exp: Math.ceil(Date.now() / 1000) + 1,
          }),
        } as never,
        {
          findUserById: async () => ({ id: 'active-user' }),
          hasPushToken: async () => false,
        } as never,
        { onPreferencesUpdate: createEventSource() } as never,
        {
          onTasksUpdate: createEventSource(),
          onUserActionUpdate: createEventSource(),
        } as never
      );
      const client = {
        id: 'idle-expired',
        handshake: { auth: { token: 'expiring-token' }, headers: {} },
        data: {},
        use: () => undefined,
        join: () => undefined,
        disconnect: () => {
          disconnectCalls += 1;
        },
        emit: (...event: unknown[]) => {
          emittedEvents.push(event);
        },
      };

      await gateway.handleConnection(client as never);
      await vi.advanceTimersByTimeAsync(2_000);

      expect(disconnectCalls).toBe(1);
      expect(emittedEvents).toContainEqual([
        SOCKET_EVENTS.SESSION_EXPIRED,
        { message: 'Your session has expired. Please sign in again.' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
