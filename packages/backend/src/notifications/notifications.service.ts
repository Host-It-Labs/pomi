import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as apn from 'apn';
import * as admin from 'firebase-admin';
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

interface NotificationContent {
  title: string;
  message: string;
}

type NotificationContentResolver = (language: string) => NotificationContent;

export function resolveApnProduction(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

@Injectable()
export class NotificationService {
  private readonly logger = new PomiLogger(NotificationService.name);
  private fcmApp: admin.app.App | null = null;
  private apnProvider: apn.Provider | null = null;

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
        this.fcmApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
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
      const apnProduction = resolveApnProduction(
        this.configService.get('APN_PRODUCTION')
      );

      if (apnKeyPath && apnKeyId && apnTeamId) {
        this.apnProvider = new apn.Provider({
          token: {
            key: apnKeyPath,
            keyId: apnKeyId,
            teamId: apnTeamId,
          },
          production: apnProduction,
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
    const tags =
      timer.type === TIMER_TYPES.WORK
        ? isLastWorkTimerInSession
          ? ['white_check_mark', 'sessionEnd']
          : ['white_check_mark', TIMER_TYPES.WORK]
        : timer.type === TIMER_TYPES.LONG_BREAK
          ? ['coffee', TIMER_TYPES.LONG_BREAK]
          : ['coffee', TIMER_TYPES.BREAK];
    await this.sendNotification(
      language => {
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

        return { title, message };
      },
      userId,
      {
        priority,
        tags,
        idempotencyKey,
        requireDelivery,
      }
    );
  }

  async sendTimerWarningNotification(
    timer: Timer,
    userId: string,
    minutesLeft: number
  ): Promise<void> {
    await this.sendNotification(
      language => ({
        title: translateNotification(language, 'minutesLeft', minutesLeft),
        message: translateNotification(language, 'timerEnding', minutesLeft),
      }),
      userId,
      {
        priority: TIMER_NOTIFICATION_PRIORITIES.warning,
        tags: ['stopwatch', TIMER_TYPES.WORK],
      }
    );
  }

  async sendLongBreakDetectedNotification(
    _timer: Timer,
    userId: string
  ): Promise<void> {
    await this.sendNotification(
      language => ({
        title: translateNotification(language, 'longBreakDetected'),
        message: translateNotification(language, 'longBreakDetectedBody'),
      }),
      userId,
      {
        priority: TIMER_NOTIFICATION_PRIORITIES.break,
        tags: ['hourglass_flowing_sand', 'longBreakDetected'],
      }
    );
  }

  async sendDurableLongBreakDetectedNotification(
    userId: string,
    idempotencyKey: string
  ): Promise<void> {
    await this.sendNotification(
      language => ({
        title: translateNotification(language, 'longBreakDetected'),
        message: translateNotification(language, 'longBreakDetectedBody'),
      }),
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
    await this.sendNotification(
      language => ({
        title: translateNotification(language, 'pausedTimerReminder'),
        message: translateNotification(language, 'pausedTimerReminderBody'),
      }),
      userId,
      {
        priority: TIMER_NOTIFICATION_PRIORITIES.warning,
        tags: ['stopwatch', 'workPaused'],
      }
    );
  }

  async sendTaskNotification(
    title: string,
    message: string,
    userId: string,
    priority: number,
    tags: string[]
  ): Promise<void> {
    await this.sendNotification({ title, message }, userId, {
      priority,
      tags,
    });
  }

  private async sendNotification(
    content: NotificationContent | NotificationContentResolver,
    userId: string,
    options: NotificationSendOptions
  ): Promise<void> {
    let language: string;
    try {
      const preferences = await this.preferencesService.getPreferences(userId);
      if (!preferences.pushNotifications) {
        this.logger.debug(
          'Push notification skipped: disabled in user preferences'
        );
        return;
      }
      language = preferences.language;
    } catch (error) {
      this.logger.error(
        'Failed to read push notification preference',
        error instanceof Error ? error.name : undefined
      );
      if (options.requireDelivery) throw error;
      return;
    }

    const { title, message } =
      typeof content === 'function' ? content(language) : content;
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

      const [fcmTokens, apnTokens] = await Promise.all([
        this.usersService.getPushTokens(userId, 'android'),
        this.usersService.getPushTokens(userId, 'ios'),
      ]);

      if (options.requireDelivery) {
        const unavailableProviders = [
          fcmTokens.length > 0 && !this.fcmApp ? 'FCM' : null,
          apnTokens.length > 0 && !this.apnProvider ? 'APNs' : null,
        ].filter((provider): provider is string => provider !== null);
        if (unavailableProviders.length > 0) {
          throw new Error(
            `Notification provider unavailable: ${unavailableProviders.join(', ')}`
          );
        }
      }

      if (this.fcmApp) {
        await Promise.all(
          fcmTokens.map(token =>
            this.sendFCMNotification(token, title, message, options, userId)
          )
        );
      }

      if (this.apnProvider) {
        await Promise.all(
          apnTokens.map(token =>
            this.sendAPNNotification(token, title, message, options, userId)
          )
        );
      }

      if (fcmTokens.length === 0 && apnTokens.length === 0) {
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

      const payload: admin.messaging.Message = {
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

      await admin.messaging(this.fcmApp!).send(payload);
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
          await this.usersService.clearPushToken(userId, 'android', token);
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

      const notification = new apn.Notification({
        alert: {
          title,
          body: message,
        },
        topic:
          this.configService.get<string>('APN_BUNDLE_ID') ||
          'app.pomi.community',
        sound,
        priority: 10,
        expiry: Math.floor(Date.now() / 1000) + 60 * 60,
        badge,
        threadId: 'pomi-timer',
        category: 'POMI_TIMER',
        ...(options.idempotencyKey && {
          collapseId: options.idempotencyKey,
        }),
        payload: {
          notificationType: options.tags?.[1] || 'general',
          timestamp: Date.now(),
          deepLink: 'pomi://timer',
          ...(options.idempotencyKey && {
            notificationId: options.idempotencyKey,
          }),
        },
      });

      const result = await this.apnProvider!.send(notification, token);

      if (result.failed.length > 0) {
        const failure = result.failed[0];
        const shouldClearToken =
          failure.response?.reason === 'BadDeviceToken' ||
          failure.response?.reason === 'Unregistered' ||
          failure.response?.reason === 'DeviceTokenNotForTopic';

        if (shouldClearToken) {
          this.logger.warn(
            'Invalid APNs token detected; clearing the device token'
          );
          if (userId) {
            await this.usersService.clearPushToken(userId, 'ios', token);
          }
        } else {
          throw new Error(
            `APNs delivery failed: ${JSON.stringify(result.failed)}`
          );
        }
      } else {
        this.logger.info('APNs notification sent');
      }
    } catch (error) {
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
