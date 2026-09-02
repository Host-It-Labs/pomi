import type { UserAction, UserActionStatus } from '@pomi/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserActionsService } from '../../src/user-actions/user-actions.service';
import { TimerMutationOutcomeUnknownException } from '../../src/timer/timer.service';

const sentryInfo = vi.hoisted(() => vi.fn());

vi.mock('@sentry/nestjs', () => ({ logger: { info: sentryInfo } }));

type StoredStatus = UserActionStatus;

class InMemoryUserActionsStore {
  readonly queue = new Map<string, string[]>();
  readonly records = new Map<string, StoredStatus>();
  readonly executionActions = new Map<string, UserAction>();
  readonly releasedLocks: string[] = [];
  readonly acquireResults: boolean[] = [];
  acquireBarrier: Promise<void> | null = null;
  failReadCount = 0;
  acquireCalls = 0;
  onEmptyHead: (() => void) | null = null;

  private key(userId: string, actionId: string) {
    return `${userId}:${actionId}`;
  }

  async listQueuedUsers() {
    return [...this.queue.keys()];
  }

  async listRecent(userId: string) {
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([, value]) => value);
  }

  async acquireLock() {
    this.acquireCalls += 1;
    if (this.acquireBarrier) await this.acquireBarrier;
    return this.acquireResults.shift() ?? true;
  }

  async renewLock() {}

  async releaseLock(userId: string) {
    this.releasedLocks.push(userId);
  }

  async queueHead(userId: string) {
    const head = this.queue.get(userId)?.[0] ?? null;
    if (!head && this.onEmptyHead) {
      const onEmptyHead = this.onEmptyHead;
      this.onEmptyHead = null;
      onEmptyHead();
    }
    return head;
  }

  async removeQueueHead(userId: string) {
    this.queue.get(userId)?.shift();
  }

  async read(userId: string, actionId: string) {
    if (this.failReadCount > 0) {
      this.failReadCount -= 1;
      throw new Error('Transient status read failure');
    }
    return this.records.get(this.key(userId, actionId)) ?? null;
  }

  async write(userId: string, status: StoredStatus) {
    this.records.set(this.key(userId, status.actionId), status);
  }

  async cancel(userId: string, actionId: string, fallback: StoredStatus) {
    const key = this.key(userId, actionId);
    const existing = this.records.get(key);
    if (existing) return { status: existing, created: false };
    this.records.set(key, fallback);
    return { status: fallback, created: true };
  }

  async readExecutionAction(userId: string, actionId: string) {
    return this.executionActions.get(this.key(userId, actionId)) ?? null;
  }

  async removeExecutionAction(userId: string, actionId: string) {
    this.executionActions.delete(this.key(userId, actionId));
  }

  add(userId: string, status: StoredStatus, executionAction?: UserAction) {
    const key = this.key(userId, status.actionId);
    this.records.set(key, status);
    this.queue.set(userId, [
      ...(this.queue.get(userId) ?? []),
      status.actionId,
    ]);
    if (executionAction) this.executionActions.set(key, executionAction);
  }
}

function accepted(actionId: string, action: UserAction): StoredStatus {
  return {
    actionId,
    status: 'accepted',
    action,
    acceptedAt: 1,
    updatedAt: 1,
  };
}

