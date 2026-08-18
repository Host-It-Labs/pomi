import {
  Inject,
  Injectable,
  OnModuleDestroy,
  forwardRef,
} from '@nestjs/common';
import { TIMER_STATUSES, TIMER_TYPES, Timer } from '@pomi/shared';
import { PomiLogger } from '../logging/pomi-logger';
import { PreferencesService } from '../preferences/preferences.service';
import { TimerEvents } from './timer-events';
import { TimerNotificationService } from './timer-notification.service';
import { TimerStore } from './timer-store';
import type { TimerVersion } from './timer-store';

interface CountdownHandle {
  timeout: NodeJS.Timeout;
  timerId: string;
  scheduleRevision: string;
  preferences?: CountdownPreferences;
}

type CountdownPreferences = Awaited<
  ReturnType<PreferencesService['getPreferences']>
>;

const COUNTDOWN_RETRY_MS = 1_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

@Injectable()
export class TimerCountdownService implements OnModuleDestroy {
  private readonly logger = new PomiLogger(TimerCountdownService.name);
  private intervals: Map<string, CountdownHandle> = new Map();
  private countdownGenerations = new Map<string, number>();
  private completingUsers = new Set<string>();
  private stopping = false;

  constructor(
    @Inject(forwardRef(() => PreferencesService))
    private preferencesService: PreferencesService,
    private timerStore: TimerStore,
    private timerEvents: TimerEvents,
    private timerNotificationService: TimerNotificationService
  ) {}

  async startCountdown(
    timer: Timer,
    onComplete: (timer: Timer) => Promise<void>
  ): Promise<void> {
    if (!timer.userId) {
      this.logger.error('Timer userId is undefined');
      return;
    }
    if (!timer.scheduleRevision) {
      this.logger.error('Timer scheduleRevision is undefined');
      return;
    }
    const scheduleRevision = timer.scheduleRevision;
    const userId = timer.userId;
    const generation = (this.countdownGenerations.get(userId) ?? 0) + 1;
    this.countdownGenerations.set(userId, generation);
    const preferences = await this.preferencesService.getPreferences(userId);
    const current = await this.timerStore.getCurrentTimer(userId);
    if (
      this.stopping ||
      this.countdownGenerations.get(userId) !== generation ||
      current?.id !== timer.id ||
      current.scheduleRevision !== scheduleRevision ||
      current.status !== TIMER_STATUSES.RUNNING
    ) {
      return;
    }
    this.stopCountdown(userId);

    this.armNextCheck(timer, preferences, onComplete);
  }

  refreshCountdown(
    timer: Timer,
    onComplete: (timer: Timer) => Promise<void>
  ): void {
    if (this.stopping) return;
    if (!timer.userId || !timer.scheduleRevision) {
      this.stopCountdown(timer.userId ?? '');
      return;
    }
    if (timer.status !== TIMER_STATUSES.RUNNING) {
      this.stopCountdown(timer.userId);
      return;
    }
    const handle = this.intervals.get(timer.userId);
    if (handle?.preferences && handle.timerId === timer.id) {
      this.armNextCheck(timer, handle.preferences, onComplete);
      return;
    }
    this.armBootstrap(timer, onComplete);
  }

  private armBootstrap(
    timer: Timer,
    onComplete: (timer: Timer) => Promise<void>,
    delayMs = 0
  ): void {
    if (this.stopping) return;
    const userId = timer.userId as string;
    this.stopCountdown(userId);
    const handle: CountdownHandle = {
      timeout: undefined as unknown as NodeJS.Timeout,
      timerId: timer.id,
      scheduleRevision: timer.scheduleRevision as string,
    };
    handle.timeout = setTimeout(() => {
      if (this.intervals.get(userId) !== handle) return;
      this.bootstrapAuthoritativeCountdown(userId, onComplete, handle).catch(
        error => {
          this.logger.error('Timer countdown bootstrap error:', error);
          if (this.intervals.get(userId) === handle) {
            this.armBootstrap(timer, onComplete, COUNTDOWN_RETRY_MS);
          }
        }
      );
    }, delayMs);
    this.intervals.set(userId, handle);
  }

  private async bootstrapAuthoritativeCountdown(
    userId: string,
    onComplete: (timer: Timer) => Promise<void>,
    handle: CountdownHandle
  ): Promise<void> {
    const [preferences, current] = await Promise.all([
      this.preferencesService.getPreferences(userId),
      this.timerStore.getCurrentTimer(userId),
    ]);
    if (this.intervals.get(userId) !== handle) return;
    if (
      !current?.scheduleRevision ||
      current.status !== TIMER_STATUSES.RUNNING
    ) {
      this.stopCountdown(userId);
      return;
    }
    this.armNextCheck(current, preferences, onComplete);
  }

