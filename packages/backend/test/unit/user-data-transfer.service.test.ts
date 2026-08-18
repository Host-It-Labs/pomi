import { describe, expect, it } from 'vitest';
import { UserDataTransferService } from '../../src/system/user-data-transfer.service';

describe('UserDataTransferService', () => {
  it('assigns fresh IDs and remaps related imported rows', async () => {
    const inserted = new Map<string, Record<string, unknown>[]>();
    let importedRuntime: Record<string, unknown> | null = null;
    const targetUserId = 'target-user';
    const manager = {
      findOne: async () => ({ id: targetUserId }),
      getRepository: (target: { name: string }) => ({
        delete: async () => undefined,
        insert: async (rows: Record<string, unknown>[]) => {
          inserted.set(
            target.name,
            rows.map(row => ({ ...row }))
          );
        },
      }),
    };
    const service = new UserDataTransferService(
      {
        transaction: async (callback: (value: unknown) => Promise<unknown>) =>
          callback(manager),
      } as never,
      {
        importUserData: async (
          _userId: string,
          runtime: Record<string, unknown>
        ) => {
          importedRuntime = runtime;
        },
      } as never,
      { emitTasksUpdate: () => undefined } as never
    );

    await service.importUserData(targetUserId, {
      version: 1,
      exportedAt: '2026-07-10T00:00:00.000Z',
      sourceUser: { id: 'source-user', username: 'source' },
      data: {
        preferences: {
          id: 'source-preferences',
          userId: 'source-user',
          language: 'fr-FR',
        },
        intentions: [
          {
            id: 'source-parent',
            userId: 'source-user',
            slug: 'parent',
            parentIntentionId: null,
          },
          {
            id: 'source-child',
            userId: 'source-user',
            slug: 'child',
            parentIntentionId: 'source-parent',
          },
        ],
        statistics: [{ id: 'source-statistic', userId: 'source-user' }],
        tasks: [{ id: 'source-task', userId: 'source-user' }],
        taskEvents: [
          {
            id: 'source-task-event',
            userId: 'source-user',
            taskId: 'source-task',
          },
        ],
        taskImportRuns: [
          {
            id: 'source-import-run',
            userId: 'source-user',
            source: 'vikunja',
            importedCount: 1,
            skippedCount: 0,
          },
        ],
        assistantDebugSetting: { userId: 'source-user', enabled: true },
        assistantDebugLogs: [
          {
            id: 'source-debug-log',
            userId: 'source-user',
            kind: 'taskDictation',
            audioBase64: 'removed-recording',
            audioMimeType: 'audio/webm',
            transcriptionOutput: '{"text":"legacy"}',
            parserOutput: '{"choices":[]}',
            userPrompt: 'private prompt',
            processedOutput: { tasks: [{ title: 'private task' }] },
            invalidParserOutput: 'private parser output',
            resolutionNotes: ['private resolution note'],
            modelCalls: [
              {
                request: { messages: ['private request'] },
                response: { choices: ['private response'] },
                content: 'private model content',
                attempts: [{ error: 'private model error' }],
              },
            ],
            error: 'private error',
          },
        ],
        assistantUsageEvents: [{ id: 'source-usage', userId: 'source-user' }],
        timerRuntime: {
          currentTimer: {
            userId: 'source-user',
            focusedTaskIds: ['source-task'],
          },
          sessionState: null,
          lastCompletionTimestamp: null,
          idleDetected: false,
          undoState: null,
          undoHistory: [],
          redoHistory: [],
          extensionState: null,
        },
      },
    } as never);

    const preferences = inserted.get('Preferences')?.[0];
    const [parent, child] = inserted.get('Intention') ?? [];
    const task = inserted.get('TaskEntity')?.[0];
    const taskEvent = inserted.get('TaskEventEntity')?.[0];
    const taskImportRun = inserted.get('TaskImportRunEntity')?.[0];
    expect(preferences).toMatchObject({
      userId: targetUserId,
      language: 'fr',
    });
    expect(preferences?.id).not.toBe('source-preferences');
    expect(parent.id).not.toBe('source-parent');
    expect(child.id).not.toBe('source-child');
    expect(child.parentIntentionId).toBe(parent.id);
    expect(task.id).not.toBe('source-task');
    expect(taskEvent).toMatchObject({ taskId: task.id, userId: targetUserId });
    expect(taskImportRun).toMatchObject({
      userId: targetUserId,
      source: 'vikunja',
      importedCount: 1,
    });
    expect(taskImportRun.id).not.toBe('source-import-run');
    expect(inserted.get('AssistantDebugSettingEntity')?.[0]).toMatchObject({
      userId: targetUserId,
    });
    const debugLog = inserted.get('AssistantDebugLogEntity')?.[0];
    expect(debugLog).toMatchObject({
      kind: 'taskCapture',
      source: 'dictation',
      status: 'failed',
      timings: {},
      userPrompt: null,
      processedOutput: null,
      invalidParserOutput: null,
      resolutionNotes: [],
      modelCalls: [],
      error: null,
    });
    expect(debugLog?.id).not.toBe('source-debug-log');
    expect(debugLog).not.toHaveProperty('audioBase64');
    expect(debugLog).not.toHaveProperty('transcriptionOutput');
    expect(inserted.get('AssistantUsageEntity')?.[0].id).not.toBe(
      'source-usage'
    );
    expect(importedRuntime).toMatchObject({
      currentTimer: {
        userId: targetUserId,
        focusedTaskIds: [task.id],
      },
    });
  });

  it('rejects an unsupported imported preference language before deleting data', async () => {
    let deleteCalls = 0;
    const manager = {
      findOne: async () => ({ id: 'target-user' }),
      getRepository: () => ({
        delete: async () => {
          deleteCalls += 1;
        },
        insert: async () => undefined,
      }),
    };
    const service = new UserDataTransferService(
      {
        transaction: async (callback: (value: unknown) => Promise<unknown>) =>
          callback(manager),
      } as never,
      { importUserData: async () => undefined } as never,
      { emitTasksUpdate: () => undefined } as never
    );

    await expect(
      service.importUserData('target-user', {
        version: 1,
        exportedAt: '2026-07-10T00:00:00.000Z',
        sourceUser: { id: 'source-user', username: 'source' },
        data: {
          preferences: {
            id: 'source-preferences',
            userId: 'source-user',
            language: 'xx-XX',
          },
          intentions: [],
          statistics: [],
          tasks: [],
          taskEvents: [],
          assistantDebugSetting: null,
          assistantDebugLogs: [],
          assistantUsageEvents: [],
          timerRuntime: {
            currentTimer: null,
            sessionState: null,
            lastCompletionTimestamp: null,
            idleDetected: false,
            undoState: null,
            undoHistory: [],
            redoHistory: [],
            extensionState: null,
          },
        },
      } as never)
    ).rejects.toThrow('Unsupported language in user data');
    expect(deleteCalls).toBe(0);
  });
});
