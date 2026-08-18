import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { AssistantCaptureService } from '../../src/assistant/assistant-capture.service';

const modelContent = JSON.stringify({
  tasks: [],
  reviewRequired: false,
  confidence: {
    title: 'high',
    dueDate: 'high',
    dueTime: 'high',
    recurrence: 'high',
    priority: 'high',
    intention: 'high',
  },
  unresolvedMetadata: [],
  timerAction: {
    action: 'pauseTimer',
    timerType: null,
    intentionSlugs: [],
    subIntentions: {},
  },
});

function createVoiceService(language: 'en' | 'fr') {
  let prepared: unknown;
  let committed: unknown;
  const voiceChunks = new Map<number, unknown>();
  let voiceChunkManifest: unknown;
  const assistantService = {
    prepareRequest: vi.fn(async () => ({
      settings: {
        textModel: 'text-model',
        transcriptionModel: 'transcription-model',
        speechModel: 'speech-model',
        speechVoice: 'voice',
      },
      preferences: { language },
      today: '2026-07-27',
    })),
    transcribe: vi.fn(async () => ({
      text: 'Pause the timer',
      costUsd: 0.01,
      modelCall: null,
    })),
    requestJson: vi.fn(async () => ({
      content: modelContent,
      costUsd: 0.02,
      modelCall: null,
    })),
    prepareVoiceCommitContext: vi.fn(async () => ({
      settings: { speechModel: 'speech-model', speechVoice: 'voice' },
      preferences: {
        assistantTaskTranscriptsEnabled: false,
        assistantTaskTranscriptMinWords: 5,
        taskDefaultDueDateMode: 'off',
        tasksExtension: true,
        language,
      },
      today: '2026-07-28',
    })),
    addSpokenAudio: vi.fn(async (_userId, _settings, result) => ({
      ...result,
      spokenAudioBase64: 'audio',
      spokenAudioMimeType: 'audio/mpeg',
    })),
  };
  const tasksService = {
    validateTaskCreation: vi.fn(),
    createPreparedTasks: vi.fn(),
  };
  const timerService = {
    getTimerByUserId: vi.fn(async () => null),
    pauseTimer: vi.fn(async () => ({ id: 'timer' })),
  };
  const intentionsService = {
    getActiveIntentionsForAssistant: vi.fn(async () => []),
  };
  const debugService = { recordLog: vi.fn(async () => null) };
  const preparationStore = {
    registerVoiceChunkManifest: vi.fn(async (_userId, _id, manifest) => {
      voiceChunkManifest = manifest;
      return manifest;
    }),
    getVoiceChunkManifest: vi.fn(async () => voiceChunkManifest),
    requireVoiceChunkManifest: vi.fn(async () => voiceChunkManifest),
    getOrCreateVoice: vi.fn(async (_userId, _id, _input, create) => {
      prepared = await create();
      return prepared;
    }),
    getOrCreateVoiceChunk: vi.fn(
      async (_userId, _id, index: number, _input, create) => {
        if (voiceChunks.has(index)) return voiceChunks.get(index);
        const chunk = await create();
        voiceChunks.set(index, chunk);
        return chunk;
      }
    ),
    requireVoiceChunk: vi.fn(async (_userId, _id, index: number) =>
      voiceChunks.get(index)
    ),
    requireVoice: vi.fn(async () => prepared),
    getVoiceCommitResult: vi.fn(async () => null),
    putVoiceCommitResult: vi.fn(async (_userId, _id, value) => {
      committed = value;
      return value;
    }),
    requireVoiceCommitResult: vi.fn(async () => committed),
  };
  const service = new AssistantCaptureService(
    assistantService as never,
    {} as never,
    tasksService as never,
    timerService as never,
    intentionsService as never,
    debugService as never,
    preparationStore as never,
    { list: vi.fn(async () => []) } as never
  );
  return {
    service,
    assistantService,
    tasksService,
    timerService,
    intentionsService,
    preparationStore,
  };
}

