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
import { PomiLogger } from '../logging/pomi-logger';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { TimerCompletionEffectsService } from './timer-completion-effects.service';
import {
  TIMER_COMPLETION_MODE_KEY,
  TIMER_COMPLETION_STREAM_KEY,
  TIMER_COMPLETION_STREAM_VERSION,
} from './timer-store';

export const TIMER_COMPLETION_STREAM_GROUP = 'pomi:timer-completion-effects:v1';
export const ACK_AND_DELETE_COMPLETION_EVENT_SCRIPT = `
local acknowledged = redis.call('xack', KEYS[1], ARGV[1], ARGV[2])
local deleted = 0
if acknowledged == 1 then
  deleted = redis.call('xdel', KEYS[1], ARGV[2])
end
return {acknowledged, deleted}
`;
const STREAM_BATCH_SIZE = 25;
const STREAM_PROCESSING_CONCURRENCY = 5;
const STREAM_BLOCK_MS = 5_000;
const PENDING_MIN_IDLE_MS = 30_000;
const PENDING_RECOVERY_INTERVAL_MS = 30_000;
const LEGACY_MODE_POLL_MS = 1_000;

type StreamEntry = [id: string, fields: string[]];

interface TimerCompletionEvent {
  userId: string;
  timer: Timer;
  completedAt: number;
}

