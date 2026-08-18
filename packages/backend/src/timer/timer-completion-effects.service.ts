import { ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { TIMER_TYPES, Timer } from '@pomi/shared';
import { randomUUID } from 'crypto';
import { format } from 'date-fns';
import { DataSource, EntityManager } from 'typeorm';

const COMPLETION_EFFECT_VERSION = 1;

export interface PersistTimerCompletionResult {
  applied: boolean;
  notificationIdempotencyKey: string;
}

export interface PersistTimerCompletionOptions {
  isLastWorkTimerInSession: boolean;
  completedAt: number;
}

export interface PersistIdleDetectionOptions {
  detectionId: string;
  detectedAt: number;
  replacementTimer: Timer;
}

@Injectable()
export class TimerCompletionEffectsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource
  ) {}

  async persistCompletionEffects(
    userId: string,
    timer: Timer,
    options: PersistTimerCompletionOptions
  ): Promise<PersistTimerCompletionResult> {
    const notificationIdempotencyKey = this.notificationIdempotencyKey(
      timer.id
    );
    const payload = {
      timer,
      isLastWorkTimerInSession: options.isLastWorkTimerInSession,
      completedAt: options.completedAt,
    };

    const applied = await this.dataSource.transaction(async manager => {
      const inserted = (await manager.query(
        `
          INSERT INTO "timer_completion_receipts"
            ("timerId", "userId", "effectVersion", "completedAt", "payload")
          VALUES ($1, $2, $3, $4, $5::jsonb)
          ON CONFLICT ("timerId") DO NOTHING
          RETURNING "timerId"
        `,
        [
          timer.id,
          userId,
          COMPLETION_EFFECT_VERSION,
          options.completedAt,
          JSON.stringify(payload),
        ]
      )) as Array<{ timerId: string }>;

      if (inserted.length === 0) {
        const matchingReceipt = (await manager.query(
          `
            SELECT 1
            FROM "timer_completion_receipts"
            WHERE "timerId" = $1
              AND "userId" = $2
              AND "effectVersion" = $3
              AND "payload" = $4::jsonb
          `,
          [timer.id, userId, COMPLETION_EFFECT_VERSION, JSON.stringify(payload)]
        )) as Array<{ '?column?': number }>;
        if (matchingReceipt.length !== 1) {
          throw new ConflictException(
            'Timer completion payload conflicts with its durable receipt'
          );
        }
        await this.ensureContinuation(manager, timer.id, payload);
        return false;
      }

      await this.persistStatistic(manager, userId, timer, options.completedAt);
      await this.incrementIntentionUsage(manager, userId, timer);
      await manager.query(
        `
          INSERT INTO "notification_outbox"
            ("id", "idempotencyKey", "userId", "type", "payload")
          VALUES ($1, $2, $3, 'timer-completed', $4::jsonb)
        `,
        [
          randomUUID(),
          notificationIdempotencyKey,
          userId,
          JSON.stringify(payload),
        ]
      );
      await this.ensureContinuation(manager, timer.id, payload);

      return true;
    });

    return { applied, notificationIdempotencyKey };
  }

  async persistIdleDetectionEffects(
    userId: string,
    longBreakTimer: Timer,
    options: PersistIdleDetectionOptions
  ): Promise<PersistTimerCompletionResult> {
    const notificationIdempotencyKey = `long-break-detected:${options.detectionId}`;
    const payload = {
      detectionId: options.detectionId,
      detectedAt: options.detectedAt,
      longBreakTimer,
      replacementTimer: options.replacementTimer,
    };
    const applied = await this.dataSource.transaction(async manager => {
      const inserted = (await manager.query(
        `
          INSERT INTO "timer_completion_receipts"
            ("timerId", "userId", "effectVersion", "completedAt", "payload")
          VALUES ($1, $2, $3, $4, $5::jsonb)
          ON CONFLICT ("timerId") DO NOTHING
          RETURNING "timerId"
        `,
        [
          longBreakTimer.id,
          userId,
          COMPLETION_EFFECT_VERSION,
          options.detectedAt,
          JSON.stringify(payload),
        ]
      )) as Array<{ timerId: string }>;

      if (inserted.length === 0) {
        const matchingReceipt = (await manager.query(
          `
            SELECT 1
            FROM "timer_completion_receipts"
            WHERE "timerId" = $1
              AND "userId" = $2
              AND "effectVersion" = $3
              AND "payload" = $4::jsonb
          `,
          [
            longBreakTimer.id,
            userId,
            COMPLETION_EFFECT_VERSION,
            JSON.stringify(payload),
          ]
        )) as Array<{ '?column?': number }>;
        if (matchingReceipt.length !== 1) {
          throw new ConflictException(
            'Idle detection payload conflicts with its durable receipt'
          );
        }
        return false;
      }

      await this.persistStatistic(
        manager,
        userId,
        longBreakTimer,
        options.detectedAt
      );
      await manager.query(
        `
          INSERT INTO "notification_outbox"
            ("id", "idempotencyKey", "userId", "type", "payload")
          VALUES ($1, $2, $3, 'long-break-detected', $4::jsonb)
        `,
        [
          randomUUID(),
          notificationIdempotencyKey,
          userId,
          JSON.stringify(payload),
        ]
      );
      return true;
    });
    return { applied, notificationIdempotencyKey };
  }

  private async persistStatistic(
    manager: EntityManager,
    userId: string,
    timer: Timer,
    completedAt: number
  ): Promise<void> {
    const selectedIntentions = this.getTimerIntentions(timer);
    const selectedSubIntentions = this.getTimerSubIntentions(timer);
    const shouldRecord =
      timer.type === TIMER_TYPES.WORK ||
      timer.type === TIMER_TYPES.LONG_BREAK ||
      (timer.type === TIMER_TYPES.BREAK && selectedIntentions.length > 0);

    if (!shouldRecord) {
      return;
    }

    const elapsedDuration = timer.duration - timer.remainingTime;
    if (timer.isExtension && timer.extensionOriginalTimerId) {
      const updatedResult = await manager.query(
        `
          UPDATE "statistics"
          SET
            "duration" = "duration" + $3,
            "completedAt" = $4,
            "updatedAt" = now()
          WHERE "id" = $1 AND "userId" = $2
          RETURNING "id"
        `,
        [timer.extensionOriginalTimerId, userId, elapsedDuration, completedAt]
      );
      const updated = this.returnedRows<{ id: string }>(updatedResult);

      if (updated.length !== 1) {
        throw new ConflictException(
          'Original Timer statistic is unavailable for extension completion'
        );
      }
      return;
    }

    await manager.query(
      `
        INSERT INTO "statistics"
          (
            "id",
            "userId",
            "type",
            "date",
            "duration",
            "completedAt",
            "intention",
            "intentions",
            "subIntentions",
            "createdAt",
            "updatedAt"
          )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9::jsonb, now(), now())
      `,
      [
        timer.id,
        userId,
        timer.type,
        format(new Date(completedAt), 'yyyy-MM-dd'),
        elapsedDuration,
        completedAt,
        selectedIntentions[0] ?? null,
        selectedIntentions.length > 0 ? selectedIntentions : null,
        Object.keys(selectedSubIntentions).length > 0
          ? JSON.stringify(selectedSubIntentions)
          : null,
      ]
    );
  }

  private async incrementIntentionUsage(
    manager: EntityManager,
    userId: string,
    timer: Timer
  ): Promise<void> {
    if (
      timer.type !== TIMER_TYPES.WORK &&
      timer.type !== TIMER_TYPES.LONG_BREAK &&
      timer.type !== TIMER_TYPES.BREAK
    ) {
      return;
    }

    const selectedIntentions = this.getTimerIntentions(timer);
    if (selectedIntentions.length === 0) {
      return;
    }

    await this.incrementSlugs(manager, userId, selectedIntentions);
    await this.incrementSlugs(
      manager,
      userId,
      Object.values(this.getTimerSubIntentions(timer))
    );
  }

  private async incrementSlugs(
    manager: EntityManager,
    userId: string,
    slugs: string[]
  ): Promise<void> {
    const uniqueSlugs = Array.from(new Set(slugs.filter(Boolean)));
    if (uniqueSlugs.length === 0) {
      return;
    }

    await manager.query(
      `
        UPDATE "intentions"
        SET "usageCount" = "usageCount" + 1, "updatedAt" = now()
        WHERE "userId" = $1 AND "slug" = ANY($2::text[])
      `,
      [userId, uniqueSlugs]
    );
  }

  private getTimerIntentions(timer: Timer): string[] {
    const source = Array.isArray(timer.intentionSlugs)
      ? timer.intentionSlugs
      : timer.intention
        ? [timer.intention]
        : [];
    return Array.from(new Set(source.map(slug => slug.trim()).filter(Boolean)));
  }

  private getTimerSubIntentions(timer: Timer): Record<string, string> {
    const selectedIntentions = new Set(this.getTimerIntentions(timer));
    return Object.fromEntries(
      Object.entries(timer.subIntentions ?? {})
        .map(([parentSlug, subSlug]) => [parentSlug.trim(), subSlug.trim()])
        .filter(
          ([parentSlug, subSlug]) =>
            selectedIntentions.has(parentSlug) && Boolean(subSlug)
        )
    );
  }

  private notificationIdempotencyKey(timerId: string): string {
    return `timer-completed:${timerId}`;
  }

  private async ensureContinuation(
    manager: EntityManager,
    timerId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const serializedPayload = JSON.stringify(payload);
    await manager.query(
      `
        INSERT INTO "timer_continuation_outbox" ("timerId", "payload")
        VALUES ($1, $2::jsonb)
        ON CONFLICT ("timerId") DO NOTHING
      `,
      [timerId, serializedPayload]
    );
    const matching = (await manager.query(
      `
        SELECT 1
        FROM "timer_continuation_outbox"
        WHERE "timerId" = $1 AND "payload" = $2::jsonb
      `,
      [timerId, serializedPayload]
    )) as Array<{ '?column?': number }>;
    if (matching.length !== 1) {
      throw new ConflictException(
        'Timer continuation payload conflicts with its durable receipt'
      );
    }
  }

  private returnedRows<T>(result: unknown): T[] {
    if (!Array.isArray(result)) {
      return [];
    }
    return Array.isArray(result[0]) ? (result[0] as T[]) : (result as T[]);
  }
}
