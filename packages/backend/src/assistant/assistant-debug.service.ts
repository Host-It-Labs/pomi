import {
  AssistantDebugLogEntry,
  AssistantDebugLogKind,
  AssistantDebugProcessedOutput,
  AssistantDebugLogSource,
  AssistantDebugLogStatus,
  AssistantDebugLogExport,
  AssistantDebugModelCall,
  AssistantDebugStatus,
  AssistantDebugTimings,
} from '@pomi/shared';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { UserEntity } from '../users/users.entity';
import {
  AssistantDebugLogEntity,
  AssistantDebugSettingEntity,
} from './assistant-debug.entity';

const MAX_ASSISTANT_DEBUG_LOGS_PER_USER = 50;
const MAX_FLAGGED_ASSISTANT_DEBUG_LOGS_PER_USER = 200;
const MAX_DICTATION_CORRELATION_AGE_MS = 24 * 60 * 60 * 1000;
const ASSISTANT_CAPTURE_CONSENT_VERSION = 1;
const MAX_CAPTURE_INPUT_CHARACTERS = 8_000;
const MAX_CAPTURE_OUTPUT_CHARACTERS = 16_000;
const MAX_CAPTURE_OUTPUT_FIELD_CHARACTERS = 512;
const MAX_CAPTURE_TASKS = 25;
const MAX_MODEL_CALLS = 20;

export type AssistantCaptureConsent = {
  generation: number;
};

type RecordAssistantDebugLogInput = {
  kind: AssistantDebugLogKind;
  source: AssistantDebugLogSource;
  status: AssistantDebugLogStatus;
  debugLogId?: string | null;
  userPrompt?: string | null;
  processedOutput?: AssistantDebugProcessedOutput | null;
  invalidParserOutput?: string | null;
  resolutionNotes?: string[];
  timings?: AssistantDebugTimings;
  modelCalls?: AssistantDebugModelCall[];
  flagged?: boolean;
  error?: string | null;
  captureGeneration: number | null;
};

@Injectable()
export class AssistantDebugService {
  constructor(
    @InjectRepository(AssistantDebugSettingEntity)
    private assistantDebugSettingsRepository: Repository<AssistantDebugSettingEntity>,
    @InjectRepository(AssistantDebugLogEntity)
    private assistantDebugLogsRepository: Repository<AssistantDebugLogEntity>
  ) {}

  async getStatus(userId: string): Promise<AssistantDebugStatus> {
    await this.assertAdmin(
      this.assistantDebugSettingsRepository.manager,
      userId
    );
    const settings = await this.getOrCreateSettings(
      userId,
      this.assistantDebugSettingsRepository
    );
    return { enabled: this.hasCurrentConsent(settings) };
  }

  async beginCapture(userId: string): Promise<AssistantCaptureConsent | null> {
    const user = await this.assistantDebugSettingsRepository.manager.findOne(
      UserEntity,
      { where: { id: userId } }
    );
    if (!user?.isAdmin) return null;
    const settings = await this.assistantDebugSettingsRepository.findOne({
      where: { userId },
    });
    return settings && this.hasCurrentConsent(settings)
      ? { generation: settings.generation }
      : null;
  }

  async updateStatus(
    userId: string,
    enabled: boolean
  ): Promise<AssistantDebugStatus> {
    return this.withUserLock(userId, async manager => {
      await this.assertAdmin(manager, userId);
      const settingsRepository = manager.getRepository(
        AssistantDebugSettingEntity
      );
      const logsRepository = manager.getRepository(AssistantDebugLogEntity);
      const settings = await this.getOrCreateSettings(
        userId,
        settingsRepository
      );
      settings.generation += 1;
      settings.enabled = enabled;
      settings.consentVersion = enabled
        ? ASSISTANT_CAPTURE_CONSENT_VERSION
        : null;
      if (!enabled) await logsRepository.delete({ userId });
      const saved = await settingsRepository.save(settings);
      return { enabled: this.hasCurrentConsent(saved) };
    });
  }