function createService(
  store: InMemoryUserActionsStore,
  assistantCapture: Record<string, unknown> = {},
  tasksService: Record<string, unknown> = {}
) {
  const lifecycle: UserActionStatus[] = [];
  const timerCalls: string[] = [];
  const timerService = {
    pauseTimer: async () => timerCalls.push('pause'),
    resetTimer: async () => timerCalls.push('reset'),
    createOrResumeTimer: vi.fn(async () => ({ id: 'timer-1' })),
  };
  const service = new UserActionsService(
    {
      emitUserActionUpdate: (_userId: string, status: UserActionStatus) =>
        lifecycle.push(status),
    } as never,
    timerService as never,
    tasksService as never,
    {} as never,
    {} as never,
    {} as never,
    store as never,
    assistantCapture as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
  return { service, lifecycle, timerCalls, timerService };
}

beforeEach(() => {
  sentryInfo.mockReset();
});

describe('UserActionsService accepted-action queue', () => {
  it('pages account-scoped recovery metadata without payloads or results', async () => {
    const store = new InMemoryUserActionsStore();
    store.records.set('user-1:action-1', {
      ...accepted('action-1', {
        kind: 'tasks',
        operation: 'create',
        title: 'Private title',
        description: 'Private description',
      }),
      result: { title: 'Private result' },
      updatedAt: 3,
    });
    store.records.set('user-1:action-2', {
      ...accepted('action-2', { kind: 'timer', operation: 'pause' }),
      updatedAt: 2,
    });
    store.records.set('user-2:action-3', {
      ...accepted('action-3', { kind: 'lists', operation: 'create' }),
      updatedAt: 4,
    });
    const { service } = createService(store);

    const firstPage = await service.listRecentActions(
      'user-1',
      undefined,
      undefined,
      1
    );
    expect(firstPage.items).toEqual([
      {
        actionId: 'action-1',
        status: 'accepted',
        action: { kind: 'tasks', operation: 'create' },
        acceptedAt: 1,
        updatedAt: 3,
      },
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    await expect(
      service.listRecentActions('user-2', firstPage.nextCursor!, undefined, 1)
    ).rejects.toThrow('Invalid user action cursor');
    await expect(
      service.listRecentActions('user-1', firstPage.nextCursor!, undefined, 1)
    ).resolves.toMatchObject({
      items: [
        {
          actionId: 'action-2',
          action: { kind: 'timer', operation: 'pause' },
        },
      ],
      nextCursor: null,
    });
  });

  it('strips the action envelope before executing a queued Task update', async () => {
    const store = new InMemoryUserActionsStore();
    const updateTask = vi.fn(async () => ({ status: 'completed' }));
    const action = {
      kind: 'tasks' as const,
      operation: 'update' as const,
      taskId: 'task-1',
      status: 'completed' as const,
      expectedDueDate: null,
      expectedDueTime: null,
    };
    store.add('user-1', accepted('task-update', action), action);
    const { service } = createService(store, {}, { updateTask });

    await (
      service as unknown as { processUserQueue(userId: string): Promise<void> }
    ).processUserQueue('user-1');

    expect(updateTask).toHaveBeenCalledWith('user-1', 'task-1', {
      status: 'completed',
      expectedDueDate: null,
      expectedDueTime: null,
    });
    expect(await store.read('user-1', 'task-update')).toMatchObject({
      status: 'succeeded',
    });
  });

  it('logs a cancel-before-submit terminal exactly once across retries', async () => {
    const store = new InMemoryUserActionsStore();
    const { service } = createService(store);

    await expect(
      service.cancel('user-1', 'client:cancel')
    ).resolves.toMatchObject({ status: 'cancelled' });
    await expect(
      service.cancel('user-1', 'client:cancel')
    ).resolves.toMatchObject({ status: 'cancelled' });

    expect(sentryInfo).toHaveBeenCalledOnce();
    expect(sentryInfo).toHaveBeenCalledWith(
      'User action backend timing',
      expect.objectContaining({
        action_id: 'client:cancel',
        lifecycle: 'cancelled',
      })
    );
  });

  it('retries a cross-instance lock handoff promptly', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const store = new InMemoryUserActionsStore();
    store.acquireResults.push(false, true);
    store.add(
      'user-1',
      accepted('client:pause', { kind: 'timer', operation: 'pause' }),
      { kind: 'timer', operation: 'pause' }
    );
    const { service, timerCalls } = createService(store);

    await (
      service as unknown as { processUserQueue(userId: string): Promise<void> }
    ).processUserQueue('user-1');
    expect(timerCalls).toEqual([]);

    await vi.advanceTimersByTimeAsync(250);

    expect(store.acquireCalls).toBe(2);
    expect(timerCalls).toEqual(['pause']);
    service.onModuleDestroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('rechecks a recovered running action at its remaining lease deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
    const store = new InMemoryUserActionsStore();
    store.add('user-1', {
      ...accepted('client:running', { kind: 'timer', operation: 'pause' }),
      status: 'running',
      startedAt: Date.now() - 59_900,
      updatedAt: Date.now() - 59_900,
    });
    const { service } = createService(store);

    await (
      service as unknown as { processUserQueue(userId: string): Promise<void> }
    ).processUserQueue('user-1');
    await vi.advanceTimersByTimeAsync(101);

    expect(await store.read('user-1', 'client:running')).toMatchObject({
      status: 'failed',
      outcomeUnknown: true,
    });
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  it('preserves the running lease wakeup across a transient status read failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const store = new InMemoryUserActionsStore();
    store.add('user-1', {
      ...accepted('client:running', { kind: 'timer', operation: 'pause' }),
      status: 'running',
      startedAt: Date.now() - 59_900,
      updatedAt: Date.now() - 59_900,
    });
    const { service } = createService(store);
    const processQueue = () =>
      (
        service as unknown as {
          processUserQueue(userId: string): Promise<void>;
        }
      ).processUserQueue('user-1');

    await processQueue();
    store.failReadCount = 1;
    await processQueue();
    await vi.advanceTimersByTimeAsync(101);

    expect(await store.read('user-1', 'client:running')).toMatchObject({
      status: 'failed',
      outcomeUnknown: true,
    });
    service.onModuleDestroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not schedule work after destruction completes an in-flight lock request', async () => {
    vi.useFakeTimers();
    let releaseAcquire: (() => void) | undefined;
    const store = new InMemoryUserActionsStore();
    store.acquireBarrier = new Promise<void>(resolve => {
      releaseAcquire = resolve;
    });
    store.add(
      'user-1',
      accepted('client:pause', { kind: 'timer', operation: 'pause' }),
      { kind: 'timer', operation: 'pause' }
    );
    const { service, timerCalls } = createService(store);
    const processing = (
      service as unknown as { processUserQueue(userId: string): Promise<void> }
    ).processUserQueue('user-1');
    await vi.waitFor(() => expect(store.acquireCalls).toBe(1));

    service.onModuleDestroy();
    releaseAcquire?.();
    await processing;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(store.acquireCalls).toBe(1);
    expect(store.releasedLocks).toEqual(['user-1']);
    expect(timerCalls).toEqual([]);
    vi.useRealTimers();
  });

  it('commits a prepared capture only when its ID matches the durable action ID', async () => {
    const store = new InMemoryUserActionsStore();
    const commitPreparedTaskFromText = vi.fn(async () => ({ tasks: [] }));
    store.add(
      'user-1',
      accepted('prep-1', {
        kind: 'assistant',
        operation: 'commitPreparedTaskFromText',
        payload: { preparationId: 'prep-1' },
      }),
      {
        kind: 'assistant',
        operation: 'commitPreparedTaskFromText',
        payload: { preparationId: 'prep-1' },
      }
    );
    store.add(
      'user-1',
      accepted('different-action', {
        kind: 'assistant',
        operation: 'commitPreparedTaskFromText',
        payload: { preparationId: 'prep-1' },
      }),
      {
        kind: 'assistant',
        operation: 'commitPreparedTaskFromText',
        payload: { preparationId: 'prep-1' },
      }
    );
    const { service } = createService(store, {
      commitPreparedTaskFromText,
    });

    await (
      service as unknown as { processUserQueue(userId: string): Promise<void> }
    ).processUserQueue('user-1');

    expect(commitPreparedTaskFromText).toHaveBeenCalledOnce();
    expect(commitPreparedTaskFromText).toHaveBeenCalledWith('user-1', 'prep-1');
    expect(await store.read('user-1', 'prep-1')).toMatchObject({
      status: 'succeeded',
    });
    expect(await store.read('user-1', 'different-action')).toMatchObject({
      status: 'failed',
      error: { message: 'Assistant preparation ID must match the action ID' },
    });
  });

  it('passes selected List context through a prepared Assistant action', async () => {
    const store = new InMemoryUserActionsStore();
    const commitPreparedTaskFromText = vi.fn(async () => ({ tasks: [] }));
    const action = {
      kind: 'assistant' as const,
      operation: 'commitPreparedTaskFromText' as const,
      payload: { preparationId: 'prep-list', listId: 'list-1' },
    };
    store.add('user-1', accepted('prep-list', action), action);
    const { service } = createService(store, {
      commitPreparedTaskFromText,
    });

    await (
      service as unknown as { processUserQueue(userId: string): Promise<void> }
    ).processUserQueue('user-1');

    expect(commitPreparedTaskFromText).toHaveBeenCalledWith(
      'user-1',
      'prep-list',
      'list-1'
    );
  });

  it('commits prepared voice only when its ID matches the durable action ID', async () => {
    const store = new InMemoryUserActionsStore();
    const commitPreparedVoiceCommand = vi.fn(async () => ({
      message: 'Done.',
    }));
    store.add(
      'user-1',
      accepted('voice-1', {
        kind: 'assistant',
        operation: 'commitPreparedVoiceCommand',
        payload: { preparationId: 'voice-1' },
      }),
      {
        kind: 'assistant',
        operation: 'commitPreparedVoiceCommand',
        payload: { preparationId: 'voice-1' },
      }
    );
    store.add(
      'user-1',
      accepted('other-action', {
        kind: 'assistant',
        operation: 'commitPreparedVoiceCommand',
        payload: { preparationId: 'voice-1' },
      }),
      {
        kind: 'assistant',
        operation: 'commitPreparedVoiceCommand',
        payload: { preparationId: 'voice-1' },
      }
    );
    const { service } = createService(store, {
      commitPreparedVoiceCommand,
    });

    await (
      service as unknown as { processUserQueue(userId: string): Promise<void> }
    ).processUserQueue('user-1');

    expect(commitPreparedVoiceCommand).toHaveBeenCalledOnce();
    expect(commitPreparedVoiceCommand).toHaveBeenCalledWith(
      'user-1',
      'voice-1'
    );
    expect(await store.read('user-1', 'voice-1')).toMatchObject({
      status: 'succeeded',
    });
    expect(await store.read('user-1', 'other-action')).toMatchObject({
      status: 'failed',
    });
  });

  it('recovers a stale voice commit from its immutable receipt', async () => {
    const store = new InMemoryUserActionsStore();
    const action = {
      kind: 'assistant' as const,
      operation: 'commitPreparedVoiceCommand' as const,
      payload: { preparationId: 'voice-1' },
    };
    store.add('user-1', {
      ...accepted('voice-1', action),
      status: 'running',
      startedAt: 1,
      updatedAt: Date.now() - 60_001,
    });
    const getPreparedVoiceCommitResult = vi.fn(async () => ({
      message: 'Already committed.',
    }));
    const commitPreparedVoiceCommand = vi.fn();
    const { service } = createService(store, {
      getPreparedVoiceCommitResult,
      commitPreparedVoiceCommand,
    });

    await (
      service as unknown as { processUserQueue(userId: string): Promise<void> }
    ).processUserQueue('user-1');

    expect(getPreparedVoiceCommitResult).toHaveBeenCalledWith(
      'user-1',
      'voice-1'
    );
    expect(commitPreparedVoiceCommand).not.toHaveBeenCalled();
    expect(await store.read('user-1', 'voice-1')).toMatchObject({
      status: 'succeeded',
      result: { message: 'Already committed.' },
    });
  });

  it('recovers an ambiguous voice commit failure from its receipt', async () => {
    const store = new InMemoryUserActionsStore();
    const action = {
      kind: 'assistant' as const,
      operation: 'commitPreparedVoiceCommand' as const,
      payload: { preparationId: 'voice-1' },
    };
    store.add('user-1', accepted('voice-1', action), action);
    const { service } = createService(store, {
      commitPreparedVoiceCommand: vi.fn(async () => {
        throw new Error('receipt response lost');
      }),
      getPreparedVoiceCommitResult: vi.fn(async () => ({
        message: 'Committed.',
      })),
    });

    await (
      service as unknown as { processUserQueue(userId: string): Promise<void> }
    ).processUserQueue('user-1');

    expect(await store.read('user-1', 'voice-1')).toMatchObject({
      status: 'succeeded',
      result: { message: 'Committed.' },
    });
  });

  it('marks a voice commit failure unknown when no receipt can prove its outcome', async () => {
    const store = new InMemoryUserActionsStore();
    const action = {
      kind: 'assistant' as const,
      operation: 'commitPreparedVoiceCommand' as const,
      payload: { preparationId: 'voice-1' },
    };
    store.add('user-1', accepted('voice-1', action), action);
    const { service } = createService(store, {
      commitPreparedVoiceCommand: vi.fn(async () => {
        throw new Error('commit interrupted');
      }),
      getPreparedVoiceCommitResult: vi.fn(async () => null),
    });

    await (
      service as unknown as { processUserQueue(userId: string): Promise<void> }
    ).processUserQueue('user-1');

    expect(await store.read('user-1', 'voice-1')).toMatchObject({
      status: 'failed',
      outcomeUnknown: true,
    });
  });

  it('marks a committed Timer transition with failed effects as outcome unknown', async () => {
    const store = new InMemoryUserActionsStore();
    const action = {
      kind: 'timer' as const,
      operation: 'skip' as const,
      requestedLogMode: 'elapsed' as const,
    };
    store.add('user-1', accepted('client:skip', action), action);
    const { service, timerService } = createService(store);
    Object.assign(timerService, {
      skipTimer: vi.fn(async () => {
        throw new TimerMutationOutcomeUnknownException(
          'Timer changed, but effects failed'
        );
      }),
    });

    await (
      service as unknown as { processUserQueue(userId: string): Promise<void> }
    ).processUserQueue('user-1');

    expect(await store.read('user-1', 'client:skip')).toMatchObject({
      status: 'failed',
      outcomeUnknown: true,
    });
  });

  it('forwards the first-Intention reset request through the Timer action gateway', async () => {
    const store = new InMemoryUserActionsStore();
    const action = {
      kind: 'timer' as const,
      operation: 'selectIntention' as const,
      timerType: 'break' as const,
      intention: 'focus',
      resetOnFirstIntention: true,
    };
    store.add('user-1', accepted('client:intention', action), action);
    const { service, timerService } = createService(store);
    const selectTimerIntention = vi.fn(async () => ({ id: 'timer-1' }));
    Object.assign(timerService, { selectTimerIntention });

    await (
      service as unknown as { processUserQueue(userId: string): Promise<void> }
    ).processUserQueue('user-1');

    expect(selectTimerIntention).toHaveBeenCalledWith(
      'user-1',
      'break',
      'focus',
      undefined,
      true
    );
    expect(await store.read('user-1', 'client:intention')).toMatchObject({
      status: 'succeeded',
    });
  });

  it('forwards a focused Task custom duration through the Timer action gateway', async () => {
    const store = new InMemoryUserActionsStore();
    const action = {
      kind: 'timer' as const,
      operation: 'createOrResume' as const,
      timerType: 'work' as const,
      intention: 'focus',
      intentions: ['focus'],
      subIntentions: { focus: 'planning' },
      focusedTaskId: 'task-1',
      customDuration: 1_800_000,
    };
    store.add('user-1', accepted('client:task-focus', action), action);
    const { service, timerService } = createService(store);

    await (
      service as unknown as { processUserQueue(userId: string): Promise<void> }
    ).processUserQueue('user-1');

    expect(timerService.createOrResumeTimer).toHaveBeenCalledWith('user-1', {
      type: 'work',
      intention: 'focus',
      intentions: ['focus'],
      subIntentions: { focus: 'planning' },
      focusedTaskId: 'task-1',
      customDuration: 1_800_000,
      resetOnFirstIntention: undefined,
    });
  });

  it('wakes a local long poll immediately when lifecycle state changes', async () => {
    const store = new InMemoryUserActionsStore();
    const initial = accepted('client:pause', {
      kind: 'timer',
      operation: 'pause',
    });
    store.add('user-1', initial);
    const { service } = createService(store);
    const pending = service.getStatus('user-1', 'client:pause', 25_000);
    await Promise.resolve();
    const succeeded: StoredStatus = {
      ...initial,
      status: 'succeeded',
      result: { ok: true },
      completedAt: 2,
      updatedAt: 2,
    };

    await (
      service as unknown as {
        writeStatus(userId: string, status: StoredStatus): Promise<void>;
      }
    ).writeStatus('user-1', succeeded);

    await expect(pending).resolves.toMatchObject({
      status: 'succeeded',
      result: { ok: true },
    });
  });

  it('executes each accepted command once in FIFO order, publishing durable lifecycle states', async () => {
    const store = new InMemoryUserActionsStore();
    store.add(
      'user-1',
      accepted('client:pause', { kind: 'timer', operation: 'pause' }),
      {
        kind: 'timer',
        operation: 'pause',
      }
    );
    store.add(
      'user-1',
      accepted('client:reset', { kind: 'timer', operation: 'reset' }),
      {
        kind: 'timer',
        operation: 'reset',
      }
    );
    const { service, lifecycle, timerCalls } = createService(store);

    await (
      service as unknown as { processUserQueue(userId: string): Promise<void> }
    ).processUserQueue('user-1');

    expect(timerCalls).toEqual(['pause', 'reset']);
    await expect(store.queueHead('user-1')).resolves.toBeNull();
    expect(await store.read('user-1', 'client:pause')).toMatchObject({
      status: 'succeeded',
    });
    expect(await store.read('user-1', 'client:reset')).toMatchObject({
      status: 'succeeded',
    });
    expect(
      lifecycle.map(status => `${status.actionId}:${status.status}`)
    ).toEqual([
      'client:pause:running',
      'client:pause:succeeded',
      'client:reset:running',
      'client:reset:succeeded',
    ]);
    expect(store.releasedLocks).toEqual(['user-1']);
    expect(sentryInfo).toHaveBeenCalledTimes(2);
    expect(sentryInfo).toHaveBeenCalledWith(
      'User action backend timing',
      expect.objectContaining({
        action_kind: 'timer',
        action_operation: 'pause',
        lifecycle: 'succeeded',
        backend_queue_ms: expect.any(Number),
        backend_execution_ms: expect.any(Number),
        backend_total_ms: expect.any(Number),
      })
    );
  });

  it('marks an abandoned running command outcome-unknown and continues with the following command', async () => {
    const store = new InMemoryUserActionsStore();
    store.add('user-1', {
      ...accepted('client:abandoned', { kind: 'timer', operation: 'pause' }),
      status: 'running',
      startedAt: 1,
      updatedAt: 1,
    });
    store.add(
      'user-1',
      accepted('client:reset', { kind: 'timer', operation: 'reset' }),
      {
        kind: 'timer',
        operation: 'reset',
      }
    );
    const { service, timerCalls } = createService(store);

    await (
      service as unknown as { processUserQueue(userId: string): Promise<void> }
    ).processUserQueue('user-1');

    expect(await store.read('user-1', 'client:abandoned')).toMatchObject({
      status: 'failed',
      outcomeUnknown: true,
      error: { message: 'Action worker stopped before completion' },
    });
    expect(timerCalls).toEqual(['reset']);
    await expect(store.queueHead('user-1')).resolves.toBeNull();
  });

  it('resumes work accepted while the previous worker is releasing its lock', async () => {
    const store = new InMemoryUserActionsStore();
    const { service, timerCalls } = createService(store);
    store.onEmptyHead = () => {
      store.add(
        'user-1',
        accepted('client:late-pause', { kind: 'timer', operation: 'pause' }),
        { kind: 'timer', operation: 'pause' }
      );
    };

    await (
      service as unknown as { processUserQueue(userId: string): Promise<void> }
    ).processUserQueue('user-1');

    await vi.waitFor(() => expect(timerCalls).toEqual(['pause']));
    await expect(store.queueHead('user-1')).resolves.toBeNull();
  });
});
