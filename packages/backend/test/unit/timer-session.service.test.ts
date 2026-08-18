import { TIMER_STATUSES, TIMER_TYPES, type Timer } from '@pomi/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreferencesService } from '../../src/preferences/preferences.service';
import { TimerSessionService } from '../../src/timer/timer-session.service';
import type { TimerSessionState } from '../../src/timer/timer-store';

function createTimer(overrides: Partial<Timer>): Timer {
  return {
    id: 'timer-1',
    userId: 'user-1',
    type: TIMER_TYPES.WORK,
    status: TIMER_STATUSES.PAUSED,
    duration: 25 * 60_000,
    remainingTime: 25 * 60_000,
    startTime: 0,
    intentionSlugs: [],
    subIntentions: {},
    ...overrides,
  };
}

function createFixture(input: {
  timer: Timer | null;
  sessionState?: TimerSessionState | null;
  sessionPomodorosCount?: number;
}) {
  let currentTimer = input.timer;
  let sessionState = input.sessionState ?? null;
  const setCurrentTimer = vi.fn(
    async (
      _userId: string,
      _expected: unknown,
      timer: Timer,
      options?: { sessionState?: TimerSessionState | null }
    ) => {
      timer.scheduleRevision = 'revision-next';
      currentTimer = timer;
      if (options?.sessionState !== undefined) {
        sessionState = options.sessionState;
      }
      return { kind: 'updated' as const, timer };
    }
  );
  const setSessionState = vi.fn(
    async (_userId: string, state: TimerSessionState) => {
      sessionState = state;
    }
  );
  const emitTimerUpdate = vi.fn();
  const getPreferences = vi.fn(async () => ({
    sessionPomodorosCount: input.sessionPomodorosCount ?? 3,
  }));
  const service = new TimerSessionService(
    { getPreferences } as never,
    {
      getCurrentTimer: vi.fn(async () => currentTimer),
      replaceCurrentTimer: setCurrentTimer,
      getSessionState: vi.fn(async () => sessionState),
      setSessionState,
    } as never,
    { emitTimerUpdate } as never
  );

  return {
    service,
    get currentTimer() {
      return currentTimer;
    },
    get sessionState() {
      return sessionState;
    },
    getPreferences,
    setCurrentTimer,
    setSessionState,
    emitTimerUpdate,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('TimerSessionService.applySessionToCurrentTimer', () => {
  it('retains its forward reference to PreferencesService', () => {
    const dependencies = Reflect.getMetadata(
      'self:paramtypes',
      TimerSessionService
    ) as Array<{
      index: number;
      param: { forwardRef: () => unknown };
    }>;
    expect(dependencies[0].index).toBe(0);
    expect(dependencies[0].param.forwardRef()).toBe(PreferencesService);
  });

  it('returns null when no current timer exists', async () => {
    const fixture = createFixture({ timer: null });
    await expect(
      fixture.service.applySessionToCurrentTimer('user-1')
    ).resolves.toBeNull();
    expect(fixture.getPreferences).not.toHaveBeenCalled();
  });

  it('leaves non-work and complete session timers untouched', async () => {
    for (const timer of [
      createTimer({ type: TIMER_TYPES.BREAK }),
      createTimer({ sessionPosition: 2, sessionTotal: 4 }),
    ]) {
      const fixture = createFixture({ timer });
      await expect(
        fixture.service.applySessionToCurrentTimer('user-1')
      ).resolves.toBe(timer);
      expect(fixture.setCurrentTimer).not.toHaveBeenCalled();
    }
  });

  it('initializes incomplete work session metadata and emits authoritative state', async () => {
    for (const timer of [
      createTimer({}),
      createTimer({ sessionPosition: 2, sessionTotal: undefined }),
      createTimer({ sessionPosition: undefined, sessionTotal: 4 }),
    ]) {
      const fixture = createFixture({ timer, sessionPomodorosCount: 4 });
      const result = await fixture.service.applySessionToCurrentTimer('user-1');
      expect(result).toMatchObject({ sessionPosition: 1, sessionTotal: 4 });
      expect(result?.sessionIntentionEmojis).toBeUndefined();
      expect(fixture.sessionState).toEqual({
        currentPosition: 1,
        totalPomodoros: 4,
      });
      expect(fixture.setCurrentTimer).toHaveBeenCalledWith(
        'user-1',
        { timerId: 'timer-1', scheduleRevision: null },
        timer,
        {
          sessionState: { currentPosition: 1, totalPomodoros: 4 },
        }
      );
      expect(fixture.emitTimerUpdate).toHaveBeenCalledWith('user-1', timer);
    }
  });

  it('returns the concurrent winner without emitting a stale update', async () => {
    const timer = createTimer({});
    const winner = createTimer({ id: 'timer-winner' });
    const fixture = createFixture({ timer });
    fixture.setCurrentTimer.mockResolvedValueOnce({
      kind: 'conflict',
      current: winner,
    } as never);

    await expect(
      fixture.service.applySessionToCurrentTimer('user-1')
    ).resolves.toBe(winner);
    expect(fixture.emitTimerUpdate).not.toHaveBeenCalled();
  });
});

describe('TimerSessionService.updateSessionTotal', () => {
  it('returns null when no current timer exists', async () => {
    const fixture = createFixture({ timer: null });
    await expect(
      fixture.service.updateSessionTotal('user-1')
    ).resolves.toBeNull();
  });

  it('initializes incomplete work timers but leaves incomplete breaks unchanged', async () => {
    const work = createFixture({
      timer: createTimer({ sessionPosition: 2, sessionTotal: undefined }),
      sessionPomodorosCount: 5,
    });
    await expect(
      work.service.updateSessionTotal('user-1')
    ).resolves.toMatchObject({
      sessionPosition: 1,
      sessionTotal: 5,
    });
    expect(work.sessionState).toEqual({
      currentPosition: 1,
      totalPomodoros: 5,
    });
    expect(work.emitTimerUpdate).toHaveBeenCalledOnce();

    for (const timer of [
      createTimer({ type: TIMER_TYPES.BREAK }),
      createTimer({ type: TIMER_TYPES.BREAK, sessionPosition: 1 }),
    ]) {
      const breakFixture = createFixture({ timer });
      await expect(
        breakFixture.service.updateSessionTotal('user-1')
      ).resolves.toBe(timer);
      expect(breakFixture.setCurrentTimer).not.toHaveBeenCalled();
    }
  });

  it('returns the concurrent winner while initializing an incomplete work timer', async () => {
    const timer = createTimer({ sessionPosition: 2, sessionTotal: undefined });
    const winner = createTimer({ id: 'timer-winner' });
    const fixture = createFixture({ timer });
    fixture.setCurrentTimer.mockResolvedValueOnce({
      kind: 'conflict',
      current: winner,
    } as never);

    await expect(fixture.service.updateSessionTotal('user-1')).resolves.toBe(
      winner
    );
    expect(fixture.emitTimerUpdate).not.toHaveBeenCalled();
  });

  it('leaves a complete timer unchanged when session state is absent', async () => {
    const timer = createTimer({ sessionPosition: 2, sessionTotal: 3 });
    const fixture = createFixture({ timer, sessionState: null });
    await expect(fixture.service.updateSessionTotal('user-1')).resolves.toBe(
      timer
    );
    expect(fixture.setCurrentTimer).not.toHaveBeenCalled();
  });

  it('updates totals and completed emojis without clamping a valid position', async () => {
    const timer = createTimer({ sessionPosition: 2, sessionTotal: 3 });
    const state: TimerSessionState = {
      currentPosition: 2,
      totalPomodoros: 3,
      completedIntentionEmojis: { 1: '🎯' },
    };
    const fixture = createFixture({
      timer,
      sessionState: state,
      sessionPomodorosCount: 4,
    });
    await fixture.service.updateSessionTotal('user-1');
    expect(timer).toMatchObject({
      sessionPosition: 2,
      sessionTotal: 4,
      sessionIntentionEmojis: { 1: '🎯' },
    });
    expect(state).toMatchObject({ currentPosition: 2, totalPomodoros: 4 });
    expect(fixture.setSessionState).not.toHaveBeenCalled();
    expect(fixture.emitTimerUpdate).toHaveBeenCalledWith('user-1', timer);
  });

  it('returns the concurrent winner while updating a complete session', async () => {
    const timer = createTimer({ sessionPosition: 2, sessionTotal: 3 });
    const state: TimerSessionState = {
      currentPosition: 2,
      totalPomodoros: 3,
    };
    const winner = createTimer({ id: 'timer-winner' });
    const fixture = createFixture({ timer, sessionState: state });
    fixture.setCurrentTimer.mockResolvedValueOnce({
      kind: 'conflict',
      current: winner,
    } as never);

    await expect(fixture.service.updateSessionTotal('user-1')).resolves.toBe(
      winner
    );
    expect(fixture.emitTimerUpdate).not.toHaveBeenCalled();
  });

  it('clamps timer and state positions when the total shrinks', async () => {
    const timer = createTimer({ sessionPosition: 4, sessionTotal: 4 });
    const state: TimerSessionState = {
      currentPosition: 4,
      totalPomodoros: 4,
      completedIntentionEmojis: {},
    };
    const fixture = createFixture({
      timer,
      sessionState: state,
      sessionPomodorosCount: 2,
    });
    await fixture.service.updateSessionTotal('user-1');
    expect(timer.sessionPosition).toBe(2);
    expect(state).toMatchObject({ currentPosition: 2, totalPomodoros: 2 });
  });
});

describe('TimerSessionService.setSessionPosition', () => {
  it('returns null when no current timer exists', async () => {
    const fixture = createFixture({ timer: null });
    await expect(
      fixture.service.setSessionPosition('user-1', 1)
    ).resolves.toBeNull();
  });

  it('rejects every invalid position boundary without persistence', async () => {
    for (const [timer, position] of [
      [createTimer({ sessionTotal: undefined }), 1],
      [createTimer({ sessionTotal: 3 }), 0],
      [createTimer({ sessionTotal: 3 }), 4],
    ] as const) {
      const fixture = createFixture({ timer });
      await expect(
        fixture.service.setSessionPosition('user-1', position)
      ).resolves.toBe(timer);
      expect(fixture.setCurrentTimer).not.toHaveBeenCalled();
    }
  });

  it('persists a paused timer without creating absent session state', async () => {
    const timer = createTimer({ sessionPosition: 1, sessionTotal: 3 });
    const fixture = createFixture({ timer, sessionState: null });
    await fixture.service.setSessionPosition('user-1', 2);
    expect(timer.sessionPosition).toBe(2);
    expect(timer.sessionIntentionEmojis).toBeUndefined();
    expect(fixture.setSessionState).not.toHaveBeenCalled();
    expect(fixture.setCurrentTimer).toHaveBeenCalledWith(
      'user-1',
      { timerId: 'timer-1', scheduleRevision: null },
      timer,
      undefined
    );
    expect(fixture.emitTimerUpdate).toHaveBeenCalledWith('user-1', timer);
  });

  it('updates running remaining time and existing session state deterministically', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const timer = createTimer({
      status: TIMER_STATUSES.RUNNING,
      duration: 10_000,
      startTime: 4_000,
      remainingTime: 10_000,
      sessionPosition: 1,
      sessionTotal: 3,
    });
    const state: TimerSessionState = {
      currentPosition: 1,
      totalPomodoros: 3,
      completedIntentionEmojis: { 1: '✅' },
    };
    const fixture = createFixture({ timer, sessionState: state });
    await fixture.service.setSessionPosition('user-1', 3);
    expect(timer).toMatchObject({
      remainingTime: 4_000,
      sessionPosition: 3,
      sessionIntentionEmojis: { 1: '✅' },
    });
    expect(fixture.sessionState).toEqual({ ...state, currentPosition: 3 });
  });

  it('clamps expired running timers to zero remaining time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    const timer = createTimer({
      status: TIMER_STATUSES.RUNNING,
      duration: 10_000,
      startTime: 1_000,
      sessionPosition: 1,
      sessionTotal: 2,
    });
    const fixture = createFixture({
      timer,
      sessionState: { currentPosition: 1, totalPomodoros: 2 },
    });
    await fixture.service.setSessionPosition('user-1', 2);
    expect(timer.remainingTime).toBe(0);
  });

  it('reports a conflict instead of accepting a concurrent Timer winner', async () => {
    const timer = createTimer({ sessionPosition: 1, sessionTotal: 2 });
    const fixture = createFixture({ timer });
    fixture.setCurrentTimer.mockResolvedValueOnce({
      kind: 'conflict',
      current: createTimer({ id: 'timer-winner' }),
    } as never);

    await expect(
      fixture.service.setSessionPosition('user-1', 2)
    ).rejects.toThrow('Timer changed while action was processing');
    expect(fixture.emitTimerUpdate).not.toHaveBeenCalled();
  });
});
