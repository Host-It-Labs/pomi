import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AssistantPreparationStore } from '../../src/assistant/assistant-task-preparation.store';

class MemoryRedis {
  readonly values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: unknown[]) {
    if (args.includes('NX') && this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }

  async eval(script: string, keys: number, key: string, ...args: unknown[]) {
    if (script.includes('local current')) {
      const serialized = String(args[0]);
      const current = this.values.get(key);
      if (current === undefined) {
        this.values.set(key, serialized);
        return 1;
      }
      return current === serialized ? 0 : -1;
    }
    const token = String(args[keys - 1]);
    if (this.values.get(key) !== token) return 0;
    if (script.includes("redis.call('del'")) {
      this.values.delete(key);
    } else if (script.includes("redis.call('set'")) {
      const resultKey = String(args[0]);
      if (keys === 2) {
        this.values.set(resultKey, String(args[2]));
      } else {
        const debugKey = String(args[1]);
        this.values.set(resultKey, String(args[keys]));
        this.values.set(debugKey, String(args[keys + 1]));
      }
    }
    return 1;
  }
}

const prepared = (title: string) => ({
  normalizedText: title,
  debugLogId: null,
  taskDrafts: [{ title }],
  usedFallback: false,
  invalidParserOutput: null,
  interpretationError: null,
  resolutionNotes: [],
  modelCalls: [],
  timings: {},
  preparationMs: 1,
  costUsd: 0,
});

const preparedVoice = (transcript: string) => ({
  transcript,
  debugLogId: null,
  interpretation: {
    mode: 'voiceCommand' as const,
    text: transcript,
    parsed: {
      tasks: [{ title: 'Plan release' }],
      timerAction: { action: 'none' },
    },
    rawTasks: [{ title: 'Plan release' }],
    costUsd: 0.02,
    invalidParserOutput: null,
    modelFailure: null,
    modelCalls: [
      {
        provider: 'openrouter' as const,
        endpoint: '/chat/completions',
        stage: 'initial' as const,
        request: { model: 'text-model' },
        attempts: [],
        content: '{}',
        costUsd: 0.02,
        durationMs: 10,
      },
    ],
    timings: { modelRequestMs: 10 },
  },
  transcriptionCostUsd: 0.01,
  transcriptionModelCalls: [
    {
      provider: 'openrouter' as const,
      endpoint: '/audio/transcriptions',
      stage: 'transcription' as const,
      request: { model: 'speech-model' },
      attempts: [],
      content: transcript,
      costUsd: 0.01,
      durationMs: 5,
    },
  ],
  timings: { transcriptionMs: 5 },
  preparationMs: 15,
});

const committedVoice = (message: string) => ({
  version: 1 as const,
  result: {
    actions: ['none' as const],
    transcript: 'Plan the release',
    message,
    tasks: [],
    usedFallback: false,
    costUsd: 0.03,
    spokenAudioBase64: null,
    spokenAudioMimeType: null,
  },
  debugLogId: null,
  speechModel: 'speech-model',
  speechVoice: 'voice',
});

