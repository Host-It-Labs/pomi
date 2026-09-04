import { SOCKET_EVENTS } from '@pomi/shared';
import { describe, expect, it, vi } from 'vitest';
import { TimerGateway } from '../../src/timer/timer.gateway';
import { createSessionServiceStub } from './auth-session-test-stubs';

function eventSource<T>() {
  let subscriber: ((value: T) => void) | null = null;
  return {
    source: {
      subscribe: (next: (value: T) => void) => {
        subscriber = next;
      },
    },
    next: (value: T) => subscriber?.(value),
  };
}

function createGateway(currentTimer: object | null = { id: 'timer-1' }) {
  const timerUpdate = eventSource<{ userId: string; timer: object }>();
  const clientNotification = eventSource<never>();
  const extensionUpdate = eventSource<never>();
  const historyUpdate = eventSource<never>();
  const preferencesUpdate = eventSource<{
    userId: string;
    preferences: object;
  }>();
  const tasksUpdate = eventSource<{ userId: string }>();
  const actionUpdate = eventSource<{ userId: string; status: object }>();
  const getTimerByUserId = vi.fn(async () => currentTimer);
  const createOrResumeTimer = vi.fn(async () => ({ id: 'timer-created' }));
  const getTimerHistoryStatus = vi.fn(async () => ({
    canUndo: false,
    canRedo: false,
  }));
  const legacyHasPushToken = vi.fn(async () => true);
  const findUserById = vi.fn(async () => ({
    id: 'user-1',
    fcmToken: 'push-token',
  }));
  const gateway = new TimerGateway(
    {
      onTimerUpdate: timerUpdate.source,
      onClientNotification: clientNotification.source,
      onExtensionStateUpdate: extensionUpdate.source,
      onTimerHistoryUpdate: historyUpdate.source,
      getTimerByUserId,
      createOrResumeTimer,
      getExtensionState: async () => null,
      getTimerHistoryStatus,
    } as never,
    { verify: () => ({ sub: 'user-1' }) } as never,
    {
      findUserById,
      userExists: async () => true,
      hasPushToken: legacyHasPushToken,
    } as never,
    createSessionServiceStub(),
    { onPreferencesUpdate: preferencesUpdate.source } as never,
    {
      onTasksUpdate: tasksUpdate.source,
      onUserActionUpdate: actionUpdate.source,
    } as never
  );
  return {
    actionUpdate,
    createOrResumeTimer,
    gateway,
    getTimerByUserId,
    getTimerHistoryStatus,
    findUserById,
    legacyHasPushToken,
    preferencesUpdate,
    tasksUpdate,
    timerUpdate,
  };
}

