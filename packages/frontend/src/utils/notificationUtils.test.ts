import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MACOS_NOTIFICATION_SETTINGS_URL } from '../constants/notifications';

const nativeNotifications = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  registerForPushNotifications: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock('@choochmeque/tauri-plugin-notifications-api', () => ({
  isPermissionGranted: nativeNotifications.isPermissionGranted,
  requestPermission: nativeNotifications.requestPermission,
  registerForPushNotifications:
    nativeNotifications.registerForPushNotifications,
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: nativeNotifications.openUrl,
}));

vi.mock('./osUtils', () => ({
  isAndroid: false,
  isMac: true,
  isMobile: false,
  isTauri: true,
}));

vi.mock('./apiClient', () => ({
  apiClient: {
    users: {
      updatePushToken: vi.fn(),
      getPushToken: vi.fn(),
    },
  },
}));

import { NotificationService } from './notificationUtils';

describe('macOS notification setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeNotifications.isPermissionGranted.mockResolvedValue(false);
    nativeNotifications.requestPermission.mockResolvedValue('denied');
    nativeNotifications.openUrl.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes the native permission state and opens macOS notification settings', async () => {
    const service = new NotificationService();

    await expect(service.checkPermission()).resolves.toBe(false);
    await expect(service.openMacNotificationSettings()).resolves.toBe(true);

    expect(nativeNotifications.openUrl).toHaveBeenCalledWith(
      MACOS_NOTIFICATION_SETTINGS_URL
    );
  });

  it('accepts a permission granted by macOS after the initial check', async () => {
    const service = new NotificationService();
    await service.checkPermission();
    nativeNotifications.requestPermission.mockResolvedValue('granted');

    await expect(service.requestPermissionIfNeeded()).resolves.toBe(true);
  });

  it('reports when the native settings opener is unavailable', async () => {
    const service = new NotificationService();
    nativeNotifications.openUrl.mockRejectedValueOnce(
      new Error('System Settings unavailable')
    );

    await expect(service.openMacNotificationSettings()).resolves.toBe(false);
  });
});
