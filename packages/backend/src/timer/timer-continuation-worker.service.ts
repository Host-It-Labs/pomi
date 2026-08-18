import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TIMER_STATUSES, TIMER_TYPES, Timer } from '@pomi/shared';
import { randomUUID } from 'crypto';
import { isTransientDependencyError } from '../logging/dependency-errors';
import { PomiLogger } from '../logging/pomi-logger';
import { formatSafeError } from '../logging/sanitize-log';
import { PreferencesService } from '../preferences/preferences.service';
import {
  TIMER_CONTINUATION_PLAN_VERSION,
  TimerContinuationPlanV2,
  buildTimerContinuationPlan,
  parseTimerContinuationPlan,
  parseTimerContinuationPlanV1,
  upgradeTimerContinuationPlanV1,
} from './timer-continuation-plan';
import {
  ClaimedTimerContinuation,
  TimerCompletionOutboxService,
} from './timer-completion-outbox.service';
import { TimerStore } from './timer-store';
import { TimerService } from './timer.service';

const CLAIM_BATCH_SIZE = 5;
const CLAIM_LEASE_MS = 30_000;
const USER_LOCK_LEASE_MS = 30_000;
const LEASE_HEARTBEAT_MS = 10_000;
const IDLE_POLL_MS = 1_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

