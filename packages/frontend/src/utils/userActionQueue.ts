import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import * as Sentry from '@sentry/react';
import { useAuthStore } from '../stores/authStore';
import { createSelectors } from '../stores/createSelectors';
import { getDebugLag } from '../stores/debugStore';
import { translateCurrent } from '../i18n';
import { getBackendOrigin } from './backendUrl';
import {
  forceReconnect,
  registerSocketEventHandler,
  waitForAuthoritativeTimer,
} from './socketManager';
import type { RecoverableUserActionStatus } from '@pomi/shared';
import { apiClient } from './apiClient';
import { requestListRefresh } from './listRefresh';
import {
  requestIntentionRefresh,
  requestWorkTimerLogRefresh,
} from './recoveryRefresh';

/** Lifecycle states exposed by the accepted-action gateway. */
export type UserActionStatus =
  | 'queued'
  | 'submitting'
  | 'accepted'
  | 'running'
  | 'reconciling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'outcomeUnknown';

export type UserActionLifecycle = {
  id: string;
  status: UserActionStatus;
  kind: string;
  label: string;
  payload?: unknown;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type SubmitUserMutationOptions = {
  id?: string;
  kind: string;
  label: string;
  payload?: unknown;
  /** Refetch/apply authoritative domain state before the next queued action. */
  reconcile?: (result: unknown) => Promise<void>;
  /** Response status used when the gateway result contains only a domain body. */
  successStatus?: number;
};

type QueueItem = UserActionLifecycle & {
  reconcile?: (result: unknown) => Promise<void>;
  resolve: (value: UserActionLifecycle) => void;
  reject: (error: unknown) => void;
  successStatus?: number;
  cancellationRequested?: boolean;
  abortController?: AbortController;
  settled?: boolean;
  enqueuedAtMs: number;
  firstSubmitStartedAtMs?: number;
  lastSubmitStartedAtMs?: number;
  firstReceiptReceivedAtMs?: number;
  lastReceiptReceivedAtMs?: number;
  terminalReceivedAtMs?: number;
  reconcileStartedAtMs?: number;
  reconcileFinishedAtMs?: number;
  submitAttempts: number;
  pollAttempts: number;
  submitFailures: number;
  pollFailures: number;
  scheduledRetryWaitMs: number;
  networkBlockReported?: boolean;
  terminalSource?: 'receipt' | 'socket' | 'poll' | 'cancel';
  timingReported?: boolean;
  restored?: boolean;
  recoveryAction?: RecoverableUserActionStatus['action'];
  recoveryCheckpoint?: string;
};

type UserActionQueueState = {
  actions: UserActionLifecycle[];
  isNetworkBlocked: boolean;
  enqueue: (input: {
    id?: string;
    kind: string;
    label: string;
    payload?: unknown;
    reconcile?: (result: unknown) => Promise<void>;
    successStatus?: number;
  }) => Promise<UserActionLifecycle>;
  submitUserMutation: <T>(options: SubmitUserMutationOptions) => Promise<T>;
  clearQueuedActions: () => void;
  retry: () => void;
  setNetworkBlocked: (blocked: boolean) => void;
  hydrateRecoveredActions: () => Promise<void>;
};

const RECEIPT_TIMEOUT_MS = 5000;
const STATUS_WAIT_MS = 25000;
const NETWORK_RETRY_MS = 1000;
const MAX_NETWORK_RETRY_MS = 10_000;
const TERMINAL_STATUSES = new Set<UserActionStatus>([
  'succeeded',
  'failed',
  'cancelled',
  'outcomeUnknown',
]);
const queue: QueueItem[] = [];
let isProcessing = false;
let socketLifecycleHandlerRegistered = false;
let networkRetryTimer: ReturnType<typeof setTimeout> | null = null;
let networkRetryAttempt = 0;
let hydrationGeneration = 0;
let hydrationRetryTimer: ReturnType<typeof setTimeout> | null = null;
let hydrationRetryAttempt = 0;
let hydrationRetryPending = false;

const recoveryCheckpointKey = (userId: string) =>
  `pomi-user-action-recovery:${userId}`;

function readRecoveryCheckpoint(userId?: string): string | null {
  if (!userId || typeof localStorage === 'undefined') return null;
  return localStorage.getItem(recoveryCheckpointKey(userId));
}

function writeRecoveryCheckpoint(userId: string, cursor: string) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(recoveryCheckpointKey(userId), cursor);
}

