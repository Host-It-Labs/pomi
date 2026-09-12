import assert from 'node:assert/strict';
import { test } from 'vitest';

import { AssistantDebugService } from '../../src/assistant/assistant-debug.service';
import {
  AssistantDebugLogEntity,
  AssistantDebugSettingEntity,
} from '../../src/assistant/assistant-debug.entity';
import { UserEntity } from '../../src/users/users.entity';

function createService(options?: { admin: boolean }) {
  const admin = options?.admin ?? true;
  const logs: any[] = [];
  const settings = {
    userId: 'user-1',
    enabled: true,
    consentVersion: 1 as number | null,
    generation: 1,
  };
  const settingsRepository: any = {
    findOne({ where }) {
      return Promise.resolve(
        where.userId === settings.userId ? settings : null
      );
    },
    create(value) {
      return value;
    },
    save(value) {
      Object.assign(settings, value);
      return Promise.resolve(value);
    },
  };
  const logsRepository: any = {
    create(value) {
      return {
        id: `log-${logs.length + 1}`,
        createdAt: new Date(),
        contentTruncated: false,
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
      const matches = logs.filter(log =>
        Object.entries(options.where ?? {}).every(
          ([key, value]) => log[key] === value
        )
      );
      if (options.skip !== undefined) {
        return Promise.resolve(matches.slice(options.skip));
      }
      return Promise.resolve([...matches].reverse().slice(0, options.take));
    },
    count({ where }) {
      return Promise.resolve(
        logs.filter(log =>
          Object.entries(where).every(([key, value]) => log[key] === value)
        ).length
      );
    },
    save(value) {
      const index = logs.findIndex(log => log.id === value.id);
      if (index >= 0) logs[index] = { ...value };
      else logs.push({ ...value });
      return Promise.resolve(value);
    },
    delete(where) {
      for (let index = logs.length - 1; index >= 0; index -= 1) {
        if (
          Object.entries(where).every(([key, value]) => {
            if (key === 'id' && value && typeof value === 'object') {
              return (value as any)._value.includes(logs[index].id);
            }
            return logs[index][key] === value;
          })
        ) {
          logs.splice(index, 1);
        }
      }
      return Promise.resolve();
    },
  };
  const manager: any = {
    findOne(entity, { where }) {
      if (entity === UserEntity) {
        return Promise.resolve(
          where.id === 'user-1' ? { id: 'user-1', isAdmin: admin } : null
        );
      }
      return Promise.resolve(null);
    },
    getRepository(entity) {
      if (entity === AssistantDebugSettingEntity) return settingsRepository;
      if (entity === AssistantDebugLogEntity) return logsRepository;
      throw new Error('Unexpected repository');
    },
    query() {
      return Promise.resolve();
    },
    transaction(operation) {
      return operation(manager);
    },
  };
  settingsRepository.manager = manager;
  logsRepository.manager = manager;

  return {
    service: new AssistantDebugService(settingsRepository, logsRepository),
    logs,
    settings,
  };
}

test('requires fresh current consent before a capture starts', async () => {
  const { service, settings } = createService();
  assert.deepEqual(await service.beginCapture('user-1'), { generation: 1 });
  settings.consentVersion = null;
  assert.equal(await service.beginCapture('user-1'), null);
});

test('non-admin capture requests continue without retaining diagnostics', async () => {
  const { service } = createService({ admin: false });
  assert.equal(await service.beginCapture('user-1'), null);
});

test('correlates dictated input and retains only allowlisted capture content', async () => {
  const { service, logs } = createService();
  const id = await service.recordLog('user-1', {
    kind: 'taskCapture',
    source: 'dictation',
    status: 'dictated',
    userPrompt: 'buy milk tomorrow',
    timings: { transcriptionMs: 120, totalMs: 140 },
    captureGeneration: 1,
  });
  const finalId = await service.recordLog('user-1', {
    kind: 'taskCapture',
    source: 'dictation',
    status: 'succeeded',
    debugLogId: id,
    userPrompt: 'Buy milk tomorrow for Groceries intention',
    processedOutput: { tasks: [{ title: 'Buy milk', dueDate: '2026-09-13' }] },
    invalidParserOutput: 'raw provider payload',
    resolutionNotes: ['private context'],
    timings: { modelRequestMs: 300, taskCreationMs: 12, totalMs: 340 },
    captureGeneration: 1,
  });

  assert.equal(finalId, id);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].userPrompt, 'Buy milk tomorrow for Groceries intention');
  assert.deepEqual(logs[0].processedOutput, {
    tasks: [{ title: 'Buy milk', dueDate: '2026-09-13' }],
  });
  assert.equal(logs[0].invalidParserOutput, null);
  assert.deepEqual(logs[0].resolutionNotes, []);
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
    timings: {},
    createdAt: new Date(),
  });
  const id = await service.recordLog('user-1', {
    kind: 'taskCapture',
    source: 'dictation',
    status: 'succeeded',
    debugLogId: 'foreign-log',
    userPrompt: 'my prompt',
    captureGeneration: 1,
  });
  assert.notEqual(id, 'foreign-log');
  assert.equal(logs[0].userPrompt, 'private prompt');
  assert.equal(logs[1].userId, 'user-1');
});

