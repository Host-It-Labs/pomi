import {
  isPermissionGranted,
  onAction,
  onNotificationClicked,
  registerForPushNotifications,
  registerActionTypes,
  requestPermission,
  unregisterForPushNotifications,
} from '@choochmeque/tauri-plugin-notifications-api';
import { PUSH_PLATFORMS } from '@pomi/shared/src/constants';
import { Platform } from '@tauri-apps/plugin-os';
import { PUSH_TOKEN_STORAGE_KEY } from '../constants/pushNotifications';
import { useUiStore } from '../stores/uiStore';
import { apiClient } from './apiClient';
import { isAndroid, isIos, isMobile, isTauri } from './osUtils';

declare global {
  interface Window {
    __POMI_TEST_NOTIFICATION_PERMISSION__?: boolean;
  }
}

class NotificationService {
  private hasPermission = false;
  private denialCount = 0;
  private readonly DENIAL_THRESHOLD = 2;

  constructor() {
    this.checkPermission();
    void this.configureIosActions();
    const stored = localStorage.getItem('notification_denial_count');
    if (stored) {
      this.denialCount = parseInt(stored, 10);
    }
  }

  private async configureIosActions() {
    if (!isTauri || !isIos) return;
    try {
      await registerActionTypes([
        {
          id: 'POMI_TIMER',
          actions: [
            {
              id: 'open-timer',
              title: 'Open Pomi',
              foreground: true,
            },
          ],
          hiddenPreviewsBodyPlaceholder: 'Pomi timer update',
          hiddenPreviewsShowTitle: true,
        },
      ]);
      const openTimer = async () => {
        useUiStore.getState().setExpanded(true);
        useUiStore.getState().setActiveTab('timer');
      };
      await onNotificationClicked(() => void openTimer());
      await onAction(() => void openTimer());
    } catch (error) {
      console.error('Failed to configure iOS notification actions:', error);
    }
  }

  private async openAndroidNotificationSettings() {
    console.warn(
      '[NotificationService] User has denied notifications multiple times'
    );

    alert(
      'To enable notifications, please go to:\nSettings > Apps > Pomi > Notifications'
    );
  }

  async checkPermission(): Promise<boolean> {
    try {
      if (!isMobile) {
        return false;
      }
      if (!isTauri) {
        return window.__POMI_TEST_NOTIFICATION_PERMISSION__ ?? false;
      }
      this.hasPermission = await isPermissionGranted();
      return this.hasPermission;
    } catch (error) {
      console.error('Error checking notification permission:', error);
      return false;
    }
  }

  async requestPermissionIfNeeded(): Promise<boolean> {
    if (!isMobile) return false;
    if (this.hasPermission) return true;
    if (!isTauri) {
      this.hasPermission =
        window.__POMI_TEST_NOTIFICATION_PERMISSION__ ?? false;
      return this.hasPermission;
    }

    try {
      const permission = await requestPermission();
      this.hasPermission = permission === 'granted';

      console.warn(
        '[NotificationService] Permission result:',
        permission,
        'isAndroid:',
        isAndroid
      );

      if (!this.hasPermission && isAndroid) {
        this.denialCount++;
        localStorage.setItem(
          'notification_denial_count',
          this.denialCount.toString()
        );

        console.warn(
          '[NotificationService] Denial count:',
          this.denialCount,
          'Threshold:',
          this.DENIAL_THRESHOLD
        );

        if (this.denialCount >= this.DENIAL_THRESHOLD) {
          console.warn('[NotificationService] Opening Android settings...');
          await this.openAndroidNotificationSettings();
        }
      } else if (this.hasPermission) {
        this.denialCount = 0;
        localStorage.removeItem('notification_denial_count');
      }
      return this.hasPermission;
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return false;
    }
  }

  async registerForPushNotificationsIfMobile(
    userId: string,
    platform: Platform
  ): Promise<boolean> {
    if (!isMobile) return false;

    try {
      const permissionGranted = await this.requestPermissionIfNeeded();
      if (!permissionGranted) {
        console.warn('Push notification permission not granted');

        return false;
      }

      if (!isTauri) {
        return permissionGranted;
      }

      const token = await registerForPushNotifications();

      if (token) {
        const platformType =
          platform === PUSH_PLATFORMS.ANDROID
            ? PUSH_PLATFORMS.ANDROID
            : PUSH_PLATFORMS.IOS;
        await apiClient.users.updatePushToken({
          params: {
            userId,
          },
          body: {
            token,
            platform: platformType,
          },
        });
        localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);

        return true;
      }
      return false;
    } catch (error) {
      console.error('Error registering for push notifications:', error);

      return false;
    }
  }

  async unregisterFromPushNotificationsIfMobile(): Promise<boolean> {
    if (!isMobile) return false;

    try {
      if (isTauri) {
        await unregisterForPushNotifications();
      }
      localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
      return true;
    } catch (error) {
      console.error('Error unregistering from push notifications:', error);
      return false;
    }
  }

  async hasValidPushToken(userId: string): Promise<boolean> {
    if (!isMobile) return false;

    try {
      const response = await apiClient.users.getPushToken({
        params: {
          userId,
        },
      });
      return response.status === 200 ? response.body.hasToken : false;
    } catch (error) {
      console.error('Error checking push token:', error);
      return false;
    }
  }
}

export const notificationService = new NotificationService();
