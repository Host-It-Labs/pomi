import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { AssistantCaptureService } from '../../src/assistant/assistant-capture.service';
import { AssistantListRoutingService } from '../../src/assistant/assistant-list-routing.service';
import { AssistantVoiceReadbackService } from '../../src/assistant/assistant-voice-readback.service';

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
  const assistantListRoutingService = new AssistantListRoutingService();
  const assistantVoiceReadbackService = new AssistantVoiceReadbackService();
  const service = new AssistantCaptureService(
    assistantService as never,
    {} as never,
    tasksService as never,
    timerService as never,
    intentionsService as never,
    debugService as never,
    preparationStore as never,
    { list: vi.fn(async () => []) } as never,
    assistantListRoutingService,
    assistantVoiceReadbackService
  );
  return {
    service,
    assistantService,
    tasksService,
    timerService,
    intentionsService,
    preparationStore,
    assistantVoiceReadbackService,
  };
}

type VoiceReadbackTask = {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: string;
  timerType: string;
  intentionSlug: string | null;
  subIntentionSlug: string | null;
  recurrenceRule: string | null;
  recurrenceInterval: number | null;
  recurrenceAnchorMode: string;
};

type VoiceReadbackFormatter = {
  formatVoiceTasksCreatedMessage(
    tasks: VoiceReadbackTask[],
    drafts: Array<{ title: string }>,
    rawTasks: unknown[],
    sourceText: string,
    intentions: Array<{ slug: string; title: string }>,
    language: string
  ): string;
};

function formatVoiceReadback(
  context: ReturnType<typeof createVoiceService>,
  tasks: VoiceReadbackTask[],
  drafts: Array<{ title: string }>,
  rawTasks: unknown[],
  sourceText: string,
  intentions: Array<{ slug: string; title: string }>,
  language: 'en' | 'fr'
) {
  return (
    context.assistantVoiceReadbackService as unknown as VoiceReadbackFormatter
  ).formatVoiceTasksCreatedMessage(
    tasks,
    drafts,
    rawTasks,
    sourceText,
    intentions,
    language
  );
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

  it('reads back explicit Task metadata in the response language', () => {
    const context = createVoiceService('fr');
    const result = formatVoiceReadback(
      context,
      [
        {
          title: 'Préparer le rapport',
          dueDate: '2026-07-30',
          dueTime: '09:00',
          priority: 'high',
          timerType: 'break',
          intentionSlug: 'work',
          subIntentionSlug: 'email',
          recurrenceRule: 'RRULE:FREQ=WEEKLY;INTERVAL=2',
          recurrenceInterval: 2,
          recurrenceAnchorMode: 'completion',
        },
      ],
      [{ title: 'Préparer le rapport' }],
      [
        {
          title: 'Préparer le rapport',
          sourceSegments: [
            'Préparer le rapport demain à 9 h, priorité haute, répéter toutes les 2 semaines à partir de la fin pour Travail intention',
          ],
          dueDate: '2026-07-30',
          dueTime: '09:00',
          priority: 'high',
          timerType: 'break',
          intentionSlug: 'work',
          subIntentionSlug: 'email',
          recurrenceRule: 'RRULE:FREQ=WEEKLY;INTERVAL=2',
          recurrenceInterval: 2,
          recurrenceAnchorMode: 'completion',
        },
      ],
      'Préparer le rapport demain à 9 h, priorité haute, répéter toutes les 2 semaines à partir de la fin pour Travail intention',
      [
        { slug: 'work', title: 'Travail' },
        { slug: 'email', title: 'Email' },
      ],
      'fr'
    );

    expect(result).toContain('Tâche créée : Préparer le rapport');
    expect(result).toContain('pour le 2026-07-30');
    expect(result).toContain('à 09:00');
    expect(result).toContain('répète');
    expect(result).toContain('priorité haute');
    expect(result).toContain('minuteur de pause');
    expect(result).toContain('intention Travail');
    expect(result).toContain('sous-intention Email');
    expect(result).not.toContain('high priority');
  });

  it('suppresses inherited, inferred, and database-default metadata', () => {
    const context = createVoiceService('en');
    const result = formatVoiceReadback(
      context,
      [
        {
          title: 'Review the release',
          dueDate: '2026-07-29',
          dueTime: '10:00',
          priority: 'normal',
          timerType: 'work',
          intentionSlug: 'focus',
          subIntentionSlug: null,
          recurrenceRule: 'RRULE:FREQ=DAILY',
          recurrenceInterval: 1,
          recurrenceAnchorMode: 'planned',
        },
      ],
      [{ title: 'Review the release' }],
      [
        {
          title: 'Review the release',
          sourceSegments: ['Review the release'],
        },
      ],
      'Review the release',
      [{ slug: 'focus', title: 'Focus' }],
      'en'
    );

    expect(result).toBe('Task created: Review the release');
  });

  it('keeps an explicit recurrence while suppressing its invariant due date', () => {
    const context = createVoiceService('en');
    const result = formatVoiceReadback(
      context,
      [
        {
          title: 'Review the release',
          dueDate: '2026-07-29',
          dueTime: null,
          priority: 'normal',
          timerType: 'work',
          intentionSlug: null,
          subIntentionSlug: null,
          recurrenceRule: 'RRULE:FREQ=WEEKLY',
          recurrenceInterval: 1,
          recurrenceAnchorMode: 'planned',
        },
      ],
      [{ title: 'Review the release' }],
      [
        {
          title: 'Review the release',
          sourceSegments: ['Review the release every week'],
          recurrenceRule: 'RRULE:FREQ=WEEKLY',
        },
      ],
      'Review the release every week',
      [],
      'en'
    );

    expect(result).toContain('repeats weekly');
    expect(result).not.toContain('due 2026-07-29');
  });
});
