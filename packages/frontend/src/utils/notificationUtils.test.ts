import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUSH_TOKEN_STORAGE_KEY } from '../constants/pushNotifications';

const notifications = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(async () => true),
  onAction: vi.fn(async () => undefined),
  onNotificationClicked: vi.fn(async () => undefined),
  registerActionTypes: vi.fn(async () => undefined),
  registerForPushNotifications: vi.fn(async () => 'push-token'),
  requestPermission: vi.fn(async () => 'granted'),
  unregisterForPushNotifications: vi.fn(async () => undefined),
}));

vi.mock('@choochmeque/tauri-plugin-notifications-api', () => notifications);
vi.mock('./osUtils', () => ({
  isAndroid: false,
  isIos: true,
  isMobile: true,
  isTauri: true,
}));
vi.mock('./apiClient', () => ({
  apiClient: {
    users: {
      getPushToken: vi.fn(),
      updatePushToken: vi.fn(),
    },
  },
}));
vi.mock('../stores/uiStore', () => ({
  useUiStore: {
    getState: () => ({
      setActiveTab: vi.fn(),
      setExpanded: vi.fn(),
    }),
  },
}));

import { notificationService } from './notificationUtils';

describe('mobile push notification registration', () => {
  beforeEach(() => {
    localStorage.clear();
    notifications.unregisterForPushNotifications.mockClear();
  });

  it('unregisters the native token and removes the cached token', async () => {
    localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, 'cached-token');

    await expect(
      notificationService.unregisterFromPushNotificationsIfMobile()
    ).resolves.toBe(true);

    expect(notifications.unregisterForPushNotifications).toHaveBeenCalledOnce();
    expect(localStorage.getItem(PUSH_TOKEN_STORAGE_KEY)).toBeNull();
  });
});
