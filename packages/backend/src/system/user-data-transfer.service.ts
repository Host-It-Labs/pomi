import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  UserDataExport,
  UserDataImportResult,
  UserDataTimerRuntime,
  UserDataTransferRow,
} from '@pomi/shared';
import { normalizeAppLanguage } from '@pomi/shared';
import {
  DataSource,
  EntityManager,
  EntityTarget,
  FindOptionsWhere,
} from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  AssistantDebugLogEntity,
  AssistantDebugSettingEntity,
} from '../assistant/assistant-debug.entity';
import { AssistantUsageEntity } from '../assistant/assistant-usage.entity';
import { Intention } from '../intentions/intentions.entity';
import { ListEntity } from '../lists/lists.entity';
import { VacationEntity } from '../vacation/vacation.entity';
import { Preferences } from '../preferences/preferences.entity';
import { RealtimeEvents } from '../realtime/realtime-events';
import { Statistic } from '../statistics/statistics.entity';
import { TimerStore, TimerUserDataSnapshot } from '../timer/timer-store';
import {
  TaskEntity,
  TaskEventEntity,
  TaskImportRunEntity,
} from '../tasks/tasks.entity';
import { UserEntity } from '../users/users.entity';

type UserDataImportIdMaps = {
  preferences: Map<string, string>;
  intentions: Map<string, string>;
  lists: Map<string, string>;
  vacationStates: Map<string, string>;
  statistics: Map<string, string>;
  tasks: Map<string, string>;
  taskEvents: Map<string, string>;
  taskImportRuns: Map<string, string>;
  assistantDebugLogs: Map<string, string>;
  assistantUsageEvents: Map<string, string>;
};