export function getRecoveredActionLabel(
  action: RecoverableUserActionStatus['action']
) {
  if (action.kind === 'timer') {
    const timerOperationLabels: Record<
      string,
      Parameters<typeof translateCurrent>[0]
    > = {
      createOrResume: 'timer.createOrResume',
      removeFocusedTask: 'timer.removeFocusedTask',
      undo: 'timer.undoAction',
      redo: 'timer.redoAction',
      stack: 'timer.stackAction',
      setSessionPosition: 'timer.setSessionPosition',
      resolveExtension: 'timer.resolveExtension',
      clearHistory: 'timer.clearHistory',
    };
    return translateCurrent(
      timerOperationLabels[action.operation] ?? 'timer.action'
    );
  }
  if (action.kind === 'tasks') {
    return translateCurrent(
      action.operation === 'create' ? 'task.create' : 'task.updated'
    );
  }
  if (action.kind === 'intentions') {
    return translateCurrent(
      action.operation === 'create' ? 'intention.create' : 'intention.update'
    );
  }
  if (action.kind === 'preferences') {
    return translateCurrent('settings.update');
  }
  if (action.kind === 'lists') {
    return translateCurrent(
      action.operation === 'create' ? 'lists.create' : 'lists.update'
    );
  }
  if (action.kind === 'assistant') {
    return translateCurrent('assistant.title');
  }
  if (action.kind === 'notifications') {
    return translateCurrent('notifications.notification');
  }
  if (action.kind === 'vacation') {
    return translateCurrent('vacation.coverage');
  }
  if (action.kind === 'feedback') {
    return translateCurrent('feedback.title');
  }
  return translateCurrent('actionQueue.action');
}

export async function reconcileRecoveredUserAction(
  action: RecoverableUserActionStatus['action']
): Promise<void> {
  if (action.kind === 'timer') {
    await waitForAuthoritativeTimer();
    return;
  }
  if (action.kind === 'tasks') {
    const { useTasksStore } = await import('../stores/tasksStore');
    await useTasksStore.getState().refreshTasks();
    return;
  }
  if (action.kind === 'intentions') {
    requestIntentionRefresh();
    return;
  }
  if (action.kind === 'preferences' || action.kind === 'notifications') {
    const { usePreferencesStore } = await import('../stores/preferencesStore');
    await usePreferencesStore
      .getState()
      .loadPreferences({ syncTimeZone: false });
    return;
  }
  if (action.kind === 'lists') {
    await Promise.all([
      apiClient.lists.list({ query: {} }),
      apiClient.lists.items({ query: {} }),
    ]);
    requestListRefresh();
    return;
  }
  if (action.kind === 'assistant') {
    const [{ useAssistantStore }, { useTasksStore }] = await Promise.all([
      import('../stores/assistantStore'),
      import('../stores/tasksStore'),
    ]);
    await Promise.all([
      useAssistantStore.getState().loadStatus(),
      useTasksStore.getState().refreshTasks(),
    ]);
    requestListRefresh();
    return;
  }
  if (action.kind === 'workTimerLog') {
    requestWorkTimerLogRefresh();
    return;
  }
  if (action.kind === 'vacation') {
    const [{ useVacationStore }, { useTasksStore }] = await Promise.all([
      import('../stores/vacationStore'),
      import('../stores/tasksStore'),
    ]);
    await Promise.all([
      useVacationStore.getState().loadStatus(),
      useTasksStore.getState().refreshTasks(),
    ]);
    requestListRefresh();
    return;
  }
  if (action.kind === 'system') {
    const [{ usePreferencesStore }, { useTasksStore }] = await Promise.all([
      import('../stores/preferencesStore'),
      import('../stores/tasksStore'),
    ]);
    await Promise.all([
      usePreferencesStore.getState().loadPreferences({ syncTimeZone: false }),
      useTasksStore.getState().refreshTasks(),
    ]);
    forceReconnect(false);
  }
}

function clearNetworkRetry() {
  if (!networkRetryTimer) return;
  clearTimeout(networkRetryTimer);
  networkRetryTimer = null;
}

function resetNetworkRetry() {
  clearNetworkRetry();
  networkRetryAttempt = 0;
}

function clearHydrationRetry() {
  if (hydrationRetryTimer) clearTimeout(hydrationRetryTimer);
  hydrationRetryTimer = null;
}

