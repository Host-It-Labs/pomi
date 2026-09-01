import {
  type LiveTimerActionKind,
  type Timer,
  type TimerTypes,
} from '@pomi/shared';
import { buildLiveTimerProjection } from '@pomi/shared/src/liveTimerProjection';
import { addPluginListener, invoke } from '@tauri-apps/api/core';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { translateCurrent } from '../i18n';
import { isAndroid, isIos, isMobile, isTauri } from './osUtils';
import { waitForAuthoritativeTimer } from './socketManager';
import { submitUserMutation } from './userActionQueue';

const ENABLED_KEY = 'pomi_live_timer_enabled';
const SHOW_TITLES_KEY = 'pomi_live_timer_show_intention_titles';

export type DeviceLiveTimerPreferences = {
  enabled: boolean;
  showIntentionTitles: boolean;
};

export type NativeLiveTimerAction = {
  action: LiveTimerActionKind;
  actionId: string;
  timerId: string;
  expectedRevision: string;
  timerType?: TimerTypes;
};

declare global {
  interface Window {
    __POMI_TEST_LIVE_TIMER_PROJECTION__?: unknown;
  }
}

export function getDeviceLiveTimerPreferences(): DeviceLiveTimerPreferences {
  return {
    enabled: localStorage.getItem(ENABLED_KEY) === 'true',
    showIntentionTitles: localStorage.getItem(SHOW_TITLES_KEY) === 'true',
  };
}

export async function setDeviceLiveTimerPreferences(
  preferences: DeviceLiveTimerPreferences,
  timer: Timer | null
): Promise<void> {
  localStorage.setItem(ENABLED_KEY, String(preferences.enabled));
  localStorage.setItem(
    SHOW_TITLES_KEY,
    String(preferences.showIntentionTitles)
  );
  await publishLiveTimerProjection(timer);
}

export async function publishLiveTimerProjection(
  timer: Timer | null
): Promise<void> {
  if (!isMobile) return;
  const preferences = getDeviceLiveTimerPreferences();
  if (!preferences.enabled) {
    await clearLiveTimerProjection();
    return;
  }

  const platform = isAndroid ? 'android' : isIos ? 'ios' : null;
  if (!platform) return;
  const projection = buildLiveTimerProjection(timer, {
    platform,
    includeIntentionTitle: preferences.showIntentionTitles,
  });
  if (!projection) {
    await clearLiveTimerProjection();
    return;
  }

  if (!isTauri) {
    window.__POMI_TEST_LIVE_TIMER_PROJECTION__ = projection;
    return;
  }
  try {
    await invoke('plugin:notifications|set_timer_projection', {
      projectionJson: JSON.stringify(projection),
    });
  } catch (error) {
    console.error('[LiveTimerSurface] Projection update failed:', error);
  }
}

export async function clearLiveTimerProjection(): Promise<void> {
  if (!isMobile) return;
  if (!isTauri) {
    delete window.__POMI_TEST_LIVE_TIMER_PROJECTION__;
    return;
  }
  try {
    await invoke('plugin:notifications|clear_timer_projection');
  } catch (error) {
    console.error('[LiveTimerSurface] Projection clear failed:', error);
  }
}

export async function handleNativeLiveTimerAction(
  input: NativeLiveTimerAction
): Promise<void> {
  const operation = nativeOperation(input.action);
  if (operation === 'createOrResume' && !input.timerType) {
    throw new Error('Timer type is required to resume a native Timer');
  }
  await submitUserMutation({
    id: input.actionId,
    kind: 'timer',
    label: nativeActionLabel(input.action),
    payload: {
      operation,
      ...(operation === 'createOrResume' ? { timerType: input.timerType } : {}),
      expectedTimerId: input.timerId,
      expectedScheduleRevision: input.expectedRevision,
    },
    reconcile: async result => {
      await waitForAuthoritativeTimer(result);
    },
  });
}

export async function registerLiveTimerActionListeners(): Promise<() => void> {
  if (!isTauri || !isMobile) return () => undefined;

  const pluginListener = await addPluginListener<NativeLiveTimerAction>(
    'notifications',
    'timerAction',
    payload => void handleNativeLiveTimerAction(payload)
  );
  await invoke('plugin:notifications|set_click_listener_active', {
    active: true,
  });

  const handleUrls = (urls: string[]) => {
    urls.forEach(url => {
      const action = nativeActionFromUrl(url);
      if (action) void handleNativeLiveTimerAction(action);
    });
  };
  const currentUrls = await getCurrent();
  if (currentUrls) handleUrls(currentUrls);
  const unlistenDeepLinks = await onOpenUrl(handleUrls);

  return () => {
    void pluginListener.unregister();
    unlistenDeepLinks();
    void invoke('plugin:notifications|set_click_listener_active', {
      active: false,
    });
  };
}

export function nativeActionFromUrl(
  urlValue: string
): NativeLiveTimerAction | null {
  try {
    const url = new URL(urlValue);
    if (url.protocol !== 'pomi:' || url.hostname !== 'timer-action') {
      return null;
    }
    const action = url.searchParams.get('action');
    const actionId = url.searchParams.get('actionId');
    const timerId = url.searchParams.get('timerId');
    const expectedRevision = url.searchParams.get('expectedScheduleRevision');
    const timerType = url.searchParams.get('timerType');
    if (
      !isLiveTimerAction(action) ||
      !actionId ||
      !timerId ||
      !expectedRevision ||
      (timerType !== null && !isTimerType(timerType))
    ) {
      return null;
    }
    return {
      action,
      actionId,
      timerId,
      expectedRevision,
      ...(timerType ? { timerType } : {}),
    };
  } catch {
    return null;
  }
}

function nativeOperation(action: LiveTimerActionKind) {
  if (action === 'resume') return 'createOrResume' as const;
  if (action === 'addFive') return 'addFiveMinutes' as const;
  return action;
}

function nativeActionLabel(action: LiveTimerActionKind): string {
  if (action === 'pause') return translateCurrent('timer.pause');
  if (action === 'resume') return translateCurrent('timer.startAction');
  if (action === 'addFive')
    return translateCurrent('timer.addFiveMinutesAction');
  return translateCurrent('timer.skip');
}

function isLiveTimerAction(value: string | null): value is LiveTimerActionKind {
  return (
    value === 'pause' ||
    value === 'resume' ||
    value === 'addFive' ||
    value === 'skip'
  );
}

function isTimerType(value: string): value is TimerTypes {
  return value === 'work' || value === 'break' || value === 'longBreak';
}
