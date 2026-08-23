import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TIMER_STATUSES, TIMER_TYPES, Timer } from '@pomi/shared';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { Redis } from 'ioredis';
import { isTransientDependencyError } from '../logging/dependency-errors';
import { PomiLogger } from '../logging/pomi-logger';
import { formatSafeError } from '../logging/sanitize-log';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { UsersService } from '../users/users.service';
import { TimerCompletionEffectsService } from './timer-completion-effects.service';
import { ACK_AND_DELETE_COMPLETION_EVENT_SCRIPT } from './timer-completion-stream.service';
import { TimerEvents } from './timer-events';
import {
  TIMER_IDLE_DETECTION_STREAM_KEY,
  TIMER_IDLE_DETECTION_STREAM_VERSION,
} from './timer-store';

const STREAM_GROUP = 'pomi:timer-idle-detection-effects:v1';
const BATCH_SIZE = 25;
const CONCURRENCY = 5;
const BLOCK_MS = 5_000;
const PENDING_MIN_IDLE_MS = 30_000;
const RECOVERY_INTERVAL_MS = 30_000;
const RETRY_MS = 1_000;

type StreamEntry = [id: string, fields: string[]];

interface IdleDetectionEvent {
  detectionId: string;
  userId: string;
  detectedAt: number;
  longBreakTimer: Timer;
  replacementTimer: Timer;
}

