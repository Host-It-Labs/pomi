import assert from 'node:assert/strict';
import { test } from 'vitest';

import { AssistantDebugService } from '../../src/assistant/assistant-debug.service';

function createService() {
  const logs = [];
  const settingsRepository = {
    findOne() {
      return Promise.resolve({ userId: 'user-1', enabled: true });
    },
    create(value) {
      return value;
    },
    save(value) {
      return Promise.resolve(value);
    },
  };
  const logsRepository = {
    create(value) {
      return {
        id: `log-${logs.length + 1}`,
        createdAt: new Date(),
        ...value,
      };
    },
    findOne({ where }) {
      return Promise.resolve(
        logs.find(log =>
          Object.entries(where).every(([key, value]) => log[key] === value)
        ) ?? null
      );
    },
    find(options) {
      if (options.skip !== undefined) return Promise.resolve([]);
      return Promise.resolve([...logs].reverse());
    },
    save(value) {
      const index = logs.findIndex(log => log.id === value.id);
      if (index >= 0) logs[index] = { ...value };
      else logs.push({ ...value });
      return Promise.resolve(value);
    },
    delete() {
      return Promise.resolve();
    },
  };

  return {
    service: new AssistantDebugService(settingsRepository, logsRepository),
    logs,
  };
}

test('reuses the winner when concurrent debug-settings initialization hits the unique key', async () => {
  let settings = null;
  const settingsRepository = {
    findOne() {
      return Promise.resolve(settings);
    },
    create(value) {
      return value;
    },
    save(value) {
      if (settings) {
        return Promise.reject(
          Object.assign(new Error('duplicate'), { code: '23505' })
        );
      }
      settings = value;
      return Promise.resolve(value);
    },
  };
  const logsRepository = {
    find() {
      return Promise.resolve([]);
    },
  };
  const service = new AssistantDebugService(settingsRepository, logsRepository);

  const statuses = await Promise.all([
    service.getStatus('user-1'),
    service.getStatus('user-1'),
  ]);

  assert.deepEqual(statuses, [{ enabled: false }, { enabled: false }]);
});

test('correlates dictated input without persisting user content', async () => {
  const { service, logs } = createService();
  const id = await service.recordLog('user-1', {
    kind: 'taskCapture',
    source: 'dictation',
    status: 'dictated',
    userPrompt: 'buy milk tomorrow',
    timings: { transcriptionMs: 120, totalMs: 140 },
  });
  const finalId = await service.recordLog('user-1', {
    kind: 'taskCapture',
    source: 'dictation',
    status: 'succeeded',
    debugLogId: id,
    userPrompt: 'Buy milk tomorrow for Groceries intention',
    processedOutput: { tasks: [{ title: 'Buy milk' }] },
    timings: { modelRequestMs: 300, taskCreationMs: 12, totalMs: 340 },
  });

  assert.equal(finalId, id);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, 'succeeded');
  assert.equal(logs[0].userPrompt, null);
  assert.equal(logs[0].processedOutput, null);
  assert.deepEqual(logs[0].timings, {
    transcriptionMs: 120,
    modelRequestMs: 300,
    taskCreationMs: 12,
    totalMs: 480,
  });
});

test('never updates a debug log owned by another user', async () => {
  const { service, logs } = createService();
  logs.push({
    id: 'foreign-log',
    userId: 'user-2',
    kind: 'taskCapture',
    source: 'dictation',
    status: 'dictated',
    userPrompt: 'private prompt',
    processedOutput: null,
    invalidParserOutput: null,
    resolutionNotes: [],
    timings: {},
    error: null,
    createdAt: new Date(),
  });

  const id = await service.recordLog('user-1', {
    kind: 'taskCapture',
    source: 'dictation',
    status: 'succeeded',
    debugLogId: 'foreign-log',
    userPrompt: 'my prompt',
  });

  assert.notEqual(id, 'foreign-log');
  assert.equal(logs.length, 2);
  assert.equal(logs[0].userPrompt, 'private prompt');
  assert.equal(logs[1].userId, 'user-1');
});

