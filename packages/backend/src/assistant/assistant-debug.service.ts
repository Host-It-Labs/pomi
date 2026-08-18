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
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  AssistantDebugLogEntity,
  AssistantDebugSettingEntity,
} from './assistant-debug.entity';

const MAX_ASSISTANT_DEBUG_LOGS_PER_USER = 50;
const MAX_DICTATION_CORRELATION_AGE_MS = 24 * 60 * 60 * 1000;

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
    const settings = await this.getOrCreateSettings(userId);
    return { enabled: settings.enabled };
  }

  async updateStatus(
    userId: string,
    enabled: boolean
  ): Promise<AssistantDebugStatus> {
    const settings = await this.getOrCreateSettings(userId);
    if (settings.enabled && !enabled) {
      await this.clearLogs(userId);
    }
    settings.enabled = enabled;
    const saved = await this.assistantDebugSettingsRepository.save(settings);
    return { enabled: saved.enabled };
  }

  async listLogs(userId: string): Promise<AssistantDebugLogEntry[]> {
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
    const log = await this.assistantDebugLogsRepository.findOne({
      where: { id: logId, userId },
    });
    if (!log) {
      throw new NotFoundException('Assistant debug log not found');
    }

    Object.assign(log, {
      userPrompt: null,
      processedOutput: null,
      invalidParserOutput: null,
      resolutionNotes: [],
      modelCalls: this.toSafeModelCalls(log.modelCalls ?? []),
      error: null,
    });
    log.flagged = flagged;
    const saved = await this.assistantDebugLogsRepository.save(log);
    return this.formatLog(saved);
  }

  async clearLogs(userId: string) {
    await this.assistantDebugLogsRepository.delete({ userId });
  }

  async recordLog(
    userId: string,
    input: RecordAssistantDebugLogInput
  ): Promise<string | null> {
    const settings = await this.getOrCreateSettings(userId);
    if (!settings.enabled) {
      return null;
    }

    const correlated = input.debugLogId
      ? await this.assistantDebugLogsRepository.findOne({
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
    const modelCalls = [
      ...this.toSafeModelCalls(existing?.modelCalls ?? []),
      ...(input.modelCalls ? this.toSafeModelCalls(input.modelCalls) : []),
    ];
    const log = existing
      ? Object.assign(existing, {
          source: input.source,
          status: input.status,
          userPrompt: null,
          processedOutput: null,
          invalidParserOutput: null,
          resolutionNotes: [],
          timings: this.mergeTimings(existing.timings, input.timings),
          modelCalls,
          flagged: existing.flagged ?? false,
          error: null,
        })
      : this.assistantDebugLogsRepository.create({
          userId,
          kind: input.kind,
          source: input.source,
          status: input.status,
          userPrompt: null,
          processedOutput: null,
          invalidParserOutput: null,
          resolutionNotes: [],
          timings: input.timings ?? {},
          modelCalls,
          flagged: input.flagged ?? false,
          error: null,
        });
    const saved = await this.assistantDebugLogsRepository.save(log);
    await this.pruneLogs(userId);
    return saved.id;
  }

  private async getOrCreateSettings(userId: string) {
    let settings = await this.assistantDebugSettingsRepository.findOne({
      where: { userId },
    });
    if (settings) {
      return settings;
    }

    settings = this.assistantDebugSettingsRepository.create({
      userId,
      enabled: false,
    });
    try {
      return await this.assistantDebugSettingsRepository.save(settings);
    } catch (error) {
      // Two first requests for a user can initialize debug settings at the
      // same time. The unique user key makes one insert win; reuse that row
      // instead of surfacing a spurious duplicate-key failure to capture.
      if ((error as { code?: string })?.code !== '23505') {
        throw error;
      }
      const existing = await this.assistantDebugSettingsRepository.findOne({
        where: { userId },
      });
      if (!existing) throw error;
      return existing;
    }
  }

  private async pruneLogs(userId: string) {
    const staleLogs = await this.assistantDebugLogsRepository.find({
      where: { userId, flagged: false },
      order: { createdAt: 'DESC' },
      skip: MAX_ASSISTANT_DEBUG_LOGS_PER_USER,
      select: { id: true },
    });
    if (staleLogs.length === 0) {
      return;
    }

    await this.assistantDebugLogsRepository.delete({
      id: In(staleLogs.map(log => log.id)),
    });
  }

  private formatLog(log: AssistantDebugLogEntity): AssistantDebugLogEntry {
    return {
      id: log.id,
      kind: log.kind,
      source: log.source,
      status: log.status,
      userPrompt: null,
      processedOutput: null,
      invalidParserOutput: null,
      resolutionNotes: [],
      timings: log.timings,
      modelCalls: this.toSafeModelCalls(log.modelCalls ?? []),
      flagged: log.flagged ?? false,
      error: null,
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
    return modelCalls.map(modelCall => ({
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
}