function scheduleHydrationRetry() {
  if (hydrationRetryTimer || !useAuthStore.getState().token) return;
  hydrationRetryPending = true;
  forceReconnect(false);
  const delay = Math.min(
    NETWORK_RETRY_MS * 2 ** hydrationRetryAttempt,
    MAX_NETWORK_RETRY_MS
  );
  hydrationRetryAttempt += 1;
  hydrationRetryTimer = setTimeout(() => {
    hydrationRetryTimer = null;
    void hydrateRecoveredActions();
  }, delay);
}

function blockNetworkAndRetry(item: QueueItem, phase: 'submit' | 'poll') {
  useUserActionQueueBase.setState({ isNetworkBlocked: true });
  forceReconnect(false);
  if (networkRetryTimer) return;
  const retryDelayBase = Math.min(
    NETWORK_RETRY_MS * 2 ** networkRetryAttempt,
    MAX_NETWORK_RETRY_MS
  );
  const retryDelay = retryDelayBase * (0.75 + Math.random() * 0.5);
  item.scheduledRetryWaitMs += retryDelay;
  if (!item.networkBlockReported) {
    item.networkBlockReported = true;
    const action = toGatewayAction(item) as Record<string, unknown>;
    Sentry.logger.warn('User action network blocked', {
      action_id: item.id,
      action_kind: action.kind,
      action_operation: action.operation ?? action.method,
      blocked_phase: phase,
      submit_attempts: item.submitAttempts,
      poll_attempts: item.pollAttempts,
    });
  }
  networkRetryAttempt += 1;
  networkRetryTimer = setTimeout(() => {
    networkRetryTimer = null;
    if (!useUserActionQueueBase.getState().isNetworkBlocked) return;
    useUserActionQueueBase.setState({ isNetworkBlocked: false });
    void processQueue();
  }, retryDelay);
}

function authHeaders(): HeadersInit {
  const token = useAuthStore.getState().token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function waitForDebugLag(signal?: AbortSignal | null): Promise<void> {
  const lag = getDebugLag();
  if (lag <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('The request was aborted.', 'AbortError'));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, lag);

    if (!signal) return;
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener('abort', abort, { once: true });
    }
  });
}

function lifecycleFromResponse(
  body: unknown,
  defaults: Partial<UserActionLifecycle>
): UserActionLifecycle {
  const candidate =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const action =
    candidate.action && typeof candidate.action === 'object'
      ? (candidate.action as Record<string, unknown>)
      : undefined;
  const rawStatus = String(candidate.status ?? defaults.status ?? 'accepted');
  const status = (
    candidate.outcomeUnknown === true && rawStatus === 'failed'
      ? 'outcomeUnknown'
      : rawStatus
  ) as UserActionStatus;
  const now = new Date().toISOString();
  return {
    id: String(candidate.actionId ?? defaults.id ?? ''),
    status,
    kind: String(action?.kind ?? defaults.kind ?? 'unknown'),
    label: String(defaults.label ?? translateCurrent('actionQueue.action')),
    payload: action ?? defaults.payload,
    result: candidate.result,
    error:
      candidate.error && typeof candidate.error === 'object'
        ? String((candidate.error as Record<string, unknown>).message ?? '')
        : undefined,
    createdAt: String(defaults.createdAt ?? now),
    updatedAt: String(defaults.updatedAt ?? now),
  };
}

function sanitizeRecoveredLifecycle(
  lifecycle: UserActionLifecycle,
  item: QueueItem
): UserActionLifecycle {
  if (!item.restored || !item.recoveryAction) return lifecycle;
  return {
    ...lifecycle,
    kind: item.recoveryAction.kind,
    label: item.label,
    payload: undefined,
    result: undefined,
    error:
      lifecycle.status === 'failed' || lifecycle.status === 'outcomeUnknown'
        ? translateCurrent('actionQueue.actionFailed')
        : undefined,
  };
}

const TIMER_OPERATION_BY_EVENT: Record<string, string> = {
  createOrResumeTimer: 'createOrResume',
  removeFocusedTask: 'removeFocusedTask',
  pauseTimer: 'pause',
  resetTimer: 'reset',
  skipTimer: 'skip',
  addFiveMinutesTimer: 'addFiveMinutes',
  undoTimerAction: 'undo',
  redoTimerAction: 'redo',
  stackTimer: 'stack',
  setSessionPosition: 'setSessionPosition',
  resolveTimerExtension: 'resolveExtension',
  clearTimerHistory: 'clearHistory',
};