describe('TimerGateway multi-instance fanout', () => {
  it('rejects a missing token without logging socket or account identifiers', async () => {
    const { gateway, findUserById } = createGateway();
    const logger = (
      gateway as never as {
        logger: { warn: ReturnType<typeof vi.fn> };
      }
    ).logger;
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const emit = vi.fn();
    const client = {
      id: 'sensitive-socket-id',
      handshake: { auth: {}, headers: {} },
      data: {},
      disconnect: vi.fn(),
      emit,
    };

    await gateway.handleConnection(client as never);

    expect(findUserById).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'Socket connection rejected: authentication failed'
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(client.id);
    expect(emit).toHaveBeenCalledWith(SOCKET_EVENTS.SESSION_EXPIRED, {
      message: 'Your session has expired. Please sign in again.',
    });
  });

  it('joins authenticated sockets to user and device rooms', async () => {
    const { gateway, legacyHasPushToken, tasksUpdate } = createGateway();
    const join = vi.fn();
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const client = {
      id: 'socket-1',
      handshake: {
        auth: { token: 'valid-token' },
        headers: { 'user-agent-mobile': 'true' },
      },
      data: {},
      nsp: { to },
      use: vi.fn(),
      join,
      disconnect: vi.fn(),
      emit: vi.fn(),
    };

    await gateway.handleConnection(client as never);

    expect(join).toHaveBeenCalledWith(['user:user-1', 'user:user-1:mobile']);
    expect(legacyHasPushToken).not.toHaveBeenCalled();

    tasksUpdate.next({ userId: 'user-1' });
    expect(to).toHaveBeenCalledWith('user:user-1');
    expect(emit).toHaveBeenCalledWith(SOCKET_EVENTS.TASKS_UPDATE);
  });

  it('uses the created Timer directly instead of reading it again', async () => {
    const {
      createOrResumeTimer,
      gateway,
      getTimerByUserId,
      getTimerHistoryStatus,
    } = createGateway(null);
    const emit = vi.fn();
    const client = {
      id: 'socket-1',
      handshake: {
        auth: { token: 'valid-token' },
        headers: { 'user-agent-mobile': 'true' },
      },
      data: {},
      use: vi.fn(),
      join: vi.fn(),
      disconnect: vi.fn(),
      emit,
    };

    await gateway.handleConnection(client as never);

    expect(getTimerByUserId).toHaveBeenCalledOnce();
    expect(createOrResumeTimer).toHaveBeenCalledOnce();
    expect(getTimerHistoryStatus).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(SOCKET_EVENTS.TIMER_UPDATE, {
      id: 'timer-created',
    });
  });

  it('reports user lookup failures as errors instead of authentication warnings', async () => {
    const { gateway, findUserById } = createGateway();
    const lookupError = new Error('database unavailable');
    findUserById.mockRejectedValueOnce(lookupError);
    const logger = (
      gateway as never as { logger: { error: ReturnType<typeof vi.fn> } }
    ).logger;
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const client = {
      id: 'socket-1',
      handshake: { auth: { token: 'valid-token' }, headers: {} },
      data: {},
      disconnect: vi.fn(),
    };

    await gateway.handleConnection(client as never);

    expect(error).toHaveBeenCalledWith(lookupError, undefined, 'TimerGateway');
    expect(warn).not.toHaveBeenCalledWith(
      'Socket connection rejected: authentication failed'
    );
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it('reports transient database lookup failures as retryable warnings', async () => {
    const { gateway, findUserById } = createGateway();
    const lookupError = Object.assign(new Error('getaddrinfo ENOTFOUND db'), {
      code: 'ENOTFOUND',
    });
    findUserById.mockRejectedValueOnce(lookupError);
    const logger = (
      gateway as never as {
        logger: {
          error: ReturnType<typeof vi.fn>;
          warn: ReturnType<typeof vi.fn>;
        };
      }
    ).logger;
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const client = {
      id: 'socket-1',
      handshake: { auth: { token: 'valid-token' }, headers: {} },
      data: {},
      disconnect: vi.fn(),
    };

    await gateway.handleConnection(client as never);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ENOTFOUND'));
    expect(error).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it('reports post-auth timer initialization failures as errors', async () => {
    const { gateway, getTimerByUserId } = createGateway();
    const initializationError = new Error('redis unavailable');
    getTimerByUserId.mockRejectedValueOnce(initializationError);
    const logger = (
      gateway as never as { logger: { error: ReturnType<typeof vi.fn> } }
    ).logger;
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const client = {
      id: 'socket-1',
      handshake: { auth: { token: 'valid-token' }, headers: {} },
      data: {},
      nsp: {},
      use: vi.fn(),
      join: vi.fn(),
      disconnect: vi.fn(),
      emit: vi.fn(),
    };

    await gateway.handleConnection(client as never);

    expect(error).toHaveBeenCalledWith(
      initializationError,
      undefined,
      'TimerGateway'
    );
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it('keeps routing through a namespace while another user socket remains', async () => {
    const { gateway, tasksUpdate } = createGateway();
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const rooms = new Map([['user:user-1', new Set(['socket-remaining'])]]);
    const namespace = { adapter: { rooms }, to };
    const client = {
      id: 'socket-disconnecting',
      handshake: {
        auth: { token: 'valid-token' },
        headers: { 'user-agent-mobile': 'false' },
      },
      data: {},
      nsp: namespace,
      use: vi.fn(),
      join: vi.fn(),
      disconnect: vi.fn(),
      emit: vi.fn(),
    };

    await gateway.handleConnection(client as never);
    gateway.handleDisconnect(client as never);
    tasksUpdate.next({ userId: 'user-1' });

    expect(to).toHaveBeenCalledWith('user:user-1');
    expect(emit).toHaveBeenCalledWith(SOCKET_EVENTS.TASKS_UPDATE);
  });

  it('broadcasts domain updates through Redis-compatible user rooms', () => {
    const {
      actionUpdate,
      gateway,
      preferencesUpdate,
      tasksUpdate,
      timerUpdate,
    } = createGateway();
    const emissions: Array<{ room: string; event: string; payload: unknown }> =
      [];
    gateway.server = {
      to: (room: string) => ({
        emit: (event: string, payload?: unknown) => {
          emissions.push({ room, event, payload });
        },
      }),
    } as never;

    timerUpdate.next({ userId: 'user-1', timer: { id: 'timer-1' } });
    preferencesUpdate.next({
      userId: 'user-1',
      preferences: { tasksExtension: true },
    });
    tasksUpdate.next({ userId: 'user-1' });
    actionUpdate.next({
      userId: 'user-1',
      status: { actionId: 'action-1', status: 'succeeded' },
    });

    expect(emissions.map(({ room, event }) => ({ room, event }))).toEqual([
      { room: 'user:user-1', event: SOCKET_EVENTS.TIMER_UPDATE },
      { room: 'user:user-1', event: SOCKET_EVENTS.PREFERENCES_UPDATE },
      { room: 'user:user-1', event: SOCKET_EVENTS.TASKS_UPDATE },
      { room: 'user:user-1', event: SOCKET_EVENTS.USER_ACTION_UPDATE },
    ]);
  });
});
