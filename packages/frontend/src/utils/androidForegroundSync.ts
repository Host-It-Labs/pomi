import { invoke } from '@tauri-apps/api/core';
import { isPermissionGranted } from '@choochmeque/tauri-plugin-notifications-api';
import { isAndroid, isTauri } from './osUtils';

export interface AndroidForegroundSyncStatus {
  enabled: boolean;
  running: boolean;
}

export interface AndroidForegroundSyncStopOptions {
  clearOptIn: boolean;
  clearAuth: boolean;
}

declare global {
  interface Window {
    __POMI_TEST_ANDROID_FOREGROUND_SYNC__?: AndroidForegroundSyncStatus;
  }
}

const DEFAULT_STATUS: AndroidForegroundSyncStatus = {
  enabled: false,
  running: false,
};

export async function getAndroidForegroundSyncStatus(): Promise<AndroidForegroundSyncStatus> {
  if (!isAndroid) {
    return DEFAULT_STATUS;
  }

  if (!isTauri) {
    return window.__POMI_TEST_ANDROID_FOREGROUND_SYNC__ ?? DEFAULT_STATUS;
  }

  try {
    return await invoke<AndroidForegroundSyncStatus>(
      'plugin:notifications|get_android_foreground_sync_status'
    );
  } catch (error) {
    console.error('[AndroidForegroundSync] Status failed:', error);
    return DEFAULT_STATUS;
  }
}

export async function startAndroidForegroundSync(): Promise<AndroidForegroundSyncStatus> {
  if (!isAndroid) {
    return DEFAULT_STATUS;
  }

  if (!isTauri) {
    const status = { enabled: true, running: true };
    window.__POMI_TEST_ANDROID_FOREGROUND_SYNC__ = status;
    return status;
  }

  try {
    return await invoke<AndroidForegroundSyncStatus>(
      'plugin:notifications|start_android_foreground_sync'
    );
  } catch (error) {
    console.error('[AndroidForegroundSync] Start failed:', error);
    return getAndroidForegroundSyncStatus();
  }
}

export async function stopAndroidForegroundSync(
  options: AndroidForegroundSyncStopOptions
): Promise<AndroidForegroundSyncStatus> {
  if (!isAndroid) {
    return DEFAULT_STATUS;
  }

  if (!isTauri) {
    const current =
      window.__POMI_TEST_ANDROID_FOREGROUND_SYNC__ ?? DEFAULT_STATUS;
    const status = {
      enabled: options.clearOptIn ? false : current.enabled,
      running: false,
    };
    window.__POMI_TEST_ANDROID_FOREGROUND_SYNC__ = status;
    return status;
  }

  try {
    return await invoke<AndroidForegroundSyncStatus>(
      'plugin:notifications|stop_android_foreground_sync',
      {
        clearOptIn: options.clearOptIn,
        clearAuth: options.clearAuth,
      }
    );
  } catch (error) {
    console.error('[AndroidForegroundSync] Stop failed:', error);
    return getAndroidForegroundSyncStatus();
  }
}

export async function reconcileAndroidForegroundSync(
  token: string | null,
  pushNotifications: boolean
): Promise<AndroidForegroundSyncStatus> {
  if (!isAndroid) {
    return DEFAULT_STATUS;
  }

  if (!token || !pushNotifications) {
    return stopAndroidForegroundSync({
      clearOptIn: !pushNotifications,
      clearAuth: true,
    });
  }

  const notificationPermissionGranted = isTauri
    ? await isPermissionGranted()
    : window.__POMI_TEST_NOTIFICATION_PERMISSION__ === true;
  if (!notificationPermissionGranted) {
    return stopAndroidForegroundSync({
      clearOptIn: false,
      clearAuth: true,
    });
  }

  return startAndroidForegroundSync();
}
