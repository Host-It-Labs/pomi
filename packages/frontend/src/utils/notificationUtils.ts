import {
  isPermissionGranted,
  registerForPushNotifications,
  requestPermission,
} from '@choochmeque/tauri-plugin-notifications-api';
import { openUrl } from '@tauri-apps/plugin-opener';
import { PUSH_PLATFORMS } from '@pomi/shared/src/constants';
import { Platform } from '@tauri-apps/plugin-os';
import { apiClient } from './apiClient';
import { MACOS_NOTIFICATION_SETTINGS_URL } from '../constants/notifications';
import { translateCurrent } from '../i18n';
import { isAndroid, isMac, isMobile, isTauri } from './osUtils';

declare global {
  interface Window {
    __POMI_TEST_NOTIFICATION_PERMISSION__?: boolean;
  }
}

export class NotificationService {
  private hasPermission = false;
  private denialCount = 0;
  private readonly DENIAL_THRESHOLD = 2;

  constructor() {
    this.checkPermission();
    const stored = localStorage.getItem('notification_denial_count');
    if (stored) {
      this.denialCount = parseInt(stored, 10);
    }
  }

  private async openAndroidNotificationSettings() {
    console.warn(
      '[NotificationService] User has denied notifications multiple times'
    );

    alert(translateCurrent('notifications.androidSettingsInstructions'));
  }

  async checkPermission(): Promise<boolean> {
    try {
      if (!isMobile && !isMac) {
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
    if (!isMobile && !isMac) return false;
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

  async openMacNotificationSettings(): Promise<boolean> {
    if (!isMac || !isTauri) return false;

    try {
      await openUrl(MACOS_NOTIFICATION_SETTINGS_URL);
      return true;
    } catch (error) {
      console.error('Error opening macOS notification settings:', error);
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

        return true;
      }
      return false;
    } catch (error) {
      console.error('Error registering for push notifications:', error);

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