  private armNextCheck(
    timer: Timer,
    preferences: CountdownPreferences,
    onComplete: (timer: Timer) => Promise<void>,
    minimumDelayMs = 0
  ): void {
    if (this.stopping) return;
    const userId = timer.userId as string;
    this.stopCountdown(userId);
    const completionAt = timer.startTime + timer.duration;
    const warningAt =
      timer.type === TIMER_TYPES.WORK &&
      !timer.isExtension &&
      !timer.hasNotifiedBeforeTimeNotification &&
      preferences.notifyBeforeWorkComplete
        ? completionAt - preferences.notifyBeforeTime
        : null;
    const nextCheckAt = warningAt === null ? completionAt : warningAt;
    const delayMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(minimumDelayMs, nextCheckAt - Date.now(), 0)
    );
    const handle: CountdownHandle = {
      timeout: undefined as unknown as NodeJS.Timeout,
      timerId: timer.id,
      scheduleRevision: timer.scheduleRevision as string,
      preferences,
    };
    handle.timeout = setTimeout(() => {
      if (this.intervals.get(userId) !== handle) return;
      this.runScheduledCheck(timer, preferences, onComplete, handle).catch(
        error => {
          this.logger.error('Timer countdown check error:', error);
          if (this.intervals.get(userId) === handle) {
            this.armNextCheck(
              timer,
              preferences,
              onComplete,
              COUNTDOWN_RETRY_MS
            );
          }
        }
      );
    }, delayMs);
    this.intervals.set(userId, handle);
  }

  private async runScheduledCheck(
    timer: Timer,
    preferences: CountdownPreferences,
    onComplete: (timer: Timer) => Promise<void>,
    handle: CountdownHandle
  ): Promise<void> {
    const userId = timer.userId as string;
    const scheduleRevision = timer.scheduleRevision as string;
    const currentTimer = await this.timerStore.getCurrentTimer(userId);
    if (this.intervals.get(userId) !== handle) return;
    if (
      !currentTimer ||
      currentTimer.id !== timer.id ||
      currentTimer.scheduleRevision !== scheduleRevision ||
      currentTimer.status !== TIMER_STATUSES.RUNNING
    ) {
      if (
        currentTimer?.scheduleRevision &&
        currentTimer.status === TIMER_STATUSES.RUNNING
      ) {
        this.armBootstrap(currentTimer, onComplete);
        return;
      }
      this.stopCountdown(userId, { timerId: timer.id, scheduleRevision });
      return;
    }

    const calculatedRemainingTime = Math.max(
      0,
      currentTimer.duration - (Date.now() - currentTimer.startTime)
    );

    if (
      calculatedRemainingTime <= preferences.notifyBeforeTime &&
      !currentTimer.hasNotifiedBeforeTimeNotification &&
      currentTimer.type === TIMER_TYPES.WORK &&
      !currentTimer.isExtension &&
      preferences.notifyBeforeWorkComplete
    ) {
      const claimedTimer = await this.timerStore.claimRunningTimerWarning(
        userId,
        currentTimer.id,
        currentTimer.startTime,
        preferences.notifyBeforeTime
      );
      if (this.intervals.get(userId) !== handle) return;
      if (!claimedTimer) {
        this.armBootstrap(currentTimer, onComplete, COUNTDOWN_RETRY_MS);
        return;
      }

      this.armNextCheck(claimedTimer, preferences, onComplete);
      this.timerEvents.emitTimerUpdate(userId, claimedTimer);
      const minutesLeft = Math.round(claimedTimer.remainingTime / 60000);
      await this.timerNotificationService.emitTimerWarning(
        userId,
        claimedTimer,
        minutesLeft
      );
      return;
    }

    if (calculatedRemainingTime > 0) {
      this.armNextCheck(currentTimer, preferences, onComplete);
      return;
    }

    if (this.completingUsers.has(userId)) return;
    this.completingUsers.add(userId);

    try {
      this.stopCountdown(userId, { timerId: timer.id, scheduleRevision });
      await onComplete(currentTimer);
      if (!this.intervals.has(userId)) {
        this.armBootstrap(currentTimer, onComplete);
      }
    } catch (error) {
      if (!this.intervals.has(userId)) {
        this.armBootstrap(currentTimer, onComplete, COUNTDOWN_RETRY_MS);
      }
      throw error;
    } finally {
      this.completingUsers.delete(userId);
    }
  }

  stopCountdown(userId: string, expected?: TimerVersion): void {
    const handle = this.intervals.get(userId);
    if (
      handle &&
      (!expected ||
        (handle.timerId === expected.timerId &&
          handle.scheduleRevision === expected.scheduleRevision))
    ) {
      clearTimeout(handle.timeout);
      this.intervals.delete(userId);
    }
  }

  onModuleDestroy() {
    this.stopping = true;
    for (const handle of this.intervals.values()) {
      clearTimeout(handle.timeout);
    }
    this.intervals.clear();
  }
}