@Injectable()
export class TimerIdleDetectionStreamService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new PomiLogger(
    TimerIdleDetectionStreamService.name
  );
  private readonly consumerName = `${hostname()}:${process.pid}:${randomUUID()}`;
  private readonly control: Redis;
  private readonly reader: Redis;
  private stopping = false;
  private loopPromise: Promise<void> | null = null;
  private lastRecoveryAt = 0;

  constructor(
    @Inject(REDIS_CLIENT) redis: Redis,
    private readonly completionEffects: TimerCompletionEffectsService,
    private readonly usersService: UsersService,
    private readonly timerEvents: TimerEvents
  ) {
    this.control = redis.duplicate();
    this.reader = redis.duplicate();
    this.control.on('error', error => {
      if (!this.stopping) {
        this.logger.warn(`Timer idle Stream control error: ${error}`);
      }
    });
    this.reader.on('error', error => {
      if (!this.stopping) {
        this.logger.warn(`Timer idle Stream reader error: ${error}`);
      }
    });
  }

  onModuleInit(): void {
    this.loopPromise = this.runLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.reader.disconnect();
    this.control.disconnect();
    if (!this.loopPromise) return;
    let timeout: NodeJS.Timeout | undefined;
    const gracePeriod = new Promise<void>(resolve => {
      timeout = setTimeout(resolve, 5_000);
    });
    await Promise.race([this.loopPromise.catch(() => undefined), gracePeriod]);
    if (timeout) clearTimeout(timeout);
  }

  private async runLoop(): Promise<void> {
    let groupReady = false;
    while (!this.stopping) {
      try {
        if (!groupReady) {
          await this.ensureConsumerGroup();
          groupReady = true;
        }
        if (Date.now() - this.lastRecoveryAt >= RECOVERY_INTERVAL_MS) {
          await this.recoverPending();
          this.lastRecoveryAt = Date.now();
        }
        await this.readNewEvents();
      } catch (error) {
        if (this.stopping) return;
        if (error instanceof Error && error.message.includes('NOGROUP')) {
          groupReady = false;
        }
        this.reportIterationFailure(error);
        await this.wait(RETRY_MS);
      }
    }
  }

  private reportIterationFailure(error: unknown): void {
    if (isTransientDependencyError(error)) {
      this.logger.warn(
        `Timer idle Stream dependency unavailable; retrying (${formatSafeError(error)})`
      );
      return;
    }
    this.logger.error('Timer idle Stream iteration failed:', error);
  }

  private async ensureConsumerGroup(): Promise<void> {
    try {
      await this.control.xgroup(
        'CREATE',
        TIMER_IDLE_DETECTION_STREAM_KEY,
        STREAM_GROUP,
        '0',
        'MKSTREAM'
      );
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('BUSYGROUP')) {
        throw error;
      }
    }
  }

  private async recoverPending(): Promise<void> {
    let cursor = '0-0';
    do {
      const raw = (await this.control.xautoclaim(
        TIMER_IDLE_DETECTION_STREAM_KEY,
        STREAM_GROUP,
        this.consumerName,
        PENDING_MIN_IDLE_MS,
        cursor,
        'COUNT',
        BATCH_SIZE
      )) as [string, StreamEntry[], string[]];
      cursor = raw[0];
      await this.processEntries(raw[1]);
    } while (!this.stopping && cursor !== '0-0');
  }

  private async readNewEvents(): Promise<void> {
    const raw = (await this.reader.xreadgroup(
      'GROUP',
      STREAM_GROUP,
      this.consumerName,
      'COUNT',
      BATCH_SIZE,
      'BLOCK',
      BLOCK_MS,
      'STREAMS',
      TIMER_IDLE_DETECTION_STREAM_KEY,
      '>'
    )) as Array<[string, StreamEntry[]]> | null;
    if (raw) await this.processEntries(raw.flatMap(([, entries]) => entries));
  }

  private async processEntries(entries: StreamEntry[]): Promise<void> {
    const byUser = new Map<string, StreamEntry[]>();
    for (const entry of entries) {
      const userId = this.readGroupingUserId(entry[1]);
      const key = userId ? `user:${userId}` : `event:${entry[0]}`;
      const group = byUser.get(key) ?? [];
      group.push(entry);
      byUser.set(key, group);
    }
    const groups = [...byUser.values()];
    let index = 0;
    const processNext = async (): Promise<void> => {
      while (index < groups.length) {
        const group = groups[index];
        index += 1;
        for (const entry of group) await this.processEntry(entry);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, groups.length) }, processNext)
    );
  }

  private async processEntry([eventId, fields]: StreamEntry): Promise<void> {
    try {
      const event = this.parseEvent(fields);
      await this.completionEffects.persistIdleDetectionEffects(
        event.userId,
        event.longBreakTimer,
        {
          detectionId: event.detectionId,
          detectedAt: event.detectedAt,
          replacementTimer: event.replacementTimer,
        }
      );
      await this.usersService.associateTimerWithUser(
        event.userId,
        event.replacementTimer.id
      );
      this.timerEvents.emitExtensionStateUpdate(event.userId, null);
      this.timerEvents.emitTimerHistoryUpdate(event.userId, {
        canUndo: false,
        canRedo: false,
      });
      this.timerEvents.emitTimerUpdate(event.userId, event.replacementTimer);
      await this.control.eval(
        ACK_AND_DELETE_COMPLETION_EVENT_SCRIPT,
        1,
        TIMER_IDLE_DETECTION_STREAM_KEY,
        STREAM_GROUP,
        eventId
      );
    } catch (error) {
      this.logger.error(`Timer idle event ${eventId} remains pending:`, error);
    }
  }

  private parseEvent(fields: string[]): IdleDetectionEvent {
    if (fields.length % 2 !== 0) throw this.malformedEvent();
    const values: Record<string, string> = {};
    for (let index = 0; index < fields.length; index += 2) {
      if (Object.prototype.hasOwnProperty.call(values, fields[index])) {
        throw this.malformedEvent();
      }
      values[fields[index]] = fields[index + 1];
    }
    if (values.schemaVersion !== TIMER_IDLE_DETECTION_STREAM_VERSION) {
      throw this.malformedEvent();
    }
    let longBreakTimer: Timer;
    let replacementTimer: Timer;
    try {
      longBreakTimer = JSON.parse(values.longBreakTimer) as Timer;
      replacementTimer = JSON.parse(values.replacementTimer) as Timer;
    } catch {
      throw this.malformedEvent();
    }
    const detectedAt = Number(values.detectedAt);
    if (
      !this.nonEmpty(values.userId) ||
      !this.nonEmpty(values.detectionId) ||
      !this.safeNonNegative(detectedAt) ||
      longBreakTimer.userId !== values.userId ||
      !this.nonEmpty(longBreakTimer.id) ||
      !this.nonEmpty(longBreakTimer.scheduleRevision) ||
      longBreakTimer.type !== TIMER_TYPES.LONG_BREAK ||
      longBreakTimer.status !== TIMER_STATUSES.COMPLETED ||
      longBreakTimer.remainingTime !== 0 ||
      longBreakTimer.hasNotifiedLongBreakDetection !== true ||
      !this.safeNonNegative(longBreakTimer.startTime) ||
      !this.safePositive(longBreakTimer.duration) ||
      longBreakTimer.startTime + longBreakTimer.duration !== detectedAt ||
      replacementTimer.userId !== values.userId ||
      !this.nonEmpty(replacementTimer.id) ||
      !this.nonEmpty(replacementTimer.scheduleRevision) ||
      replacementTimer.type !== TIMER_TYPES.WORK ||
      replacementTimer.status !== TIMER_STATUSES.PAUSED ||
      replacementTimer.startTime !== 0 ||
      !this.safePositive(replacementTimer.duration) ||
      replacementTimer.remainingTime !== replacementTimer.duration
    ) {
      throw this.malformedEvent();
    }
    return {
      detectionId: values.detectionId,
      userId: values.userId,
      detectedAt,
      longBreakTimer,
      replacementTimer,
    };
  }

  private readGroupingUserId(fields: string[]): string | null {
    const values: string[] = [];
    for (let index = 0; index + 1 < fields.length; index += 2) {
      if (fields[index] === 'userId') values.push(fields[index + 1]);
    }
    return values.length === 1 && this.nonEmpty(values[0]) ? values[0] : null;
  }

  private nonEmpty(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private safeNonNegative(value: unknown): value is number {
    return (
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    );
  }

  private safePositive(value: unknown): value is number {
    return this.safeNonNegative(value) && value > 0;
  }

  private malformedEvent(): UnprocessableEntityException {
    return new UnprocessableEntityException(
      'Timer idle detection event is malformed'
    );
  }

  private wait(delayMs: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, delayMs));
  }
}