  async listLogs(userId: string): Promise<AssistantDebugLogEntry[]> {
    await this.assertAdmin(this.assistantDebugLogsRepository.manager, userId);
    const [recentLogs, flaggedLogs] = await Promise.all([
      this.assistantDebugLogsRepository.find({
        where: { userId },
        order: { createdAt: 'DESC' },
        take: MAX_ASSISTANT_DEBUG_LOGS_PER_USER,
      }),
      this.assistantDebugLogsRepository.find({
        where: { userId, flagged: true },
        order: { createdAt: 'DESC' },
      }),
    ]);
    const logsById = new Map(
      [...recentLogs, ...flaggedLogs].map(log => [log.id, log])
    );
    const logs = [...logsById.values()].sort(
      (left, right) => this.logTime(right) - this.logTime(left)
    );

    return logs.map(log => this.formatLog(log));
  }

  async exportFlaggedLogs(userId: string): Promise<AssistantDebugLogExport> {
    await this.assertAdmin(this.assistantDebugLogsRepository.manager, userId);
    const logs = await this.assistantDebugLogsRepository.find({
      where: { userId, flagged: true },
      order: { createdAt: 'ASC' },
    });

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      logs: logs.map(log => this.formatLog(log)),
    };
  }

  async updateFlag(
    userId: string,
    logId: string,
    flagged: boolean
  ): Promise<AssistantDebugLogEntry> {
    return this.withUserLock(userId, async manager => {
      await this.assertAdmin(manager, userId);
      const logsRepository = manager.getRepository(AssistantDebugLogEntity);
      const log = await logsRepository.findOne({
        where: { id: logId, userId },
      });
      if (!log) throw new NotFoundException('Assistant debug log not found');
      if (flagged && !log.flagged) {
        const flaggedCount = await logsRepository.count({
          where: { userId, flagged: true },
        });
        if (flaggedCount >= MAX_FLAGGED_ASSISTANT_DEBUG_LOGS_PER_USER) {
          throw new BadRequestException(
            `At most ${MAX_FLAGGED_ASSISTANT_DEBUG_LOGS_PER_USER} capture logs can be flagged`
          );
        }
      }
      log.flagged = flagged;
      const saved = await logsRepository.save(log);
      return this.formatLog(saved);
    });
  }

  async clearLogs(userId: string) {
    await this.withUserLock(userId, async manager => {
      await this.assertAdmin(manager, userId);
      const settingsRepository = manager.getRepository(
        AssistantDebugSettingEntity
      );
      const settings = await this.getOrCreateSettings(
        userId,
        settingsRepository
      );
      settings.generation += 1;
      await settingsRepository.save(settings);
      await manager.getRepository(AssistantDebugLogEntity).delete({ userId });
    });
  }

  async recordLog(
    userId: string,
    input: RecordAssistantDebugLogInput
  ): Promise<string | null> {
    if (input.captureGeneration === null) return null;
    if (
      input.kind === 'voiceCommand' &&
      input.status === 'succeeded' &&
      (input.processedOutput?.tasks.length ?? 0) === 0
    ) {
      return null;
    }

    return this.withUserLock(userId, async manager => {
      const user = await manager.findOne(UserEntity, { where: { id: userId } });
      if (!user?.isAdmin) return null;
      const settingsRepository = manager.getRepository(
        AssistantDebugSettingEntity
      );
      const logsRepository = manager.getRepository(AssistantDebugLogEntity);
      const settings = await settingsRepository.findOne({ where: { userId } });
      if (
        !settings ||
        !this.hasCurrentConsent(settings) ||
        settings.generation !== input.captureGeneration
      ) {
        return null;
      }
      const correlated = input.debugLogId
        ? await logsRepository.findOne({
            where: {
              id: input.debugLogId,
              userId,
              kind: input.kind,
              status: 'dictated',
            },
          })
        : null;
      const existing =
        correlated && this.isFreshDictationLog(correlated) ? correlated : null;
      const prompt = this.limitText(
        input.userPrompt,
        MAX_CAPTURE_INPUT_CHARACTERS
      );
      const output = this.sanitizeProcessedOutput(input.processedOutput);
      const modelCalls = [
        ...this.toSafeModelCalls(existing?.modelCalls ?? []),
        ...(input.modelCalls ? this.toSafeModelCalls(input.modelCalls) : []),
      ].slice(-MAX_MODEL_CALLS);
      const contentTruncated =
        Boolean(existing?.contentTruncated) ||
        prompt.truncated ||
        output.truncated;
      const log = existing
        ? Object.assign(existing, {
            source: input.source,
            status: input.status,
            userPrompt: prompt.value,
            processedOutput: output.value,
            invalidParserOutput: null,
            resolutionNotes: [],
            timings: this.mergeTimings(existing.timings, input.timings),
            modelCalls,
            flagged: existing.flagged ?? false,
            contentTruncated,
            error: this.safeErrorCategory(input.error),
          })
        : logsRepository.create({
            userId,
            kind: input.kind,
            source: input.source,
            status: input.status,
            userPrompt: prompt.value,
            processedOutput: output.value,
            invalidParserOutput: null,
            resolutionNotes: [],
            timings: input.timings ?? {},
            modelCalls,
            flagged: input.flagged ?? false,
            contentTruncated,
            error: this.safeErrorCategory(input.error),
          });
      const saved = await logsRepository.save(log);
      await this.pruneLogs(userId, logsRepository);
      return saved.id;
    });
  }

  private async getOrCreateSettings(
    userId: string,
    repository: Repository<AssistantDebugSettingEntity>
  ) {
    let settings = await repository.findOne({
      where: { userId },
    });
    if (settings) {
      return settings;
    }

    settings = repository.create({
      userId,
      enabled: false,
      consentVersion: null,
      generation: 0,
    });
    try {
      return await repository.save(settings);
    } catch (error) {
      // Two first requests for a user can initialize debug settings at the
      // same time. The unique user key makes one insert win; reuse that row
      // instead of surfacing a spurious duplicate-key failure to capture.
      if ((error as { code?: string })?.code !== '23505') {
        throw error;
      }
      const existing = await repository.findOne({
        where: { userId },
      });
      if (!existing) throw error;
      return existing;
    }
  }

  private async pruneLogs(
    userId: string,
    repository: Repository<AssistantDebugLogEntity>
  ) {
    const staleLogs = await repository.find({
      where: { userId, flagged: false },
      order: { createdAt: 'DESC' },
      skip: MAX_ASSISTANT_DEBUG_LOGS_PER_USER,
      select: { id: true },
    });
    if (staleLogs.length === 0) {
      return;
    }

    await repository.delete({
      id: In(staleLogs.map(log => log.id)),
    });
  }

  private formatLog(log: AssistantDebugLogEntity): AssistantDebugLogEntry {
    return {
      id: log.id,
      kind: log.kind,
      source: log.source,
      status: log.status,
      userPrompt: log.userPrompt,
      processedOutput: log.processedOutput,
      invalidParserOutput: null,
      resolutionNotes: [],
      timings: log.timings,
      modelCalls: this.toSafeModelCalls(log.modelCalls ?? []),
      flagged: log.flagged ?? false,
      contentTruncated: log.contentTruncated ?? false,
      error: this.safeErrorCategory(log.error),
      createdAt:
        log.createdAt instanceof Date
          ? log.createdAt.toISOString()
          : String(log.createdAt),
    };
  }

  private logTime(log: AssistantDebugLogEntity) {
    const value =
      log.createdAt instanceof Date
        ? log.createdAt.getTime()
        : new Date(log.createdAt).getTime();
    return Number.isFinite(value) ? value : 0;
  }

  private mergeTimings(
    current: AssistantDebugTimings | null | undefined,
    incoming: AssistantDebugTimings | undefined
  ): AssistantDebugTimings {
    const merged: AssistantDebugTimings = { ...(current ?? {}) };
    for (const [key, value] of Object.entries(incoming ?? {})) {
      if (typeof value !== 'number') continue;
      const timingKey = key as keyof AssistantDebugTimings;
      merged[timingKey] = (merged[timingKey] ?? 0) + value;
    }
    return merged;
  }

  private toSafeModelCalls(
    modelCalls: AssistantDebugModelCall[]
  ): AssistantDebugModelCall[] {
    return modelCalls.slice(-MAX_MODEL_CALLS).map(modelCall => ({
      provider: modelCall.provider,
      endpoint: modelCall.endpoint,
      stage: modelCall.stage,
      request: {},
      attempts: modelCall.attempts.map(attempt => ({
        request: {},
        status: attempt.status,
        error: attempt.error ? 'ModelRequestError' : null,
      })),
      response: undefined,
      content: null,
      costUsd: modelCall.costUsd,
      durationMs: modelCall.durationMs,
    }));
  }

  private isFreshDictationLog(log: AssistantDebugLogEntity) {
    const createdAt =
      log.createdAt instanceof Date
        ? log.createdAt.getTime()
        : new Date(log.createdAt).getTime();
    return (
      Number.isFinite(createdAt) &&
      Date.now() - createdAt <= MAX_DICTATION_CORRELATION_AGE_MS
    );
  }

  private hasCurrentConsent(settings: AssistantDebugSettingEntity) {
    return (
      settings.enabled &&
      settings.consentVersion === ASSISTANT_CAPTURE_CONSENT_VERSION
    );
  }

  private async assertAdmin(manager: EntityManager, userId: string) {
    const user = await manager.findOne(UserEntity, { where: { id: userId } });
    if (!user?.isAdmin) throw new ForbiddenException('Admin access required');
  }

  private async withUserLock<T>(
    userId: string,
    operation: (manager: EntityManager) => Promise<T>
  ): Promise<T> {
    return this.assistantDebugSettingsRepository.manager.transaction(
      async manager => {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`assistant-capture-logs:${userId}`]
        );
        return operation(manager);
      }
    );
  }

  private limitText(value: string | null | undefined, maximum: number) {
    if (!value) return { value: null, truncated: false };
    if (value.length <= maximum) return { value, truncated: false };
    return {
      value: `${value.slice(0, maximum - 1)}…`,
      truncated: true,
    };
  }

  private sanitizeProcessedOutput(
    output: AssistantDebugProcessedOutput | null | undefined
  ): { value: AssistantDebugProcessedOutput | null; truncated: boolean } {
    if (!output) return { value: null, truncated: false };
    let truncated = output.tasks.length > MAX_CAPTURE_TASKS;
    const tasks = output.tasks.slice(0, MAX_CAPTURE_TASKS).map(task => {
      const safeTask: Record<string, unknown> = {};
      for (const key of [
        'title',
        'description',
        'dueDate',
        'dueTime',
        'priority',
        'timerType',
        'recurrenceRule',
        'recurrenceInterval',
        'recurrenceAnchorMode',
        'intentionSlug',
        'subIntentionSlug',
        'listId',
      ]) {
        const value = (task as unknown as Record<string, unknown>)[key];
        if (typeof value === 'string') {
          const limited = this.limitText(
            value,
            MAX_CAPTURE_OUTPUT_FIELD_CHARACTERS
          );
          safeTask[key] = limited.value;
          truncated ||= limited.truncated;
        } else if (typeof value === 'number' || value === null) {
          safeTask[key] = value;
        }
      }
      return safeTask as unknown as AssistantDebugProcessedOutput['tasks'][number];
    });
    let value: AssistantDebugProcessedOutput = { tasks };
    while (
      JSON.stringify(value).length > MAX_CAPTURE_OUTPUT_CHARACTERS &&
      value.tasks.length > 1
    ) {
      truncated = true;
      value = { tasks: value.tasks.slice(0, -1) };
    }
    return { value, truncated };
  }

  private safeErrorCategory(error: string | null | undefined) {
    if (!error) return null;
    const category = error.match(
      /[A-Za-z][A-Za-z0-9]*(?:Error|Exception)/
    )?.[0];
    return category ?? 'AssistantCaptureError';
  }
}
