import { TIMER_STATUSES, TIMER_TYPES, Timer } from '@pomi/shared';
import { describe, expect, it, vi } from 'vitest';
import { TimerIdleDetectionStreamService } from '../../src/timer/timer-idle-detection-stream.service';

describe('TimerIdleDetectionStreamService', () => {
  it('persists effects before acknowledging a valid idle event', async () => {
    const order: string[] = [];
    const evalCommand = vi.fn(async () => {
      order.push('ack');
      return [1, 1];
    });
    const persistIdleDetectionEffects = vi.fn(async () => {
      order.push('persist');
    });
    const harness = createService(evalCommand, persistIdleDetectionEffects);

    await internals(harness.service).processEntry(['event-1', fields()]);

    expect(persistIdleDetectionEffects).toHaveBeenCalledWith(
      'user-1',
      longBreakTimer(),
      {
        detectionId: 'detection-1',
        detectedAt: 901_000,
        replacementTimer: replacementTimer(),
      }
    );
    expect(order).toEqual(['persist', 'ack']);
    expect(harness.emitTimerUpdate).toHaveBeenCalledWith(
      'user-1',
      replacementTimer()
    );
  });

  it('leaves malformed events pending', async () => {
    const evalCommand = vi.fn();
    const persistIdleDetectionEffects = vi.fn();
    const harness = createService(evalCommand, persistIdleDetectionEffects);

    await internals(harness.service).processEntry([
      'event-1',
      fields().map(value => (value === 'detection-1' ? '' : value)),
    ]);

    expect(persistIdleDetectionEffects).not.toHaveBeenCalled();
    expect(evalCommand).not.toHaveBeenCalled();
  });

  it('contains transient idle-check failures as retryable warnings', () => {
    const harness = createService(vi.fn(), vi.fn());
    const logger = (
      harness.service as unknown as {
        logger: {
          error: ReturnType<typeof vi.fn>;
          warn: ReturnType<typeof vi.fn>;
        };
      }
    ).logger;

    internals(harness.service).reportIterationFailure(
      Object.assign(new Error('redis unavailable'), { code: 'ECONNRESET' })
    );

    expect(logger.warn).toHaveBeenCalledWith(
      'Timer idle Stream dependency unavailable; retrying (Error (ECONNRESET))'
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  function createService(
    evalCommand: ReturnType<typeof vi.fn>,
    persistIdleDetectionEffects: ReturnType<typeof vi.fn>
  ) {
    const connection = {
      on: vi.fn(),
      eval: evalCommand,
      disconnect: vi.fn(),
    };
    const emitTimerUpdate = vi.fn();
    const service = new TimerIdleDetectionStreamService(
      { duplicate: vi.fn(() => connection) } as never,
      { persistIdleDetectionEffects } as never,
      { associateTimerWithUser: vi.fn(async () => undefined) } as never,
      {
        emitTimerUpdate,
        emitExtensionStateUpdate: vi.fn(),
        emitTimerHistoryUpdate: vi.fn(),
      } as never
    );
    Object.assign(service, { logger: { error: vi.fn(), warn: vi.fn() } });
    return { service, emitTimerUpdate };
  }

  function internals(service: TimerIdleDetectionStreamService) {
    return service as unknown as {
      processEntry(entry: [string, string[]]): Promise<void>;
      reportIterationFailure(error: unknown): void;
    };
  }

  function fields(): string[] {
    return [
      'schemaVersion',
      '1',
      'userId',
      'user-1',
      'detectionId',
      'detection-1',
      'detectedAt',
      '901000',
      'longBreakTimer',
      JSON.stringify(longBreakTimer()),
      'replacementTimer',
      JSON.stringify(replacementTimer()),
    ];
  }

  function longBreakTimer(): Timer {
    return {
      id: 'long-break-1',
      scheduleRevision: 'detection-1',
      userId: 'user-1',
      startTime: 1_000,
      duration: 900_000,
      remainingTime: 0,
      type: TIMER_TYPES.LONG_BREAK,
      status: TIMER_STATUSES.COMPLETED,
      hasNotifiedLongBreakDetection: true,
    };
  }

  function replacementTimer(): Timer {
    return {
      id: 'work-1',
      scheduleRevision: 'work-revision-1',
      userId: 'user-1',
      startTime: 0,
      duration: 1_500_000,
      remainingTime: 1_500_000,
      type: TIMER_TYPES.WORK,
      status: TIMER_STATUSES.PAUSED,
    };
  }
});
