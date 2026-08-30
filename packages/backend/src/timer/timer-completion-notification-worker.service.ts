import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TIMER_STATUSES, TIMER_TYPES, Timer } from '@pomi/shared';
import { isTransientDependencyError } from '../logging/dependency-errors';
import { PomiLogger } from '../logging/pomi-logger';
import { formatSafeError } from '../logging/sanitize-log';
import {
  ClaimedCompletionNotification,
  MAX_DURABLE_COMPLETION_ATTEMPTS,
  TimerCompletionOutboxService,
} from './timer-completion-outbox.service';
import { TimerNotificationService } from './timer-notification.service';

const CLAIM_BATCH_SIZE = 10;
const CLAIM_LEASE_MS = 30_000;
const LEASE_HEARTBEAT_MS = 10_000;
const IDLE_POLL_MS = 1_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

interface CompletionNotificationPayload {
  timer: Timer;
  completedAt: number;
  isLastWorkTimerInSession: boolean;
}

interface IdleDetectionNotificationPayload {
  detectionId: string;
  detectedAt: number;
  longBreakTimer: Timer;
  replacementTimer: Timer;
}

@Injectable()
export class TimerCompletionNotificationWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new PomiLogger(
    TimerCompletionNotificationWorkerService.name
  );
  private stopping = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly outbox: TimerCompletionOutboxService,
    private readonly timerNotificationService: TimerNotificationService
  ) {}

  onModuleInit(): void {
    this.loopPromise = this.runLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
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
        const jobs = await this.outbox.claimPendingCompletionNotifications(
          CLAIM_BATCH_SIZE,
          CLAIM_LEASE_MS
        );
        if (jobs.length === 0) {
          await this.wait(IDLE_POLL_MS);
          continue;
        }
        await this.processJobs(jobs);
      } catch (error) {
        if (this.stopping) return;
        this.reportWorkerFailure(
          'Timer completion notification worker cycle failed; retrying',
          error
        );
        await this.wait(IDLE_POLL_MS);
      }
    }
  }

  private async processJobs(
    jobs: ClaimedCompletionNotification[]
  ): Promise<void> {
    const jobsByUser = new Map<string, ClaimedCompletionNotification[]>();
    for (const job of jobs) {
      const userJobs = jobsByUser.get(job.userId) ?? [];
      userJobs.push(job);
      jobsByUser.set(job.userId, userJobs);
    }
    await Promise.all(
      [...jobsByUser.values()].map(async userJobs => {
        for (const job of userJobs) {
          try {
            await this.processJob(job);
          } catch (error) {
            if (this.stopping) return;
            this.reportWorkerFailure(
              'Timer completion notification job handler escaped; its claim will retry',
              error
            );
          }
        }
      })
    );
  }

  private async processJob(job: ClaimedCompletionNotification): Promise<void> {
    let ownershipLost = false;
    const heartbeat = setInterval(() => {
      void this.outbox
        .renewCompletionNotificationLease(
          job.id,
          job.claimToken,
          CLAIM_LEASE_MS
        )
        .then(renewed => {
          if (!renewed) ownershipLost = true;
        })
        .catch(() => {
          ownershipLost = true;
        });
    }, LEASE_HEARTBEAT_MS);

    try {
      const renewed = await this.outbox.renewCompletionNotificationLease(
        job.id,
        job.claimToken,
        CLAIM_LEASE_MS
      );
      if (!renewed || ownershipLost) return;
      if (job.type === 'long-break-detected') {
        const payload = this.parseIdleDetectionPayload(job);
        await this.timerNotificationService.emitDurableLongBreakDetected(
          job.userId,
          payload.replacementTimer,
          payload.detectedAt,
          job.idempotencyKey
        );
      } else {
        const payload = this.parseCompletionPayload(job);
        await this.timerNotificationService.emitDurableTimerCompleted(
          job.userId,
          payload.timer,
          payload.isLastWorkTimerInSession,
          payload.completedAt,
          job.idempotencyKey
        );
      }
      if (ownershipLost) return;

      const marked =
        await this.outbox.markClaimedCompletionNotificationProcessed(
          job.id,
          job.claimToken
        );
      if (!marked) {
        this.logger.warn(
          `Timer completion notification ${job.id} lost its lease before acknowledgement`
        );
      }
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        await this.outbox.markClaimedCompletionNotificationFailed(
          job.id,
          job.claimToken,
          error
        );
        this.logger.error(
          `Timer completion notification ${job.id} was dead-lettered:`,
          error
        );
        return;
      }
      if (job.attempts >= MAX_DURABLE_COMPLETION_ATTEMPTS) {
        await this.outbox.markClaimedCompletionNotificationFailed(
          job.id,
          job.claimToken,
          error
        );
        this.logger.error(
          `Timer completion notification ${job.id} exhausted its retry budget:`,
          error
        );
        return;
      }
      await this.outbox.releaseClaimedCompletionNotification(
        job.id,
        job.claimToken,
        error,
        this.retryDelayMs(job.attempts)
      );
      this.logger.error(
        `Timer completion notification ${job.id} will be retried:`,
        error
      );
    } finally {
      clearInterval(heartbeat);
    }
  }

  private parseCompletionPayload(
    job: ClaimedCompletionNotification
  ): CompletionNotificationPayload {
    if (!this.isRecord(job.payload) || !this.isRecord(job.payload.timer)) {
      throw new UnprocessableEntityException(
        'Timer completion notification payload is malformed'
      );
    }
    const timer = job.payload.timer as unknown as Timer;
    const completedAt = job.payload.completedAt;
    const isLastWorkTimerInSession = job.payload.isLastWorkTimerInSession;
    if (
      !this.isNonEmptyString(job.idempotencyKey) ||
      job.idempotencyKey !== `timer-completed:${timer.id}` ||
      timer.userId !== job.userId ||
      !this.isNonEmptyString(timer.id) ||
      !this.isNonEmptyString(timer.userId) ||
      !this.isNonEmptyString(timer.scheduleRevision) ||
      !Object.values(TIMER_TYPES).includes(timer.type) ||
      timer.status !== TIMER_STATUSES.COMPLETED ||
      timer.remainingTime !== 0 ||
      !this.isSafeNonNegativeInteger(timer.startTime) ||
      !this.isSafePositiveInteger(timer.duration) ||
      !this.isSafeNonNegativeInteger(completedAt) ||
      !Number.isSafeInteger(timer.startTime + timer.duration) ||
      timer.startTime + timer.duration !== completedAt ||
      (isLastWorkTimerInSession !== true && isLastWorkTimerInSession !== false)
    ) {
      throw new UnprocessableEntityException(
        'Timer completion notification payload correlations are invalid'
      );
    }
    return {
      timer,
      completedAt: completedAt as number,
      isLastWorkTimerInSession,
    };
  }

  private parseIdleDetectionPayload(
    job: ClaimedCompletionNotification
  ): IdleDetectionNotificationPayload {
    if (
      !this.isRecord(job.payload) ||
      !this.isRecord(job.payload.longBreakTimer) ||
      !this.isRecord(job.payload.replacementTimer)
    ) {
      throw new UnprocessableEntityException(
        'Idle detection notification payload is malformed'
      );
    }
    const longBreakTimer = job.payload.longBreakTimer as unknown as Timer;
    const replacementTimer = job.payload.replacementTimer as unknown as Timer;
    const detectionId = job.payload.detectionId;
    const detectedAt = job.payload.detectedAt;
    if (
      !this.isNonEmptyString(detectionId) ||
      job.idempotencyKey !== `long-break-detected:${detectionId}` ||
      longBreakTimer.userId !== job.userId ||
      !this.isNonEmptyString(longBreakTimer.id) ||
      !this.isNonEmptyString(longBreakTimer.scheduleRevision) ||
      longBreakTimer.type !== TIMER_TYPES.LONG_BREAK ||
      longBreakTimer.status !== TIMER_STATUSES.COMPLETED ||
      longBreakTimer.remainingTime !== 0 ||
      longBreakTimer.hasNotifiedLongBreakDetection !== true ||
      !this.isSafeNonNegativeInteger(longBreakTimer.startTime) ||
      !this.isSafePositiveInteger(longBreakTimer.duration) ||
      !this.isSafeNonNegativeInteger(detectedAt) ||
      longBreakTimer.startTime + longBreakTimer.duration !== detectedAt ||
      replacementTimer.userId !== job.userId ||
      !this.isNonEmptyString(replacementTimer.id) ||
      !this.isNonEmptyString(replacementTimer.scheduleRevision) ||
      replacementTimer.type !== TIMER_TYPES.WORK ||
      replacementTimer.status !== TIMER_STATUSES.PAUSED ||
      replacementTimer.startTime !== 0 ||
      !this.isSafePositiveInteger(replacementTimer.duration) ||
      replacementTimer.remainingTime !== replacementTimer.duration
    ) {
      throw new UnprocessableEntityException(
        'Idle detection notification payload correlations are invalid'
      );
    }
    return {
      detectionId,
      detectedAt: detectedAt as number,
      longBreakTimer,
      replacementTimer,
    };
  }

  private retryDelayMs(attempts: number): number {
    const exponent = Math.max(0, Math.min(6, attempts - 1));
    return Math.min(MAX_RETRY_DELAY_MS, 5_000 * 2 ** exponent);
  }

  private reportWorkerFailure(message: string, error: unknown): void {
    if (isTransientDependencyError(error)) {
      this.logger.warn(`${message} (${formatSafeError(error)})`);
      return;
    }
    this.logger.error(message, error);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
  }

  private isSafeNonNegativeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
  }

  private isSafePositiveInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) > 0;
  }

  private wait(delayMs: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, delayMs));
  }
}
