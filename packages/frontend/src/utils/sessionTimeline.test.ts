import type { Preferences, Timer } from '@pomi/shared';
import { describe, expect, it } from 'vitest';
import { getSessionSegments, getSessionTimeline } from './sessionTimeline';

const preferences = {
  workTimerDuration: 1_500_000,
  breakTimerDuration: 300_000,
  sessionPomodorosCount: 3,
} as Preferences;
const timer = {
  type: 'work',
  status: 'running',
  duration: 1_500_000,
  remainingTime: 600_000,
  sessionPosition: 2,
  sessionTotal: 3,
} as Timer;

describe('compact session progress', () => {
  it('estimates remaining work and intervening breaks, including paused timers', () => {
    expect(getSessionTimeline(timer, preferences, 1_000).ends).toEqual([
      null,
      601_000,
      2_401_000,
    ]);
    expect(
      getSessionTimeline(
        { ...timer, type: 'break', status: 'paused' },
        preferences,
        1_000
      ).ends
    ).toEqual([null, 2_101_000, 3_901_000]);
    expect(
      getSessionTimeline({ ...timer, type: 'longBreak' }, preferences, 1_000)
        .sessionEnd
    ).toBeNull();
    expect(
      getSessionTimeline({ ...timer, status: 'completed' }, preferences, 1_000)
        .timerEnd
    ).toBeNull();
  });
  it('includes the stacked break before later Work timers', () => {
    expect(
      getSessionTimeline({ ...timer, stackedSessions: 3 }, preferences, 1_000)
        .ends
    ).toEqual([null, 601_000, 3_001_000]);
    expect(
      getSessionTimeline(
        { ...timer, type: 'break', stackedSessions: 3, remainingTime: 900_000 },
        preferences,
        1_000
      ).ends
    ).toEqual([null, 2_401_000, 4_201_000]);
  });
  it('weights stacked work and includes completed work in extension progress', () => {
    const stacked = getSessionSegments(
      { ...timer, duration: 3_000_000 },
      preferences
    );
    expect(stacked.map(segment => segment.sweep)).toEqual([90, 180, 90]);
    const extended = getSessionSegments(
      {
        ...timer,
        isExtension: true,
        sessionPosition: 3,
        duration: 300_000,
        remainingTime: 150_000,
        extensionBaseDuration: 1_500_000,
      },
      preferences
    );
    expect(extended[1].progress).toBeCloseTo(1_650_000 / 1_800_000);
    expect(extended[0].progress).toBe(1);
    expect(extended[2].progress).toBe(0);
  });
  it('keeps the next work segment empty during a break', () => {
    expect(
      getSessionSegments({ ...timer, type: 'break' }, preferences).map(
        segment => segment.progress
      )
    ).toEqual([1, 0, 0]);
  });
});
