import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const socketHandlers = vi.hoisted(
  () => new Map<string, (data: unknown) => void>()
);
const forceReconnect = vi.hoisted(() => vi.fn());
const uuid = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({
  token: 'test-token' as string | null,
  expireSession: vi.fn(),
  subscriber: undefined as
    | ((
        state: { token: string | null },
        previous: { token: string | null }
      ) => void)
    | undefined,
}));
const debug = vi.hoisted(() => ({ lag: 0 }));
const timingLog = vi.hoisted(() => vi.fn());
const networkBlockedLog = vi.hoisted(() => vi.fn());

vi.mock('uuid', () => ({ v4: uuid }));
vi.mock('@sentry/react', () => ({
  logger: { info: timingLog, warn: networkBlockedLog },
}));
vi.mock('../stores/authStore', () => ({
  useAuthStore: {
    getState: () => auth,
    subscribe: (
      subscriber: (
        state: { token: string | null },
        previous: { token: string | null }
      ) => void
    ) => {
      auth.subscriber = subscriber;
      return vi.fn();
    },
  },
}));
vi.mock('../stores/debugStore', () => ({ getDebugLag: () => debug.lag }));
vi.mock('./backendUrl', () => ({
  getBackendOrigin: () => 'http://backend.test',
}));
vi.mock('./socketManager', () => ({
  forceReconnect,
  registerSocketEventHandler: (
    event: string,
    handler: (data: unknown) => void
  ) => socketHandlers.set(event, handler),
}));
vi.mock('../stores/timerStore', () => ({
  useTimerStore: {
    use: {
      connectionStatus: () => ({
        isConnected: true,
        isReconnecting: false,
      }),
    },
  },
}));

const jsonResponse = (status: number, body: unknown) =>
  ({
    status,
    text: async () => JSON.stringify(body),
  }) as Response;

