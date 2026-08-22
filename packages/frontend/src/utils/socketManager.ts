import type { Timer } from '@pomi/shared';
import {
  SOCKET_EVENTS,
  TIMER_STATUSES,
  TIMER_TYPES,
} from '@pomi/shared/src/constants';
import { Socket, io } from 'socket.io-client';
import { showToastFromStore } from '../components/toast/ToastContext';
import { useAuthStore } from '../stores/authStore';
import { getDebugLag } from '../stores/debugStore';
import { translateCurrent } from '../i18n';
import { getBackendSocketOrigin } from './backendUrl';
import { isMobile } from './osUtils';
import {
  getServerResponseState,
  startServerResponseWatch,
} from './serverResponseMonitor';
import { useUserActionQueueBase } from './userActionQueue';

let socket: Socket | null = null;
let socketInitialized = false;
let lastPongTime = 0;
const MAX_PENDING_FIRE_AND_FORGET_EVENTS = 50;

const closeSocket = () => {
  if (!socket) return;

  try {
    socket.removeAllListeners();
    socket.io.removeAllListeners();
    socket.disconnect();
  } catch {
    // Ignore errors from disconnecting a dead socket
  }
  socket = null;
};

type TimerActionError = Error & { reportedByTimerSocket?: boolean };

type PendingFireAndForgetEvent = {
  eventName: string;
  data?: unknown;
};

const pendingFireAndForgetEvents: PendingFireAndForgetEvent[] = [];

export const connectionState = {
  isConnected: false,
  isReconnecting: false,
  reconnectAttempts: 0,
  lastError: null as string | null,
};

type ConnectionStateListener = () => void;
const connectionStateListeners = new Set<ConnectionStateListener>();
type ReadyCallback = {
  run: (readySocket: Socket) => void;
  cancel: () => void;
};
const readyCallbacks = new Set<ReadyCallback>();

const isSocketReady = (
  candidate: Socket | null = socket
): candidate is Socket =>
  Boolean(
    candidate?.connected && candidate === socket && connectionState.isConnected
  );

const whenSocketReady = (
  callback: (readySocket: Socket) => void,
  onCancel: () => void
) => {
  if (isSocketReady()) {
    callback(socket as Socket);
    return () => undefined;
  }
  const entry = { run: callback, cancel: onCancel };
  readyCallbacks.add(entry);
  return () => {
    readyCallbacks.delete(entry);
  };
};

const cancelReadyCallbacks = () => {
  const callbacks = Array.from(readyCallbacks);
  readyCallbacks.clear();
  callbacks.forEach(callback => callback.cancel());
};

export const subscribeToConnectionState = (
  listener: ConnectionStateListener
) => {
  connectionStateListeners.add(listener);
  return () => {
    connectionStateListeners.delete(listener);
  };
};

const notifyConnectionStateListeners = () => {
  connectionStateListeners.forEach(listener => listener());
};

const queueFireAndForgetEvent = (eventName: string, data?: unknown) => {
  pendingFireAndForgetEvents.push({ eventName, data });

  if (pendingFireAndForgetEvents.length > MAX_PENDING_FIRE_AND_FORGET_EVENTS) {
    pendingFireAndForgetEvents.shift();
  }
};

const flushFireAndForgetEvents = (currentSocket: Socket) => {
  if (
    !isSocketReady(currentSocket) ||
    pendingFireAndForgetEvents.length === 0
  ) {
    return;
  }

  const eventsToFlush = pendingFireAndForgetEvents.splice(
    0,
    pendingFireAndForgetEvents.length
  );
  eventsToFlush.forEach(({ eventName, data }) => {
    currentSocket.emit(eventName, data);
  });
};

type SocketEventHandler = {
  event: string;
  handler: (...args: unknown[]) => Promise<void>;
};
const customEventHandlers: SocketEventHandler[] = [];
const pendingSocketHandlers = new Map<string, Set<Promise<void>>>();

