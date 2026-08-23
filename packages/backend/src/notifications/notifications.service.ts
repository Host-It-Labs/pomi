import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApnsClient, Host, Notification, Priority } from 'apns2';
import { cert, initializeApp, type App } from 'firebase-admin/app';
import * as firebaseMessaging from 'firebase-admin/messaging';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

import {
  ACCENT_HEX_COLORS,
  ANDROID_NOTIFICATION_CHANNEL_IDS,
  TIMER_TYPES,
} from '@pomi/shared';
import type { Timer } from '@pomi/shared';

import { TIMER_NOTIFICATION_PRIORITIES } from 'src/common/constants';
import { PomiLogger } from '../logging/pomi-logger';
import { PreferencesService } from '../preferences/preferences.service';
import { UsersService } from '../users/users.service';
import { translateNotification } from '../i18n/notification-localization';

interface NotificationSendOptions {
  priority?: number;
  tags?: string[];
  idempotencyKey?: string;
  requireDelivery?: boolean;
}

@Injectable()
export class NotificationService {
  private readonly logger = new PomiLogger(NotificationService.name);
  private fcmApp: App | null = null;
  private apnProvider: ApnsClient | null = null;

  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
    @Inject(forwardRef(() => PreferencesService))
    private preferencesService: PreferencesService
  ) {
    this.initializeFCM();
    this.initializeAPNs();
  }

  private initializeFCM() {
    try {
      let serviceAccountJson = this.configService.get<string>(
        'FIREBASE_SERVICE_ACCOUNT_JSON'
      );

      if (!serviceAccountJson) {
        const configuredPath = this.configService.get<string>(
          'FIREBASE_SERVICE_ACCOUNT_PATH'
        );
        const candidates = configuredPath
          ? [
              path.resolve(process.cwd(), configuredPath),
              path.resolve(process.cwd(), '../..', configuredPath),
            ]
          : [];
        const serviceAccountPath = candidates.find(candidate =>
          existsSync(candidate)
        );
        if (serviceAccountPath) {
          serviceAccountJson = readFileSync(serviceAccountPath, 'utf8');
        }
      }

      if (serviceAccountJson) {
        const serviceAccount = JSON.parse(serviceAccountJson);
        this.fcmApp = initializeApp({
          credential: cert(serviceAccount),
        });
        this.logger.log('Firebase Cloud Messaging initialized successfully');
      } else {
        this.logger.warn(
          'FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON not configured. FCM notifications will not be available.'
        );
      }
    } catch (error) {
      this.logger.error('Failed to initialize FCM:', error);
    }
  }

  private initializeAPNs() {
    try {
      const apnKeyPath = this.configService.get<string>('APN_KEY_PATH');
      const apnKeyId = this.configService.get<string>('APN_KEY_ID');
      const apnTeamId = this.configService.get<string>('APN_TEAM_ID');
      const apnProduction = this.configService.get<boolean>(
        'APN_PRODUCTION',
        false
      );

      if (apnKeyPath && apnKeyId && apnTeamId) {
        this.apnProvider = new ApnsClient({
          team: apnTeamId,
          keyId: apnKeyId,
          signingKey: readFileSync(apnKeyPath),
          defaultTopic:
            this.configService.get<string>('APN_BUNDLE_ID') ||
            'app.pomi.community',
          host: apnProduction ? Host.production : Host.development,
        });
        this.logger.log(
          'Apple Push Notification service initialized successfully'
        );
      } else {
        this.logger.warn(
          'APNs credentials not configured. iOS notifications will not be available.'
        );
      }
    } catch (error) {
      this.logger.error('Failed to initialize APNs:', error);
    }
  }

  arePushNotificationsEnabled() {
    return !!(this.fcmApp || this.apnProvider);
  }

  async sendTimerCompletedNotification(
    timer: Timer,
    userId: string,
    priority: number = 3,
    isLastWorkTimerInSession: boolean = false
  ): Promise<void> {
    await this.sendTimerCompletedNotificationWithPolicy(
      timer,
      userId,
      priority,
      isLastWorkTimerInSession,
      undefined,
      false
    );
  }

  async sendDurableTimerCompletedNotification(
    timer: Timer,
    userId: string,
    priority: number,
    isLastWorkTimerInSession: boolean,
    idempotencyKey: string
  ): Promise<void> {
    await this.sendTimerCompletedNotificationWithPolicy(
      timer,
      userId,
      priority,
      isLastWorkTimerInSession,
      idempotencyKey,
      true
    );
  }

  private async sendTimerCompletedNotificationWithPolicy(
    timer: Timer,
    userId: string,
    priority: number,
    isLastWorkTimerInSession: boolean,
    idempotencyKey: string | undefined,
    requireDelivery: boolean
  ): Promise<void> {
    const language = await this.getUserLanguage(userId);
    const title =
      timer.type === TIMER_TYPES.WORK
        ? translateNotification(language, 'workComplete')
        : timer.type === TIMER_TYPES.LONG_BREAK
          ? translateNotification(language, 'longBreakComplete')
          : translateNotification(language, 'breakComplete');

    let message: string;
    if (timer.type === TIMER_TYPES.WORK) {
      if (timer.sessionPosition && timer.sessionTotal) {
        message = translateNotification(
          language,
          'workTimersDone',
          timer.sessionPosition,
          timer.sessionTotal
        );
      } else {
        message = translateNotification(language, 'breakTime');
      }
    } else {
      message = translateNotification(language, 'readyToWork');
    }

    const tags =
      timer.type === TIMER_TYPES.WORK
        ? isLastWorkTimerInSession
          ? ['white_check_mark', 'sessionEnd']
          : ['white_check_mark', TIMER_TYPES.WORK]
        : timer.type === TIMER_TYPES.LONG_BREAK
          ? ['coffee', TIMER_TYPES.LONG_BREAK]
          : ['coffee', TIMER_TYPES.BREAK];
    await this.sendNotification(title, message, userId, {
      priority,
      tags,
      idempotencyKey,
      requireDelivery,
    });
  }

  async sendTimerWarningNotification(
    timer: Timer,
    userId: string,
    minutesLeft: number
  ): Promise<void> {
    const language = await this.getUserLanguage(userId);
    const title = translateNotification(language, 'minutesLeft', minutesLeft);
    const message = translateNotification(language, 'timerEnding', minutesLeft);

    await this.sendNotification(title, message, userId, {
      priority: TIMER_NOTIFICATION_PRIORITIES.warning,
      tags: ['stopwatch', TIMER_TYPES.WORK],
    });
  }

  async sendLongBreakDetectedNotification(
    _timer: Timer,
    userId: string
  ): Promise<void> {
    const language = await this.getUserLanguage(userId);
    const title = translateNotification(language, 'longBreakDetected');
    const message = translateNotification(language, 'longBreakDetectedBody');

    await this.sendNotification(title, message, userId, {
      priority: TIMER_NOTIFICATION_PRIORITIES.break,
      tags: ['hourglass_flowing_sand', 'longBreakDetected'],
    });
  }

  async sendDurableLongBreakDetectedNotification(
    userId: string,
    idempotencyKey: string
  ): Promise<void> {
    const language = await this.getUserLanguage(userId);
    await this.sendNotification(
      translateNotification(language, 'longBreakDetected'),
      translateNotification(language, 'longBreakDetectedBody'),
      userId,
      {
        priority: TIMER_NOTIFICATION_PRIORITIES.break,
        tags: ['hourglass_flowing_sand', 'longBreakDetected'],
        idempotencyKey,
        requireDelivery: true,
      }
    );
  }

  async sendPausedTimerReminderNotification(
    timer: Timer,
    userId: string
  ): Promise<void> {
    const language = await this.getUserLanguage(userId);
    const title = translateNotification(language, 'pausedTimerReminder');
    const message = translateNotification(language, 'pausedTimerReminderBody');

    await this.sendNotification(title, message, userId, {
      priority: TIMER_NOTIFICATION_PRIORITIES.warning,
      tags: ['stopwatch', 'workPaused'],
    });
  }

  async sendTaskNotification(
    title: string,
    message: string,
    userId: string,
    priority: number,
    tags: string[]
  ): Promise<void> {
    await this.sendNotification(title, message, userId, {
      priority,
      tags,
    });
  }

  private async getUserLanguage(userId: string): Promise<string> {
    try {
      return (await this.preferencesService.getPreferences(userId)).language;
    } catch {
      return 'en';
    }
  }

  private async sendNotification(
    title: string,
    message: string,
    userId: string,
    options: NotificationSendOptions
  ): Promise<void> {
    const arePushNotificationsEnabled = this.arePushNotificationsEnabled();

    if (arePushNotificationsEnabled || options.requireDelivery) {
      await this.sendPushNotification(title, message, userId, options);
    } else {
      this.logger.debug(
        'No notification provider configured. Skipping notification.'
      );
    }
  }

  private async sendPushNotification(
    title: string,
    message: string,
    userId: string,
    options: NotificationSendOptions
  ): Promise<void> {
    try {
      const user = await this.usersService.findUserById(userId);
      if (!user) {
        this.logger.warn('Push notification skipped: user not found');
        return;
      }

      if (options.requireDelivery) {
        const unavailableProviders = [
          user.fcmToken && !this.fcmApp ? 'FCM' : null,
          user.apnToken && !this.apnProvider ? 'APNs' : null,
        ].filter((provider): provider is string => provider !== null);
        if (unavailableProviders.length > 0) {
          throw new Error(
            `Notification provider unavailable: ${unavailableProviders.join(', ')}`
          );
        }
      }

      if (user.fcmToken && this.fcmApp) {
        await this.sendFCMNotification(
          user.fcmToken,
          title,
          message,
          options,
          userId
        );
      }

      if (user.apnToken && this.apnProvider) {
        await this.sendAPNNotification(
          user.apnToken,
          title,
          message,
          options,
          userId
        );
      }

      if (!user.fcmToken && !user.apnToken) {
        this.logger.debug('Push notification skipped: no device token');
      }
    } catch (error) {
      this.logger.error(
        'Failed to send push notification',
        error instanceof Error ? error.name : undefined
      );
      if (options.requireDelivery) throw error;
    }
  }

  private async sendFCMNotification(
    token: string,
    title: string,
    message: string,
    options: NotificationSendOptions,
    userId?: string
  ): Promise<void> {
    try {
      const sound = this.getSoundForNotification(options.tags, 'fcm');
      const channelId = this.getChannelIdForNotification(options.tags);
      const iconColor = this.getIconColorForNotification(options.tags);

      const payload: firebaseMessaging.Message = {
        token,
        notification: {
          title,
          body: message,
        },
        android: {
          priority: 'high',
          notification: {
            icon: 'ic_notification',
            sound,
            channelId,
            color: iconColor,
            tag: options.idempotencyKey ?? options.tags?.[1] ?? 'pomi',
          },
        },
        data: {
          notificationType: options.tags?.[1] || 'general',
          timestamp: Date.now().toString(),
          ...(options.idempotencyKey && {
            notificationId: options.idempotencyKey,
          }),
        },
      };

      await firebaseMessaging.getMessaging(this.fcmApp!).send(payload);
      this.logger.info('FCM notification sent');
    } catch (error) {
      const errorCode = error.code || error.errorInfo?.code;
      const shouldClearToken =
        errorCode === 'messaging/invalid-registration-token' ||
        errorCode === 'messaging/registration-token-not-registered';

      if (shouldClearToken) {
        this.logger.warn(
          'Invalid FCM token detected; clearing the device token'
        );
        if (userId) {
          await this.usersService.clearPushToken(userId, 'android');
        }
      } else {
        this.logger.error(
          'Failed to send FCM notification',
          error instanceof Error ? error.name : undefined
        );
        throw error;
      }
    }
  }

  private async sendAPNNotification(
    token: string,
    title: string,
    message: string,
    options: NotificationSendOptions,
    userId?: string
  ): Promise<void> {
    try {
      const sound = this.getSoundForNotification(options.tags, 'apn');
      const badge = this.getBadgeForNotification(options.tags);

      const notification = new Notification(token, {
        alert: {
          title,
          body: message,
        },
        topic:
          this.configService.get<string>('APN_BUNDLE_ID') ||
          'app.pomi.community',
        sound,
        priority:
          options.priority === 5 ? Priority.immediate : Priority.throttled,
        badge,
        threadId: 'pomi-timer',
        ...(options.idempotencyKey && {
          collapseId: options.idempotencyKey,
        }),
        data: {
          notificationType: options.tags?.[1] || 'general',
          timestamp: Date.now(),
          ...(options.idempotencyKey && {
            notificationId: options.idempotencyKey,
          }),
        },
      });

      await this.apnProvider!.send(notification);
      this.logger.info('APNs notification sent');
    } catch (error) {
      const apnsReason =
        typeof error === 'object' && error !== null && 'reason' in error
          ? String(error.reason)
          : undefined;
      if (
        apnsReason === 'BadDeviceToken' ||
        apnsReason === 'Unregistered' ||
        apnsReason === 'DeviceTokenNotForTopic'
      ) {
        this.logger.warn(
          'Invalid APNs token detected; clearing the device token'
        );
        if (userId) {
          await this.usersService.clearPushToken(userId, 'ios');
        }
        return;
      }
      this.logger.error(
        'Failed to send APNs notification',
        error instanceof Error ? error.name : undefined
      );
      throw error;
    }
  }

  private getSoundForNotification(
    tags?: string[],
    platform?: 'fcm' | 'apn'
  ): string {
    if (!tags || tags.length === 0) {
      return 'default';
    }

    let soundFile = 'default';
    if (tags.includes('sessionEnd')) {
      soundFile = 'session_end';
    } else if (tags.includes(TIMER_TYPES.WORK)) {
      soundFile = 'work_complete';
    } else if (
      tags.includes(TIMER_TYPES.BREAK) ||
      tags.includes(TIMER_TYPES.LONG_BREAK)
    ) {
      soundFile = 'break_complete';
    } else if (tags.includes('stopwatch') || tags.includes('warning')) {
      soundFile = 'timer_warning';
    }

    if (platform === 'apn' && soundFile !== 'default') {
      return `${soundFile}.mp3`;
    }

    return soundFile;
  }

  private getChannelIdForNotification(tags?: string[]): string {
    if (!tags || tags.length === 0) {
      return ANDROID_NOTIFICATION_CHANNEL_IDS.GENERAL;
    }

    if (tags.includes('stopwatch') || tags.includes('warning')) {
      return ANDROID_NOTIFICATION_CHANNEL_IDS.WARNINGS;
    } else if (tags.includes('sessionEnd')) {
      return ANDROID_NOTIFICATION_CHANNEL_IDS.SESSION_END;
    } else if (tags.includes(TIMER_TYPES.WORK)) {
      return ANDROID_NOTIFICATION_CHANNEL_IDS.WORK_COMPLETE;
    } else if (
      tags.includes(TIMER_TYPES.BREAK) ||
      tags.includes(TIMER_TYPES.LONG_BREAK)
    ) {
      return ANDROID_NOTIFICATION_CHANNEL_IDS.BREAK_COMPLETE;
    }

    return ANDROID_NOTIFICATION_CHANNEL_IDS.GENERAL;
  }

  private getIconColorForNotification(tags?: string[]): string {
    if (!tags || tags.length === 0) {
      return ACCENT_HEX_COLORS.indigo;
    }

    if (tags.includes('sessionEnd')) {
      return ACCENT_HEX_COLORS.purple;
    } else if (tags.includes(TIMER_TYPES.WORK)) {
      return ACCENT_HEX_COLORS.indigo;
    } else if (tags.includes(TIMER_TYPES.LONG_BREAK)) {
      return ACCENT_HEX_COLORS.purple;
    } else if (tags.includes(TIMER_TYPES.BREAK)) {
      return ACCENT_HEX_COLORS.green;
    } else if (tags.includes('stopwatch')) {
      return '#FFA726';
    }

    return ACCENT_HEX_COLORS.indigo;
  }

  private getBadgeForNotification(_tags?: string[]): number {
    return 1;
  }
}
