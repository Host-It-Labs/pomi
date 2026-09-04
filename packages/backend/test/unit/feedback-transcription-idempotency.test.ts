import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantService } from '../../src/assistant/assistant.service';

describe('feedback transcription idempotency', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reuses the cached transcription for a repeated chunk key', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    const queryBuilder = {
      insert: vi.fn(),
      into: vi.fn(),
      values: vi.fn(),
      orIgnore: vi.fn(),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    Object.values(queryBuilder).forEach(method => {
      if (method !== queryBuilder.execute) method.mockReturnValue(queryBuilder);
    });
    const cached = new Map<string, unknown>();
    const preparationStore = {
      getOrCreateVoiceChunk: vi.fn(
        async (
          _userId: string,
          preparationId: string,
          _index: number,
          _input: unknown,
          create: () => Promise<unknown>
        ) => {
          if (!cached.has(preparationId)) {
            cached.set(preparationId, await create());
          }
          return cached.get(preparationId);
        }
      ),
    };
    const service = new AssistantService(
      {
        createQueryBuilder: () => queryBuilder,
        findOne: vi.fn().mockResolvedValue({
          id: 'default',
          transcriptionModel: 'openai/transcribe',
        }),
      } as never,
      {} as never,
      {
        getPreferences: vi.fn().mockResolvedValue({ language: 'en' }),
      } as never,
      preparationStore as never
    );
    const transcribe = vi.spyOn(service, 'transcribe').mockResolvedValue({
      text: 'Voice feedback',
      costUsd: 0.01,
      modelCall: undefined,
    } as never);
    const input = {
      audioBase64: 'audio-data',
      mimeType: 'audio/webm',
      idempotencyKey: '1224e9ce-aec9-4f59-92e7-97f694bbcb1c',
    };

    await expect(service.transcribeFeedback('user-1', input)).resolves.toEqual({
      transcript: 'Voice feedback',
      costUsd: 0.01,
    });
    await expect(service.transcribeFeedback('user-1', input)).resolves.toEqual({
      transcript: 'Voice feedback',
      costUsd: 0.01,
    });

    expect(transcribe).toHaveBeenCalledOnce();
    expect(preparationStore.getOrCreateVoiceChunk).toHaveBeenCalledTimes(2);
  });
});
