import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PomiLogger } from '../logging/pomi-logger';
import { PreferencesService } from '../preferences/preferences.service';
import {
  DueIdleDetection,
  DueTimerCompletion,
  TimerStore,
} from './timer-store';

const SCHEDULER_LEASE_MS = 10_000;
const LEADER_RETRY_MS = 1_000;
const SCHEDULER_RENEWAL_BOUND_MS = SCHEDULER_LEASE_MS / 2;
const SCHEDULE_FALLBACK_POLL_MS = 5_000;
const CLAIM_BATCH_SIZE = 100;
const CLAIM_CONCURRENCY = 20;
const RECONCILE_SCAN_SIZE = 250;
type SchedulerWakeMode = 'pubsub' | 'poll';

@Injectable()
export class TimerCompletionSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new PomiLogger(
    TimerCompletionSchedulerService.name
  );
  private stopping = false;
  private loopPromise: Promise<void> | null = null;
  private leaderToken: string | null = null;
  private scheduleWakeRequested = false;
  private scheduleWakeResolver: (() => void) | null = null;

  constructor(
    private readonly timerStore: TimerStore,
    private readonly preferencesService: PreferencesService
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.getScheduleWakeMode() === 'pubsub') {
      try {
        await this.timerStore.startTimerScheduleWakeListener(() =>
          this.requestScheduleWake()
        );
      } catch (error) {
        this.logger.warn(
          `Failed to subscribe to Timer schedule wakeups; using bounded fallback: ${error}`
        );
      }
    }
    this.loopPromise = this.runLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.requestScheduleWake();
    if (this.leaderToken) {
      await this.timerStore
        .releaseTimerCompletionScheduler(this.leaderToken)
        .catch(error => {
          this.logger.warn(`Failed to release Timer scheduler lease: ${error}`);
        });
      this.leaderToken = null;
    }
    await this.timerStore.stopTimerScheduleWakeListener().catch(error => {
      this.logger.warn(`Failed to stop Timer scheduler wakeups: ${error}`);
    });
    if (!this.loopPromise) return;
    let timeout: NodeJS.Timeout | undefined;
    const gracePeriod = new Promise<void>(resolve => {
      timeout = setTimeout(resolve, 5_000);
    });
    await Promise.race([this.loopPromise, gracePeriod]);
    if (timeout) clearTimeout(timeout);
  }

  private async runLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        if (!(await this.ensureLeadership())) {
          await this.waitForScheduleWake(LEADER_RETRY_MS);
          continue;
        }
        if (!(await this.ensureScheduleReady())) {
          await this.waitForScheduleWake(LEADER_RETRY_MS);
          continue;
        }
        const redisNow = await this.timerStore.getRedisTimeMs();
        const idleMode = await this.timerStore.getIdleDetectionMode();
        if (idleMode === 'durable') {
          const dueIdle = await this.timerStore.getDueIdleDetections(
            redisNow,
            CLAIM_BATCH_SIZE
          );
          if (dueIdle.length > 0) {
            await this.processIdleWithConcurrency(dueIdle);
            continue;
          }
        }
        const completionMode = await this.timerStore.getTimerCompletionMode();
        if (completionMode === 'stream') {
          const due = await this.timerStore.getDueTimerCompletions(
            redisNow,
            CLAIM_BATCH_SIZE
          );
          if (due.length > 0) {
            await this.processWithConcurrency(due);
            continue;
          }
        }

        await this.waitForNextSchedule(redisNow, completionMode, idleMode);
      } catch (error) {
        if (this.stopping) return;
        this.logger.error(
          'Timer completion scheduler iteration failed:',
          error
        );
        this.leaderToken = null;
        await this.waitForScheduleWake(LEADER_RETRY_MS);
      }
    }
  }

  private async ensureLeadership(): Promise<boolean> {
    if (!this.leaderToken) {
      const acquired =
        await this.timerStore.claimTimerCompletionScheduler(SCHEDULER_LEASE_MS);
      if (this.stopping) {
        if (acquired) {
          await this.timerStore.releaseTimerCompletionScheduler(acquired);
        }
        return false;
      }
      this.leaderToken = acquired;
      return this.leaderToken !== null;
    }
    const renewed = await this.timerStore.renewTimerCompletionScheduler(
      this.leaderToken,
      SCHEDULER_LEASE_MS
    );
    if (!renewed) this.leaderToken = null;
    return renewed;
  }

  private async ensureScheduleReady(): Promise<boolean> {
    if (!(await this.ensureCompletionScheduleReady())) return false;
    return this.ensureIdleScheduleReady();
  }

  private async ensureCompletionScheduleReady(): Promise<boolean> {
    if (await this.timerStore.isTimerCompletionScheduleReady()) return true;

    let cursor = '0';
    let foundCorruptState = false;
    do {
      if (!(await this.ensureLeadership()) || !this.leaderToken) return false;
      const page = await this.timerStore.scanCurrentTimerUsers(
        cursor,
        RECONCILE_SCAN_SIZE
      );
      const leaderToken = this.leaderToken;
      const results = await Promise.all(
        page.userIds.map(userId =>
          this.timerStore.reconcileTimerCompletionSchedule(userId, leaderToken)
        )
      );
      if (results.includes('lost-leader')) {
        this.leaderToken = null;
        return false;
      }
      for (const result of results) {
        if (result === 'corrupt') {
          foundCorruptState = true;
          this.logger.error(
            'Timer schedule reconciliation found corrupt state'
          );
        }
      }
      cursor = page.cursor;
    } while (cursor !== '0');

    if (foundCorruptState) return false;
    return this.leaderToken
      ? this.timerStore.markTimerCompletionScheduleReady(this.leaderToken)
      : false;
  }

  private async ensureIdleScheduleReady(): Promise<boolean> {
    if (await this.timerStore.isIdleDetectionScheduleReady()) return true;

    const generation =
      await this.timerStore.getIdleDetectionScheduleGeneration();
    let cursor = '0';
    do {
      if (!(await this.ensureLeadership()) || !this.leaderToken) return false;
      const page = await this.timerStore.scanLastCompletionUsers(
        cursor,
        RECONCILE_SCAN_SIZE
      );
      const leaderToken = this.leaderToken;
      const results = await Promise.all(
        page.userIds.map(async userId => {
          const preferences =
            await this.preferencesService.getPreferences(userId);
          if (
            !preferences.sessionAutoDetectLongBreak ||
            !preferences.sessionsExtension ||
            !preferences.sessionHasLongBreak
          ) {
            return (await this.timerStore.cancelIdleDetectionSchedule(
              userId,
              leaderToken
            ))
              ? 'stale'
              : 'lost-leader';
          }
          return this.timerStore.scheduleIdleDetection(
            userId,
            {
              longBreakDuration: preferences.sessionLongBreakDuration,
              workTimerDuration: preferences.workTimerDuration,
              sessionPomodorosCount: preferences.sessionPomodorosCount,
            },
            leaderToken
          );
        })
      );
      if (results.includes('lost-leader')) {
        this.leaderToken = null;
        return false;
      }
      cursor = page.cursor;
    } while (cursor !== '0');

    return this.leaderToken
      ? this.timerStore.markIdleDetectionScheduleReady(
          this.leaderToken,
          generation
        )
      : false;
  }

  private async processWithConcurrency(
    due: DueTimerCompletion[]
  ): Promise<void> {
    const leaderToken = this.leaderToken;
    if (!leaderToken) return;
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(CLAIM_CONCURRENCY, due.length) },
      async () => {
        while (!this.stopping) {
          const index = nextIndex;
          nextIndex += 1;
          const scheduled = due[index];
          if (!scheduled) return;
          await this.processScheduledCompletion(scheduled, leaderToken);
        }
      }
    );
    await Promise.all(workers);
  }

  private async processIdleWithConcurrency(
    due: DueIdleDetection[]
  ): Promise<void> {
    const leaderToken = this.leaderToken;
    if (!leaderToken) return;
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(CLAIM_CONCURRENCY, due.length) },
      async () => {
        while (!this.stopping) {
          const index = nextIndex;
          nextIndex += 1;
          const scheduled = due[index];
          if (!scheduled) return;
          await this.processScheduledIdleDetection(scheduled, leaderToken);
        }
      }
    );
    await Promise.all(workers);
  }

  private async processScheduledIdleDetection(
    scheduled: DueIdleDetection,
    leaderToken: string
  ): Promise<void> {
    if (!scheduled.userId) {
      await this.timerStore.removeMalformedIdleDetection(
        scheduled.member,
        scheduled.deadline,
        leaderToken
      );
      this.logger.warn(
        `Removed malformed idle detection schedule member: ${scheduled.member}`
      );
      return;
    }
    const result = await this.timerStore.claimScheduledIdleDetection(
      scheduled.userId,
      scheduled,
      leaderToken
    );
    if (result.kind === 'lost-leader') this.leaderToken = null;
    if (result.kind === 'corrupt') {
      this.logger.error(
        `Idle detection schedule ${scheduled.member} references corrupt state`
      );
    }
  }

  private async processScheduledCompletion(
    scheduled: DueTimerCompletion,
    leaderToken: string
  ): Promise<void> {
    if (!scheduled.userId) {
      await this.timerStore.removeMalformedTimerCompletion(
        scheduled.member,
        scheduled.deadline,
        leaderToken
      );
      this.logger.warn(
        `Removed malformed Timer completion schedule member: ${scheduled.member}`
      );
      return;
    }

    const result = await this.timerStore.claimScheduledTimerCompletion(
      scheduled.userId,
      scheduled,
      leaderToken
    );
    if (result.kind === 'lost-leader') this.leaderToken = null;
    if (result.kind === 'corrupt') {
      this.logger.error(
        `Timer completion schedule ${scheduled.member} references corrupt Timer state`
      );
    }
  }

  private async waitForNextSchedule(
    redisNow: number,
    completionMode: 'legacy' | 'stream',
    idleMode: 'legacy' | 'durable'
  ): Promise<void> {
    const [completionDeadline, idleDeadline] = await Promise.all([
      completionMode === 'stream'
        ? this.timerStore.getNextTimerCompletionDeadline()
        : Promise.resolve(null),
      idleMode === 'durable'
        ? this.timerStore.getNextIdleDetectionDeadline()
        : Promise.resolve(null),
    ]);
    const deadlines = [completionDeadline, idleDeadline].filter(
      (deadline): deadline is number => deadline !== null
    );
    const nextDeadline = deadlines.length > 0 ? Math.min(...deadlines) : null;
    const untilDeadline =
      nextDeadline === null
        ? SCHEDULE_FALLBACK_POLL_MS
        : Math.max(0, nextDeadline - redisNow);
    await this.waitForScheduleWake(
      Math.min(untilDeadline, SCHEDULER_RENEWAL_BOUND_MS)
    );
  }

  private getScheduleWakeMode(): SchedulerWakeMode {
    return process.env.POMI_TIMER_SCHEDULER_WAKE_MODE === 'poll'
      ? 'poll'
      : 'pubsub';
  }

  private waitForScheduleWake(delayMs: number): Promise<void> {
    if (this.stopping || this.scheduleWakeRequested || delayMs <= 0) {
      this.scheduleWakeRequested = false;
      return Promise.resolve();
    }

    return new Promise(resolve => {
      let timeout: NodeJS.Timeout | undefined;
      const finish = () => {
        if (timeout) clearTimeout(timeout);
        if (this.scheduleWakeResolver === finish) {
          this.scheduleWakeResolver = null;
        }
        this.scheduleWakeRequested = false;
        resolve();
      };
      this.scheduleWakeResolver = finish;
      timeout = setTimeout(finish, delayMs);
    });
  }

  private requestScheduleWake(): void {
    this.scheduleWakeRequested = true;
    this.scheduleWakeResolver?.();
  }
}
