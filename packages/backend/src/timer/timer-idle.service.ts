import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { TIMER_STATUSES, TIMER_TYPES, Timer } from '@pomi/shared';
import { randomUUID } from 'crypto';
import { PomiLogger } from '../logging/pomi-logger';
import { Subscription } from 'rxjs';
import { PreferencesService } from '../preferences/preferences.service';
import { StatisticsService } from '../statistics/statistics.service';
import { TimerNotificationService } from './timer-notification.service';
import { TimerStore, timerVersion } from './timer-store';

const PAUSED_TIMER_REMINDER_DELAY_MS = 5 * 60 * 1000;

@Injectable()
export class TimerIdleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PomiLogger(TimerIdleService.name);
  private idleCheckSchedules: Map<string, NodeJS.Timeout> = new Map();
  private legacyWorkTimerFactories = new Map<
    string,
    (userId: string) => Promise<Timer>
  >();
  private pausedReminderSchedules: Map<string, NodeJS.Timeout> = new Map();
  private idleScheduleOperations = new Map<string, Promise<void>>();
  private preferencesSubscription: Subscription | null = null;

  constructor(
    @Inject(forwardRef(() => PreferencesService))
    private preferencesService: PreferencesService,
    private statisticsService: StatisticsService,
    private timerStore: TimerStore,
    private timerNotificationService: TimerNotificationService
  ) {}

  onModuleInit(): void {
    this.preferencesSubscription =
      this.preferencesService.onPreferencesUpdate.subscribe(({ userId }) => {
        this.scheduleIdleDetectionCheck(userId);
      });
  }

  scheduleIdleDetectionCheck(
    userId: string,
    createWorkTimer?: (userId: string) => Promise<Timer>
  ): void {
    if (createWorkTimer) {
      this.legacyWorkTimerFactories.set(userId, createWorkTimer);
    }
    this.enqueueIdleScheduleOperation(userId, () =>
      this.persistIdleDetectionSchedule(userId)
    ).catch(error => {
      this.logger.error(
        `Error scheduling idle detection for user ${userId}:`,
        error
      );
    });
  }

  cancelIdleDetectionCheck(userId: string): void {
    this.cancelLegacyIdleDetectionCheck(userId);
    this.legacyWorkTimerFactories.delete(userId);
    this.enqueueIdleScheduleOperation(userId, async () => {
      await this.timerStore.cancelIdleDetectionSchedule(userId);
    }).catch(error => {
      this.logger.error(
        `Error cancelling idle detection for user ${userId}:`,
        error
      );
    });
  }

  private enqueueIdleScheduleOperation(
    userId: string,
    operation: () => Promise<void>
  ): Promise<void> {
    const previous =
      this.idleScheduleOperations.get(userId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.idleScheduleOperations.set(userId, current);
    const cleanup = () => {
      if (this.idleScheduleOperations.get(userId) === current) {
        this.idleScheduleOperations.delete(userId);
      }
    };
    void current.then(cleanup, cleanup);
    return current;
  }

  schedulePausedTimerReminder(userId: string, timerId: string): void {
    this.cancelPausedTimerReminder(userId);

    const reminderTimeout = setTimeout(() => {
      this.sendPausedTimerReminder(userId, timerId).catch(error => {
        this.logger.error(
          `Error sending paused timer reminder for user ${userId}:`,
          error
        );
      });
      this.pausedReminderSchedules.delete(userId);
    }, PAUSED_TIMER_REMINDER_DELAY_MS);

    this.pausedReminderSchedules.set(userId, reminderTimeout);
  }

  cancelPausedTimerReminder(userId: string): void {
    const existingTimeout = this.pausedReminderSchedules.get(userId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.pausedReminderSchedules.delete(userId);
    }
  }

  private async sendPausedTimerReminder(
    userId: string,
    timerId: string
  ): Promise<void> {
    const timer = await this.timerStore.getCurrentTimer(userId);

    if (!timer || timer.id !== timerId) {
      return;
    }

    if (
      timer.type !== TIMER_TYPES.WORK ||
      timer.status !== TIMER_STATUSES.PAUSED ||
      timer.hasNotifiedPausedTimerReminder
    ) {
      return;
    }

    const expected = timerVersion(timer);
    timer.hasNotifiedPausedTimerReminder = true;
    const write = await this.timerStore.replaceCurrentTimer(
      userId,
      expected,
      timer
    );
    if (write.kind === 'conflict') return;
    await this.timerNotificationService.emitPausedTimerReminder(
      userId,
      write.timer
    );
  }

  private async persistIdleDetectionSchedule(userId: string): Promise<void> {
    this.cancelLegacyIdleDetectionCheck(userId);
    await this.timerStore.prepareIdleDetectionScheduleChange();
    const preferences = await this.preferencesService.getPreferences(userId);

    if (
      !preferences.sessionAutoDetectLongBreak ||
      !preferences.sessionsExtension ||
      !preferences.sessionHasLongBreak
    ) {
      await this.timerStore.cancelIdleDetectionSchedule(userId);
      return;
    }
    await this.timerStore.scheduleIdleDetection(userId, {
      longBreakDuration: preferences.sessionLongBreakDuration,
      workTimerDuration: preferences.workTimerDuration,
      sessionPomodorosCount: preferences.sessionPomodorosCount,
    });
    const createWorkTimer = this.legacyWorkTimerFactories.get(userId);
    if (
      !createWorkTimer ||
      (await this.timerStore.getIdleDetectionMode()) === 'durable'
    ) {
      return;
    }
    const lastCompletion =
      await this.timerStore.getLastCompletionTimestamp(userId);
    if (lastCompletion === null) return;
    const delay = Math.max(
      0,
      lastCompletion + preferences.sessionLongBreakDuration - Date.now()
    );
    const timeout = setTimeout(() => {
      this.idleCheckSchedules.delete(userId);
      void this.checkForLongIdlePeriod(userId, createWorkTimer).catch(error => {
        this.logger.error(
          `Error checking idle period for user ${userId}:`,
          error
        );
      });
    }, delay);
    this.idleCheckSchedules.set(userId, timeout);
  }

  private async checkForLongIdlePeriod(
    userId: string,
    createWorkTimer: (userId: string) => Promise<Timer>
  ): Promise<void> {
    if ((await this.timerStore.getIdleDetectionMode()) === 'durable') return;
    const preferences = await this.preferencesService.getPreferences(userId);
    if (
      !preferences.sessionAutoDetectLongBreak ||
      !preferences.sessionsExtension ||
      !preferences.sessionHasLongBreak
    ) {
      return;
    }
    const [currentTimer, extensionState, lastCompletion] = await Promise.all([
      this.timerStore.getCurrentTimer(userId),
      this.timerStore.getExtensionState(userId),
      this.timerStore.getLastCompletionTimestamp(userId),
    ]);
    if (!currentTimer?.scheduleRevision || lastCompletion === null) return;
    const hasPendingExtension = Boolean(
      extensionState &&
      ((currentTimer.type === TIMER_TYPES.WORK &&
        currentTimer.status === TIMER_STATUSES.COMPLETED) ||
        currentTimer.remainingTime === currentTimer.duration)
    );
    if (
      currentTimer.status === TIMER_STATUSES.RUNNING ||
      (!hasPendingExtension &&
        (currentTimer.type === TIMER_TYPES.LONG_BREAK ||
          currentTimer.remainingTime < currentTimer.duration))
    ) {
      return;
    }
    const now = Date.now();
    const idleDuration = now - lastCompletion;
    if (idleDuration < preferences.sessionLongBreakDuration) {
      this.scheduleIdleDetectionCheck(userId, createWorkTimer);
      return;
    }
    if (
      !(await this.timerStore.claimLegacyIdleDetection(
        userId,
        lastCompletion,
        timerVersion(currentTimer)
      ))
    ) {
      return;
    }
    await this.statisticsService.recordCompletedTimer(userId, {
      id: randomUUID(),
      type: TIMER_TYPES.LONG_BREAK,
      duration: idleDuration,
      startTime: lastCompletion,
      remainingTime: 0,
      status: TIMER_STATUSES.COMPLETED,
      userId,
    });
    await this.timerStore.clearLastCompletionTimestamp(userId);
    await this.timerStore.clearSessionState(userId);
    const timer = await createWorkTimer(userId);
    await this.timerNotificationService.emitLongBreakDetected(userId, timer);
  }

  private cancelLegacyIdleDetectionCheck(userId: string): void {
    const timeout = this.idleCheckSchedules.get(userId);
    if (!timeout) return;
    clearTimeout(timeout);
    this.idleCheckSchedules.delete(userId);
  }

  onModuleDestroy() {
    this.preferencesSubscription?.unsubscribe();
    this.preferencesSubscription = null;
    for (const timeout of this.idleCheckSchedules.values()) {
      clearTimeout(timeout);
    }
    this.idleCheckSchedules.clear();
    this.legacyWorkTimerFactories.clear();
    for (const timeout of this.pausedReminderSchedules.values()) {
      clearTimeout(timeout);
    }
    this.pausedReminderSchedules.clear();
  }
}