test('flagging preserves content and strips model provider envelopes', async () => {
  const { service } = createService();
  const id = await service.recordLog('user-1', {
    kind: 'taskCapture',
    source: 'typed',
    status: 'succeeded',
    userPrompt: 'test prompt',
    processedOutput: { tasks: [{ title: 'Test task' }] },
    modelCalls: [
      {
        provider: 'openrouter',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        stage: 'initial',
        request: { messages: ['secret'] },
        attempts: [
          {
            request: { messages: ['secret'] },
            status: 200,
            response: { choices: ['secret'] },
            error: null,
          },
        ],
        response: { choices: ['secret'] },
        content: 'secret',
        costUsd: 0.01,
        durationMs: 42,
      },
    ],
    captureGeneration: 1,
  });
  const flagged = await service.updateFlag('user-1', id!, true);
  assert.equal(flagged.flagged, true);
  assert.equal(flagged.userPrompt, 'test prompt');
  assert.deepEqual(flagged.processedOutput, {
    tasks: [{ title: 'Test task' }],
  });
  assert.deepEqual(flagged.modelCalls[0].request, {});
  assert.equal(flagged.modelCalls[0].content, null);
  assert.equal(flagged.modelCalls[0].response, undefined);
  const exported = await service.exportFlaggedLogs('user-1');
  assert.equal(exported.logs.length, 1);
  assert.equal(exported.logs[0].id, id);
});

test('disabling advances generation, deletes flags, and blocks late writes', async () => {
  const { service, logs, settings } = createService();
  const consent = await service.beginCapture('user-1');
  await service.recordLog('user-1', {
    kind: 'taskCapture',
    source: 'typed',
    status: 'succeeded',
    userPrompt: 'before disable',
    processedOutput: { tasks: [{ title: 'Before disable' }] },
    flagged: true,
    captureGeneration: consent!.generation,
  });
  await service.updateStatus('user-1', false);
  const lateId = await service.recordLog('user-1', {
    kind: 'taskCapture',
    source: 'typed',
    status: 'succeeded',
    userPrompt: 'late completion',
    processedOutput: { tasks: [{ title: 'Late completion' }] },
    captureGeneration: consent!.generation,
  });
  assert.equal(lateId, null);
  assert.equal(logs.length, 0);
  assert.equal(settings.enabled, false);
  assert.equal(settings.consentVersion, null);
  assert.equal(settings.generation, 2);
});

test('does not retain Assistant voice commands without Task output', async () => {
  const { service, logs } = createService();
  const id = await service.recordLog('user-1', {
    kind: 'voiceCommand',
    source: 'assistantVoice',
    status: 'succeeded',
    userPrompt: 'pause my timer',
    processedOutput: { tasks: [] },
    captureGeneration: 1,
  });
  assert.equal(id, null);
  assert.equal(logs.length, 0);
});