@Injectable()
export class TimerContinuationWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new PomiLogger(TimerContinuationWorkerService.name);
  private stopping = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly outbox: TimerCompletionOutboxService,
    private readonly preferencesService: PreferencesService,
    private readonly timerStore: TimerStore,
    private readonly timerService: TimerService
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
        const jobs = await this.outbox.claimPendingTimerContinuations(
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
          'Timer continuation worker cycle failed; retrying',
          error
        );
        await this.wait(IDLE_POLL_MS);
      }
    }
  }

  private async processJobs(jobs: ClaimedTimerContinuation[]): Promise<void> {
    const jobsByUser = new Map<string, ClaimedTimerContinuation[]>();
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
              'Timer continuation job handler escaped; its claim will retry',
              error
            );
          }
        }
      })
    );
  }

  private async processJob(job: ClaimedTimerContinuation): Promise<void> {
    let userLockToken: string | null = null;
    let heartbeat: NodeJS.Timeout | null = null;
    let ownershipLost = false;
    try {
      userLockToken = await this.timerStore.claimTimerContinuationUserLock(
        job.userId,
        USER_LOCK_LEASE_MS
      );
      if (!userLockToken) {
        await this.outbox.releaseClaimedTimerContinuation(
          job.timerId,
          job.claimToken,
          new Error('Another continuation is active for this user'),
          250
        );
        return;
      }
      heartbeat = setInterval(() => {
        void Promise.all([
          this.timerStore.renewTimerContinuationUserLock(
            job.userId,
            userLockToken as string,
            USER_LOCK_LEASE_MS
          ),
          this.outbox.renewTimerContinuationLease(
            job.timerId,
            job.claimToken,
            CLAIM_LEASE_MS
          ),
        ])
          .then(([hasUserLock, hasOutboxLease]) => {
            if (!hasUserLock || !hasOutboxLease) ownershipLost = true;
          })
          .catch(() => {
            ownershipLost = true;
          });
      }, LEASE_HEARTBEAT_MS);
      const payload = this.parsePayload(job);
      const plan = await this.resolvePlan(job, payload);
      if (plan.activationAt > Date.now()) {
        await this.wait(plan.activationAt - Date.now());
      }
      if (ownershipLost) return;
      const renewed = await this.outbox.renewTimerContinuationLease(
        job.timerId,
        job.claimToken,
        CLAIM_LEASE_MS
      );
      if (!renewed) return;
      const lockRenewed = await this.timerStore.renewTimerContinuationUserLock(
        job.userId,
        userLockToken,
        USER_LOCK_LEASE_MS
      );
      if (!lockRenewed || ownershipLost) return;

      const result = await this.timerStore.applyTimerContinuationPlan(
        job.userId,
        plan,
        userLockToken
      );
      if (result.kind === 'lost-lock') return;
      if (ownershipLost || !(await this.renewOwnership(job, userLockToken))) {
        return;
      }
      if (result.kind !== 'superseded') {
        const current = await this.timerStore.getCurrentTimer(job.userId);
        if (
          current?.id === plan.nextTimer.id &&
          current.scheduleRevision === plan.nextTimer.scheduleRevision
        ) {
          await this.timerService.activateTimerContinuation(plan);
        }
      }
      if (ownershipLost || !(await this.renewOwnership(job, userLockToken))) {
        return;
      }
      const marked = await this.outbox.markClaimedTimerContinuationProcessed(
        job.timerId,
        job.claimToken,
        result.kind === 'superseded' ? 'superseded' : 'applied'
      );
      if (!marked) {
        this.logger.warn(
          `Timer continuation ${job.timerId} lost its lease before acknowledgement`
        );
      }
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        await this.outbox.markClaimedTimerContinuationProcessed(
          job.timerId,
          job.claimToken,
          'failed'
        );
        this.logger.error(
          `Timer continuation ${job.timerId} was dead-lettered:`,
          error
        );
        return;
      }
      await this.outbox.releaseClaimedTimerContinuation(
        job.timerId,
        job.claimToken,
        error,
        this.retryDelayMs(job.attempts)
      );
      this.logger.error(
        `Timer continuation ${job.timerId} will be retried:`,
        error
      );
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (userLockToken) {
        try {
          await this.timerStore.releaseTimerContinuationUserLock(
            job.userId,
            userLockToken
          );
        } catch (error) {
          if (!this.stopping) {
            this.logger.warn(
              `Timer continuation lock cleanup failed; the claim will expire for retry (${formatSafeError(error)})`
            );
          }
        }
      }
    }
  }

  private async renewOwnership(
    job: ClaimedTimerContinuation,
    userLockToken: string
  ): Promise<boolean> {
    const [hasUserLock, hasOutboxLease] = await Promise.all([
      this.timerStore.renewTimerContinuationUserLock(
        job.userId,
        userLockToken,
        USER_LOCK_LEASE_MS
      ),
      this.outbox.renewTimerContinuationLease(
        job.timerId,
        job.claimToken,
        CLAIM_LEASE_MS
      ),
    ]);
    return hasUserLock && hasOutboxLease;
  }

  private async resolvePlan(
    job: ClaimedTimerContinuation,
    payload: CompletionPayload
  ): Promise<TimerContinuationPlanV2> {
    if (job.plan !== null) {
      if (
        job.planVersion !== 1 &&
        job.planVersion !== TIMER_CONTINUATION_PLAN_VERSION
      ) {
        throw new UnprocessableEntityException(
          `Unsupported Timer continuation plan version: ${job.planVersion ?? 'missing'}`
        );
      }
      const plan =
        job.planVersion === 1
          ? await this.upgradeV1Plan(job)
          : parseTimerContinuationPlan(job.plan, job.planVersion);
      this.assertPlanCorrelations(job, payload, plan);
      return plan;
    }

    const preferences = await this.preferencesService.getPreferences(
      job.userId
    );
    const plan = buildTimerContinuationPlan(
      payload.timer,
      preferences,
      payload.completedAt,
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID()
    );
    const stored = await this.outbox.storeClaimedTimerContinuationPlan(
      job.timerId,
      job.claimToken,
      plan as unknown as Record<string, unknown>,
      TIMER_CONTINUATION_PLAN_VERSION
    );
    if (!stored) {
      throw new Error('Timer continuation lease was lost before plan storage');
    }
    return plan;
  }

  private async upgradeV1Plan(
    job: ClaimedTimerContinuation
  ): Promise<TimerContinuationPlanV2> {
    const legacyPlan = parseTimerContinuationPlanV1(job.plan);
    const preferences = await this.preferencesService.getPreferences(
      job.userId
    );
    const plan = upgradeTimerContinuationPlanV1(legacyPlan, preferences, {
      detectionId: randomUUID(),
      longBreakTimerId: randomUUID(),
      replacementTimerId: randomUUID(),
      replacementScheduleRevision: randomUUID(),
    });
    const upgraded = await this.outbox.upgradeClaimedTimerContinuationPlan(
      job.timerId,
      job.claimToken,
      job.plan as Record<string, unknown>,
      plan as unknown as Record<string, unknown>,
      1,
      TIMER_CONTINUATION_PLAN_VERSION
    );
    if (!upgraded) {
      throw new Error('Timer continuation lease was lost during plan upgrade');
    }
    return plan;
  }

  private parsePayload(job: ClaimedTimerContinuation): CompletionPayload {
    if (!this.isRecord(job.payload) || !this.isRecord(job.payload.timer)) {
      throw new UnprocessableEntityException(
        'Timer continuation payload is malformed'
      );
    }
    const timer = job.payload.timer as unknown as Timer;
    const completedAt = job.payload.completedAt;
    if (
      timer.id !== job.timerId ||
      timer.userId !== job.userId ||
      !this.isNonEmptyString(timer.id) ||
      !this.isNonEmptyString(timer.userId) ||
      !this.isNonEmptyString(timer.scheduleRevision) ||
      !Object.values(TIMER_TYPES).includes(timer.type) ||
      timer.status !== TIMER_STATUSES.COMPLETED ||
      timer.remainingTime !== 0 ||
      !this.isSafeNonNegativeInteger(completedAt) ||
      !this.isSafeNonNegativeInteger(timer.startTime) ||
      !this.isSafePositiveInteger(timer.duration) ||
      !this.hasValidSessionPosition(timer) ||
      !this.hasValidOptionalNumericFields(timer) ||
      (timer.isExtension !== undefined &&
        typeof timer.isExtension !== 'boolean') ||
      (timer.extensionNextTimerType !== undefined &&
        !Object.values(TIMER_TYPES).includes(timer.extensionNextTimerType)) ||
      (timer.sessionIntentionEmojis !== undefined &&
        !this.isRecord(timer.sessionIntentionEmojis)) ||
      (timer.focusedTaskIds !== undefined &&
        (!Array.isArray(timer.focusedTaskIds) ||
          timer.focusedTaskIds.some(id => !this.isNonEmptyString(id)))) ||
      !Number.isSafeInteger(timer.startTime + timer.duration) ||
      timer.startTime + timer.duration !== completedAt ||
      (job.payload.isLastWorkTimerInSession !== true &&
        job.payload.isLastWorkTimerInSession !== false)
    ) {
      throw new UnprocessableEntityException(
        'Timer continuation payload correlations are invalid'
      );
    }
    return { timer, completedAt: completedAt as number };
  }

  private assertPlanCorrelations(
    job: ClaimedTimerContinuation,
    payload: CompletionPayload,
    plan: TimerContinuationPlanV2
  ): void {
    if (
      plan.source.timerId !== job.timerId ||
      plan.source.scheduleRevision !== payload.timer.scheduleRevision ||
      plan.nextTimer.userId !== job.userId
    ) {
      throw new UnprocessableEntityException(
        'Timer continuation plan correlations are invalid'
      );
    }
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
    return typeof value === 'string' && value.trim().length > 0;
  }

  private isSafeNonNegativeInteger(value: unknown): value is number {
    return (
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    );
  }

  private isSafePositiveInteger(value: unknown): value is number {
    return this.isSafeNonNegativeInteger(value) && value > 0;
  }

  private hasValidSessionPosition(timer: Timer): boolean {
    if (
      timer.sessionPosition === undefined &&
      timer.sessionTotal === undefined
    ) {
      return true;
    }
    return (
      this.isSafePositiveInteger(timer.sessionPosition) &&
      this.isSafePositiveInteger(timer.sessionTotal) &&
      timer.sessionPosition <= timer.sessionTotal
    );
  }

  private hasValidOptionalNumericFields(timer: Timer): boolean {
    return [
      timer.stackedSessions,
      timer.originalDuration,
      timer.originalBreakDuration,
      timer.extensionBaseDuration,
    ].every(value => value === undefined || this.isSafePositiveInteger(value));
  }

  private async wait(durationMs: number): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, durationMs));
  }
}

interface CompletionPayload {
  timer: Timer;
  completedAt: number;
}