export const registerSocketEventHandler = (
  event: string,
  handler: (...args: unknown[]) => void | Promise<void>
) => {
  const wrappedHandler = (...args: unknown[]) => {
    const pending = (async () => {
      const lag = getDebugLag();
      if (lag > 0) {
        await new Promise<void>(resolve => setTimeout(resolve, lag));
      }
      await handler(...args);
    })();
    const handlers = pendingSocketHandlers.get(event) ?? new Set();
    handlers.add(pending);
    pendingSocketHandlers.set(event, handlers);
    const cleanup = () => {
      handlers.delete(pending);
      if (handlers.size === 0) pendingSocketHandlers.delete(event);
    };
    void pending.then(cleanup, cleanup);
    return pending;
  };
  customEventHandlers.push({ event, handler: wrappedHandler });
  if (socket) {
    socket.on(event, wrappedHandler);
  }
};

const waitForPendingSocketHandlers = async (event: string) => {
  const handlers = pendingSocketHandlers.get(event);
  if (handlers) await Promise.all(handlers);
};

const dispatchSocketEvent = async (event: string, ...args: unknown[]) => {
  await Promise.all(
    customEventHandlers
      .filter(registration => registration.event === event)
      .map(registration => registration.handler(...args))
  );
};

const isAuthoritativeTimerResult = (value: unknown): value is Timer => {
  if (!value || typeof value !== 'object') return false;
  const timer = value as Partial<Timer>;
  return (
    typeof timer.id === 'string' &&
    typeof timer.startTime === 'number' &&
    typeof timer.duration === 'number' &&
    typeof timer.remainingTime === 'number' &&
    Object.values(TIMER_TYPES).includes(timer.type as Timer['type']) &&
    Object.values(TIMER_STATUSES).includes(timer.status as Timer['status'])
  );
};

const setupSocketListeners = (sock: Socket) => {
  const trackEnginePong = () => {
    sock.io.engine?.on('pong', () => {
      lastPongTime = Date.now();
    });
  };

  sock.on('connect', () => {
    connectionState.isConnected = false;
    lastPongTime = Date.now();
    notifyConnectionStateListeners();
  });

  sock.on(SOCKET_EVENTS.SERVER_READY, () => {
    if (!sock.connected) return;
    connectionState.isConnected = true;
    connectionState.isReconnecting = false;
    connectionState.reconnectAttempts = 0;
    connectionState.lastError = null;
    notifyConnectionStateListeners();
    flushFireAndForgetEvents(sock);
    const callbacks = Array.from(readyCallbacks);
    readyCallbacks.clear();
    callbacks.forEach(callback => callback.run(sock));
  });

  sock.on('connect_error', error => {
    connectionState.isConnected = false;
    connectionState.lastError = error.message;
    notifyConnectionStateListeners();
  });

  sock.on(SOCKET_EVENTS.SESSION_EXPIRED, () => {
    useAuthStore.getState().expireSession();
  });

  sock.on('disconnect', () => {
    connectionState.isConnected = false;
    notifyConnectionStateListeners();
  });

  sock.io.on('reconnect_attempt', attemptNumber => {
    connectionState.isReconnecting = true;
    connectionState.reconnectAttempts = attemptNumber;
    notifyConnectionStateListeners();
  });

  sock.io.on('reconnect_failed', () => {
    connectionState.isReconnecting = false;
    notifyConnectionStateListeners();
  });

  sock.io.on('reconnect', () => {
    connectionState.reconnectAttempts = 0;
    lastPongTime = Date.now();
  });

  sock.io.on('open', trackEnginePong);

  customEventHandlers.forEach(({ event, handler }) => {
    sock.on(event, handler);
  });
};