describe('AssistantPreparationStore', () => {
  it('reads and reuses the exact legacy task preparation envelope', async () => {
    const redis = new MemoryRedis();
    const store = new AssistantPreparationStore(redis as never);
    const input = { text: 'Legacy plan' };
    const value = prepared('Legacy plan');
    const inputHash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    redis.values.set(
      'pomi:assistant-task-preparation:{user-1}:legacy-id',
      JSON.stringify({
        inputHash,
        prepared: {
          taskDrafts: value.taskDrafts,
          usedFallback: value.usedFallback,
          preparationMs: value.preparationMs,
          costUsd: value.costUsd,
        },
      })
    );
    redis.values.set(
      'pomi:assistant-task-preparation-debug:{user-1}:legacy-id',
      JSON.stringify({
        normalizedText: value.normalizedText,
        debugLogId: value.debugLogId,
        invalidParserOutput: value.invalidParserOutput,
        interpretationError: value.interpretationError,
        resolutionNotes: value.resolutionNotes,
        modelCalls: value.modelCalls,
        timings: value.timings,
      })
    );
    const create = vi.fn(async () => value);

    await expect(store.requireTask('user-1', 'legacy-id')).resolves.toEqual(
      value
    );
    await expect(
      store.getOrCreateTask('user-1', 'legacy-id', input, create)
    ).resolves.toEqual(value);
    expect(create).not.toHaveBeenCalled();
  });

  it('reuses the same prepared result for the same ID and input', async () => {
    const redis = new MemoryRedis();
    const store = new AssistantPreparationStore(redis as never);
    const create = vi.fn(async () => prepared('Plan'));

    const first = await store.getOrCreateTask(
      'user-1',
      'prep-1',
      { text: 'Plan' },
      create
    );
    const retry = await store.getOrCreateTask(
      'user-1',
      'prep-1',
      { text: 'Plan' },
      create
    );

    expect(first).toEqual(retry);
    expect(create).toHaveBeenCalledOnce();
    expect([...redis.values.keys()].sort()).toEqual([
      'pomi:assistant-task-preparation-debug:{user-1}:prep-1',
      'pomi:assistant-task-preparation:{user-1}:prep-1',
    ]);
    expect(
      redis.values.get('pomi:assistant-task-preparation:{user-1}:prep-1')
    ).toBe(
      JSON.stringify({
        inputHash: createHash('sha256')
          .update(JSON.stringify({ text: 'Plan' }))
          .digest('hex'),
        prepared: {
          taskDrafts: prepared('Plan').taskDrafts,
          usedFallback: false,
          preparationMs: 1,
          costUsd: 0,
        },
      })
    );
  });

  it('rejects reuse of a preparation ID for different input', async () => {
    const store = new AssistantPreparationStore(new MemoryRedis() as never);
    await store.getOrCreateTask(
      'user-1',
      'prep-1',
      { text: 'First' },
      async () => prepared('First')
    );

    await expect(
      store.getOrCreateTask(
        'user-1',
        'prep-1',
        { text: 'Different' },
        async () => prepared('Different')
      )
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets concurrent retries share one preparation', async () => {
    const store = new AssistantPreparationStore(new MemoryRedis() as never);
    let release!: () => void;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    const create = vi.fn(async () => {
      await blocked;
      return prepared('Once');
    });

    const first = store.getOrCreateTask(
      'user-1',
      'prep-1',
      { text: 'Once' },
      create
    );
    const retry = store.getOrCreateTask(
      'user-1',
      'prep-1',
      { text: 'Once' },
      create
    );
    await Promise.resolve();
    release();

    await expect(Promise.all([first, retry])).resolves.toEqual([
      prepared('Once'),
      prepared('Once'),
    ]);
    expect(create).toHaveBeenCalledOnce();
  });

  it('does not allow commit after a preparation expires or disappears', async () => {
    const store = new AssistantPreparationStore(new MemoryRedis() as never);
    await expect(store.requireTask('user-1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('does not publish a result after preparation lock ownership is lost', async () => {
    const redis = new MemoryRedis();
    const store = new AssistantPreparationStore(redis as never);

    await expect(
      store.getOrCreateTask('user-1', 'prep-1', { text: 'Plan' }, async () => {
        const lockKey = [...redis.values.keys()].find(key =>
          key.includes('preparation-lock')
        );
        if (lockKey) redis.values.set(lockKey, 'new-owner');
        return prepared('Stale');
      })
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(store.requireTask('user-1', 'prep-1')).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('keeps voice preparations isolated from task IDs and round-trips split debug data', async () => {
    const store = new AssistantPreparationStore(new MemoryRedis() as never);
    await store.getOrCreateTask(
      'user-1',
      'shared-id',
      { text: 'Task input' },
      async () => prepared('Task input')
    );
    const createVoice = vi.fn(async () => preparedVoice('Plan the release'));

    const voice = await store.getOrCreateVoice(
      'user-1',
      'shared-id',
      { kind: 'transcript', transcript: 'Plan the release' },
      createVoice
    );
    const retry = await store.getOrCreateVoice(
      'user-1',
      'shared-id',
      { kind: 'transcript', transcript: 'Plan the release' },
      createVoice
    );

    expect(retry).toEqual(voice);
    expect(retry.interpretation).toMatchObject({
      ...preparedVoice('Plan the release').interpretation,
      modelCalls: [
        expect.objectContaining({
          request: { redacted: true },
          content: null,
        }),
      ],
    });
    expect(createVoice).toHaveBeenCalledOnce();
    await expect(store.requireTask('user-1', 'shared-id')).resolves.toEqual(
      prepared('Task input')
    );
    await expect(store.requireVoice('user-1', 'shared-id')).resolves.toEqual(
      voice
    );
  });

  it('checkpoints each voice chunk without storing its audio input', async () => {
    const redis = new MemoryRedis();
    const store = new AssistantPreparationStore(redis as never);
    const rawAudio = 'RAW_AUDIO_SENTINEL';
    const create = vi.fn(async () => ({
      transcript: 'First',
      costUsd: 0.01,
      debugLogId: null,
    }));
    const input = {
      audioSha256: createHash('sha256').update(rawAudio).digest('hex'),
      mimeType: 'audio/webm',
      transcriptionModel: 'transcription-model',
    };
    await store.registerVoiceChunkManifest('user-1', 'voice-1', {
      chunks: [
        { audioSha256: input.audioSha256, mimeType: input.mimeType },
        { audioSha256: 'next-hash', mimeType: input.mimeType },
      ],
      transcriptionModel: 'transcription-model',
    });

    const first = await store.getOrCreateVoiceChunk(
      'user-1',
      'voice-1',
      0,
      input,
      create
    );
    const retry = await store.getOrCreateVoiceChunk(
      'user-1',
      'voice-1',
      0,
      input,
      create
    );

    expect(retry).toEqual(first);
    expect(create).toHaveBeenCalledOnce();
    const serializedRedis = JSON.stringify([...redis.values.values()]);
    expect(serializedRedis).not.toContain('audioBase64');
    expect(serializedRedis).not.toContain(rawAudio);
    expect([...redis.values.keys()]).toEqual(
      expect.arrayContaining([
        'pomi:assistant-voice-chunk-preparation:{user-1}:voice-1:0',
        'pomi:assistant-voice-chunk-preparation-debug:{user-1}:voice-1:0',
      ])
    );
  });

  it('rejects a different recording for a checkpointed voice chunk', async () => {
    const store = new AssistantPreparationStore(new MemoryRedis() as never);
    await store.getOrCreateVoiceChunk(
      'user-1',
      'voice-1',
      0,
      {
        audioSha256: 'first',
        mimeType: 'audio/webm',
        transcriptionModel: 'transcription-model',
      },
      async () => ({ transcript: 'First', costUsd: 0.01, debugLogId: null })
    );

    await expect(
      store.getOrCreateVoiceChunk(
        'user-1',
        'voice-1',
        0,
        {
          audioSha256: 'different',
          mimeType: 'audio/webm',
          transcriptionModel: 'transcription-model',
        },
        async () => ({
          transcript: 'Different',
          costUsd: 0.01,
          debugLogId: null,
        })
      )
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('registers one immutable ordered manifest before voice chunk work', async () => {
    const redis = new MemoryRedis();
    const store = new AssistantPreparationStore(redis as never);
    const manifest = {
      chunks: [
        { audioSha256: 'first', mimeType: 'audio/webm' },
        { audioSha256: 'second', mimeType: 'audio/webm' },
      ],
      transcriptionModel: 'transcription-model',
    };

    await store.registerVoiceChunkManifest('user-1', 'voice-1', manifest);
    await store.registerVoiceChunkManifest('user-1', 'voice-1', manifest);
    await expect(
      store.registerVoiceChunkManifest('user-1', 'voice-1', {
        ...manifest,
        transcriptionModel: 'new-model',
      })
    ).resolves.toEqual(manifest);

    expect(
      redis.values.get('pomi:assistant-voice-chunk-manifest:{user-1}:voice-1')
    ).toBe(JSON.stringify(manifest));
    await expect(
      store.registerVoiceChunkManifest('user-1', 'voice-1', {
        ...manifest,
        chunks: manifest.chunks.slice(0, 1),
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an unsupported voice preparation envelope version', async () => {
    const redis = new MemoryRedis();
    const store = new AssistantPreparationStore(redis as never);
    await store.getOrCreateVoice(
      'user-1',
      'voice-version',
      { kind: 'transcript', transcript: 'Plan' },
      async () => preparedVoice('Plan')
    );
    const resultKey = [...redis.values.keys()].find(
      key =>
        key.includes('assistant-voice-preparation:') && !key.includes('-debug:')
    );
    const envelope = JSON.parse(String(redis.values.get(resultKey!)));
    redis.values.set(resultKey!, JSON.stringify({ ...envelope, version: 2 }));

    await expect(
      store.requireVoice('user-1', 'voice-version')
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects corrupt preparation object containers', async () => {
    const redis = new MemoryRedis();
    const store = new AssistantPreparationStore(redis as never);
    await store.getOrCreateVoice(
      'user-1',
      'voice-corrupt',
      { kind: 'transcript', transcript: 'Plan' },
      async () => preparedVoice('Plan')
    );
    const resultKey = [...redis.values.keys()].find(
      key =>
        key.includes('assistant-voice-preparation:') && !key.includes('-debug:')
    );
    const envelope = JSON.parse(String(redis.values.get(resultKey!)));
    redis.values.set(
      resultKey!,
      JSON.stringify({ ...envelope, prepared: null })
    );

    await expect(
      store.requireVoice('user-1', 'voice-corrupt')
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('stores one immutable voice commit result and reuses identical retries', async () => {
    const store = new AssistantPreparationStore(new MemoryRedis() as never);
    const committed = committedVoice('No safe action found.');

    await expect(
      store.putVoiceCommitResult('user-1', 'voice-1', committed)
    ).resolves.toEqual(committed);
    await expect(
      store.putVoiceCommitResult('user-1', 'voice-1', committed)
    ).resolves.toEqual(committed);
    await expect(
      store.requireVoiceCommitResult('user-1', 'voice-1')
    ).resolves.toEqual(committed);
    await expect(
      store.putVoiceCommitResult(
        'user-1',
        'voice-1',
        committedVoice('Different result')
      )
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires a committed voice result before finalization', async () => {
    const store = new AssistantPreparationStore(new MemoryRedis() as never);

    await expect(
      store.requireVoiceCommitResult('user-1', 'missing')
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