function toGatewayAction(item: QueueItem): unknown {
  const payload =
    item.payload && typeof item.payload === 'object'
      ? (item.payload as Record<string, unknown>)
      : {};
  const operation = TIMER_OPERATION_BY_EVENT[item.kind];
  if (operation) {
    if (operation === 'resolveExtension' && 'action' in payload) {
      return {
        kind: 'timer',
        operation,
        extensionAction: payload.action,
      };
    }
    if (operation === 'createOrResume' && 'type' in payload) {
      const { type, ...rest } = payload;
      return { kind: 'timer', operation, timerType: type, ...rest };
    }
    if (operation === 'skip' && 'logMode' in payload) {
      const { logMode, ...rest } = payload;
      return { kind: 'timer', operation, requestedLogMode: logMode, ...rest };
    }
    return { kind: 'timer', operation, ...payload };
  }
  if (
    [
      'timer',
      'tasks',
      'intentions',
      'preferences',
      'assistant',
      'workTimerLog',
      'system',
      'notifications',
      'feedback',
      'lists',
      'vacation',
    ].includes(item.kind)
  ) {
    return { kind: item.kind, ...payload };
  }
  throw new Error(`Unsupported user action kind: ${item.kind}`);
}

async function requestJson(
  path: string,
  options: RequestInit,
  timeoutMs: number
): Promise<{ status: number; body: unknown }> {
  const parentSignal = options.signal;
  await waitForDebugLag(parentSignal);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromParent = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else
      parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }
  try {
    const response = await fetch(`${getBackendOrigin()}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { ...authHeaders(), ...(options.headers ?? {}) },
    });
    if (
      response.status === 401 &&
      typeof window !== 'undefined' &&
      window.location.pathname !== '/login'
    ) {
      // Gateway requests bypass apiClient's shared auth wrapper. Clear the
      // session here so an expired token cannot keep replaying queued actions.
      useAuthStore.getState().expireSession();
    }
    const text = await response.text();
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { message: text };
      }
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

function updateItem(item: QueueItem, patch: Partial<UserActionLifecycle>) {
  Object.assign(item, patch, { updatedAt: new Date().toISOString() });
  useUserActionQueueBase.setState({
    actions: queue.map(toPublicAction),
  });
}

function toPublicAction(item: QueueItem): UserActionLifecycle {
  const {
    resolve: _resolve,
    reject: _reject,
    reconcile: _reconcile,
    successStatus: _successStatus,
    abortController: _abortController,
    cancellationRequested: _cancellationRequested,
    settled: _settled,
    enqueuedAtMs: _enqueuedAtMs,
    firstSubmitStartedAtMs: _firstSubmitStartedAtMs,
    lastSubmitStartedAtMs: _lastSubmitStartedAtMs,
    firstReceiptReceivedAtMs: _firstReceiptReceivedAtMs,
    lastReceiptReceivedAtMs: _lastReceiptReceivedAtMs,
    terminalReceivedAtMs: _terminalReceivedAtMs,
    reconcileStartedAtMs: _reconcileStartedAtMs,
    reconcileFinishedAtMs: _reconcileFinishedAtMs,
    submitAttempts: _submitAttempts,
    pollAttempts: _pollAttempts,
    submitFailures: _submitFailures,
    pollFailures: _pollFailures,
    scheduledRetryWaitMs: _scheduledRetryWaitMs,
    networkBlockReported: _networkBlockReported,
    terminalSource: _terminalSource,
    timingReported: _timingReported,
    restored: _restored,
    recoveryAction: _recoveryAction,
    ...action
  } = item;
  return action;
}

function reportTiming(item: QueueItem) {
  if (item.timingReported) return;
  item.timingReported = true;
  const finishedAtMs = performance.now();
  const duration = (start?: number, end?: number) =>
    start === undefined || end === undefined
      ? undefined
      : Math.max(0, end - start);
  const action = toGatewayAction(item) as Record<string, unknown>;
  Sentry.logger.info('User action client timing', {
    action_id: item.id,
    action_kind: action.kind,
    action_operation: action.operation ?? action.method,
    lifecycle: item.status,
    terminal_source: item.terminalSource ?? 'client',
    client_queue_wait_ms: duration(
      item.enqueuedAtMs,
      item.firstSubmitStartedAtMs
    ),
    submit_receipt_ms: duration(
      item.firstSubmitStartedAtMs,
      item.firstReceiptReceivedAtMs
    ),
    terminal_wait_ms: duration(
      item.firstReceiptReceivedAtMs,
      item.terminalReceivedAtMs
    ),
    reconcile_ms: duration(
      item.reconcileStartedAtMs,
      item.reconcileFinishedAtMs
    ),
    client_total_ms: Math.max(0, finishedAtMs - item.enqueuedAtMs),
    submit_attempts: item.submitAttempts,
    poll_attempts: item.pollAttempts,
    submit_retry_count: item.submitFailures,
    poll_retry_count: item.pollFailures,
    scheduled_retry_delay_ms: Math.round(item.scheduledRetryWaitMs),
  });
}

function resolveItem(item: QueueItem) {
  if (item.settled) return;
  item.settled = true;
  reportTiming(item);
  item.resolve(toPublicAction(item));
}

function rejectItem(item: QueueItem, error: Error) {
  if (item.settled) return;
  item.settled = true;
  reportTiming(item);
  item.reject(error);
}

function terminalFailure(item: QueueItem, message: string) {
  item.terminalReceivedAtMs ??= performance.now();
  updateItem(item, { status: 'failed', error: message });
  rejectItem(item, new Error(message));
}

async function submitItem(item: QueueItem) {
  if (item.cancellationRequested) {
    await cancelItem(item);
    return;
  }
  updateItem(item, { status: 'submitting' });
  item.submitAttempts += 1;
  item.lastSubmitStartedAtMs = performance.now();
  item.firstSubmitStartedAtMs ??= item.lastSubmitStartedAtMs;
  item.abortController = new AbortController();
  let receipt: { status: number; body: unknown };
  try {
    receipt = await requestJson(
      '/user-actions',
      {
        method: 'POST',
        body: JSON.stringify({
          actionId: item.id,
          action: toGatewayAction(item),
        }),
        signal: item.abortController.signal,
      },
      RECEIPT_TIMEOUT_MS
    );
  } catch (error) {
    if (item.cancellationRequested) {
      await cancelItem(item);
      return;
    }
    if (TERMINAL_STATUSES.has(item.status)) {
      await settleTerminalItem(item);
      return;
    }
    item.submitFailures += 1;
    blockNetworkAndRetry(item, 'submit');
    updateItem(item, {
      error:
        error instanceof Error
          ? error.message
          : translateCurrent('actionQueue.serverRetry'),
    });
    return;
  }

  item.lastReceiptReceivedAtMs = performance.now();
  item.firstReceiptReceivedAtMs ??= item.lastReceiptReceivedAtMs;

  if (TERMINAL_STATUSES.has(item.status)) {
    await settleTerminalItem(item);
    return;
  }

  if (receipt.status !== 202) {
    if (receipt.status === 408 || receipt.status >= 500) {
      item.submitFailures += 1;
      blockNetworkAndRetry(item, 'submit');
      updateItem(item, {
        error: translateCurrent('actionQueue.submitCodeRetry', {
          status: receipt.status,
        }),
      });
      return;
    }
    const lifecycle = lifecycleFromResponse(receipt.body, item);
    updateItem(item, {
      ...lifecycle,
      status: lifecycle.status === 'cancelled' ? 'cancelled' : 'failed',
    });
    item.terminalSource = 'receipt';
    item.terminalReceivedAtMs = performance.now();
    resolveItem(item);
    return;
  }

  const accepted = lifecycleFromResponse(receipt.body, {
    ...item,
    status: 'accepted',
  });
  updateItem(item, {
    ...accepted,
    status: accepted.status,
  });
  if (TERMINAL_STATUSES.has(item.status)) {
    item.terminalSource = 'receipt';
    item.terminalReceivedAtMs = performance.now();
  }
  await pollItem(item);
}

async function pollItem(item: QueueItem) {
  while (!TERMINAL_STATUSES.has(item.status)) {
    let response: { status: number; body: unknown };
    item.abortController = new AbortController();
    item.pollAttempts += 1;
    try {
      response = await requestJson(
        `/user-actions/${encodeURIComponent(item.id)}?waitMs=${STATUS_WAIT_MS}`,
        { method: 'GET', signal: item.abortController.signal },
        STATUS_WAIT_MS + RECEIPT_TIMEOUT_MS
      );
    } catch (error) {
      if (TERMINAL_STATUSES.has(item.status)) {
        await settleTerminalItem(item);
        return;
      }
      item.pollFailures += 1;
      blockNetworkAndRetry(item, 'poll');
      updateItem(item, {
        error:
          error instanceof Error
            ? error.message
            : translateCurrent('actionQueue.statusRetry'),
      });
      return;
    }
    if (response.status < 200 || response.status >= 300) {
      if (response.status === 408 || response.status >= 500) {
        item.pollFailures += 1;
        blockNetworkAndRetry(item, 'poll');
        updateItem(item, {
          error: translateCurrent('actionQueue.statusCodeRetry', {
            status: response.status,
          }),
        });
        return;
      }
      item.terminalSource = 'poll';
      item.terminalReceivedAtMs = performance.now();
      terminalFailure(
        item,
        translateCurrent('actionQueue.statusCodeFailed', {
          status: response.status,
        })
      );
      return;
    }
    const lifecycle = sanitizeRecoveredLifecycle(
      lifecycleFromResponse(response.body, item),
      item
    );
    resetNetworkRetry();
    if (!TERMINAL_STATUSES.has(item.status)) {
      updateItem(item, lifecycle);
    }
    if (TERMINAL_STATUSES.has(item.status)) {
      item.terminalSource = 'poll';
      item.terminalReceivedAtMs = performance.now();
    }
    if (TERMINAL_STATUSES.has(item.status)) break;
  }

  await settleTerminalItem(item);
}

async function settleTerminalItem(item: QueueItem) {
  if (item.settled) return;
  if (
    (item.status === 'succeeded' || item.status === 'outcomeUnknown') &&
    item.reconcile
  ) {
    const terminalStatus = item.status;
    updateItem(item, { status: 'reconciling' });
    item.reconcileStartedAtMs = performance.now();
    try {
      await item.reconcile(item.result);
      item.reconcileFinishedAtMs = performance.now();
      updateItem(item, { status: terminalStatus });
    } catch (error) {
      item.reconcileFinishedAtMs = performance.now();
      terminalFailure(
        item,
        error instanceof Error
          ? error.message
          : translateCurrent('actionQueue.refreshFailed')
      );
      return;
    }
  }
  const userId = useAuthStore.getState().user?.id;
  if (item.recoveryCheckpoint && userId) {
    writeRecoveryCheckpoint(userId, item.recoveryCheckpoint);
  }
  resolveItem(item);
}

async function cancelItem(item: QueueItem) {
  try {
    const response = await requestJson(
      `/user-actions/${encodeURIComponent(item.id)}`,
      { method: 'DELETE' },
      RECEIPT_TIMEOUT_MS
    );
    const lifecycle = lifecycleFromResponse(response.body, item);
    resetNetworkRetry();
    updateItem(item, lifecycle);
    if (TERMINAL_STATUSES.has(item.status)) {
      item.terminalSource = 'cancel';
      item.terminalReceivedAtMs = performance.now();
    }
    if (!TERMINAL_STATUSES.has(item.status)) {
      await pollItem(item);
      return;
    }
    resolveItem(item);
  } catch (error) {
    item.pollFailures += 1;
    blockNetworkAndRetry(item, 'poll');
    updateItem(item, {
      error:
        error instanceof Error
          ? error.message
          : translateCurrent('actionQueue.cancelRetry'),
    });
  }
}

async function runUserMutation<T>(
  options: SubmitUserMutationOptions
): Promise<T> {
  const lifecycle = await useUserActionQueueBase.getState().enqueue({
    id: options.id,
    kind: options.kind,
    label: options.label,
    payload: options.payload,
    reconcile: options.reconcile,
    successStatus: options.successStatus,
  });
  if (lifecycle.status !== 'succeeded') {
    throw new Error(
      lifecycle.error ?? translateCurrent('actionQueue.actionFailed')
    );
  }
  const result = lifecycle.result;
  if (result && typeof result === 'object' && 'body' in result) {
    return (result as { body: T }).body;
  }
  if (options.successStatus !== undefined) {
    return { status: options.successStatus, body: result } as T;
  }
  return result as T;
}

async function processQueue() {
  if (isProcessing) return;
  if (useUserActionQueueBase.getState().isNetworkBlocked) return;
  isProcessing = true;
  try {
    while (queue.length > 0) {
      const head = queue[0];
      if (TERMINAL_STATUSES.has(head.status)) {
        await settleTerminalItem(head);
        queue.shift();
        useUserActionQueueBase.setState({ actions: queue.map(toPublicAction) });
        continue;
      }
      if (head.restored) {
        await pollItem(head);
      } else {
        await submitItem(head);
      }
      if (useUserActionQueueBase.getState().isNetworkBlocked) {
        return;
      }
      if (queue[0] === head) {
        queue.shift();
        useUserActionQueueBase.setState({ actions: queue.map(toPublicAction) });
      }
    }
  } finally {
    isProcessing = false;
  }
}

async function hydrateRecoveredActions(): Promise<void> {
  const token = useAuthStore.getState().token;
  const userId = useAuthStore.getState().user?.id;
  if (!token) return;
  const generation = ++hydrationGeneration;
  let cursor: string | null = null;
  const recovered: RecoverableUserActionStatus[] = [];
  let recoveryCursor: string | null = null;
  const after = readRecoveryCheckpoint(userId);
  try {
    do {
      const response = await requestJson(
        `/user-actions?limit=50${
          after ? `&after=${encodeURIComponent(after)}` : ''
        }${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { method: 'GET' },
        RECEIPT_TIMEOUT_MS
      );
      if (
        generation !== hydrationGeneration ||
        token !== useAuthStore.getState().token
      ) {
        return;
      }
      if (response.status !== 200) {
        if (response.status !== 401) {
          Sentry.logger.warn('User action recovery discovery failed', {
            status: response.status,
          });
        }
        if (response.status !== 401) scheduleHydrationRetry();
        return;
      }
      const body = response.body as {
        items?: RecoverableUserActionStatus[];
        nextCursor?: string | null;
        recoveryCursor?: string | null;
      };
      recovered.push(...(Array.isArray(body.items) ? body.items : []));
      if (!recoveryCursor && typeof body.recoveryCursor === 'string') {
        recoveryCursor = body.recoveryCursor;
      }
      cursor = typeof body.nextCursor === 'string' ? body.nextCursor : null;
    } while (cursor);
  } catch (error) {
    if (
      generation === hydrationGeneration &&
      token === useAuthStore.getState().token
    ) {
      Sentry.logger.warn('User action recovery discovery failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      scheduleHydrationRetry();
    }
    return;
  }

  clearHydrationRetry();
  hydrationRetryAttempt = 0;
  hydrationRetryPending = false;

  const knownIds = new Set(queue.map(item => item.id));
  recovered.sort((left, right) => {
    const leftActive = left.status === 'accepted' || left.status === 'running';
    const rightActive =
      right.status === 'accepted' || right.status === 'running';
    if (leftActive !== rightActive) return leftActive ? -1 : 1;
    return leftActive
      ? left.acceptedAt - right.acceptedAt
      : right.updatedAt - left.updatedAt;
  });
  for (const status of recovered) {
    if (knownIds.has(status.actionId)) continue;
    knownIds.add(status.actionId);
    const now = performance.now();
    const localStatus: UserActionStatus = status.outcomeUnknown
      ? 'outcomeUnknown'
      : status.status;
    const item: QueueItem = {
      id: status.actionId,
      status: localStatus,
      kind: status.action.kind,
      label: getRecoveredActionLabel(status.action),
      createdAt: new Date(status.acceptedAt).toISOString(),
      updatedAt: new Date(status.updatedAt).toISOString(),
      reconcile: () => reconcileRecoveredUserAction(status.action),
      resolve: () => undefined,
      reject: () => undefined,
      enqueuedAtMs: now,
      firstReceiptReceivedAtMs: now,
      submitAttempts: 0,
      pollAttempts: 0,
      submitFailures: 0,
      pollFailures: 0,
      scheduledRetryWaitMs: 0,
      restored: true,
      recoveryAction: status.action,
    };
    queue.push(item);
  }
  if (recoveryCursor && userId) {
    const recoveredIds = new Set(recovered.map(status => status.actionId));
    const checkpointTarget = [...queue]
      .reverse()
      .find(item => recoveredIds.has(item.id));
    if (checkpointTarget) checkpointTarget.recoveryCheckpoint = recoveryCursor;
    else writeRecoveryCheckpoint(userId, recoveryCursor);
  }
  useUserActionQueueBase.setState({ actions: queue.map(toPublicAction) });
  void processQueue();
}