describe('Assistant voice phases', () => {
  it('keeps provider work outside the queued commit and resolves mutable state during commit', async () => {
    const context = createVoiceService('en');

    await context.service.prepareVoiceCommand('user-1', 'voice-1', {
      audioBase64: 'encoded-audio',
      mimeType: 'audio/webm',
    });

    expect(context.assistantService.transcribe).toHaveBeenCalledOnce();
    expect(context.assistantService.requestJson).toHaveBeenCalledOnce();
    expect(context.timerService.getTimerByUserId).not.toHaveBeenCalled();
    expect(context.timerService.pauseTimer).not.toHaveBeenCalled();

    const result = await context.service.commitPreparedVoiceCommand(
      'user-1',
      'voice-1'
    );

    expect(
      context.assistantService.prepareVoiceCommitContext
    ).toHaveBeenCalledOnce();
    expect(context.timerService.getTimerByUserId).toHaveBeenCalledOnce();
    expect(context.timerService.pauseTimer).toHaveBeenCalledOnce();
    expect(context.assistantService.transcribe).toHaveBeenCalledOnce();
    expect(context.assistantService.requestJson).toHaveBeenCalledOnce();
    expect(context.assistantService.addSpokenAudio).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      actions: ['pauseTimer'],
      message: 'Timer paused.',
      spokenAudioBase64: null,
    });
  });

  it('finalizes speech directly without storing generated audio', async () => {
    const context = createVoiceService('en');
    await context.service.prepareVoiceCommand('user-1', 'voice-1', {
      transcript: 'Pause the timer',
    });
    await context.service.commitPreparedVoiceCommand('user-1', 'voice-1');

    const result = await context.service.finalizePreparedVoiceCommand(
      'user-1',
      'voice-1'
    );

    expect(result.spokenAudioBase64).toBe('audio');
    expect(context.assistantService.addSpokenAudio).toHaveBeenCalledOnce();
    expect(context.preparationStore).not.toHaveProperty(
      'getOrCreateVoiceFinalResult'
    );
  });

  it('resumes multi-chunk preparation without retranscribing completed chunks', async () => {
    const context = createVoiceService('en');
    context.assistantService.transcribe
      .mockResolvedValueOnce({ text: 'Pause', costUsd: 0.01, modelCall: null })
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce({
        text: 'the timer',
        costUsd: 0.02,
        modelCall: null,
      });
    const audio = ['first-audio', 'second-audio'];
    const manifest = audio.map(audioBase64 => ({
      audioSha256: createHash('sha256').update(audioBase64).digest('hex'),
      mimeType: 'audio/webm',
    }));
    const chunk = (index: number) => ({
      preparationId: 'voice-chunks',
      index,
      audioBase64: audio[index],
      mimeType: 'audio/webm',
      debugLogId: null,
    });

    await context.service.registerVoiceChunks(
      'user-1',
      'voice-chunks',
      manifest
    );
    await expect(
      context.service.transcribeVoiceChunk('user-1', chunk(0))
    ).resolves.toMatchObject({ transcript: 'Pause', costUsd: 0.01 });
    await expect(
      context.service.transcribeVoiceChunk('user-1', chunk(1))
    ).rejects.toThrow('provider unavailable');
    await expect(
      context.service.transcribeVoiceChunk('user-1', chunk(0))
    ).resolves.toMatchObject({ transcript: 'Pause', costUsd: 0.01 });
    await expect(
      context.service.transcribeVoiceChunk('user-1', chunk(1))
    ).resolves.toMatchObject({ transcript: 'the timer', costUsd: 0.02 });
    await context.service.prepareVoiceChunks('user-1', 'voice-chunks');

    expect(context.assistantService.transcribe).toHaveBeenCalledTimes(3);
    expect(context.assistantService.requestJson).toHaveBeenCalledOnce();
    expect(
      context.preparationStore.getOrCreateVoiceChunk
    ).toHaveBeenCalledTimes(4);
    expect(
      context.preparationStore.registerVoiceChunkManifest
    ).toHaveBeenCalledOnce();
    await expect(
      context.service.commitPreparedVoiceCommand('user-1', 'voice-chunks')
    ).resolves.toMatchObject({
      transcript: 'Pause\n\nthe timer',
      costUsd: 0.05,
    });
  });

  it('uses the account language for voice timer responses', async () => {
    const context = createVoiceService('fr');

    await context.service.prepareVoiceCommand('user-1', 'voice-1', {
      transcript: 'Pause le minuteur',
    });

    const result = await context.service.commitPreparedVoiceCommand(
      'user-1',
      'voice-1'
    );

    expect(result.message).toBe('Minuteur mis en pause.');
  });
});
