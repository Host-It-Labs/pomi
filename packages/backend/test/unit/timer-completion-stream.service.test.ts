import { TIMER_STATUSES, TIMER_TYPES, Timer } from '@pomi/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  ACK_AND_DELETE_COMPLETION_EVENT_SCRIPT,
  TIMER_COMPLETION_STREAM_GROUP,
  TimerCompletionStreamService,
} from '../../src/timer/timer-completion-stream.service';
import {
  TIMER_COMPLETION_STREAM_KEY,
  TIMER_COMPLETION_STREAM_VERSION,
} from '../../src/timer/timer-store';

describe('TimerCompletionStreamService', () => {
  it('acknowledges and deletes an event only after durable persistence', async () => {
    const harness = createHarness();
    const entry = completionEntry();

    await harness.processEntry(entry);

    expect(harness.persistCompletionEffects).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ id: 'timer-1' }),
      {
        completedAt: 61_000,
        isLastWorkTimerInSession: true,
      }
    );
    expect(harness.control.eval).toHaveBeenCalledWith(
      ACK_AND_DELETE_COMPLETION_EVENT_SCRIPT,
      1,
      TIMER_COMPLETION_STREAM_KEY,
      TIMER_COMPLETION_STREAM_GROUP,
      '1-0'
    );
  });

  it('leaves transient persistence failures pending', async () => {
    const harness = createHarness();
    harness.persistCompletionEffects.mockRejectedValueOnce(
      new Error('database unavailable')
    );

    await harness.processEntry(completionEntry());

    expect(harness.control.eval).not.toHaveBeenCalled();
  });

  it('keeps unknown event versions pending without applying effects', async () => {
    const harness = createHarness();
    const [id, fields] = completionEntry();
    fields[1] = '2';

    await harness.processEntry([id, fields]);

    expect(harness.persistCompletionEffects).not.toHaveBeenCalled();
    expect(harness.control.eval).not.toHaveBeenCalled();
  });

  it.each([
    ['a primitive Timer', '1'],
    ['a null Timer', 'null'],
    ['an array Timer', '[]'],
  ])('keeps %s pending', async (_name, serializedTimer) => {
    const harness = createHarness();
    const entry = completionEntry();
    replaceField(entry, 'timer', serializedTimer);

    await harness.processEntry(entry);

    expect(harness.persistCompletionEffects).not.toHaveBeenCalled();
    expect(harness.control.eval).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown type', { type: 'focus' }],
    ['fractional start', { startTime: 1.5 }],
    ['unsafe duration', { duration: Number.MAX_SAFE_INTEGER + 1 }],
    ['negative duration', { duration: -1 }],
    ['a zero optional duration', { extensionBaseDuration: 0 }],
    ['an empty intention list', { intentionSlugs: [] }],
    ['a non-string intention slug', { intentionSlugs: [1] }],
    ['a non-string sub-intention', { subIntentions: { focus: 1 } }],
    ['a malformed session emoji', { sessionIntentionEmojis: { 1: 1 } }],
    ['an empty focused task ID', { focusedTaskIds: [''] }],
    ['a non-boolean extension flag', { isExtension: 'yes' }],
    ['only a session position', { sessionTotal: undefined }],
    ['a zero session position', { sessionPosition: 0 }],
    ['a position beyond its session', { sessionPosition: 5 }],
  ])('keeps a Timer with %s pending', async (_name, timerPatch) => {
    const harness = createHarness();
    const entry = completionEntry();
    patchTimer(entry, timerPatch);

    await harness.processEntry(entry);

    expect(harness.persistCompletionEffects).not.toHaveBeenCalled();
    expect(harness.control.eval).not.toHaveBeenCalled();
  });

  it('keeps a zero-duration Timer pending even with matching timestamps', async () => {
    const harness = createHarness();
    const entry = completionEntry();
    patchTimer(entry, { duration: 0 });
    replaceField(entry, 'completedAt', '1000');

    await harness.processEntry(entry);

    expect(harness.persistCompletionEffects).not.toHaveBeenCalled();
    expect(harness.control.eval).not.toHaveBeenCalled();
  });

  it('rejects duplicate Stream field names', async () => {
    const harness = createHarness();
    const entry = completionEntry();
    entry[1].push('userId', 'user-1');

    await harness.processEntry(entry);

    expect(harness.persistCompletionEffects).not.toHaveBeenCalled();
    expect(harness.control.eval).not.toHaveBeenCalled();
  });

  it.each(['', '1.5', '-1', '9007199254740992'])(
    'rejects a non-safe completedAt value of %j',
    async completedAt => {
      const harness = createHarness();
      const entry = completionEntry();
      replaceField(entry, 'completedAt', completedAt);

      await harness.processEntry(entry);

      expect(harness.persistCompletionEffects).not.toHaveBeenCalled();
      expect(harness.control.eval).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['regular final work Timer', {}, true],
    ['regular non-final work Timer', { sessionPosition: 3 }, false],
    [
      'extension followed by a long break',
      { isExtension: true, extensionNextTimerType: TIMER_TYPES.LONG_BREAK },
      true,
    ],
    [
      'extension followed by work',
      { isExtension: true, extensionNextTimerType: TIMER_TYPES.WORK },
      true,
    ],
    [
      'extension followed by a break',
      { isExtension: true, extensionNextTimerType: TIMER_TYPES.BREAK },
      false,
    ],
  ])(
    'uses stable snapshot semantics for %s',
    async (_name, patch, expected) => {
      const harness = createHarness();
      const entry = completionEntry();
      patchTimer(entry, patch);

      await harness.processEntry(entry);

      expect(harness.persistCompletionEffects).toHaveBeenCalledWith(
        'user-1',
        expect.any(Object),
        expect.objectContaining({ isLastWorkTimerInSession: expected })
      );
    }
  );

  it('bounds concurrency across users and preserves each user order', async () => {
    const harness = createHarness();
    let active = 0;
    let maxActive = 0;
    const persistedTimerIds: string[] = [];
    harness.persistCompletionEffects.mockImplementation(
      async (_userId: string, timer: Timer) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        persistedTimerIds.push(timer.id);
        await new Promise(resolve => setTimeout(resolve, 5));
        active -= 1;
        return {
          applied: true,
          notificationIdempotencyKey: `timer-completed:${timer.id}`,
        };
      }
    );
    const entries = Array.from({ length: 8 }, (_, index) =>
      completionEntryFor(
        `user-${index + 1}`,
        `timer-${index + 1}`,
        `${index + 1}-0`
      )
    );
    entries.push(completionEntryFor('user-1', 'timer-9', '9-0'));

    await harness.processEntries(entries);

    expect(maxActive).toBe(5);
    expect(persistedTimerIds.indexOf('timer-1')).toBeLessThan(
      persistedTimerIds.indexOf('timer-9')
    );
  });

  it('ignores only BUSYGROUP while creating the consumer group', async () => {
    const harness = createHarness();
    harness.control.xgroup.mockRejectedValueOnce(
      new Error('BUSYGROUP Consumer Group name already exists')
    );
    await expect(harness.ensureConsumerGroup()).resolves.toBeUndefined();

    harness.control.xgroup.mockRejectedValueOnce(
      new Error('redis unavailable')
    );
    await expect(harness.ensureConsumerGroup()).rejects.toThrow(
      'redis unavailable'
    );
  });

  it('retries a transient consumer-group startup failure', async () => {
    const harness = createHarness();
    harness.control.xgroup
      .mockRejectedValueOnce(new Error('redis unavailable'))
      .mockResolvedValueOnce('OK');
    harness.control.get.mockResolvedValue('legacy');
    let waits = 0;
    Object.assign(harness.service, {
      wait: vi.fn(async () => {
        waits += 1;
        if (waits === 2) {
          Object.assign(harness.service, { stopping: true });
        }
      }),
    });

    await harness.runLoop();

    expect(harness.control.xgroup).toHaveBeenCalledTimes(2);
  });

  it('recreates a consumer group lost during Redis recovery', async () => {
    const harness = createHarness();
    harness.control.xgroup.mockResolvedValue('OK');
    harness.control.get.mockResolvedValue('stream');
    harness.control.xautoclaim
      .mockRejectedValueOnce(new Error('NOGROUP No such key or group'))
      .mockResolvedValueOnce(['0-0', [], []]);
    harness.reader.xreadgroup.mockImplementationOnce(async () => {
      Object.assign(harness.service, { stopping: true });
      return null;
    });
    Object.assign(harness.service, { wait: vi.fn(async () => undefined) });

    await harness.runLoop();

    expect(harness.control.xgroup).toHaveBeenCalledTimes(2);
  });

  it('drains existing Stream work after producers return to legacy mode', async () => {
    const harness = createHarness();
    harness.control.xgroup.mockResolvedValue('OK');
    harness.control.get.mockResolvedValue('legacy');
    harness.control.xlen.mockResolvedValueOnce(1).mockResolvedValue(0);
    harness.control.xautoclaim.mockResolvedValueOnce([
      '0-0',
      [completionEntry()],
      [],
    ]);
    Object.assign(harness.service, {
      wait: vi.fn(async () => {
        Object.assign(harness.service, { stopping: true });
      }),
    });

    await harness.runLoop();

    expect(harness.persistCompletionEffects).toHaveBeenCalledTimes(1);
    expect(harness.control.eval).toHaveBeenCalledTimes(1);
    expect(harness.reader.xreadgroup).not.toHaveBeenCalled();
  });

  it('disconnects both owned Redis clients during shutdown', async () => {
    const harness = createHarness();

    await harness.service.onModuleDestroy();

    expect(harness.control.disconnect).toHaveBeenCalledOnce();
    expect(harness.reader.disconnect).toHaveBeenCalledOnce();
  });

  function createHarness() {
    const control = {
      on: vi.fn(),
      disconnect: vi.fn(),
      get: vi.fn(),
      xgroup: vi.fn(),
      xautoclaim: vi.fn(),
      xlen: vi.fn(async () => 0),
      eval: vi.fn(async () => [1, 1]),
    };
    const reader = {
      on: vi.fn(),
      disconnect: vi.fn(),
      xreadgroup: vi.fn(),
    };
    const redis = {
      duplicate: vi
        .fn()
        .mockReturnValueOnce(control)
        .mockReturnValueOnce(reader),
    };
    const persistCompletionEffects = vi.fn(async () => ({
      applied: true,
      notificationIdempotencyKey: 'timer-completed:timer-1',
    }));
    const service = new TimerCompletionStreamService(
      redis as never,
      { persistCompletionEffects } as never
    );
    Object.assign(service, { logger: { error: vi.fn() } });
    const internals = service as unknown as {
      processEntry(entry: [string, string[]]): Promise<void>;
      processEntries(entries: Array<[string, string[]]>): Promise<void>;
      ensureConsumerGroup(): Promise<void>;
      runLoop(): Promise<void>;
    };
    return {
      service,
      reader,
      control,
      redis,
      persistCompletionEffects,
      processEntry: internals.processEntry.bind(service),
      processEntries: internals.processEntries.bind(service),
      ensureConsumerGroup: internals.ensureConsumerGroup.bind(service),
      runLoop: internals.runLoop.bind(service),
    };
  }

  function replaceField(
    entry: [string, string[]],
    fieldName: string,
    value: string
  ): void {
    const index = entry[1].indexOf(fieldName);
    entry[1][index + 1] = value;
  }

  function patchTimer(
    entry: [string, string[]],
    patch: Record<string, unknown>
  ): void {
    const index = entry[1].indexOf('timer');
    const timer = JSON.parse(entry[1][index + 1]) as Timer;
    entry[1][index + 1] = JSON.stringify({ ...timer, ...patch });
  }

  function completionEntryFor(
    userId: string,
    timerId: string,
    eventId: string
  ): [string, string[]] {
    const entry = completionEntry();
    entry[0] = eventId;
    replaceField(entry, 'userId', userId);
    replaceField(entry, 'timerId', timerId);
    patchTimer(entry, { userId, id: timerId });
    return entry;
  }

  function completionEntry(): [string, string[]] {
    const timer: Timer = {
      id: 'timer-1',
      userId: 'user-1',
      scheduleRevision: 'revision-1',
      startTime: 1_000,
      duration: 60_000,
      remainingTime: 0,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.COMPLETED,
      sessionPosition: 4,
      sessionTotal: 4,
    };
    return [
      '1-0',
      [
        'schemaVersion',
        TIMER_COMPLETION_STREAM_VERSION,
        'userId',
        'user-1',
        'timerId',
        timer.id,
        'scheduleRevision',
        timer.scheduleRevision as string,
        'completedAt',
        '61000',
        'claimedAt',
        '61001',
        'timer',
        JSON.stringify(timer),
      ],
    ];
  }
});