function resetQueueForAuthenticationChange() {
  hydrationGeneration += 1;
  clearNetworkRetry();
  clearHydrationRetry();
  hydrationRetryAttempt = 0;
  hydrationRetryPending = false;
  queue.forEach(item => {
    item.status = 'cancelled';
    item.abortController?.abort();
    if (!item.settled) {
      item.settled = true;
      item.resolve({ ...toPublicAction(item), status: 'cancelled' });
    }
  });
  queue.splice(0);
  isProcessing = false;
  useUserActionQueueBase.setState({
    actions: [],
    isNetworkBlocked: false,
  });
}

function registerLifecycleSocketHandler() {
  if (socketLifecycleHandlerRegistered) return;
  socketLifecycleHandlerRegistered = true;
  registerSocketEventHandler('USER_ACTION_UPDATE', (data: unknown) => {
    const lifecycle = lifecycleFromResponse(data, {});
    const item = queue.find(action => action.id === lifecycle.id);
    if (!item) return;
    if (item.status === 'reconciling' || TERMINAL_STATUSES.has(item.status)) {
      return;
    }
    updateItem(
      item,
      sanitizeRecoveredLifecycle(lifecycleFromResponse(data, item), item)
    );
    if (TERMINAL_STATUSES.has(item.status)) {
      item.terminalSource = 'socket';
      item.terminalReceivedAtMs = performance.now();
      item.abortController?.abort();
      void processQueue();
    }
  });
}