test('starts a new log for completed or stale correlation IDs', async () => {
  const { service, logs } = createService();
  logs.push(
    {
      id: 'completed-log',
      userId: 'user-1',
      kind: 'taskCapture',
      source: 'dictation',
      status: 'succeeded',
      userPrompt: 'completed',
      createdAt: new Date(),
      timings: {},
    },
    {
      id: 'stale-log',
      userId: 'user-1',
      kind: 'taskCapture',
      source: 'dictation',
      status: 'dictated',
      userPrompt: 'stale',
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      timings: {},
    }
  );

  const completedReplacement = await service.recordLog('user-1', {
    kind: 'taskCapture',
    source: 'dictation',
    status: 'succeeded',
    debugLogId: 'completed-log',
    userPrompt: 'new completed capture',
  });
  const staleReplacement = await service.recordLog('user-1', {
    kind: 'taskCapture',
    source: 'dictation',
    status: 'succeeded',
    debugLogId: 'stale-log',
    userPrompt: 'new stale capture',
  });

  assert.notEqual(completedReplacement, 'completed-log');
  assert.notEqual(staleReplacement, 'stale-log');
  assert.equal(logs.length, 4);
});

test('flags a log while retaining only safe model-call metadata', async () => {
  const { service } = createService();
  const modelCalls = [
    {
      provider: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      stage: 'initial',
      request: { model: 'test/model', messages: [] },
      attempts: [
        {
          request: { model: 'test/model', messages: [] },
          status: 200,
          response: { choices: [] },
          error: null,
        },
      ],
      response: { choices: [] },
      content: '{}',
      costUsd: 0.01,
      durationMs: 42,
    },
  ];
  const id = await service.recordLog('user-1', {
    kind: 'taskCapture',
    source: 'typed',
    status: 'succeeded',
    userPrompt: 'test prompt',
    modelCalls,
  });

  const flagged = await service.updateFlag('user-1', id, true);
  assert.equal(flagged.flagged, true);
  assert.deepEqual(flagged.modelCalls, [
    {
      provider: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      stage: 'initial',
      request: {},
      attempts: [{ request: {}, status: 200, error: null }],
      response: undefined,
      content: null,
      costUsd: 0.01,
      durationMs: 42,
    },
  ]);

  const exported = await service.exportFlaggedLogs('user-1');
  assert.equal(exported.version, 1);
  assert.equal(exported.logs.length, 1);
  assert.equal(exported.logs[0].id, id);
  assert.deepEqual(exported.logs[0].modelCalls, flagged.modelCalls);
});

test('correlates segmented voice transcription traces with the final command', async () => {
  const { service, logs } = createService();
  const transcriptionCall = {
    provider: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1/audio/transcriptions',
    stage: 'transcription',
    request: { model: 'test/transcription' },
    attempts: [],
    response: { text: 'first chunk' },
    content: 'first chunk',
    costUsd: 0,
    durationMs: 12,
  };
  const firstId = await service.recordLog('user-1', {
    kind: 'voiceCommand',
    source: 'assistantVoice',
    status: 'dictated',
    userPrompt: 'first chunk',
    modelCalls: [transcriptionCall],
  });
  const secondId = await service.recordLog('user-1', {
    kind: 'voiceCommand',
    source: 'assistantVoice',
    status: 'succeeded',
    debugLogId: firstId,
    userPrompt: 'first chunk second chunk',
    modelCalls: [
      {
        ...transcriptionCall,
        response: { text: 'second chunk' },
        content: 'second chunk',
      },
    ],
  });

  assert.equal(secondId, firstId);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].kind, 'voiceCommand');
  assert.equal(logs[0].modelCalls.length, 2);
  assert.equal(logs[0].userPrompt, null);
  assert.equal(logs[0].modelCalls[0].content, null);
});
