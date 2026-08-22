import { SOCKET_EVENTS } from '@pomi/shared/src/constants';
import { io } from 'socket.io-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const socketHarness = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const managerHandlers = new Map<string, (...args: unknown[]) => void>();
  const engineHandlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    connected: false,
    auth: { token: 'test-token' },
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return socket;
    }),
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return socket;
    }),
    off: vi.fn(),
    emit: vi.fn(),
    timeout: vi.fn(() => socket),
    removeAllListeners: vi.fn(),
    disconnect: vi.fn(),
    io: {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        managerHandlers.set(event, handler);
      }),
      removeAllListeners: vi.fn(),
      engine: {
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          engineHandlers.set(event, handler);
        }),
      },
    },
  };
  return { engineHandlers, handlers, managerHandlers, socket };
});

const actionQueue = vi.hoisted(() => ({
  isNetworkBlocked: false,
  retry: vi.fn(),
  enqueue: vi.fn(),
}));
const billing = vi.hoisted(() => ({
  reset: vi.fn(),
  loadEntitlement: vi.fn(async () => null),
}));

const auth = vi.hoisted(() => ({
  token: 'test-token' as string | null,
  expireSession: vi.fn(),
  subscriber: undefined as
    | ((
        state: { token: string | null },
        previousState: { token: string | null }
      ) => void)
    | undefined,
}));
const debug = vi.hoisted(() => ({ lag: 0 }));
const serverMonitor = vi.hoisted(() => ({ stop: vi.fn() }));

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => socketHarness.socket),
}));
vi.mock('../components/toast/ToastContext', () => ({
  showToastFromStore: vi.fn(),
}));
vi.mock('../stores/authStore', () => ({
  useAuthStore: {
    getState: () => auth,
    subscribe: (
      subscriber: (
        state: { token: string | null },
        previousState: { token: string | null }
      ) => void
    ) => {
      auth.subscriber = subscriber;
      return vi.fn();
    },
  },
}));
vi.mock('../stores/billingStore', () => ({
  useBillingStoreBase: { getState: () => billing },
}));
vi.mock('../stores/debugStore', () => ({ getDebugLag: () => debug.lag }));
vi.mock('./backendUrl', () => ({
  getBackendSocketOrigin: () => 'http://backend.test',
}));
vi.mock('./osUtils', () => ({ isMobile: false }));
vi.mock('./serverResponseMonitor', () => ({
  getServerResponseState: () => ({ isWaitingForServer: false }),
  startServerResponseWatch: () => serverMonitor.stop,
}));
vi.mock('./userActionQueue', () => ({
  useUserActionQueueBase: { getState: () => actionQueue },
}));

beforeEach(() => {
  vi.resetModules();
  socketHarness.handlers.clear();
  socketHarness.managerHandlers.clear();
  socketHarness.engineHandlers.clear();
  socketHarness.socket.connected = false;
  socketHarness.socket.auth = { token: 'test-token' };
  socketHarness.socket.on.mockClear();
  socketHarness.socket.once.mockClear();
  socketHarness.socket.off.mockClear();
  socketHarness.socket.emit.mockClear();
  socketHarness.socket.timeout.mockClear();
  socketHarness.socket.removeAllListeners.mockClear();
  socketHarness.socket.disconnect.mockClear();
  socketHarness.socket.io.on.mockClear();
  socketHarness.socket.io.removeAllListeners.mockClear();
  socketHarness.socket.io.engine.on.mockClear();
  vi.mocked(io).mockClear();
  actionQueue.isNetworkBlocked = false;
  actionQueue.retry.mockReset();
  actionQueue.enqueue.mockReset();
  billing.reset.mockReset();
  billing.loadEntitlement.mockReset();
  auth.token = 'test-token';
  auth.expireSession.mockReset();
  auth.subscriber = undefined;
  debug.lag = 0;
  serverMonitor.stop.mockReset();
});

