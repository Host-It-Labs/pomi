import { Inject, Injectable, forwardRef } from '@nestjs/common';
import {
  CLIENT_NOTIFICATION_TYPES,
  ClientNotificationType,
  NOTIFICATION_GROUPS,
  Preferences,
  TIMER_STATUSES,
  TIMER_TYPES,
  Timer,
  TimerTypes,
} from '@pomi/shared';
import { randomUUID } from 'crypto';
import { TIMER_NOTIFICATION_PRIORITIES } from '../common/constants';
import { NotificationService } from '../notifications/notifications.service';
import { PreferencesService } from '../preferences/preferences.service';
import { ClientNotificationEvent, TimerEvents } from './timer-events';

export interface TestNotificationRequest {
  userId: string;
  type: ClientNotificationType;
  timerType: TimerTypes;
  minutesLeft?: number;
  isLastWorkTimerInSession?: boolean;
}

@Injectable()
export class TimerNotificationService {
  constructor(
    @Inject(forwardRef(() => PreferencesService))
    private preferencesService: PreferencesService,
    @Inject(forwardRef(() => NotificationService))
    private notificationService: NotificationService,
    private timerEvents: TimerEvents
  ) {}

  async sendTestNotification(request: TestNotificationRequest): Promise<void> {
    const preferences = await this.preferencesService.getPreferences(
      request.userId
    );
    const duration = this.getDurationForTimerType(
      preferences,
      request.timerType
    );
    const isWarning = request.type === CLIENT_NOTIFICATION_TYPES.WARNING;
    const isPausedTimerReminder =
      request.type === CLIENT_NOTIFICATION_TYPES.PAUSED_TIMER_REMINDER;
    const now = Date.now();
    const requestedMinutes =
      typeof request.minutesLeft === 'number' ? request.minutesLeft : undefined;
    const warningMinutes = isWarning
      ? Math.max(
          1,
          Math.round(requestedMinutes ?? preferences.notifyBeforeTime / 60000)
        )
      : undefined;
    const remainingTime =
      isWarning && warningMinutes !== undefined
        ? warningMinutes * 60000
        : isPausedTimerReminder
          ? duration
          : 0;

    const timer: Timer = {
      id: randomUUID(),
      startTime: now - (duration - remainingTime),
      duration,
      type: request.timerType,
      status: isWarning
        ? TIMER_STATUSES.RUNNING
        : isPausedTimerReminder
          ? TIMER_STATUSES.PAUSED
          : TIMER_STATUSES.COMPLETED,
      remainingTime,
      userId: request.userId,
    };

    if (request.timerType === TIMER_TYPES.WORK) {
      timer.sessionTotal = preferences.sessionPomodorosCount;
      timer.sessionPosition = request.isLastWorkTimerInSession
        ? timer.sessionTotal
        : 1;
    }

    if (
      request.type === CLIENT_NOTIFICATION_TYPES.WARNING &&
      warningMinutes !== undefined
    ) {
      await this.emitTimerWarning(request.userId, timer, warningMinutes);
      return;
    }

    if (request.type === CLIENT_NOTIFICATION_TYPES.COMPLETE) {
      await this.emitTimerCompleted(
        request.userId,
        timer,
        request.isLastWorkTimerInSession
      );
      return;
    }

    if (request.type === CLIENT_NOTIFICATION_TYPES.PAUSED_TIMER_REMINDER) {
      await this.emitPausedTimerReminder(request.userId, timer);
      return;
    }

    if (request.type === CLIENT_NOTIFICATION_TYPES.LONG_BREAK_DETECTED) {
      await this.emitLongBreakDetected(request.userId, timer);
    }
  }

  async emitTimerWarning(
    userId: string,
    timer: Timer,
    minutesLeft: number
  ): Promise<void> {
    this.emitClientNotification({
      userId,
      type: CLIENT_NOTIFICATION_TYPES.WARNING,
      timer,
      timestamp: Date.now(),
      minutesLeft,
      notificationGroup: NOTIFICATION_GROUPS.TIMER,
    });
    await this.notificationService.sendTimerWarningNotification(
      timer,
      userId,
      minutesLeft
    );
  }

