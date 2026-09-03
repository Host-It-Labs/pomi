import { describe, expect, it } from 'vitest';
import {
  TASK_FOLLOW_UP_DELAY_MAX_DAYS,
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_IMPORT_MAX_ROWS,
  TASK_TITLE_MAX_LENGTH,
} from '../constants';
import {
  apiContract,
  userActionIdSchema,
  userActionSchema,
  userActionStatusSchema,
} from './contract';

function expectActionValid(action: unknown) {
  expect(userActionSchema.safeParse(action).success).toBe(true);
}

function expectActionInvalid(action: unknown, path: string) {
  const result = userActionSchema.safeParse(action);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues.map(issue => issue.path.join('.'))).toContain(
      path
    );
  }
}

describe('accepted-action schemas', () => {
  it('accepts each supported action family', () => {
    expect(
      userActionSchema.parse({
        kind: 'timer',
        operation: 'createOrResume',
        timerType: 'work',
        focusedTaskId: 'task-1',
        customDuration: 1_800_000,
      })
    ).toMatchObject({
      kind: 'timer',
      operation: 'createOrResume',
      customDuration: 1_800_000,
    });
    expect(
      userActionSchema.parse({
        kind: 'tasks',
        operation: 'update',
        taskId: 'task',
        customDuration: 1_800_000,
        recurrenceAnchorMode: 'completion',
        followUpDefinition: {
          title: 'Send the follow-up',
          description: null,
          dueTime: '09:00',
          priority: 'normal',
          timerType: 'work',
          intentionSlug: null,
          subIntentionSlug: null,
          vacationEligible: false,
        },
        followUpDelayDays: TASK_FOLLOW_UP_DELAY_MAX_DAYS,
      })
    ).toMatchObject({
      kind: 'tasks',
      recurrenceAnchorMode: 'completion',
      followUpDefinition: expect.objectContaining({
        title: 'Send the follow-up',
      }),
      followUpDelayDays: TASK_FOLLOW_UP_DELAY_MAX_DAYS,
    });
    expect(
      userActionSchema.parse({
        kind: 'notifications',
        operation: 'test',
        payload: { type: 'complete', timerType: 'work' },
      })
    ).toMatchObject({ kind: 'notifications', operation: 'test' });
    expect(
      userActionSchema.parse({
        kind: 'intentions',
        operation: 'reparent',
        slug: 'deep-work',
        parentSlug: 'work',
      })
    ).toMatchObject({ kind: 'intentions', operation: 'reparent' });
    expect(
      userActionSchema.parse({
        kind: 'preferences',
        operation: 'toggle',
        key: 'tasksEnabled',
      })
    ).toMatchObject({ kind: 'preferences', operation: 'toggle' });
    expect(
      userActionSchema.parse({
        kind: 'assistant',
        operation: 'createTaskFromText',
        payload: { transcript: 'Prepare report' },
      })
    ).toMatchObject({ kind: 'assistant' });
    expect(
      userActionSchema.parse({
        kind: 'assistant',
        operation: 'commitPreparedTaskFromText',
        payload: { preparationId: '11111111-1111-4111-8111-111111111111' },
      })
    ).toMatchObject({ kind: 'assistant' });
    expect(
      userActionSchema.parse({
        kind: 'workTimerLog',
        operation: 'update',
        logId: 'log-1',
        payload: { intentionSlug: 'deep-work' },
      })
    ).toMatchObject({ kind: 'workTimerLog', logId: 'log-1' });
    expect(
      userActionSchema.parse({
        kind: 'system',
        operation: 'importUserData',
        payload: { version: 1 },
      })
    ).toMatchObject({ kind: 'system', operation: 'importUserData' });
  });

  it('rejects malformed IDs and removed request actions', () => {
    expect(userActionIdSchema.safeParse('bad id with spaces').success).toBe(
      false
    );
    expect(
      userActionSchema.safeParse({
        kind: 'assistant',
        operation: 'commitPreparedTaskFromText',
        payload: { preparationId: 'not-a-uuid' },
      }).success
    ).toBe(false);
    expect(
      userActionSchema.safeParse({
        kind: 'request',
        method: 'GET',
        path: 'https://example.com',
      }).success
    ).toBe(false);
    expect(
      userActionSchema.safeParse({
        kind: 'tasks',
        operation: 'update',
        taskId: 'task',
        followUpTaskId: 'template',
        followUpDelayDays: TASK_FOLLOW_UP_DELAY_MAX_DAYS + 1,
      }).success
    ).toBe(false);
    expect(
      userActionSchema.parse({
        kind: 'timer',
        operation: 'pause',
        unsupported: true,
      })
    ).toEqual({ kind: 'timer', operation: 'pause' });
  });

  it('requires a complete confirmed lifecycle envelope', () => {
    const now = Date.now();
    const parsed = userActionStatusSchema.parse({
      actionId: '5484f2b5-1a3f-4e3f-8d9d-f9e7b74f8e76',
      status: 'succeeded',
      action: { kind: 'timer', operation: 'pause' },
      acceptedAt: now - 2,
      startedAt: now - 1,
      completedAt: now,
      updatedAt: now,
    });

    expect(parsed.status).toBe('succeeded');
    expect(
      userActionStatusSchema.safeParse({
        actionId: parsed.actionId,
        status: 'done',
        action: parsed.action,
        acceptedAt: now,
        updatedAt: now,
      }).success
    ).toBe(false);
    expect(
      userActionStatusSchema.safeParse({
        actionId: parsed.actionId,
        status: 'succeeded',
        action: parsed.action,
        acceptedAt: 1.5,
        updatedAt: now,
      }).success
    ).toBe(false);
    expect(
      userActionStatusSchema.safeParse({
        actionId: parsed.actionId,
        status: 'failed',
        action: parsed.action,
        error: { message: 'Worker failed' },
        outcomeUnknown: true,
        acceptedAt: now - 1,
        updatedAt: now,
      }).success
    ).toBe(true);
  });

  it('validates every conditional timer action requirement', () => {
    expectActionInvalid(
      { kind: 'timer', operation: 'createOrResume' },
      'timerType'
    );
    expectActionValid({
      kind: 'timer',
      operation: 'createOrResume',
      timerType: 'work',
    });
    expectActionValid({
      kind: 'timer',
      operation: 'createOrResume',
      timerType: 'break',
    });
    expectActionInvalid(
      {
        kind: 'timer',
        operation: 'createOrResume',
        timerType: 'work',
        customDuration: 0,
      },
      'customDuration'
    );

    expectActionInvalid(
      { kind: 'timer', operation: 'setSessionPosition' },
      'position'
    );
    expectActionValid({
      kind: 'timer',
      operation: 'setSessionPosition',
      position: 2,
    });

    expectActionInvalid(
      { kind: 'timer', operation: 'resolveExtension' },
      'extensionAction'
    );
    expectActionValid({
      kind: 'timer',
      operation: 'resolveExtension',
      extensionAction: 'logElapsed',
    });
    expectActionInvalid(
      {
        kind: 'timer',
        operation: 'resolveExtension',
        action: 'addFiveMinutes',
      },
      'extensionAction'
    );

    expectActionInvalid(
      { kind: 'timer', operation: 'selectIntention' },
      'intention'
    );
    expectActionValid({
      kind: 'timer',
      operation: 'selectIntention',
      intention: 'focus',
    });
    expectActionInvalid(
      { kind: 'timer', operation: 'setIntentions' },
      'intentions'
    );
    expectActionValid({
      kind: 'timer',
      operation: 'setIntentions',
      intentions: [],
    });
    expectActionValid({ kind: 'timer', operation: 'pause' });
    expectActionValid({
      kind: 'timer',
      operation: 'selectIntention',
      intention: 'focus',
      resetOnFirstIntention: true,
    });
    expect(
      userActionSchema.safeParse({
        kind: 'timer',
        operation: 'selectIntention',
        intention: 'focus',
        resetOnFirstIntention: 'true',
      }).success
    ).toBe(false);
  });

  it('validates every conditional Task action requirement', () => {
    expectActionInvalid({ kind: 'tasks', operation: 'create' }, 'title');
    expectActionValid({
      kind: 'tasks',
      operation: 'create',
      title: 'Ship tests',
      customDuration: 1_800_000,
    });
    expectActionInvalid(
      {
        kind: 'tasks',
        operation: 'update',
        taskId: 'task-1',
        customDuration: 0,
      },
      'customDuration'
    );

    for (const operation of ['update', 'complete'] as const) {
      expectActionInvalid({ kind: 'tasks', operation }, 'taskId');
      expectActionValid({ kind: 'tasks', operation, taskId: 'task-1' });
    }

    expectActionInvalid({ kind: 'tasks', operation: 'revert' }, 'eventId');
    expectActionValid({
      kind: 'tasks',
      operation: 'revert',
      eventId: 'event-1',
    });
    expectActionInvalid({ kind: 'tasks', operation: 'reorder' }, 'reorder');
    expectActionValid({
      kind: 'tasks',
      operation: 'reorder',
      reorder: [],
    });

    expectActionInvalid({ kind: 'tasks', operation: 'import' }, 'rows');
    expectActionInvalid(
      { kind: 'tasks', operation: 'import', importSource: 'todoist' },
      'rows'
    );
    expectActionInvalid(
      { kind: 'tasks', operation: 'import', rows: [] },
      'rows'
    );
    expectActionValid({
      kind: 'tasks',
      operation: 'import',
      importSource: 'todoist',
      rows: [],
    });
    expectActionValid({
      kind: 'lists',
      operation: 'resetCompletedItems',
      listId: 'list-1',
    });
    expectActionInvalid(
      { kind: 'lists', operation: 'createItem', listId: 'list-1' },
      'title'
    );
    expectActionValid({
      kind: 'lists',
      operation: 'createItem',
      listId: 'list-1',
      title: 'Milk',
    });
    expectActionInvalid(
      {
        kind: 'lists',
        operation: 'convertTaskToListItem',
        listId: 'list-1',
      },
      'taskId'
    );
    expectActionInvalid(
      {
        kind: 'lists',
        operation: 'convertTaskToListItem',
        taskId: 'task-1',
      },
      'taskId'
    );
    expectActionValid({
      kind: 'lists',
      operation: 'convertTaskToListItem',
      taskId: 'task-1',
      listId: 'list-1',
    });
    expectActionInvalid(
      {
        kind: 'lists',
        operation: 'convertListItemToTask',
        intentionSlug: 'focus',
      },
      'itemId'
    );
    expectActionInvalid(
      {
        kind: 'lists',
        operation: 'convertListItemToTask',
        itemId: 'item-1',
      },
      'itemId'
    );
    expectActionValid({
      kind: 'lists',
      operation: 'convertListItemToTask',
      itemId: 'item-1',
      intentionSlug: 'focus',
    });
    expectActionInvalid(
      {
        kind: 'vacation',
        operation: 'configure',
        listIds: ['not-a-uuid'],
      },
      'listIds.0'
    );
  });

  it('bounds Task action payloads before queueing them', () => {
    const row = {
      sourceId: 'task-1',
      title: 'Imported task',
      include: true,
    };

    expectActionInvalid(
      {
        kind: 'tasks',
        operation: 'create',
        title: 'x'.repeat(TASK_TITLE_MAX_LENGTH + 1),
      },
      'title'
    );
    expectActionInvalid(
      {
        kind: 'tasks',
        operation: 'update',
        taskId: 'task-1',
        description: 'x'.repeat(TASK_DESCRIPTION_MAX_LENGTH + 1),
      },
      'description'
    );
    expectActionInvalid(
      {
        kind: 'tasks',
        operation: 'import',
        importSource: 'vikunja',
        rows: Array.from({ length: TASK_IMPORT_MAX_ROWS + 1 }, () => row),
      },
      'rows'
    );
    expectActionInvalid(
      {
        kind: 'tasks',
        operation: 'import',
        importSource: 'vikunja',
        rows: [{ ...row, description: 'x'.repeat(10_001) }],
      },
      'rows.0.description'
    );
  });

  it('validates every conditional Intention action requirement', () => {
    expectActionInvalid({ kind: 'intentions', operation: 'create' }, 'title');
    expectActionInvalid(
      { kind: 'intentions', operation: 'create', title: 'Focus' },
      'title'
    );
    expectActionInvalid(
      { kind: 'intentions', operation: 'create', emoji: 'F' },
      'title'
    );
    expectActionValid({
      kind: 'intentions',
      operation: 'create',
      title: 'Focus',
      emoji: 'F',
    });

    for (const operation of [
      'update',
      'delete',
      'archive',
      'unarchive',
      'reparent',
    ] as const) {
      expectActionInvalid({ kind: 'intentions', operation }, 'slug');
    }
    expectActionValid({
      kind: 'intentions',
      operation: 'delete',
      slug: 'focus',
    });

    expectActionInvalid(
      { kind: 'intentions', operation: 'update', slug: 'focus' },
      'title'
    );
    expectActionInvalid(
      {
        kind: 'intentions',
        operation: 'update',
        slug: 'focus',
        title: 'Focus',
      },
      'title'
    );
    expectActionInvalid(
      {
        kind: 'intentions',
        operation: 'update',
        slug: 'focus',
        emoji: 'F',
      },
      'title'
    );
    expectActionValid({
      kind: 'intentions',
      operation: 'update',
      slug: 'focus',
      title: 'Focus',
      emoji: 'F',
    });

    expectActionInvalid(
      { kind: 'intentions', operation: 'reparent', slug: 'focus' },
      'parentSlug'
    );
    expectActionValid({
      kind: 'intentions',
      operation: 'reparent',
      slug: 'focus',
      parentSlug: 'work',
    });
    expectActionValid({
      kind: 'intentions',
      operation: 'reparent',
      slug: 'focus',
      parentIntentionId: 'parent-1',
    });
  });

  it('validates conditional Preferences, log, and Assistant payloads', () => {
    expectActionInvalid(
      { kind: 'preferences', operation: 'update' },
      'updates'
    );
    expectActionValid({
      kind: 'preferences',
      operation: 'update',
      updates: {},
    });
    expectActionInvalid({ kind: 'preferences', operation: 'toggle' }, 'key');
    expectActionValid({
      kind: 'preferences',
      operation: 'toggle',
      key: 'tasksExtension',
    });

    expectActionInvalid(
      { kind: 'workTimerLog', operation: 'update', logId: 'log-1' },
      'payload'
    );
    expectActionValid({
      kind: 'workTimerLog',
      operation: 'update',
      logId: 'log-1',
      payload: {},
    });
    expectActionValid({
      kind: 'workTimerLog',
      operation: 'delete',
      logId: 'log-1',
    });

    expectActionInvalid(
      { kind: 'assistant', operation: 'createTaskFromText' },
      'payload'
    );
    expectActionValid({
      kind: 'assistant',
      operation: 'createTaskFromText',
      payload: {},
    });
    expectActionValid({
      kind: 'assistant',
      operation: 'clearDebugLogs',
    });
    expectActionValid({
      kind: 'system',
      operation: 'importUserData',
      payload: {},
    });
  });

  it('normalizes every boolean query-string transform', () => {
    expect(
      apiContract.intentions.list.query.parse({
        isArchived: 'true',
        includeSubIntentions: 'false',
      })
    ).toEqual({ isArchived: true, includeSubIntentions: false });
    expect(
      apiContract.intentions.list.query.parse({
        isArchived: 'false',
        includeSubIntentions: 'true',
      })
    ).toEqual({ isArchived: false, includeSubIntentions: true });
    expect(
      apiContract.intentions.delete.query.parse({ keepStats: 'true' })
    ).toEqual({ keepStats: true });
    expect(
      apiContract.intentions.delete.query.parse({ keepStats: 'false' })
    ).toEqual({ keepStats: false });
    expect(
      apiContract.lists.list.query.parse({ includeArchived: 'true' })
    ).toEqual({ includeArchived: true });
    expect(
      apiContract.lists.list.query.parse({ includeArchived: 'false' })
    ).toEqual({ includeArchived: false });
  });

  it('accepts independent Wear reset preferences for both break types', () => {
    const statusSchema = apiContract.watch.status.responses[200];
    const baseStatus = {
      serverNowMs: 0,
      language: 'en',
      taskMode: 'intention',
      timer: null,
      assistant: {
        assistantEnabled: false,
        speechCaptureEnabled: false,
        aiTaskCaptureEnabled: false,
        assistantRecordingMaxMinutes: null,
        usageBudgetPeriod: 'daily',
        usageBudgetCapUsd: null,
        usageBudgetUsedUsd: 0,
        usageBudgetRemainingUsd: null,
      },
      timerControls: {
        canStartOrResume: true,
        canPause: false,
        canAddFiveMinutes: false,
        canReset: false,
        canSkip: false,
        requiresIntentionSelection: false,
        intentionRequireSelection: false,
        intentionMultiSelect: false,
        advancedSkip: false,
        sessionsEnabled: false,
        canStartLongBreak: false,
        resetBreakOnFirstIntention: false,
        resetLongBreakOnFirstIntention: false,
      },
      tasks: [],
      totalVisibleTasks: 0,
      totalActiveTasks: 0,
    };

    for (const [resetBreakOnFirstIntention, resetLongBreakOnFirstIntention] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ]) {
      expect(
        statusSchema.safeParse({
          ...baseStatus,
          timerControls: {
            ...baseStatus.timerControls,
            resetBreakOnFirstIntention,
            resetLongBreakOnFirstIntention,
          },
        }).success
      ).toBe(true);
    }
  });

  it('requires an immutable manifest for durable Assistant audio chunks', () => {
    const manifestBody = apiContract.assistant.registerVoiceChunks.body;
    const chunkBody = apiContract.assistant.transcribeVoiceChunk.body;
    const preparationBody = apiContract.assistant.prepareVoiceCommand.body;
    const preparationId = '550e8400-e29b-41d4-a716-446655440000';
    expect(
      manifestBody.safeParse({
        preparationId,
        manifest: [
          { audioSha256: 'a'.repeat(64), mimeType: 'audio/webm' },
          { audioSha256: 'b'.repeat(64), mimeType: 'audio/webm' },
        ],
      }).success
    ).toBe(true);
    expect(
      manifestBody.safeParse({
        preparationId,
        manifest: [{ audioSha256: 'invalid', mimeType: 'audio/webm' }],
      }).success
    ).toBe(false);
    expect(
      chunkBody.safeParse({
        preparationId,
        index: 0,
        audioBase64: 'YQ==',
        mimeType: 'audio/webm',
      }).success
    ).toBe(true);
    expect(
      preparationBody.safeParse({ kind: 'chunks', preparationId }).success
    ).toBe(true);
  });

  it('bounds feedback payloads and requires a transcription idempotency key', () => {
    const transcriptionBody = apiContract.feedback.transcribe.body;
    const idempotencyKey = '550e8400-e29b-41d4-a716-446655440000';

    expect(
      transcriptionBody.safeParse({
        audioBase64: 'YQ==',
        mimeType: 'audio/webm',
        idempotencyKey,
      }).success
    ).toBe(true);
    expect(
      transcriptionBody.safeParse({
        audioBase64: 'YQ==',
        mimeType: 'audio/webm',
      }).success
    ).toBe(false);
    expect(
      transcriptionBody.safeParse({
        audioBase64: 'a'.repeat(4 * 1024 * 1024 + 1),
        mimeType: 'audio/webm',
        idempotencyKey,
      }).success
    ).toBe(false);
  });
});