@Injectable()
export class UserDataTransferService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly timerStore: TimerStore,
    private readonly realtimeEvents: RealtimeEvents
  ) {}

  async exportUserData(userId: string): Promise<UserDataExport> {
    const [
      user,
      preferences,
      intentions,
      lists,
      vacationStates,
      statistics,
      tasks,
      taskEvents,
      taskImportRuns,
      assistantDebugSetting,
      assistantDebugLogs,
      assistantUsageEvents,
      timerRuntime,
    ] = await Promise.all([
      this.dataSource.manager.findOne(UserEntity, { where: { id: userId } }),
      this.dataSource.manager.findOne(Preferences, { where: { userId } }),
      this.dataSource.manager.find(Intention, {
        where: { userId },
        order: { type: 'ASC', createdAt: 'ASC' },
      }),
      this.dataSource.manager.find(ListEntity, {
        where: { userId },
        order: { createdAt: 'ASC' },
      }),
      this.dataSource.manager.find(VacationEntity, { where: { userId } }),
      this.dataSource.manager.find(Statistic, {
        where: { userId },
        order: { completedAt: 'ASC', createdAt: 'ASC' },
      }),
      this.dataSource.manager.find(TaskEntity, {
        where: { userId },
        order: { createdAt: 'ASC' },
      }),
      this.dataSource.manager.find(TaskEventEntity, {
        where: { userId },
        order: { occurredAt: 'ASC', createdAt: 'ASC' },
      }),
      this.dataSource.manager.find(TaskImportRunEntity, {
        where: { userId },
        order: { createdAt: 'ASC' },
      }),
      this.dataSource.manager.findOne(AssistantDebugSettingEntity, {
        where: { userId },
      }),
      this.dataSource.manager.find(AssistantDebugLogEntity, {
        where: { userId },
        order: { createdAt: 'ASC' },
      }),
      this.dataSource.manager.find(AssistantUsageEntity, {
        where: { userId },
        order: { localDate: 'ASC', createdAt: 'ASC' },
      }),
      this.timerStore.exportUserData(userId),
    ]);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      sourceUser: {
        id: user.id,
        username: user.username,
      },
      data: {
        preferences: this.stripRelations(preferences),
        intentions: intentions.map(row => this.stripEntity(row)),
        lists: lists.map(row => this.stripEntity(row)),
        vacationStates: vacationStates.map(row => this.stripEntity(row)),
        statistics: statistics.map(row => this.stripEntity(row)),
        tasks: tasks.map(row => this.stripEntity(row)),
        taskEvents: taskEvents.map(row => this.stripEntity(row)),
        taskImportRuns: taskImportRuns.map(row => this.stripEntity(row)),
        assistantDebugSetting: this.stripRelations(assistantDebugSetting),
        assistantDebugLogs: assistantDebugLogs.map(row =>
          this.stripAssistantDebugLog(row)
        ),
        assistantUsageEvents: assistantUsageEvents.map(row =>
          this.stripEntity(row)
        ),
        timerRuntime: this.toTransferRuntime(timerRuntime),
      },
    };
  }

  async importUserData(
    userId: string,
    payload: UserDataExport
  ): Promise<UserDataImportResult> {
    if (payload.version !== 1) {
      throw new BadRequestException('Unsupported user data export version');
    }

    const idMaps = this.createImportIdMaps(payload);

    await this.dataSource.transaction(async manager => {
      const user = await manager.findOne(UserEntity, { where: { id: userId } });
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const importedPreferences = this.remapPreferencesRow(
        payload.data.preferences,
        userId,
        idMaps.preferences
      );
      await this.deleteCurrentUserData(manager, userId);
      await this.insertRows(manager, Preferences, importedPreferences);
      await this.insertRows(
        manager,
        Intention,
        this.remapIntentionRows(
          this.orderIntentionRowsForImport(payload.data.intentions),
          userId,
          idMaps.intentions
        )
      );
      await this.insertRows(
        manager,
        ListEntity,
        this.remapListRows(payload.data.lists ?? [], userId, idMaps)
      );
      await this.insertRows(
        manager,
        Statistic,
        this.remapRowsWithFreshIds(
          payload.data.statistics,
          userId,
          idMaps.statistics
        )
      );
      await this.insertRows(
        manager,
        TaskEntity,
        this.remapTaskRows(payload.data.tasks, userId, idMaps)
      );
      await this.insertRows(
        manager,
        TaskEventEntity,
        this.remapTaskEventRows(payload.data.taskEvents, userId, idMaps)
      );
      await this.insertRows(
        manager,
        TaskImportRunEntity,
        this.remapRowsWithFreshIds(
          payload.data.taskImportRuns ?? [],
          userId,
          idMaps.taskImportRuns
        )
      );
      await this.insertRows(
        manager,
        VacationEntity,
        this.remapRowsWithFreshIds(
          payload.data.vacationStates ?? [],
          userId,
          idMaps.vacationStates
        )
      );
      await this.insertRows(
        manager,
        AssistantDebugSettingEntity,
        this.remapNullableRow(payload.data.assistantDebugSetting, userId)
      );
      await this.insertRows(
        manager,
        AssistantDebugLogEntity,
        this.remapAssistantDebugLogRows(
          payload.data.assistantDebugLogs,
          userId,
          idMaps.assistantDebugLogs
        )
      );
      await this.insertRows(
        manager,
        AssistantUsageEntity,
        this.remapRowsWithFreshIds(
          payload.data.assistantUsageEvents,
          userId,
          idMaps.assistantUsageEvents
        )
      );
    });

    await this.timerStore.importUserData(
      userId,
      this.fromTransferRuntime(payload.data.timerRuntime, userId, idMaps)
    );
    this.realtimeEvents.emitTasksUpdate(userId);

    return {
      success: true,
      imported: {
        preferences: payload.data.preferences ? 1 : 0,
        intentions: payload.data.intentions.length,
        lists: (payload.data.lists ?? []).length,
        vacationStates: (payload.data.vacationStates ?? []).length,
        statistics: payload.data.statistics.length,
        tasks: payload.data.tasks.length,
        taskEvents: payload.data.taskEvents.length,
        taskImportRuns: (payload.data.taskImportRuns ?? []).length,
        assistantDebugSettings: payload.data.assistantDebugSetting ? 1 : 0,
        assistantDebugLogs: payload.data.assistantDebugLogs.length,
        assistantUsageEvents: payload.data.assistantUsageEvents.length,
        timerRuntime: true,
      },
    };
  }

  private async deleteCurrentUserData(
    manager: EntityManager,
    userId: string
  ): Promise<void> {
    await this.deleteRows(manager, AssistantUsageEntity, userId);
    await this.deleteRows(manager, AssistantDebugLogEntity, userId);
    await this.deleteRows(manager, AssistantDebugSettingEntity, userId);
    await this.deleteRows(manager, TaskEventEntity, userId);
    await this.deleteRows(manager, TaskImportRunEntity, userId);
    await this.deleteRows(manager, TaskEntity, userId);
    await this.deleteRows(manager, VacationEntity, userId);
    await this.deleteRows(manager, ListEntity, userId);
    await this.deleteRows(manager, Statistic, userId);
    await this.deleteRows(manager, Intention, userId);
    await this.deleteRows(manager, Preferences, userId);
  }

  private async deleteRows<T extends object>(
    manager: EntityManager,
    target: EntityTarget<T>,
    userId: string
  ): Promise<void> {
    await manager
      .getRepository(target)
      .delete({ userId } as unknown as FindOptionsWhere<T>);
  }

  private async insertRows<T extends object>(
    manager: EntityManager,
    target: EntityTarget<T>,
    rows: UserDataTransferRow[]
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await manager
      .getRepository(target)
      .insert(rows as QueryDeepPartialEntity<T>[]);
  }

  private remapNullableRow(
    row: UserDataTransferRow | null,
    userId: string
  ): UserDataTransferRow[] {
    return row ? [this.remapRow(row, userId)] : [];
  }

  private remapPreferencesRow(
    row: UserDataTransferRow | null,
    userId: string,
    ids: Map<string, string>
  ): UserDataTransferRow[] {
    if (!row) {
      return [];
    }

    const next = this.remapRowWithFreshId(row, userId, ids);
    if (next.language === null || next.language === undefined) {
      return [next];
    }

    const language = normalizeAppLanguage(next.language);
    if (!language) {
      throw new BadRequestException('Unsupported language in user data');
    }
    next.language = language;
    return [next];
  }

  private remapRowsWithFreshIds(
    rows: UserDataTransferRow[],
    userId: string,
    ids: Map<string, string>
  ): UserDataTransferRow[] {
    return rows.map(row => this.remapRowWithFreshId(row, userId, ids));
  }

  private remapIntentionRows(
    rows: UserDataTransferRow[],
    userId: string,
    ids: Map<string, string>
  ): UserDataTransferRow[] {
    return rows.map(row => {
      const next = this.remapRowWithFreshId(row, userId, ids);
      next.parentIntentionId = this.remapOptionalId(row.parentIntentionId, ids);
      return next;
    });
  }

  private remapTaskEventRows(
    rows: UserDataTransferRow[],
    userId: string,
    ids: UserDataImportIdMaps
  ): UserDataTransferRow[] {
    return rows.map(row => {
      const next = this.remapRowWithFreshId(row, userId, ids.taskEvents);
      next.taskId = this.remapRequiredId(row.taskId, ids.tasks, 'Task');
      return next;
    });
  }

  private remapListRows(
    rows: UserDataTransferRow[],
    userId: string,
    ids: UserDataImportIdMaps
  ) {
    return rows.map(row => {
      const next = this.remapRowWithFreshId(row, userId, ids.lists);
      next.sourceIntentionId = this.remapOptionalId(
        row.sourceIntentionId,
        ids.intentions
      );
      return next;
    });
  }

  private remapTaskRows(
    rows: UserDataTransferRow[],
    userId: string,
    ids: UserDataImportIdMaps
  ) {
    const rowsById = new Map(
      rows.flatMap(row => {
        const id = this.readRowId(row.id);
        return id ? [[id, row] as const] : [];
      })
    );
    const legacyTemplateIds = new Set<string>();
    rows.forEach(row => {
      const directTemplateId = this.readRowId(row.followUpTaskId);
      if (directTemplateId) legacyTemplateIds.add(directTemplateId);
      if (this.isTransferRecord(row.taskRestoreState)) {
        const restoredTemplateId = this.readRowId(
          row.taskRestoreState.followUpTaskId
        );
        if (restoredTemplateId) legacyTemplateIds.add(restoredTemplateId);
      }
    });

    return rows.map(row => {
      const next = this.remapRowWithFreshId(row, userId, ids.tasks);
      next.listId = this.remapOptionalId(row.listId, ids.lists);
      const legacyTemplateId = this.readRowId(row.followUpTaskId);
      next.followUpTaskId = legacyTemplateId
        ? null
        : this.remapOptionalId(row.followUpTaskId, ids.tasks);
      if (legacyTemplateId && !this.isTransferRecord(row.followUpDefinition)) {
        next.followUpDefinition = this.createLegacyFollowUpDefinition(
          legacyTemplateId,
          rowsById
        );
      }
      next.followUpSourceTaskId = this.remapOptionalId(
        row.followUpSourceTaskId,
        ids.tasks
      );
      const sourceId = this.readRowId(row.id);
      if (
        sourceId &&
        legacyTemplateIds.has(sourceId) &&
        (row.itemKind === undefined || row.itemKind === 'task')
      ) {
        next.itemKind = 'followUpTemplate';
      } else if (
        this.readRowId(row.followUpSourceTaskId) &&
        (row.itemKind === undefined || row.itemKind === 'task')
      ) {
        next.itemKind = 'followUp';
      }
      if (this.isTransferRecord(next.taskRestoreState)) {
        const legacyRestoreTemplateId = this.readRowId(
          next.taskRestoreState.followUpTaskId
        );
        next.taskRestoreState = {
          ...next.taskRestoreState,
          followUpTaskId: legacyRestoreTemplateId
            ? null
            : this.remapOptionalId(
                next.taskRestoreState.followUpTaskId,
                ids.tasks
              ),
          ...(legacyRestoreTemplateId &&
          !this.isTransferRecord(next.taskRestoreState.followUpDefinition)
            ? {
                followUpDefinition: this.createLegacyFollowUpDefinition(
                  legacyRestoreTemplateId,
                  rowsById
                ),
              }
            : {}),
          followUpSourceTaskId: this.remapOptionalId(
            next.taskRestoreState.followUpSourceTaskId,
            ids.tasks
          ),
        };
      }
      return next;
    });
  }

  private createLegacyFollowUpDefinition(
    templateId: string,
    rowsById: Map<string, UserDataTransferRow>
  ): UserDataTransferRow {
    const template = rowsById.get(templateId);
    if (!template || typeof template.title !== 'string') {
      throw new BadRequestException(
        'Legacy follow-up template is missing from user data'
      );
    }
    return {
      title: template.title,
      description: template.description ?? null,
      dueTime: template.dueTime ?? null,
      priority: template.priority,
      timerType: template.timerType,
      intentionSlug: template.intentionSlug ?? null,
      subIntentionSlug: template.subIntentionSlug ?? null,
      vacationEligible: template.vacationEligible === true,
    };
  }

  private orderIntentionRowsForImport(rows: UserDataTransferRow[]) {
    const parentRows: UserDataTransferRow[] = [];
    const childRows: UserDataTransferRow[] = [];

    rows.forEach(row => {
      if (
        typeof row.parentIntentionId === 'string' &&
        row.parentIntentionId.length > 0
      ) {
        childRows.push(row);
        return;
      }

      parentRows.push(row);
    });

    return [...parentRows, ...childRows];
  }

  private remapRow(
    row: UserDataTransferRow,
    userId: string
  ): UserDataTransferRow {
    const next: UserDataTransferRow = { ...row, userId };
    delete next.user;
    delete next.task;
    return next;
  }

  private remapRowWithFreshId(
    row: UserDataTransferRow,
    userId: string,
    ids: Map<string, string>
  ): UserDataTransferRow {
    const next = this.remapRow(row, userId);
    next.id = this.remapRequiredId(row.id, ids, 'Row');
    return next;
  }

  private remapAssistantDebugLogRows(
    rows: UserDataTransferRow[],
    userId: string,
    ids: Map<string, string>
  ): UserDataTransferRow[] {
    return rows.map(row => {
      const next = this.remapRowWithFreshId(row, userId, ids);
      const legacyKind = row.kind;
      const error = typeof row.error === 'string' ? row.error : null;
      next.kind =
        legacyKind === 'voiceCommand' ? 'voiceCommand' : 'taskCapture';
      next.source =
        row.source === 'typed' ||
        row.source === 'dictation' ||
        row.source === 'assistantVoice'
          ? row.source
          : legacyKind === 'taskDictation'
            ? 'dictation'
            : legacyKind === 'voiceCommand'
              ? 'assistantVoice'
              : 'typed';
      next.status =
        row.status === 'dictated' ||
        row.status === 'succeeded' ||
        row.status === 'fallback' ||
        row.status === 'failed'
          ? row.status
          : error
            ? 'failed'
            : legacyKind === 'taskDictation'
              ? 'dictated'
              : 'succeeded';
      next.userPrompt = null;
      next.processedOutput = null;
      next.invalidParserOutput = null;
      next.resolutionNotes = [];
      next.timings = this.isTransferRecord(row.timings) ? row.timings : {};
      next.modelCalls = [];
      next.flagged = row.flagged === true;
      next.error = null;
      delete next.audioBase64;
      delete next.audioMimeType;
      delete next.transcriptionOutput;
      delete next.parserOutput;
      return next;
    });
  }

  private isTransferRecord(value: unknown): value is UserDataTransferRow {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  private stripAssistantDebugLog(
    row: AssistantDebugLogEntity
  ): UserDataTransferRow {
    return {
      ...this.stripEntity(row),
      userPrompt: null,
      processedOutput: null,
      invalidParserOutput: null,
      resolutionNotes: [],
      modelCalls: [],
      error: null,
    };
  }

  private createImportIdMaps(payload: UserDataExport): UserDataImportIdMaps {
    return {
      preferences: this.createIdMap(
        payload.data.preferences ? [payload.data.preferences] : []
      ),
      intentions: this.createIdMap(payload.data.intentions),
      lists: this.createIdMap(payload.data.lists ?? []),
      vacationStates: this.createIdMap(payload.data.vacationStates ?? []),
      statistics: this.createIdMap(payload.data.statistics),
      tasks: this.createIdMap(payload.data.tasks),
      taskEvents: this.createIdMap(payload.data.taskEvents),
      taskImportRuns: this.createIdMap(payload.data.taskImportRuns ?? []),
      assistantDebugLogs: this.createIdMap(payload.data.assistantDebugLogs),
      assistantUsageEvents: this.createIdMap(payload.data.assistantUsageEvents),
    };
  }

  private createIdMap(rows: UserDataTransferRow[]): Map<string, string> {
    return new Map(
      rows
        .map(row => this.readRowId(row.id))
        .filter((id): id is string => id !== null)
        .map(id => [id, randomUUID()])
    );
  }

  private remapOptionalId(value: unknown, ids: Map<string, string>) {
    const id = this.readRowId(value);
    return id ? (ids.get(id) ?? null) : null;
  }

  private remapRequiredId(
    value: unknown,
    ids: Map<string, string>,
    label: string
  ) {
    const id = this.readRowId(value);
    const remappedId = id ? ids.get(id) : undefined;
    if (!remappedId) {
      throw new BadRequestException(`${label} ID is missing from user data`);
    }
    return remappedId;
  }

  private readRowId(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private stripRelations<T extends object>(
    entity: T | null
  ): UserDataTransferRow | null {
    if (!entity) {
      return null;
    }

    return this.stripEntity(entity);
  }

  private stripEntity<T extends object>(entity: T): UserDataTransferRow {
    const row = { ...(entity as UserDataTransferRow) };
    delete row.user;
    delete row.task;
    return row;
  }

  private toTransferRuntime(
    snapshot: TimerUserDataSnapshot
  ): UserDataTimerRuntime {
    return {
      currentTimer: this.toTransferRow(snapshot.currentTimer),
      sessionState: this.toTransferRow(snapshot.sessionState),
      lastCompletionTimestamp: snapshot.lastCompletionTimestamp,
      idleDetected: snapshot.idleDetected,
      undoState: this.toTransferRow(snapshot.undoState),
      undoHistory: snapshot.undoHistory.map(entry => ({ ...entry })),
      redoHistory: snapshot.redoHistory.map(entry => ({ ...entry })),
      extensionState: this.toTransferRow(snapshot.extensionState),
    };
  }

  private toTransferRow<T extends object>(
    value: T | null
  ): UserDataTransferRow | null {
    return value ? { ...(value as UserDataTransferRow) } : null;
  }

  private fromTransferRuntime(
    runtime: UserDataTimerRuntime,
    userId: string,
    ids: UserDataImportIdMaps
  ): TimerUserDataSnapshot {
    return this.rewriteRuntimeUserIds(
      runtime,
      userId,
      ids
    ) as TimerUserDataSnapshot;
  }

  private rewriteRuntimeUserIds(
    value: unknown,
    userId: string,
    ids: UserDataImportIdMaps
  ): unknown {
    if (Array.isArray(value)) {
      return value.map(item => this.rewriteRuntimeUserIds(item, userId, ids));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const next: UserDataTransferRow = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === 'userId') {
        next[key] = userId;
      } else if (key === 'focusedTaskId') {
        next[key] = this.remapOptionalId(child, ids.tasks);
      } else if (key === 'focusedTaskIds' && Array.isArray(child)) {
        next[key] = child
          .map(taskId => this.remapOptionalId(taskId, ids.tasks))
          .filter((taskId): taskId is string => taskId !== null);
      } else {
        next[key] = this.rewriteRuntimeUserIds(child, userId, ids);
      }
    }
    return next;
  }
}