export const getOrCreateSocket = (): Socket | null => {
  const { token } = useAuthStore.getState();
  if (!token) {
    closeSocket();
    return null;
  }

  const socketToken = (socket?.auth as { token?: unknown } | undefined)?.token;

  // Reuse a socket that is still connecting or reconnecting. Recreating it on
  // every caller resets the handshake and can trap a healthy network in a loop.
  if (socket && socketToken === token) {
    return socket;
  }

  if (socket) {
    closeSocket();
  }

  socket = io(getBackendSocketOrigin(), {
    // Establish ordinary HTTPS polling first, then let Socket.IO upgrade to
    // WebSocket. This avoids waiting for a full WebSocket timeout on networks
    // and proxies that reject the upgrade while supporting healthy HTTPS.
    transports: ['polling', 'websocket'],
    tryAllTransports: true,
    path: '/socket.io',
    auth: { token },
    extraHeaders: {
      'user-agent-mobile': isMobile ? 'true' : 'false',
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 300,
    reconnectionDelayMax: 2000,
    randomizationFactor: 0.5,
    timeout: 10000,
    forceNew: true,
  });

  setupSocketListeners(socket);
  socketInitialized = true;
  lastPongTime = Date.now();

  return socket;
};

export const isSocketInitialized = () => socketInitialized;

export const isSocketConnected = () => isSocketReady();

export const isTimerErrorReported = (error: unknown) =>
  error instanceof Error &&
  (error as TimerActionError).reportedByTimerSocket === true;

let lastReconnectTime = 0;
const RECONNECT_DEBOUNCE_MS = 200;
const SERVER_ACK_TIMEOUT_MS = 5000;

const isConnectionStale = (): boolean => {
  if (!isSocketReady()) return true;
  const timeSinceLastPong = Date.now() - lastPongTime;
  return timeSinceLastPong > 30000;
};

export const forceReconnect = (skipIfConnected = false): Socket | null => {
  if (!useAuthStore.getState().token) {
    closeSocket();
    connectionState.isConnected = false;
    connectionState.isReconnecting = false;
    connectionState.reconnectAttempts = 0;
    connectionState.lastError = null;
    notifyConnectionStateListeners();
    return null;
  }

  if (skipIfConnected && isSocketReady() && !isConnectionStale()) {
    const readySocket = socket as Socket;
    readySocket.emit(SOCKET_EVENTS.GET_CURRENT_TIMER);
    return readySocket;
  }

  const now = Date.now();
  if (now - lastReconnectTime < RECONNECT_DEBOUNCE_MS) {
    if (socket) return socket;
  }
  lastReconnectTime = now;

  if (socket) {
    closeSocket();
  }

  connectionState.isConnected = false;
  connectionState.isReconnecting = true;
  connectionState.reconnectAttempts = 0;
  connectionState.lastError = null;
  notifyConnectionStateListeners();

  return getOrCreateSocket();
};

/**
 * Resolve after the timer socket has published a fresh authoritative state.
 * Gateway actions are completed over HTTP, while the existing timer store is
 * updated by the socket event. Waiting here prevents the next FIFO action from
 * reading stale timer state.
 */
export const waitForAuthoritativeTimer = async (
  result?: unknown
): Promise<void> => {
  // The lifecycle result is persisted only after execution finishes, so it is
  // already authoritative. Apply it without another socket round trip.
  if (result === null || isAuthoritativeTimerResult(result)) {
    await dispatchSocketEvent(SOCKET_EVENTS.TIMER_UPDATE, result);
    return;
  }

  const currentSocket = getOrCreateSocket();
  if (!currentSocket) return;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    let cancelReadyWait: () => void = () => undefined;
    const finishSuccess = async (event: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cancelReadyWait();
      currentSocket.off(SOCKET_EVENTS.TIMER_UPDATE, finishTimerSuccess);
      currentSocket.off(SOCKET_EVENTS.TIMER_ERROR, finishFailure);
      currentSocket.off(
        SOCKET_EVENTS.EXTENSION_STATE_UPDATE,
        finishExtensionSuccess
      );
      try {
        await waitForPendingSocketHandlers(event);
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    const finishTimerSuccess = () =>
      void finishSuccess(SOCKET_EVENTS.TIMER_UPDATE);
    const finishExtensionSuccess = () =>
      void finishSuccess(SOCKET_EVENTS.EXTENSION_STATE_UPDATE);
    const finishFailure = (data: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cancelReadyWait();
      currentSocket.off(SOCKET_EVENTS.TIMER_UPDATE, finishTimerSuccess);
      currentSocket.off(SOCKET_EVENTS.TIMER_ERROR, finishFailure);
      currentSocket.off(
        SOCKET_EVENTS.EXTENSION_STATE_UPDATE,
        finishExtensionSuccess
      );
      const message =
        data && typeof data === 'object' && 'message' in data
          ? String(
              (data as { message?: unknown }).message ??
                translateCurrent('timer.actionFailed')
            )
          : translateCurrent('timer.actionFailed');
      const error = new Error(message) as TimerActionError;
      error.reportedByTimerSocket = true;
      reject(error);
    };
    const finishTimeout = () => {
      if (settled) return;
      settled = true;
      cancelReadyWait();
      currentSocket.off(SOCKET_EVENTS.TIMER_UPDATE, finishTimerSuccess);
      currentSocket.off(SOCKET_EVENTS.TIMER_ERROR, finishFailure);
      currentSocket.off(
        SOCKET_EVENTS.EXTENSION_STATE_UPDATE,
        finishExtensionSuccess
      );
      resolve();
    };
    timeout = setTimeout(finishTimeout, SERVER_ACK_TIMEOUT_MS);

    currentSocket.once(SOCKET_EVENTS.TIMER_UPDATE, finishTimerSuccess);
    currentSocket.once(SOCKET_EVENTS.TIMER_ERROR, finishFailure);
    currentSocket.once(
      SOCKET_EVENTS.EXTENSION_STATE_UPDATE,
      finishExtensionSuccess
    );
    cancelReadyWait = whenSocketReady(readySocket => {
      readySocket.emit(SOCKET_EVENTS.GET_CURRENT_TIMER);
    }, finishTimeout);
  });
};

const USER_ACTION_SOCKET_EVENTS: Set<string> = new Set([
  SOCKET_EVENTS.CREATE_OR_RESUME_TIMER,
  SOCKET_EVENTS.REMOVE_FOCUSED_TASK,
  SOCKET_EVENTS.PAUSE_TIMER,
  SOCKET_EVENTS.RESET_TIMER,
  SOCKET_EVENTS.SKIP_TIMER,
  SOCKET_EVENTS.ADD_FIVE_MINUTES_TIMER,
  SOCKET_EVENTS.UNDO_TIMER_ACTION,
  SOCKET_EVENTS.REDO_TIMER_ACTION,
  SOCKET_EVENTS.STACK_TIMER,
  SOCKET_EVENTS.SET_SESSION_POSITION,
  SOCKET_EVENTS.RESOLVE_TIMER_EXTENSION,
  SOCKET_EVENTS.CLEAR_TIMER_HISTORY,
]);

const USER_ACTION_LABEL_KEY_BY_EVENT: Record<string, string> = {
  [SOCKET_EVENTS.CREATE_OR_RESUME_TIMER]: 'timer.startAction',
  [SOCKET_EVENTS.REMOVE_FOCUSED_TASK]: 'timer.removeFocusedTask',
  [SOCKET_EVENTS.PAUSE_TIMER]: 'timer.pause',
  [SOCKET_EVENTS.RESET_TIMER]: 'timer.reset',
  [SOCKET_EVENTS.SKIP_TIMER]: 'timer.skipTimer',
  [SOCKET_EVENTS.ADD_FIVE_MINUTES_TIMER]: 'timer.addFiveMinutesAction',
  [SOCKET_EVENTS.UNDO_TIMER_ACTION]: 'timer.undoAction',
  [SOCKET_EVENTS.REDO_TIMER_ACTION]: 'timer.redoAction',
  [SOCKET_EVENTS.STACK_TIMER]: 'timer.stackAction',
  [SOCKET_EVENTS.SET_SESSION_POSITION]: 'timer.setSessionPosition',
  [SOCKET_EVENTS.RESOLVE_TIMER_EXTENSION]: 'timer.resolveExtension',
  [SOCKET_EVENTS.CLEAR_TIMER_HISTORY]: 'timer.clearHistory',
};

export const emitSocketEventDirect = (eventName: string, data?: unknown) => {
  if (!useAuthStore.getState().token) return;

  const lag = getDebugLag();
  const stopWatchingServer = startServerResponseWatch();

  const emitWithAck = (currentSocket: Socket | null): boolean => {
    if (!isSocketReady(currentSocket)) {
      return false;
    }

    let completed = false;
    const finishWatchingServer = () => {
      if (completed) {
        return;
      }

      completed = true;
      currentSocket.off(SOCKET_EVENTS.TIMER_UPDATE, finishWatchingServer);
      currentSocket.off(SOCKET_EVENTS.TIMER_ERROR, finishWatchingServer);
      currentSocket.off(
        SOCKET_EVENTS.EXTENSION_STATE_UPDATE,
        finishWatchingServer
      );
      stopWatchingServer();
    };

    try {
      currentSocket.once(SOCKET_EVENTS.TIMER_UPDATE, finishWatchingServer);
      currentSocket.once(SOCKET_EVENTS.TIMER_ERROR, finishWatchingServer);
      currentSocket.once(
        SOCKET_EVENTS.EXTENSION_STATE_UPDATE,
        finishWatchingServer
      );

      currentSocket.timeout(SERVER_ACK_TIMEOUT_MS).emit(eventName, data, () => {
        finishWatchingServer();
      });
      return true;
    } catch {
      finishWatchingServer();
      return false;
    }
  };

  const doEmit = () => {
    const currentSocket = getOrCreateSocket();

    if (!currentSocket) {
      stopWatchingServer();
      return;
    }

    if (emitWithAck(currentSocket)) {
      return;
    }
    whenSocketReady(readySocket => {
      if (!emitWithAck(readySocket)) stopWatchingServer();
    }, stopWatchingServer);
  };

  if (lag > 0) {
    setTimeout(doEmit, lag);
  } else {
    doEmit();
  }
};

export const emitSocketEvent = (eventName: string, data?: unknown) => {
  if (USER_ACTION_SOCKET_EVENTS.has(eventName)) {
    void useUserActionQueueBase
      .getState()
      .enqueue({
        kind: eventName,
        label: translateCurrent(
          USER_ACTION_LABEL_KEY_BY_EVENT[eventName] ?? 'timer.action'
        ),
        payload: data,
        reconcile: waitForAuthoritativeTimer,
      })
      .catch(error => {
        const message =
          error instanceof Error
            ? error.message
            : translateCurrent('timer.actionFailed');
        if (!isTimerErrorReported(error)) {
          showToastFromStore(message, 'error');
        }
      });
    return;
  }

  emitSocketEventDirect(eventName, data);
};

export const emitSocketEventFireAndForget = (
  eventName: string,
  data?: unknown
) => {
  if (!useAuthStore.getState().token) {
    return;
  }

  const emit = () => {
    const currentSocket = getOrCreateSocket();

    if (isSocketReady(currentSocket)) {
      currentSocket.emit(eventName, data);
      return;
    }

    queueFireAndForgetEvent(eventName, data);
    forceReconnect();
  };

  emit();
};

export const getConnectionStatus = () => ({
  isConnected: connectionState.isConnected,
  isReconnecting: connectionState.isReconnecting,
  isWaitingForServer: getServerResponseState().isWaitingForServer,
  reconnectAttempts: connectionState.reconnectAttempts,
  lastError: connectionState.lastError,
});

useAuthStore.subscribe((state, prevState) => {
  if (state.token !== prevState.token) {
    pendingFireAndForgetEvents.splice(0, pendingFireAndForgetEvents.length);
    cancelReadyCallbacks();
  }

  if (state.token !== prevState.token && !state.token) {
    closeSocket();
    connectionState.isConnected = false;
    connectionState.isReconnecting = false;
    connectionState.reconnectAttempts = 0;
    connectionState.lastError = null;
    notifyConnectionStateListeners();
  } else if (state.token !== prevState.token && state.token) {
    getOrCreateSocket();
  }
});