const useUserActionQueueBase = create<UserActionQueueState>(() => ({
  actions: [],
  isNetworkBlocked: false,
  enqueue: input => {
    registerLifecycleSocketHandler();
    const id = input.id ?? uuid();
    const now = new Date().toISOString();
    return new Promise<UserActionLifecycle>((resolve, reject) => {
      queue.push({
        id,
        status: 'queued',
        kind: input.kind,
        label: input.label,
        payload: input.payload,
        createdAt: now,
        updatedAt: now,
        reconcile: input.reconcile,
        successStatus: input.successStatus,
        resolve,
        reject,
        enqueuedAtMs: performance.now(),
        submitAttempts: 0,
        pollAttempts: 0,
        submitFailures: 0,
        pollFailures: 0,
        scheduledRetryWaitMs: 0,
      });
      useUserActionQueueBase.setState({ actions: queue.map(toPublicAction) });
      void processQueue();
    });
  },
  submitUserMutation: runUserMutation,
  clearQueuedActions: () => {
    const head = queue[0];
    const removed = queue.splice(1);
    removed.forEach(item => {
      updateItem(item, { status: 'cancelled' });
      resolveItem(item);
    });
    if (head && (head.status === 'queued' || head.status === 'submitting')) {
      head.cancellationRequested = true;
      head.abortController?.abort();
      if (head.status === 'queued') {
        void cancelItem(head);
      }
    }
    useUserActionQueueBase.setState({ actions: queue.map(toPublicAction) });
    void processQueue();
  },
  retry: () => {
    resetNetworkRetry();
    useUserActionQueueBase.setState({ isNetworkBlocked: false });
    const head = queue[0];
    if (head?.status === 'failed') {
      updateItem(head, { status: 'queued', error: undefined });
    }
    void processQueue();
    if (hydrationRetryPending) void hydrateRecoveredActions();
  },
  setNetworkBlocked: blocked => {
    if (!blocked) resetNetworkRetry();
    useUserActionQueueBase.setState({ isNetworkBlocked: blocked });
  },
  hydrateRecoveredActions,
}));

export const useUserActionQueue = createSelectors(useUserActionQueueBase);
export { useUserActionQueueBase };

export const submitUserMutation = <T>(
  options: SubmitUserMutationOptions
): Promise<T> => useUserActionQueueBase.getState().submitUserMutation(options);

useAuthStore.subscribe((state, previousState) => {
  const tokenChanged = state.token !== previousState.token;
  const accountChanged = state.user?.id !== previousState.user?.id;
  if (!tokenChanged && !accountChanged) return;
  resetQueueForAuthenticationChange();
  if (state.token && state.user?.id) void hydrateRecoveredActions();
});

const initialAuthState = useAuthStore.getState();
if (
  initialAuthState.token &&
  initialAuthState.isAuthenticated &&
  initialAuthState.user?.id
) {
  void hydrateRecoveredActions();
}