@Injectable()
export class TimerCompletionStreamService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new PomiLogger(TimerCompletionStreamService.name);
  private readonly consumerName = `${hostname()}:${process.pid}:${randomUUID()}`;
  private readonly control: Redis;
  private readonly reader: Redis;
  private stopping = false;
  private loopPromise: Promise<void> | null = null;
  private lastPendingRecoveryAt = 0;

  constructor(
    @Inject(REDIS_CLIENT)
    redis: Redis,
    private readonly completionEffects: TimerCompletionEffectsService
  ) {
    this.control = redis.duplicate();
    this.reader = redis.duplicate();
    this.control.on('error', error => {
      if (!this.stopping) {
        this.logger.warn(`Timer completion Stream control error: ${error}`);
      }
    });
    this.reader.on('error', error => {
      if (!this.stopping) {
        this.logger.warn(`Timer completion Stream reader error: ${error}`);
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
    if (this.loopPromise) {
      let graceTimeout: NodeJS.Timeout | undefined;
      const gracePeriod = new Promise<void>(resolve => {
        graceTimeout = setTimeout(resolve, 5_000);
      });
      await Promise.race([
        this.loopPromise.catch(error => {
          if (!this.stopping) {
            throw error;
          }
        }),
        gracePeriod,
      ]);
      if (graceTimeout) {
        clearTimeout(graceTimeout);
      }
    }
  }

  private async runLoop(): Promise<void> {
    let groupReady = false;
    while (!this.stopping) {
      try {
        if (!groupReady) {
          await this.ensureConsumerGroup();
          groupReady = true;
        }
        const mode = await this.control.get(TIMER_COMPLETION_MODE_KEY);
        const isStreamMode = mode === 'stream';
        if (
          !isStreamMode &&
          (await this.control.xlen(TIMER_COMPLETION_STREAM_KEY)) === 0
        ) {
          await this.wait(LEGACY_MODE_POLL_MS);
          continue;
        }

        if (
          Date.now() - this.lastPendingRecoveryAt >=
          PENDING_RECOVERY_INTERVAL_MS
        ) {
          await this.recoverPending(PENDING_MIN_IDLE_MS);
          this.lastPendingRecoveryAt = Date.now();
        }
        if (
          isStreamMode ||
          (await this.control.xlen(TIMER_COMPLETION_STREAM_KEY)) > 0
        ) {
          await this.readNewEvents();
        }
      } catch (error) {
        if (this.stopping) {
          return;
        }
        if (error instanceof Error && error.message.includes('NOGROUP')) {
          groupReady = false;
        }
        this.logger.error('Timer completion Stream iteration failed:', error);
        await this.wait(LEGACY_MODE_POLL_MS);
      }
    }
  }

  private async ensureConsumerGroup(): Promise<void> {
    try {
      await this.control.xgroup(
        'CREATE',
        TIMER_COMPLETION_STREAM_KEY,
        TIMER_COMPLETION_STREAM_GROUP,
        '0',
        'MKSTREAM'
      );
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('BUSYGROUP')) {
        throw error;
      }
    }
  }

  private async recoverPending(minIdleMs: number): Promise<void> {
    let cursor = '0-0';
    do {
      const raw = (await this.control.xautoclaim(
        TIMER_COMPLETION_STREAM_KEY,
        TIMER_COMPLETION_STREAM_GROUP,
        this.consumerName,
        minIdleMs,
        cursor,
        'COUNT',
        STREAM_BATCH_SIZE
      )) as [string, StreamEntry[], string[]];
      cursor = raw[0];
      await this.processEntries(raw[1]);
    } while (!this.stopping && cursor !== '0-0');
  }

  private async readNewEvents(): Promise<void> {
    const raw = (await this.reader.xreadgroup(
      'GROUP',
      TIMER_COMPLETION_STREAM_GROUP,
      this.consumerName,
      'COUNT',
      STREAM_BATCH_SIZE,
      'BLOCK',
      STREAM_BLOCK_MS,
      'STREAMS',
      TIMER_COMPLETION_STREAM_KEY,
      '>'
    )) as Array<[string, StreamEntry[]]> | null;
    if (!raw) {
      return;
    }
    await this.processEntries(raw.flatMap(([, entries]) => entries));
  }

  private async processEntries(entries: StreamEntry[]): Promise<void> {
    const entriesByUser = new Map<string, StreamEntry[]>();
    for (const entry of entries) {
      const userId = this.readGroupingUserId(entry[1]);
      const key = userId ? `user:${userId}` : `event:${entry[0]}`;
      const groupedEntries = entriesByUser.get(key) ?? [];
      groupedEntries.push(entry);
      entriesByUser.set(key, groupedEntries);
    }

    const groups = [...entriesByUser.values()];
    let nextGroupIndex = 0;
    const processNextGroup = async (): Promise<void> => {
      while (nextGroupIndex < groups.length) {
        const group = groups[nextGroupIndex];
        nextGroupIndex += 1;
        for (const entry of group) {
          await this.processEntry(entry);
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(STREAM_PROCESSING_CONCURRENCY, groups.length) },
        () => processNextGroup()
      )
    );
  }

  private async processEntry([eventId, fields]: StreamEntry): Promise<void> {
    try {
      const event = this.parseEvent(fields);
      await this.completionEffects.persistCompletionEffects(
        event.userId,
        event.timer,
        {
          completedAt: event.completedAt,
          isLastWorkTimerInSession: this.isLastWorkTimerInSession(event.timer),
        }
      );
      const result = (await this.control.eval(
        ACK_AND_DELETE_COMPLETION_EVENT_SCRIPT,
        1,
        TIMER_COMPLETION_STREAM_KEY,
        TIMER_COMPLETION_STREAM_GROUP,
        eventId
      )) as [number, number];
      if (result[0] === 1 && result[1] !== 1) {
        this.logger.warn(
          `Acknowledged Timer completion event ${eventId} was already absent`
        );
      }
    } catch (error) {
      this.logger.error(
        `Timer completion event ${eventId} remains pending:`,
        error
      );
    }
  }

  private parseEvent(fields: string[]): TimerCompletionEvent {
    if (fields.length % 2 !== 0) {
      throw new UnprocessableEntityException(
        'Timer completion event fields are malformed'
      );
    }
    const values: Record<string, string> = {};
    for (let index = 0; index < fields.length; index += 2) {
      const name = fields[index];
      if (Object.prototype.hasOwnProperty.call(values, name)) {
        throw new UnprocessableEntityException(
          `Timer completion event field ${name} is duplicated`
        );
      }
      values[name] = fields[index + 1];
    }
    if (values.schemaVersion !== TIMER_COMPLETION_STREAM_VERSION) {
      throw new UnprocessableEntityException(
        `Unsupported Timer completion event version: ${values.schemaVersion ?? 'missing'}`
      );
    }

    let parsedTimer: unknown;
    try {
      parsedTimer = JSON.parse(values.timer);
    } catch {
      throw new UnprocessableEntityException(
        'Timer completion event Timer is malformed'
      );
    }
    if (!this.isRecord(parsedTimer)) {
      throw new UnprocessableEntityException(
        'Timer completion event Timer is malformed'
      );
    }
    const timer = parsedTimer as unknown as Timer;
    if (
      !this.isSerializedSafeNonNegativeInteger(values.completedAt) ||
      !this.isSerializedSafeNonNegativeInteger(values.claimedAt)
    ) {
      throw new UnprocessableEntityException(
        'Timer completion event timestamps are malformed'
      );
    }
    const completedAt = Number(values.completedAt);
    const claimedAt = Number(values.claimedAt);
    if (
      !this.isNonEmptyString(values.userId) ||
      !this.isNonEmptyString(values.timerId) ||
      !this.isNonEmptyString(values.scheduleRevision) ||
      !this.isSafeNonNegativeInteger(completedAt) ||
      !this.isSafeNonNegativeInteger(claimedAt) ||
      !this.isNonEmptyString(timer.userId) ||
      !this.isNonEmptyString(timer.id) ||
      !this.isNonEmptyString(timer.scheduleRevision) ||
      !this.isSafeNonNegativeInteger(timer.startTime) ||
      !this.isSafePositiveInteger(timer.duration) ||
      !this.isSafeNonNegativeInteger(timer.remainingTime) ||
      !this.hasValidOptionalNumericFields(timer) ||
      !this.hasValidSessionPosition(timer) ||
      !this.hasValidPayloadFields(timer) ||
      (timer.isExtension !== undefined &&
        typeof timer.isExtension !== 'boolean') ||
      (timer.isAutoStarted !== undefined &&
        typeof timer.isAutoStarted !== 'boolean') ||
      (timer.hasConsumedFirstIntentionReset !== undefined &&
        typeof timer.hasConsumedFirstIntentionReset !== 'boolean') ||
      !this.isOptionalExtensionCandidate(timer.extensionCandidate) ||
      !Object.values(TIMER_TYPES).includes(timer.type) ||
      (timer.extensionNextTimerType !== undefined &&
        !Object.values(TIMER_TYPES).includes(timer.extensionNextTimerType)) ||
      timer.userId !== values.userId ||
      timer.id !== values.timerId ||
      timer.scheduleRevision !== values.scheduleRevision ||
      timer.status !== TIMER_STATUSES.COMPLETED ||
      timer.remainingTime !== 0 ||
      !Number.isSafeInteger(timer.startTime + timer.duration) ||
      timer.startTime + timer.duration !== completedAt ||
      claimedAt < completedAt
    ) {
      throw new UnprocessableEntityException(
        'Timer completion event does not match its Timer snapshot'
      );
    }
    return { userId: values.userId, timer, completedAt };
  }

  private readGroupingUserId(fields: string[]): string | null {
    const userIds: string[] = [];
    for (let index = 0; index + 1 < fields.length; index += 2) {
      if (fields[index] === 'userId') {
        userIds.push(fields[index + 1]);
      }
    }
    return userIds.length === 1 && this.isNonEmptyString(userIds[0])
      ? userIds[0]
      : null;
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

  private isSerializedSafeNonNegativeInteger(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      /^(0|[1-9]\d*)$/.test(value) &&
      this.isSafeNonNegativeInteger(Number(value))
    );
  }

  private hasValidOptionalNumericFields(timer: Timer): boolean {
    return [
      timer.sessionPosition,
      timer.sessionTotal,
      timer.stackedSessions,
      timer.originalDuration,
      timer.originalBreakDuration,
      timer.extensionBaseDuration,
    ].every(value => value === undefined || this.isSafePositiveInteger(value));
  }

  private hasValidSessionPosition(timer: Timer): boolean {
    if (
      timer.sessionPosition === undefined &&
      timer.sessionTotal === undefined
    ) {
      return true;
    }
    return (
      this.isSafeNonNegativeInteger(timer.sessionPosition) &&
      this.isSafeNonNegativeInteger(timer.sessionTotal) &&
      timer.sessionPosition > 0 &&
      timer.sessionTotal > 0 &&
      timer.sessionPosition <= timer.sessionTotal
    );
  }

  private hasValidPayloadFields(timer: Timer): boolean {
    const optionalBooleans = [
      timer.hasNotifiedBeforeTimeNotification,
      timer.hasNotifiedLongBreakDetection,
      timer.hasNotifiedPausedTimerReminder,
    ];
    const optionalStrings = [
      timer.intention,
      timer.intentionTitle,
      timer.intentionEmoji,
      timer.subIntention,
      timer.subIntentionTitle,
      timer.subIntentionEmoji,
    ];
    return (
      optionalBooleans.every(
        value => value === undefined || typeof value === 'boolean'
      ) &&
      optionalStrings.every(
        value => value === undefined || typeof value === 'string'
      ) &&
      (timer.extensionOriginalTimerId === undefined ||
        this.isNonEmptyString(timer.extensionOriginalTimerId)) &&
      this.isOptionalStringArray(timer.intentionSlugs, false) &&
      this.isOptionalStringArray(timer.focusedTaskIds, true) &&
      this.isOptionalStringRecord(timer.subIntentions) &&
      this.isOptionalStringRecord(timer.intentionEmojis) &&
      this.isOptionalStringRecord(timer.subIntentionEmojis) &&
      this.isOptionalSessionEmojiRecord(timer.sessionIntentionEmojis)
    );
  }

  private isOptionalStringArray(
    value: unknown,
    requireNonEmptyItems: boolean
  ): boolean {
    return (
      value === undefined ||
      (Array.isArray(value) &&
        value.length > 0 &&
        value.every(
          item =>
            typeof item === 'string' &&
            (!requireNonEmptyItems || this.isNonEmptyString(item))
        ))
    );
  }

  private isOptionalStringRecord(value: unknown): boolean {
    return (
      value === undefined ||
      (this.isRecord(value) &&
        Object.values(value).every(item => typeof item === 'string'))
    );
  }

  private isOptionalSessionEmojiRecord(value: unknown): boolean {
    return (
      value === undefined ||
      (this.isRecord(value) &&
        Object.entries(value).every(
          ([position, emoji]) =>
            /^[1-9]\d*$/.test(position) &&
            Number.isSafeInteger(Number(position)) &&
            typeof emoji === 'string'
        ))
    );
  }

  private isOptionalExtensionCandidate(value: unknown): boolean {
    if (value === undefined) return true;
    if (!this.isRecord(value)) return false;
    return (
      this.isNonEmptyString(value.originalTimerId) &&
      this.isSafePositiveInteger(value.originalDuration) &&
      (value.maxDuration === undefined ||
        this.isSafePositiveInteger(value.maxDuration)) &&
      (value.extensionNextTimerType === undefined ||
        Object.values(TIMER_TYPES).includes(
          value.extensionNextTimerType as Timer['type']
        ))
    );
  }

  private isLastWorkTimerInSession(timer: Timer): boolean {
    if (timer.type !== TIMER_TYPES.WORK) {
      return false;
    }
    if (timer.isExtension) {
      return (
        timer.extensionNextTimerType === TIMER_TYPES.LONG_BREAK ||
        timer.extensionNextTimerType === TIMER_TYPES.WORK
      );
    }
    return Boolean(
      timer.sessionPosition &&
      timer.sessionTotal &&
      timer.sessionPosition === timer.sessionTotal
    );
  }

  private async wait(durationMs: number): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, durationMs));
  }
}