describe('socket manager reconnect contracts', () => {
  it('reuses an in-progress socket and configures transport fallback', async () => {
    const { getOrCreateSocket } = await import('./socketManager');

    const first = getOrCreateSocket();
    const second = getOrCreateSocket();

    expect(second).toBe(first);
    expect(io).toHaveBeenCalledOnce();
    expect(io).toHaveBeenCalledWith(
      'http://backend.test',
      expect.objectContaining({
        transports: ['polling', 'websocket'],
        tryAllTransports: true,
        randomizationFactor: 0.5,
        timeout: 10000,
      })
    );
  });

  it('disconnects the socket when the authenticated token is cleared', async () => {
    const { getOrCreateSocket } = await import('./socketManager');

    getOrCreateSocket();
    auth.token = null;
    auth.subscriber?.({ token: null }, { token: 'test-token' });

    expect(socketHarness.socket.disconnect).toHaveBeenCalledOnce();
    expect(io).toHaveBeenCalledOnce();
  });

  it('expires the session only for the server authentication event', async () => {
    const { getOrCreateSocket } = await import('./socketManager');

    getOrCreateSocket();
    socketHarness.handlers.get(SOCKET_EVENTS.SESSION_EXPIRED)?.();
    expect(auth.expireSession).toHaveBeenCalledOnce();

    auth.expireSession.mockReset();
    socketHarness.handlers.get('connect_error')?.(new Error('network down'));
    expect(auth.expireSession).not.toHaveBeenCalled();
  });

  it('refreshes billing without expiring identity for entitlement events', async () => {
    const { getOrCreateSocket } = await import('./socketManager');

    getOrCreateSocket();
    socketHarness.handlers.get(SOCKET_EVENTS.ENTITLEMENT_REQUIRED)?.();

    expect(billing.reset).toHaveBeenCalledOnce();
    expect(billing.loadEntitlement).toHaveBeenCalledOnce();
    expect(auth.expireSession).not.toHaveBeenCalled();
  });

  it('does not preempt the HTTP retry backoff after socket connection', async () => {
    actionQueue.isNetworkBlocked = true;
    const { getOrCreateSocket } = await import('./socketManager');

    getOrCreateSocket();
    expect(actionQueue.retry).not.toHaveBeenCalled();

    socketHarness.socket.connected = true;
    socketHarness.handlers.get('connect')?.();

    expect(actionQueue.retry).not.toHaveBeenCalled();
  });

  it('flushes offline fire-and-forget events in original order on reconnect', async () => {
    const { emitSocketEventFireAndForget } = await import('./socketManager');

    emitSocketEventFireAndForget('first-event', { sequence: 1 });
    emitSocketEventFireAndForget('second-event', { sequence: 2 });
    expect(socketHarness.socket.emit).not.toHaveBeenCalled();

    socketHarness.socket.connected = true;
    socketHarness.handlers.get('connect')?.();
    expect(socketHarness.socket.emit).not.toHaveBeenCalled();
    socketHarness.handlers.get(SOCKET_EVENTS.SERVER_READY)?.();

    expect(socketHarness.socket.emit.mock.calls).toEqual([
      ['first-event', { sequence: 1 }],
      ['second-event', { sequence: 2 }],
    ]);
  });

  it('waits for fresh authoritative Timer state after reconnect', async () => {
    socketHarness.socket.connected = true;
    const { waitForAuthoritativeTimer } = await import('./socketManager');

    const pending = waitForAuthoritativeTimer();
    expect(socketHarness.socket.emit).not.toHaveBeenCalled();
    socketHarness.handlers.get(SOCKET_EVENTS.SERVER_READY)?.();
    expect(socketHarness.socket.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.GET_CURRENT_TIMER
    );

    socketHarness.handlers.get(SOCKET_EVENTS.TIMER_UPDATE)?.({
      status: 'running',
    });
    await expect(pending).resolves.toBeUndefined();
  });

  it('waits for delayed handlers after a socket round trip', async () => {
    vi.useFakeTimers();
    debug.lag = 250;
    socketHarness.socket.connected = true;
    const {
      getOrCreateSocket,
      registerSocketEventHandler,
      waitForAuthoritativeTimer,
    } = await import('./socketManager');
    const onTimerUpdate = vi.fn();
    getOrCreateSocket();
    registerSocketEventHandler(SOCKET_EVENTS.TIMER_UPDATE, onTimerUpdate);
    const delayedHandler = socketHarness.handlers.get(
      SOCKET_EVENTS.TIMER_UPDATE
    )!;
    const pending = waitForAuthoritativeTimer();
    const completionHandler = socketHarness.handlers.get(
      SOCKET_EVENTS.TIMER_UPDATE
    )!;
    const result = { status: 'running' };

    void delayedHandler(result);
    completionHandler(result);
    await vi.advanceTimersByTimeAsync(249);
    expect(onTimerUpdate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(onTimerUpdate).toHaveBeenCalledWith(result);
    vi.useRealTimers();
  });

  it('does not replay a queued readiness action after the account changes', async () => {
    vi.useFakeTimers();
    socketHarness.socket.connected = true;
    const { waitForAuthoritativeTimer } = await import('./socketManager');
    const pending = waitForAuthoritativeTimer();

    auth.token = 'replacement-token';
    auth.subscriber?.({ token: 'replacement-token' }, { token: 'test-token' });
    socketHarness.socket.connected = true;
    socketHarness.handlers.get(SOCKET_EVENTS.SERVER_READY)?.();

    expect(socketHarness.socket.emit).not.toHaveBeenCalledWith(
      SOCKET_EVENTS.GET_CURRENT_TIMER
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await pending;
    vi.useRealTimers();
  });

  it('stops a queued direct-event watch when the account changes', async () => {
    const { emitSocketEventDirect } = await import('./socketManager');
    emitSocketEventDirect(SOCKET_EVENTS.GET_CURRENT_TIMER);
    expect(serverMonitor.stop).not.toHaveBeenCalled();

    auth.token = 'replacement-token';
    auth.subscriber?.({ token: 'replacement-token' }, { token: 'test-token' });

    expect(serverMonitor.stop).toHaveBeenCalledOnce();
    socketHarness.socket.connected = true;
    socketHarness.handlers.get(SOCKET_EVENTS.SERVER_READY)?.();
    expect(socketHarness.socket.emit).not.toHaveBeenCalledWith(
      SOCKET_EVENTS.GET_CURRENT_TIMER,
      undefined
    );
  });

  it('applies an authoritative action result without a second socket round trip', async () => {
    const { registerSocketEventHandler, waitForAuthoritativeTimer } =
      await import('./socketManager');
    const onTimerUpdate = vi.fn();
    registerSocketEventHandler(SOCKET_EVENTS.TIMER_UPDATE, onTimerUpdate);
    const result = {
      id: 'timer-1',
      startTime: 100,
      duration: 1_500_000,
      remainingTime: 1_400_000,
      type: 'work',
      status: 'running',
    };

    await waitForAuthoritativeTimer(result);

    expect(onTimerUpdate).toHaveBeenCalledWith(result);
    expect(socketHarness.socket.emit).not.toHaveBeenCalled();
    expect(io).not.toHaveBeenCalled();
  });

  it('waits for debug lag before completing an authoritative action result', async () => {
    vi.useFakeTimers();
    debug.lag = 250;
    const { registerSocketEventHandler, waitForAuthoritativeTimer } =
      await import('./socketManager');
    const onTimerUpdate = vi.fn();
    registerSocketEventHandler(SOCKET_EVENTS.TIMER_UPDATE, onTimerUpdate);
    const result = {
      id: 'timer-delayed',
      startTime: 100,
      duration: 1_500_000,
      remainingTime: 1_400_000,
      type: 'work',
      status: 'running',
    };

    const pending = waitForAuthoritativeTimer(result);
    expect(onTimerUpdate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(249);
    expect(onTimerUpdate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(onTimerUpdate).toHaveBeenCalledWith(result);
    vi.useRealTimers();
  });

  it('submits timer actions with readable queue labels', async () => {
    actionQueue.enqueue.mockResolvedValue({ status: 'succeeded' });
    const { emitSocketEvent } = await import('./socketManager');

    emitSocketEvent(SOCKET_EVENTS.ADD_FIVE_MINUTES_TIMER);
    await Promise.resolve();

    expect(actionQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: SOCKET_EVENTS.ADD_FIVE_MINUTES_TIMER,
        label: 'Add 5 minutes',
      })
    );
  });
});
