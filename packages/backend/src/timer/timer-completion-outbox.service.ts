import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const MAX_CLAIM_BATCH_SIZE = 100;
const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 5 * 60_000;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60_000;
const MAX_PLAN_VERSION = 1_000;
export const MAX_DURABLE_COMPLETION_ATTEMPTS = 5;

export type TimerContinuationOutcome = 'applied' | 'superseded' | 'failed';

export interface ClaimedCompletionNotification {
  id: string;
  idempotencyKey: string;
  type: 'timer-completed' | 'long-break-detected';
  userId: string;
  payload: Record<string, unknown>;
  attempts: number;
  claimToken: string;
}

export interface ClaimedTimerContinuation {
  timerId: string;
  userId: string;
  payload: Record<string, unknown>;
  attempts: number;
  claimToken: string;
  plan: Record<string, unknown> | null;
  planVersion: number | null;
}

@Injectable()
export class TimerCompletionOutboxService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource
  ) {}

  async claimPendingCompletionNotifications(
    limit: number,
    leaseMs: number
  ): Promise<ClaimedCompletionNotification[]> {
    this.requireClaimBounds(limit, leaseMs, 'Notification');
    await this.dataSource.query(
      `
        UPDATE "notification_outbox"
        SET "status" = 'failed', "processedAt" = now(),
            "claimedUntil" = NULL, "claimToken" = NULL,
            "lastError" = COALESCE("lastError", 'Maximum durable completion notification attempts exhausted'),
            "updatedAt" = now()
        WHERE "type" IN ('timer-completed', 'long-break-detected')
          AND "processedAt" IS NULL
          AND "attempts" >= $1
          AND (
            ("status" = 'pending' AND "claimToken" IS NULL AND "claimedUntil" IS NULL)
            OR
            ("status" = 'processing' AND "claimToken" IS NOT NULL AND "claimedUntil" < now())
          )
      `,
      [MAX_DURABLE_COMPLETION_ATTEMPTS]
    );
    const result = await this.dataSource.query(
      `
        WITH candidates AS (
          SELECT "id"
          FROM "notification_outbox"
          WHERE "type" IN ('timer-completed', 'long-break-detected')
            AND "processedAt" IS NULL
            AND "availableAt" <= now()
            AND "attempts" < $3
            AND (
              ("status" = 'pending' AND "claimToken" IS NULL AND "claimedUntil" IS NULL)
              OR
              ("status" = 'processing' AND "claimToken" IS NOT NULL AND "claimedUntil" < now())
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "notification_outbox" AS earlier
              WHERE earlier."type" IN ('timer-completed', 'long-break-detected')
                AND earlier."userId" = "notification_outbox"."userId"
                AND earlier."processedAt" IS NULL
                AND (earlier."createdAt", earlier."id") <
                    ("notification_outbox"."createdAt", "notification_outbox"."id")
            )
          ORDER BY "availableAt", "createdAt", "id"
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        UPDATE "notification_outbox" AS outbox
        SET
          "status" = 'processing',
          "attempts" = outbox."attempts" + 1,
          "claimedUntil" = now() + ($2 * interval '1 millisecond'),
          "availableAt" = now() + ($2 * interval '1 millisecond'),
          "claimToken" = uuid_generate_v4(),
          "updatedAt" = now()
        FROM candidates
        WHERE outbox."id" = candidates."id"
        RETURNING
          outbox."id",
          outbox."idempotencyKey",
          outbox."type",
          outbox."userId",
          outbox."payload",
          outbox."attempts",
          outbox."claimToken"
      `,
      [limit, leaseMs, MAX_DURABLE_COMPLETION_ATTEMPTS]
    );
    return this.returnedRows<ClaimedCompletionNotification>(result);
  }

  async renewCompletionNotificationLease(
    id: string,
    claimToken: string,
    leaseMs: number
  ): Promise<boolean> {
    this.requireLeaseBounds(leaseMs, 'Notification');
    return this.didUpdate(
      await this.dataSource.query(
        `
          UPDATE "notification_outbox"
          SET "claimedUntil" = now() + ($3 * interval '1 millisecond'),
              "availableAt" = now() + ($3 * interval '1 millisecond'),
              "updatedAt" = now()
          WHERE "id" = $1
            AND "claimToken" = $2
            AND "processedAt" IS NULL
          RETURNING "id"
        `,
        [id, claimToken, leaseMs]
      )
    );
  }

  async markClaimedCompletionNotificationProcessed(
    id: string,
    claimToken: string
  ): Promise<boolean> {
    return this.didUpdate(
      await this.dataSource.query(
        `
          UPDATE "notification_outbox"
          SET "status" = 'processed', "processedAt" = now(),
              "claimedUntil" = NULL, "claimToken" = NULL,
              "lastError" = NULL, "updatedAt" = now()
          WHERE "id" = $1 AND "claimToken" = $2 AND "processedAt" IS NULL
          RETURNING "id"
        `,
        [id, claimToken]
      )
    );
  }

  async markClaimedCompletionNotificationFailed(
    id: string,
    claimToken: string,
    error: unknown
  ): Promise<boolean> {
    return this.didUpdate(
      await this.dataSource.query(
        `
          UPDATE "notification_outbox"
          SET "status" = 'failed', "processedAt" = now(),
              "claimedUntil" = NULL, "claimToken" = NULL,
              "lastError" = $3, "updatedAt" = now()
          WHERE "id" = $1 AND "claimToken" = $2 AND "processedAt" IS NULL
          RETURNING "id"
        `,
        [id, claimToken, this.errorMessage(error)]
      )
    );
  }

  async releaseClaimedCompletionNotification(
    id: string,
    claimToken: string,
    error: unknown,
    retryDelayMs: number
  ): Promise<boolean> {
    this.requireRetryBounds(retryDelayMs, 'Notification');
    return this.release(
      'notification_outbox',
      'id',
      id,
      claimToken,
      error,
      retryDelayMs
    );
  }

  async claimPendingTimerContinuations(
    limit: number,
    leaseMs: number
  ): Promise<ClaimedTimerContinuation[]> {
    this.requireClaimBounds(limit, leaseMs, 'Continuation');
    const result = await this.dataSource.query(
      `
        WITH candidates AS (
          SELECT continuation."timerId", receipt."userId"
          FROM "timer_continuation_outbox" AS continuation
          INNER JOIN "timer_completion_receipts" AS receipt
            ON receipt."timerId" = continuation."timerId"
          WHERE continuation."processedAt" IS NULL
            AND continuation."availableAt" <= now()
            AND (
              (continuation."status" = 'pending' AND continuation."claimToken" IS NULL AND continuation."claimedUntil" IS NULL)
              OR
              (continuation."status" = 'processing' AND continuation."claimToken" IS NOT NULL AND continuation."claimedUntil" < now())
            )
          ORDER BY continuation."availableAt", continuation."createdAt"
          FOR UPDATE OF continuation SKIP LOCKED
          LIMIT $1
        )
        UPDATE "timer_continuation_outbox" AS outbox
        SET
          "status" = 'processing',
          "attempts" = outbox."attempts" + 1,
          "claimedUntil" = now() + ($2 * interval '1 millisecond'),
          "availableAt" = now() + ($2 * interval '1 millisecond'),
          "claimToken" = uuid_generate_v4(),
          "updatedAt" = now()
        FROM candidates
        WHERE outbox."timerId" = candidates."timerId"
        RETURNING outbox."timerId", candidates."userId", outbox."payload",
          outbox."attempts", outbox."claimToken", outbox."plan",
          outbox."planVersion"
      `,
      [limit, leaseMs]
    );
    return this.returnedRows<ClaimedTimerContinuation>(result);
  }

  async storeClaimedTimerContinuationPlan(
    timerId: string,
    claimToken: string,
    plan: Record<string, unknown>,
    planVersion: number
  ): Promise<boolean> {
    if (!this.isRecord(plan) || Object.keys(plan).length === 0) {
      throw new BadRequestException(
        'Continuation plan must be a non-empty object'
      );
    }
    this.requireBoundedPositiveInteger(
      planVersion,
      MAX_PLAN_VERSION,
      'Continuation plan version'
    );
    return this.didUpdate(
      await this.dataSource.query(
        `
          UPDATE "timer_continuation_outbox"
          SET "plan" = COALESCE("plan", $3::jsonb),
              "planVersion" = COALESCE("planVersion", $4),
              "updatedAt" = now()
          WHERE "timerId" = $1 AND "claimToken" = $2
            AND "processedAt" IS NULL
            AND ("plan" IS NULL OR ("plan" = $3::jsonb AND "planVersion" = $4))
          RETURNING "timerId"
        `,
        [timerId, claimToken, JSON.stringify(plan), planVersion]
      )
    );
  }

  async upgradeClaimedTimerContinuationPlan(
    timerId: string,
    claimToken: string,
    expectedPlan: Record<string, unknown>,
    upgradedPlan: Record<string, unknown>,
    expectedVersion: number,
    upgradedVersion: number
  ): Promise<boolean> {
    if (
      !this.isRecord(expectedPlan) ||
      Object.keys(expectedPlan).length === 0 ||
      !this.isRecord(upgradedPlan) ||
      Object.keys(upgradedPlan).length === 0
    ) {
      throw new BadRequestException(
        'Continuation plans must be non-empty objects'
      );
    }
    this.requireBoundedPositiveInteger(
      expectedVersion,
      MAX_PLAN_VERSION,
      'Expected continuation plan version'
    );
    this.requireBoundedPositiveInteger(
      upgradedVersion,
      MAX_PLAN_VERSION,
      'Upgraded continuation plan version'
    );
    if (upgradedVersion <= expectedVersion) {
      throw new BadRequestException(
        'Upgraded continuation plan version must increase'
      );
    }
    return this.didUpdate(
      await this.dataSource.query(
        `
          UPDATE "timer_continuation_outbox"
          SET "plan" = $4::jsonb, "planVersion" = $6, "updatedAt" = now()
          WHERE "timerId" = $1 AND "claimToken" = $2
            AND "processedAt" IS NULL
            AND "plan" = $3::jsonb AND "planVersion" = $5
          RETURNING "timerId"
        `,
        [
          timerId,
          claimToken,
          JSON.stringify(expectedPlan),
          JSON.stringify(upgradedPlan),
          expectedVersion,
          upgradedVersion,
        ]
      )
    );
  }

  async renewTimerContinuationLease(
    timerId: string,
    claimToken: string,
    leaseMs: number
  ): Promise<boolean> {
    this.requireLeaseBounds(leaseMs, 'Continuation');
    return this.didUpdate(
      await this.dataSource.query(
        `
          UPDATE "timer_continuation_outbox"
          SET "claimedUntil" = now() + ($3 * interval '1 millisecond'),
              "availableAt" = now() + ($3 * interval '1 millisecond'),
              "updatedAt" = now()
          WHERE "timerId" = $1 AND "claimToken" = $2
            AND "processedAt" IS NULL
          RETURNING "timerId"
        `,
        [timerId, claimToken, leaseMs]
      )
    );
  }

  async markClaimedTimerContinuationProcessed(
    timerId: string,
    claimToken: string,
    outcome: TimerContinuationOutcome
  ): Promise<boolean> {
    if (!['applied', 'superseded', 'failed'].includes(outcome)) {
      throw new BadRequestException('Unsupported continuation outcome');
    }
    return this.didUpdate(
      await this.dataSource.query(
        `
          UPDATE "timer_continuation_outbox"
          SET "status" = 'processed', "processedAt" = now(), "outcome" = $3,
              "claimedUntil" = NULL, "claimToken" = NULL,
              "lastError" = NULL, "updatedAt" = now()
          WHERE "timerId" = $1 AND "claimToken" = $2
            AND "processedAt" IS NULL
          RETURNING "timerId"
        `,
        [timerId, claimToken, outcome]
      )
    );
  }

  async releaseClaimedTimerContinuation(
    timerId: string,
    claimToken: string,
    error: unknown,
    retryDelayMs: number
  ): Promise<boolean> {
    this.requireRetryBounds(retryDelayMs, 'Continuation');
    return this.release(
      'timer_continuation_outbox',
      'timerId',
      timerId,
      claimToken,
      error,
      retryDelayMs
    );
  }

  private async release(
    table: 'notification_outbox' | 'timer_continuation_outbox',
    idColumn: 'id' | 'timerId',
    id: string,
    claimToken: string,
    error: unknown,
    retryDelayMs: number
  ): Promise<boolean> {
    const message = this.errorMessage(error);
    return this.didUpdate(
      await this.dataSource.query(
        `
          UPDATE "${table}"
          SET "status" = 'pending',
              "availableAt" = now() + ($4 * interval '1 millisecond'),
              "claimedUntil" = NULL, "claimToken" = NULL,
              "lastError" = $3, "updatedAt" = now()
          WHERE "${idColumn}" = $1 AND "claimToken" = $2
            AND "processedAt" IS NULL
          RETURNING "${idColumn}"
        `,
        [id, claimToken, message, retryDelayMs]
      )
    );
  }

  private errorMessage(error: unknown): string {
    return (
      error instanceof Error ? error.message : 'Unknown outbox error'
    ).slice(0, 4_000);
  }

  private returnedRows<T>(result: unknown): T[] {
    if (!Array.isArray(result)) return [];
    return Array.isArray(result[0]) ? (result[0] as T[]) : (result as T[]);
  }

  private didUpdate(result: unknown): boolean {
    return this.returnedRows<Record<string, unknown>>(result).length === 1;
  }

  private requireClaimBounds(
    limit: number,
    leaseMs: number,
    workType: string
  ): void {
    this.requireBoundedPositiveInteger(
      limit,
      MAX_CLAIM_BATCH_SIZE,
      `${workType} claim limit`
    );
    this.requireLeaseBounds(leaseMs, workType);
  }

  private requireLeaseBounds(leaseMs: number, workType: string): void {
    if (
      !Number.isSafeInteger(leaseMs) ||
      leaseMs < MIN_LEASE_MS ||
      leaseMs > MAX_LEASE_MS
    ) {
      throw new BadRequestException(
        `${workType} lease duration must be between ${MIN_LEASE_MS} and ${MAX_LEASE_MS} milliseconds`
      );
    }
  }

  private requireRetryBounds(retryDelayMs: number, workType: string): void {
    if (
      !Number.isSafeInteger(retryDelayMs) ||
      retryDelayMs < 0 ||
      retryDelayMs > MAX_RETRY_DELAY_MS
    ) {
      throw new BadRequestException(
        `${workType} retry delay must be between 0 and ${MAX_RETRY_DELAY_MS} milliseconds`
      );
    }
  }

  private requireBoundedPositiveInteger(
    value: number,
    maximum: number,
    label: string
  ): void {
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
      throw new BadRequestException(
        `${label} must be a positive integer no greater than ${maximum}`
      );
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