  async emitTimerCompleted(
    userId: string,
    timer: Timer,
    isLastWorkTimerInSession?: boolean
  ): Promise<void> {
    const priority =
      timer.type === TIMER_TYPES.WORK
        ? TIMER_NOTIFICATION_PRIORITIES.work
        : TIMER_NOTIFICATION_PRIORITIES.break;

    this.emitClientNotification({
      userId,
      type: CLIENT_NOTIFICATION_TYPES.COMPLETE,
      timer,
      timestamp: Date.now(),
      isLastWorkTimerInSession,
      notificationGroup: NOTIFICATION_GROUPS.TIMER,
    });
    await this.notificationService.sendTimerCompletedNotification(
      timer,
      userId,
      priority,
      isLastWorkTimerInSession === true
    );
  }

  async emitDurableTimerCompleted(
    userId: string,
    timer: Timer,
    isLastWorkTimerInSession: boolean,
    completedAt: number,
    idempotencyKey: string
  ): Promise<void> {
    const priority =
      timer.type === TIMER_TYPES.WORK
        ? TIMER_NOTIFICATION_PRIORITIES.work
        : TIMER_NOTIFICATION_PRIORITIES.break;

    await this.notificationService.sendDurableTimerCompletedNotification(
      timer,
      userId,
      priority,
      isLastWorkTimerInSession,
      idempotencyKey
    );
    this.emitClientNotification({
      userId,
      type: CLIENT_NOTIFICATION_TYPES.COMPLETE,
      timer,
      timestamp: completedAt,
      isLastWorkTimerInSession,
      notificationGroup: NOTIFICATION_GROUPS.TIMER,
    });
  }

  async emitLongBreakDetected(userId: string, timer: Timer): Promise<void> {
    this.emitClientNotification({
      userId,
      type: CLIENT_NOTIFICATION_TYPES.LONG_BREAK_DETECTED,
      timer,
      timestamp: Date.now(),
      notificationGroup: NOTIFICATION_GROUPS.TIMER,
    });
    await this.notificationService.sendLongBreakDetectedNotification(
      timer,
      userId
    );
  }

  async emitDurableLongBreakDetected(
    userId: string,
    replacementTimer: Timer,
    detectedAt: number,
    idempotencyKey: string
  ): Promise<void> {
    await this.notificationService.sendDurableLongBreakDetectedNotification(
      userId,
      idempotencyKey
    );
    this.emitClientNotification({
      userId,
      type: CLIENT_NOTIFICATION_TYPES.LONG_BREAK_DETECTED,
      timer: replacementTimer,
      timestamp: detectedAt,
      notificationGroup: NOTIFICATION_GROUPS.TIMER,
    });
  }

  async emitPausedTimerReminder(userId: string, timer: Timer): Promise<void> {
    this.emitClientNotification({
      userId,
      type: CLIENT_NOTIFICATION_TYPES.PAUSED_TIMER_REMINDER,
      timer,
      timestamp: Date.now(),
      notificationGroup: NOTIFICATION_GROUPS.TIMER,
    });
    await this.notificationService.sendPausedTimerReminderNotification(
      timer,
      userId
    );
  }

  private emitClientNotification(event: ClientNotificationEvent): void {
    this.timerEvents.emitClientNotification(event);
  }

  private getDurationForTimerType(
    preferences: Preferences,
    timerType: TimerTypes
  ): number {
    if (timerType === TIMER_TYPES.WORK) {
      return preferences.workTimerDuration;
    }

    if (timerType === TIMER_TYPES.LONG_BREAK) {
      return preferences.sessionLongBreakDuration;
    }

    return preferences.breakTimerDuration;
  }
}
