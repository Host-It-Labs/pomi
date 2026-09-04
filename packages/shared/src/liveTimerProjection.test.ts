import { describe, expect, it } from 'vitest';
import {
  buildLiveTimerProjection,
  liveTimerProjectionSchema,
} from './liveTimerProjection';
import type { Timer } from './types';

const runningTimer: Timer = {
  id: 'timer-1',
  scheduleRevision: 'revision-1',
  startTime: Date.parse('2026-09-01T08:00:00.000Z'),
  duration: 25 * 60 * 1000,
  remainingTime: 20 * 60 * 1000,
  type: 'work',
  status: 'running',
  intentionEmoji: '🔒',
  intentionTitle: 'Private roadmap',
};

describe('live Timer projection', () => {
  it('uses an absolute running deadline and stable fenced Android actions', () => {
    const projection = buildLiveTimerProjection(runningTimer, {
      platform: 'android',
      includeIntentionTitle: false,
      nowMs: Date.parse('2026-09-01T08:05:00.000Z'),
    });

    expect(projection).toMatchObject({
      version: 1,
      timerID: 'timer-1',
      timerRevision: 'revision-1',
      status: 'running',
      timerType: 'work',
      absoluteDeadline: '2026-09-01T08:25:00.000Z',
      intention: { emoji: '🔒', titlePrivacy: 'private' },
    });
    expect(projection?.intention).not.toHaveProperty('title');
    expect(projection?.actions.map(action => action.kind)).toEqual([
      'pause',
      'addFive',
      'skip',
    ]);
    expect(projection?.actions.every(action => action.isSupported)).toBe(true);
    expect(projection?.actions[0]).toMatchObject({
      id: 'native:timer-1:revision-1:pause',
      expectedTimerRevision: 'revision-1',
    });
  });

  it('uses confirmed paused remaining time and exposes titles only by opt-in', () => {
    const projection = buildLiveTimerProjection(
      {
        ...runningTimer,
        status: 'paused',
        remainingTime: 61_001,
      },
      {
        platform: 'ios',
        includeIntentionTitle: true,
        nowMs: Date.parse('2026-09-01T08:05:00.000Z'),
      }
    );

    expect(projection).toMatchObject({
      status: 'paused',
      pausedRemainingSeconds: 62,
      intention: {
        emoji: '🔒',
        title: 'Private roadmap',
        titlePrivacy: 'public',
      },
    });
    expect(projection).not.toHaveProperty('absoluteDeadline');
    expect(projection?.actions[0].kind).toBe('resume');
    expect(projection?.actions.every(action => !action.isSupported)).toBe(true);
  });

  it('clears completed or unfenced Timer state', () => {
    expect(
      buildLiveTimerProjection(
        { ...runningTimer, status: 'completed' },
        {
          platform: 'android',
          includeIntentionTitle: false,
          nowMs: Date.parse('2026-09-01T08:05:00.000Z'),
        }
      )
    ).toBeNull();
    expect(
      buildLiveTimerProjection(
        { ...runningTimer, scheduleRevision: undefined },
        {
          platform: 'android',
          includeIntentionTitle: false,
          nowMs: Date.parse('2026-09-01T08:05:00.000Z'),
        }
      )
    ).toBeNull();
  });

  it('rejects mismatched action revisions', () => {
    const projection = buildLiveTimerProjection(runningTimer, {
      platform: 'android',
      includeIntentionTitle: false,
      nowMs: Date.parse('2026-09-01T08:05:00.000Z'),
    });
    expect(
      liveTimerProjectionSchema.safeParse({
        ...projection,
        actions: projection?.actions.map(action => ({
          ...action,
          expectedTimerRevision: 'stale-revision',
        })),
      }).success
    ).toBe(false);
  });
});