const textResponse = (status: number, body: string) =>
  ({
    status,
    text: async () => body,
  }) as Response;

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn());
  uuid.mockReset();
  let actionIndex = 0;
  uuid.mockImplementation(() => `action-${++actionIndex}`);
  socketHandlers.clear();
  forceReconnect.mockReset();
  auth.token = 'test-token';
  auth.expireSession.mockReset();
  auth.subscriber = undefined;
  debug.lag = 0;
  timingLog.mockReset();
  networkBlockedLog.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('accepted action queue', () => {
  it('uses a caller-provided idempotency ID for prepared mutations', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(202, { actionId: 'preparation-1', status: 'accepted' })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          actionId: 'preparation-1',
          status: 'succeeded',
          result: { tasks: [] },
        })
      );
    const { submitUserMutation } = await import('./userActionQueue');

    await submitUserMutation({
      id: 'preparation-1',
      kind: 'assistant',
      label: 'Commit prepared capture',
      payload: {
        operation: 'commitPreparedTaskFromText',
        payload: { preparationId: 'preparation-1' },
      },
    });

    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
    ).toMatchObject({ actionId: 'preparation-1' });
    expect(timingLog).toHaveBeenCalledWith(
      'User action client timing',
      expect.objectContaining({
        action_id: 'preparation-1',
        action_kind: 'assistant',
        action_operation: 'commitPreparedTaskFromText',
        lifecycle: 'succeeded',
        terminal_source: 'poll',
        submit_attempts: 1,
        poll_attempts: 1,
        submit_retry_count: 0,
        poll_retry_count: 0,
      })
    );
    expect(timingLog).toHaveBeenCalledOnce();
  });

  it('reconciles authoritative state before resolving an accepted action', async () => {
    const reconcile = vi.fn(async (_result: unknown) => undefined);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(202, {
          actionId: 'action-1',
          status: 'accepted',
          action: { kind: 'timer', operation: 'pause' },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          actionId: 'action-1',
          status: 'succeeded',
          action: { kind: 'timer', operation: 'pause' },
          result: { confirmed: true },
        })
      );
    const { useUserActionQueueBase } = await import('./userActionQueue');

    const result = await useUserActionQueueBase.getState().enqueue({
      kind: 'pauseTimer',
      label: 'Pause',
      reconcile: async result => {
        expect(useUserActionQueueBase.getState().actions[0]?.status).toBe(
          'reconciling'
        );
        await reconcile(result);
      },
    });

    expect(result).toMatchObject({
      status: 'succeeded',
      result: { confirmed: true },
    });
    expect(reconcile).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledWith({ confirmed: true });
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      'http://backend.test/user-actions',
      'http://backend.test/user-actions/action-1?waitMs=25000',
    ]);
  });

  it('blocks after a transport failure, reconnects, then retries the head', async () => {
    const reconnectRequested = deferred<void>();
    forceReconnect.mockImplementation(() =>
      reconnectRequested.resolve(undefined)
    );
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(
        jsonResponse(202, { actionId: 'action-1', status: 'accepted' })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          actionId: 'action-1',
          status: 'succeeded',
          result: 'confirmed',
        })
      );
    const { useUserActionQueueBase } = await import('./userActionQueue');

    const pending = useUserActionQueueBase.getState().enqueue({
      kind: 'tasks',
      label: 'Persist task',
    });
    await reconnectRequested.promise;
    await flush();

    expect(useUserActionQueueBase.getState()).toMatchObject({
      isNetworkBlocked: true,
    });
    expect(forceReconnect).toHaveBeenCalledWith(false);

    useUserActionQueueBase.getState().retry();
    await expect(pending).resolves.toMatchObject({
      status: 'succeeded',
      result: 'confirmed',
    });
    expect(useUserActionQueueBase.getState().isNetworkBlocked).toBe(false);
    expect(networkBlockedLog).toHaveBeenCalledOnce();
    expect(timingLog).toHaveBeenCalledWith(
      'User action client timing',
      expect.objectContaining({
        terminal_source: 'poll',
        submit_attempts: 2,
        submit_retry_count: 1,
        poll_retry_count: 0,
      })
    );
  });

  it('retries HTTP independently when the socket cannot reconnect', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(
        jsonResponse(202, { actionId: 'action-1', status: 'accepted' })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          actionId: 'action-1',
          status: 'succeeded',
          result: 'confirmed',
        })
      );
    const { useUserActionQueueBase } = await import('./userActionQueue');

    const pending = useUserActionQueueBase.getState().enqueue({
      kind: 'tasks',
      label: 'Persist task',
    });
    await flush();
    expect(useUserActionQueueBase.getState().isNetworkBlocked).toBe(true);

    await vi.advanceTimersByTimeAsync(1250);

    await expect(pending).resolves.toMatchObject({ status: 'succeeded' });
  });

  it('shows the delayed indicator exactly at the one-second threshold', async () => {
    vi.useFakeTimers();
    const { UserActionIndicator } =
      await import('../components/UserActionIndicator');
    const { useUserActionQueueBase } = await import('./userActionQueue');
    useUserActionQueueBase.setState({
      actions: [
        {
          id: 'action-1',
          status: 'accepted',
          kind: 'timer',
          label: 'Pause timer',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      isNetworkBlocked: false,
    });

    render(<UserActionIndicator />);
    act(() => vi.advanceTimersByTime(999));
    expect(screen.queryByTestId('user-action-indicator')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('user-action-indicator')).toBeVisible();
  });

  it('maps timer events and direct action kinds to gateway contracts', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(404, {}));
    const { useUserActionQueueBase } = await import('./userActionQueue');
    const cases = [
      {
        kind: 'resolveTimerExtension',
        payload: { action: 'logElapsed' },
        expected: {
          kind: 'timer',
          operation: 'resolveExtension',
          extensionAction: 'logElapsed',
        },
      },
      {
        kind: 'createOrResumeTimer',
        payload: { type: 'work', intention: 'focus' },
        expected: {
          kind: 'timer',
          operation: 'createOrResume',
          timerType: 'work',
          intention: 'focus',
        },
      },
      {
        kind: 'skipTimer',
        payload: { logMode: 'elapsed', taskId: 'task-1' },
        expected: {
          kind: 'timer',
          operation: 'skip',
          requestedLogMode: 'elapsed',
          taskId: 'task-1',
        },
      },
      {
        kind: 'pauseTimer',
        payload: undefined,
        expected: { kind: 'timer', operation: 'pause' },
      },
      {
        kind: 'tasks',
        payload: { operation: 'complete', taskId: 'task-1' },
        expected: { kind: 'tasks', operation: 'complete', taskId: 'task-1' },
      },
      {
        kind: 'notifications',
        payload: {
          operation: 'test',
          payload: { type: 'complete', timerType: 'work' },
        },
        expected: {
          kind: 'notifications',
          operation: 'test',
          payload: { type: 'complete', timerType: 'work' },
        },
      },
    ];

    for (const testCase of cases) {
      await useUserActionQueueBase.getState().enqueue({
        kind: testCase.kind,
        label: testCase.kind,
        payload: testCase.payload,
      });
    }

    const submitted = vi
      .mocked(fetch)
      .mock.calls.map(([, options]) => JSON.parse(String(options?.body)));
    expect(submitted.map(value => value.action)).toEqual(
      cases.map(testCase => testCase.expected)
    );
  });

  it('parses plain, empty, and structured failure responses and expires auth', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(textResponse(401, 'expired'))
      .mockResolvedValueOnce(textResponse(400, ''))
      .mockResolvedValueOnce(
        jsonResponse(409, {
          actionId: 'action-3',
          status: 'cancelled',
          action: { kind: 'tasks' },
          label: 'Cancelled task',
          payload: { original: true },
          error: { message: 'cancelled remotely' },
          createdAt: 'created',
          updatedAt: 'updated',
        })
      );
    const { useUserActionQueueBase } = await import('./userActionQueue');

    await expect(
      useUserActionQueueBase.getState().enqueue({
        kind: 'tasks',
        label: 'Expired',
      })
    ).resolves.toMatchObject({ status: 'failed' });
    expect(auth.expireSession).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    });

    auth.token = null;
    await expect(
      useUserActionQueueBase.getState().enqueue({
        kind: 'tasks',
        label: 'Empty body',
      })
    ).resolves.toMatchObject({ status: 'failed' });
    expect(vi.mocked(fetch).mock.calls[1]?.[1]?.headers).not.toHaveProperty(
      'Authorization'
    );

    await expect(
      useUserActionQueueBase.getState().enqueue({
        kind: 'tasks',
        label: 'Structured',
      })
    ).resolves.toMatchObject({
      id: 'action-3',
      status: 'cancelled',
      kind: 'tasks',
      label: 'Structured',
      error: 'cancelled remotely',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('maps canonical lifecycle fields and outcome-unknown failures', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(202, {
          actionId: 'action-1',
          status: 'accepted',
          action: { kind: 'tasks', operation: 'complete' },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          actionId: 'action-1',
          status: 'running',
          action: { kind: 'tasks', operation: 'complete' },
          error: { message: 'still running' },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          actionId: 'action-1',
          status: 'failed',
          outcomeUnknown: true,
          action: { kind: 'tasks', operation: 'complete' },
          result: { accepted: true },
        })
      );
    const { useUserActionQueueBase } = await import('./userActionQueue');

    await expect(
      useUserActionQueueBase.getState().enqueue({
        kind: 'tasks',
        label: 'Complete',
      })
    ).resolves.toMatchObject({
      status: 'outcomeUnknown',
      kind: 'tasks',
      result: { accepted: true },
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('reports reconciliation failures after a canonical gateway result', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(202, { actionId: 'action-1', status: 'accepted' })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          actionId: 'action-1',
          status: 'succeeded',
          result: { saved: true },
        })
      );
    const { useUserActionQueueBase } = await import('./userActionQueue');

    await expect(
      useUserActionQueueBase.getState().enqueue({
        kind: 'tasks',
        label: 'Reconcile error',
        reconcile: async () => {
          throw new Error('reconcile exploded');
        },
      })
    ).rejects.toThrow('reconcile exploded');
    expect(timingLog).toHaveBeenLastCalledWith(
      'User action client timing',
      expect.objectContaining({
        lifecycle: 'failed',
        terminal_source: 'poll',
        reconcile_ms: expect.any(Number),
      })
    );
  });

  it('blocks and retries receipt timeouts and server failures', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(408, {}))
      .mockResolvedValueOnce(
        jsonResponse(202, { actionId: 'action-1', status: 'accepted' })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { actionId: 'action-1', status: 'succeeded' })
      );
    const { useUserActionQueueBase } = await import('./userActionQueue');

    const pending = useUserActionQueueBase.getState().enqueue({
      kind: 'tasks',
      label: 'Retry receipt',
    });
    await vi.waitFor(() => {
      expect(useUserActionQueueBase.getState().isNetworkBlocked).toBe(true);
    });
    expect(forceReconnect).toHaveBeenCalledWith(false);

    useUserActionQueueBase.getState().retry();
    await expect(pending).resolves.toMatchObject({ status: 'succeeded' });

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(
        jsonResponse(202, { actionId: 'action-2', status: 'accepted' })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { actionId: 'action-2', status: 'succeeded' })
      );
    const second = useUserActionQueueBase.getState().enqueue({
      kind: 'tasks',
      label: 'Retry server',
    });
    await vi.waitFor(() => {
      expect(useUserActionQueueBase.getState().isNetworkBlocked).toBe(true);
    });
    useUserActionQueueBase.getState().retry();
    await expect(second).resolves.toMatchObject({ status: 'succeeded' });
  });

  it('blocks and retries poll transport and HTTP failures', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(202, { actionId: 'action-1', status: 'accepted' })
      )
      .mockRejectedValueOnce('offline poll')
      .mockResolvedValueOnce(
        jsonResponse(202, { actionId: 'action-1', status: 'accepted' })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { actionId: 'action-1', status: 'succeeded' })
      );
    const { useUserActionQueueBase } = await import('./userActionQueue');
    const first = useUserActionQueueBase.getState().enqueue({
      kind: 'tasks',
      label: 'Poll transport',
    });
    await vi.waitFor(() => {
      expect(useUserActionQueueBase.getState().isNetworkBlocked).toBe(true);
    });
    expect(useUserActionQueueBase.getState().actions[0]?.error).toBe(
      'Unable to check action status. Retrying connection.'
    );
    useUserActionQueueBase.getState().retry();
    await expect(first).resolves.toMatchObject({ status: 'succeeded' });
    expect(timingLog).toHaveBeenLastCalledWith(
      'User action client timing',
      expect.objectContaining({
        terminal_source: 'poll',
        submit_attempts: 2,
        poll_attempts: 2,
        submit_retry_count: 0,
        poll_retry_count: 1,
      })
    );

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(202, { actionId: 'action-2', status: 'accepted' })
      )
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(
        jsonResponse(202, { actionId: 'action-2', status: 'accepted' })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { actionId: 'action-2', status: 'succeeded' })
      );
    const second = useUserActionQueueBase.getState().enqueue({
      kind: 'tasks',
      label: 'Poll server',
    });
    await vi.waitFor(() => {
      expect(useUserActionQueueBase.getState().isNetworkBlocked).toBe(true);
    });
    useUserActionQueueBase.getState().retry();
    await expect(second).resolves.toMatchObject({ status: 'succeeded' });
  });

  it('partitions retry delay after the first receipt without overlapping submit timing', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(202, { actionId: 'action-1', status: 'accepted' })
      )
      .mockRejectedValueOnce(new TypeError('poll disconnected'))
      .mockResolvedValueOnce(
        jsonResponse(202, { actionId: 'action-1', status: 'accepted' })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { actionId: 'action-1', status: 'succeeded' })
      );
    const { useUserActionQueueBase } = await import('./userActionQueue');

    const pending = useUserActionQueueBase.getState().enqueue({
      kind: 'tasks',
      label: 'Measured poll retry',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(useUserActionQueueBase.getState().isNetworkBlocked).toBe(true);

    await vi.advanceTimersByTimeAsync(750);
    await expect(pending).resolves.toMatchObject({ status: 'succeeded' });

    expect(timingLog).toHaveBeenCalledOnce();
    expect(timingLog).toHaveBeenCalledWith(
      'User action client timing',
      expect.objectContaining({
        submit_receipt_ms: 0,
        terminal_wait_ms: 750,
        client_total_ms: 750,
        scheduled_retry_delay_ms: 750,
        submit_attempts: 2,
        poll_attempts: 2,
        poll_retry_count: 1,
      })
    );
    random.mockRestore();
  });

  it('rejects terminal polling failures and reconcile failures', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(202, { actionId: 'action-1', status: 'accepted' })
      )
      .mockResolvedValueOnce(jsonResponse(422, {}));
    const { useUserActionQueueBase } = await import('./userActionQueue');
    const terminalPoll = useUserActionQueueBase.getState().enqueue({
      kind: 'tasks',
      label: 'Bad poll',
    });
    await expect(terminalPoll).rejects.toThrow(
      'Unable to check action status (422).'
    );

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(202, { actionId: 'action-2', status: 'accepted' })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          actionId: 'action-2',
          status: 'outcomeUnknown',
        })
      );
    const reconcileError = useUserActionQueueBase.getState().enqueue({
      kind: 'tasks',
      label: 'Bad reconcile',
      reconcile: async () => Promise.reject('not an Error'),
    });
    await expect(reconcileError).rejects.toThrow(
      'Unable to refresh confirmed state.'
    );
  });

  it('cancels queued followers and an active submission', async () => {
    debug.lag = 10_000;
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { actionId: 'action-1', status: 'cancelled' })
    );
    const { useUserActionQueueBase } = await import('./userActionQueue');

    const active = useUserActionQueueBase.getState().enqueue({
      kind: 'tasks',
      label: 'Active',
    });
    const queued = useUserActionQueueBase.getState().enqueue({
      kind: 'tasks',
      label: 'Queued',
    });
    await flush();
    useUserActionQueueBase.getState().clearQueuedActions();
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(queued).resolves.toMatchObject({ status: 'cancelled' });
    await expect(active).resolves.toMatchObject({ status: 'cancelled' });
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('polls cancellation until terminal', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(200, { actionId: 'action-1', status: 'running' })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { actionId: 'action-1', status: 'cancelled' })
      );
    const { useUserActionQueueBase } = await import('./userActionQueue');
    useUserActionQueueBase.setState({ isNetworkBlocked: true });
    const pollingCancel = useUserActionQueueBase.getState().enqueue({
      kind: 'tasks',
      label: 'Cancel then poll',
    });
    useUserActionQueueBase.getState().clearQueuedActions();
    await expect(pollingCancel).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('blocks when cancellation cannot reach the server', async () => {
    debug.lag = 100;
    vi.useFakeTimers();
    vi.mocked(fetch).mockRejectedValue('cancel offline');
    const { useUserActionQueueBase } = await import('./userActionQueue');
    const blockedCancel = useUserActionQueueBase.getState().enqueue({
      kind: 'tasks',
      label: 'Cancel offline',
    });
    await flush();
    useUserActionQueueBase.getState().clearQueuedActions();
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    expect(useUserActionQueueBase.getState().actions[0]?.error).toBe(
      'Unable to cancel action. Retrying connection.'
    );
    expect(useUserActionQueueBase.getState().isNetworkBlocked).toBe(true);

    debug.lag = 0;
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { actionId: 'action-2', status: 'cancelled' })
    );
    useUserActionQueueBase.getState().retry();
    await expect(blockedCancel).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('unwraps mutation results, synthesizes response status, and rejects failures', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(202, { status: 'accepted' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: 'succeeded',
          result: { body: { id: 'task-1' } },
        })
      )
      .mockResolvedValueOnce(jsonResponse(202, { status: 'accepted' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: 'succeeded',
          result: { id: 'task-2' },
        })
      )
      .mockResolvedValueOnce(jsonResponse(202, { status: 'accepted' }))
      .mockResolvedValueOnce(
        jsonResponse(200, { status: 'succeeded', result: 'saved' })
      );
    const { submitUserMutation } = await import('./userActionQueue');

    await expect(
      submitUserMutation({
        kind: 'tasks',
        label: 'Body',
      })
    ).resolves.toEqual({ id: 'task-1' });
    await expect(
      submitUserMutation({
        kind: 'tasks',
        label: 'Status',
        successStatus: 201,
      })
    ).resolves.toEqual({ status: 201, body: { id: 'task-2' } });
    await expect(
      submitUserMutation({
        kind: 'tasks',
        label: 'Raw',
      })
    ).resolves.toBe('saved');

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(409, { status: 'cancelled' })
    );
    await expect(
      submitUserMutation({
        kind: 'tasks',
        label: 'Cancelled',
      })
    ).rejects.toThrow('Action failed.');
  });

  it('applies socket terminal updates and ignores unknown action IDs', async () => {
    const pollStarted = deferred<void>();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(202, { actionId: 'action-1', status: 'accepted' })
      )
      .mockImplementationOnce((_url, init) => {
        pollStarted.resolve(undefined);
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        });
      });
    const { useUserActionQueueBase } = await import('./userActionQueue');
    const reconcile = vi.fn(async () => undefined);
    const pending = useUserActionQueueBase.getState().enqueue({
      kind: 'tasks',
      label: 'Socket lifecycle',
      reconcile,
    });
    await pollStarted.promise;

    const handler = socketHandlers.get('USER_ACTION_UPDATE');
    expect(handler).toBeDefined();
    handler?.({ actionId: 'unknown', status: 'succeeded' });
    handler?.({
      actionId: 'action-1',
      status: 'succeeded',
      action: { kind: 'tasks' },
      result: { socket: true },
    });
    handler?.({
      actionId: 'action-1',
      status: 'accepted',
      action: { kind: 'tasks' },
    });

    await expect(pending).resolves.toMatchObject({
      status: 'succeeded',
      result: { socket: true },
    });
    expect(reconcile).toHaveBeenCalledOnce();
    expect(timingLog).toHaveBeenCalledOnce();
    expect(timingLog).toHaveBeenCalledWith(
      'User action client timing',
      expect.objectContaining({ terminal_source: 'socket' })
    );
  });

  it('does not downgrade a terminal socket update behind a late receipt', async () => {
    const receipt = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(receipt.promise);
    const { useUserActionQueueBase } = await import('./userActionQueue');
    const pending = useUserActionQueueBase.getState().enqueue({
      kind: 'timer',
      label: 'Pause timer',
    });
    await flush();

    socketHandlers.get('USER_ACTION_UPDATE')?.({
      actionId: 'action-1',
      status: 'succeeded',
      action: { kind: 'timer' },
      result: { socket: true },
    });
    receipt.resolve(
      jsonResponse(404, { actionId: 'action-1', status: 'accepted' })
    );

    await expect(pending).resolves.toMatchObject({
      status: 'succeeded',
      result: { socket: true },
    });
    expect(useUserActionQueueBase.getState().isNetworkBlocked).toBe(false);
  });

  it('clears the queue only when the authenticated account changes', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(404, {}));
    const { useUserActionQueueBase } = await import('./userActionQueue');
    expect(auth.subscriber).toBeDefined();
    auth.subscriber?.({ token: 'same' }, { token: 'same' });
    useUserActionQueueBase.setState({ isNetworkBlocked: true });
    auth.subscriber?.({ token: 'new' }, { token: 'old' });
    expect(useUserActionQueueBase.getState().isNetworkBlocked).toBe(false);
    useUserActionQueueBase.getState().setNetworkBlocked(true);
    expect(useUserActionQueueBase.getState().isNetworkBlocked).toBe(true);
  });
});
