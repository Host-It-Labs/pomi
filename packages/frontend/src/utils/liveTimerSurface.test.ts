import { beforeEach, describe, expect, it, vi } from 'vitest';

const queue = vi.hoisted(() => ({
  submit: vi.fn(async () => undefined),
}));

vi.mock('./osUtils', () => ({
  isAndroid: true,
  isIos: false,
  isMobile: true,
  isTauri: false,
}));
vi.mock('./userActionQueue', () => ({
  submitUserMutation: queue.submit,
}));
vi.mock('./socketManager', () => ({
  waitForAuthoritativeTimer: vi.fn(async () => undefined),
}));
vi.mock('@tauri-apps/plugin-deep-link', () => ({
  getCurrent: vi.fn(async () => null),
  onOpenUrl: vi.fn(async () => () => undefined),
}));

import {
  getDeviceLiveTimerPreferences,
  handleNativeLiveTimerAction,
  nativeActionFromUrl,
  publishLiveTimerProjection,
  setDeviceLiveTimerPreferences,
} from './liveTimerSurface';

describe('device live Timer surface', () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.__POMI_TEST_LIVE_TIMER_PROJECTION__;
    queue.submit.mockClear();
  });

  it('keeps opt-in and title privacy device-local', async () => {
    await setDeviceLiveTimerPreferences(
      { enabled: true, showIntentionTitles: false },
      null
    );
    expect(getDeviceLiveTimerPreferences()).toEqual({
      enabled: true,
      showIntentionTitles: false,
    });
  });

  it('publishes only privacy-safe confirmed Timer state', async () => {
    localStorage.setItem('pomi_live_timer_enabled', 'true');
    await publishLiveTimerProjection({
      id: 'timer-1',
      scheduleRevision: 'revision-1',
      startTime: Date.now(),
      duration: 60_000,
      remainingTime: 60_000,
      type: 'work',
      status: 'running',
      intentionEmoji: '🎯',
      intentionTitle: 'Private plan',
    });

    expect(window.__POMI_TEST_LIVE_TIMER_PROJECTION__).toMatchObject({
      timerID: 'timer-1',
      timerRevision: 'revision-1',
      intention: { emoji: '🎯', titlePrivacy: 'private' },
    });
    expect(
      JSON.stringify(window.__POMI_TEST_LIVE_TIMER_PROJECTION__)
    ).not.toContain('Private plan');
  });

  it('parses and submits a stable fenced deep-link action', async () => {
    const action = nativeActionFromUrl(
      'pomi://timer-action?action=resume&actionId=native%3Atimer-1%3Arevision-1%3Aresume&timerId=timer-1&expectedScheduleRevision=revision-1&timerType=break'
    );
    expect(action).toEqual({
      action: 'resume',
      actionId: 'native:timer-1:revision-1:resume',
      timerId: 'timer-1',
      expectedRevision: 'revision-1',
      timerType: 'break',
    });

    await handleNativeLiveTimerAction(action!);
    expect(queue.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'native:timer-1:revision-1:resume',
        kind: 'timer',
        payload: {
          operation: 'createOrResume',
          timerType: 'break',
          expectedTimerId: 'timer-1',
          expectedScheduleRevision: 'revision-1',
        },
      })
    );
  });

  it('rejects malformed or unfenced deep links', () => {
    expect(nativeActionFromUrl('pomi://timer-action?action=pause')).toBeNull();
    expect(nativeActionFromUrl('https://example.com/timer-action')).toBeNull();
  });
});
