import { BadRequestException, Injectable } from '@nestjs/common';
import {
  TASK_CREATION_SOURCES,
  TIMER_TYPES,
  normalizeAppLanguage,
  AssistantDebugProcessedOutput,
  AssistantDebugModelCall,
  AssistantDebugTimings,
  AssistantTaskCreationResult,
  AssistantTranscriptionResult,
  AssistantVoiceAction,
  AssistantVoiceCommandResult,
  TaskCreationSource,
  Timer,
  TimerTypes,
  Preferences,
  ListItem,
} from '@pomi/shared';
import { createHash } from 'node:crypto';
import { Intention } from '../intentions/intentions.entity';
import { IntentionsService } from '../intentions/intentions.service';
import { ListsService } from '../lists/lists.service';
import { PreferencesService } from '../preferences/preferences.service';
import { TaskEntity } from '../tasks/tasks.entity';
import {
  type PreparedTaskCreation,
  TasksService,
} from '../tasks/tasks.service';
import { TimerService } from '../timer/timer.service';
import { AssistantDebugService } from './assistant-debug.service';
import {
  AssistantInputInterpreter,
  AssistantInterpretationError,
  AssistantTaskDefaults,
  ParsedTaskDraft,
  ParsedTimerCommand,
} from './assistant-input-interpreter';
import {
  AssistantModelRequestError,
  type AssistantModelRequestOptions,
} from './assistant-input-types';
import { AssistantListRoutingService } from './assistant-list-routing.service';
import { elapsedMs } from './assistant-timing';
import { AssistantService } from './assistant.service';
import { AssistantVoiceReadbackService } from './assistant-voice-readback.service';
import { translateAssistant } from '../i18n/assistant-localization';
import {
  type AssistantVoicePreparationInput,
  type AssistantVoiceCommitResult,
  type CommittedAssistantVoiceCapture,
  type PreparedAssistantTaskCapture,
  type PreparedAssistantVoiceCapture,
  AssistantPreparationStore,
} from './assistant-task-preparation.store';

type AssistantVoiceInput = {
  audioBase64?: string;
  mimeType?: string;
  transcript?: string;
  transcriptionCostUsd?: number;
  debugLogId?: string | null;
  transcriptionModelCalls?: AssistantDebugModelCall[];
};

@Injectable()
export class AssistantCaptureService {
  private readonly inputInterpreter = new AssistantInputInterpreter();
  private readonly voiceFinalizations = new Map<
    string,
    Promise<AssistantVoiceCommandResult>
  >();

  constructor(
    private readonly assistantService: AssistantService,
    private readonly preferencesService: PreferencesService,
    private readonly tasksService: TasksService,
    private readonly timerService: TimerService,
    private readonly intentionsService: IntentionsService,
    private readonly assistantDebugService: AssistantDebugService,
    private readonly taskPreparationStore: AssistantPreparationStore,
    private readonly listsService: ListsService,
    private readonly assistantListRoutingService: AssistantListRoutingService,
    private readonly assistantVoiceReadbackService: AssistantVoiceReadbackService
  ) {}

  async createTaskFromText(
    userId: string,
    text: string,
    defaults?: AssistantTaskDefaults,
    debugLogId?: string | null,
    listId?: string | null
  ): Promise<AssistantTaskCreationResult> {
    const prepared = await this.prepareTaskCapture(
      userId,
      text,
      defaults,
      debugLogId,
      listId
    );
    return this.commitTaskCapture(userId, prepared, listId);
  }

  async prepareTaskFromText(
    userId: string,
    preparationId: string,
    text: string,
    defaults?: AssistantTaskDefaults,
    debugLogId?: string | null,
    listId?: string | null
  ): Promise<{ preparationId: string }> {
    const normalizedText = this.normalizeUserText(text);
    if (!normalizedText) {
      const preferences = await this.preferencesService.getPreferences(userId);
      throw new BadRequestException(
        translateAssistant(preferences.language, 'assistantTextRequired')
      );
    }
    await this.taskPreparationStore.getOrCreateTask(
      userId,
      preparationId,
      {
        text: normalizedText,
        listId,
        defaults,
        debugLogId: debugLogId ?? null,
      },
      () =>
        this.prepareTaskCapture(
          userId,
          normalizedText,
          defaults,
          debugLogId,
          listId
        )
    );
    return { preparationId };
  }

  async commitPreparedTaskFromText(
    userId: string,
    preparationId: string,
    listId?: string | null
  ): Promise<AssistantTaskCreationResult> {
    const prepared = await this.taskPreparationStore.requireTask(
      userId,
      preparationId
    );
    return this.commitTaskCapture(userId, prepared, listId);
  }

  private async prepareTaskCapture(
    userId: string,
    text: string,
    defaults?: AssistantTaskDefaults,
    debugLogId?: string | null,
    listId?: string | null
  ): Promise<PreparedAssistantTaskCapture> {
    const normalizedText = this.normalizeUserText(text);
    if (!normalizedText) {
      const preferences = await this.preferencesService.getPreferences(userId);
      throw new BadRequestException(
        translateAssistant(preferences.language, 'assistantTextRequired')
      );
    }
    const totalStartedAt = performance.now();
    const timings: AssistantDebugTimings = {};
    let processedOutput: AssistantDebugProcessedOutput | null = null;
    let resolutionNotes: string[] = [];
    let modelCalls: AssistantDebugModelCall[] = [];
    const usagePersistence: Promise<void>[] = [];

    try {
      const [runtime, intentions, lists] = await this.measureDebugStage(
        timings,
        'contextMs',
        async () =>
          Promise.all([
            this.assistantService.prepareRequest(userId, 'taskCapture'),
            this.getActiveIntentions(userId),
            this.listsService.list(userId, false),
          ])
      );
      const { preferences } = runtime;
      const interpreted = await this.inputInterpreter.interpret({
        mode: 'taskCapture',
        text: normalizedText,
        today: runtime.today,
        accountLanguage: preferences.language,
        intentions: this.formatCaptureIntentions(intentions),
        defaults,
        taskTranscriptEnabled: preferences.assistantTaskTranscriptsEnabled,
        taskTranscriptMinWords: preferences.assistantTaskTranscriptMinWords,
        requestJson: async (
          messages,
          options: AssistantModelRequestOptions
        ) => {
          const response = await this.assistantService.requestJson(
            userId,
            runtime.settings.textModel,
            messages,
            options,
            runtime.today
          );
          if (response.usagePersistence) {
            usagePersistence.push(response.usagePersistence);
          }
          return response;
        },
      });
      Object.assign(timings, interpreted.timings);
      modelCalls = interpreted.modelCalls;
      const routedTaskDrafts = listId
        ? this.assistantListRoutingService.routeSelectedListItems(
            interpreted.tasks,
            normalizedText,
            listId,
            preferences.listsExtension ? lists : [],
            preferences.language
          )
        : this.assistantListRoutingService.routeExplicitListItems(
            interpreted.tasks,
            normalizedText,
            preferences.listsExtension ? lists : [],
            preferences.language
          );
      const taskDrafts = this.applyDefaultDueDates(
        routedTaskDrafts,
        preferences,
        runtime.today
      );
      processedOutput = { tasks: taskDrafts };
      resolutionNotes = interpreted.resolutionNotes;
      await Promise.all(usagePersistence);
      return {
        normalizedText,
        listId,
        responseLanguage: interpreted.responseLanguage,
        debugLogId: debugLogId ?? null,
        taskDrafts,
        usedFallback: interpreted.usedFallback,
        invalidParserOutput: interpreted.invalidParserOutput,
        interpretationError: interpreted.error,
        resolutionNotes,
        modelCalls,
        timings,
        preparationMs: elapsedMs(totalStartedAt),
        costUsd: interpreted.costUsd,
      };
    } catch (error) {
      await Promise.allSettled(usagePersistence);
      const diagnostics = this.readInterpretationDiagnostics(error);
      if (diagnostics?.modelCalls) {
        modelCalls = [...modelCalls, ...diagnostics.modelCalls];
      }
      this.appendModelCall(modelCalls, error);
      Object.assign(timings, diagnostics?.timings);
      timings.totalMs = elapsedMs(totalStartedAt);
      await this.assistantDebugService.recordLog(userId, {
        kind: 'taskCapture',
        source: debugLogId ? 'dictation' : 'typed',
        status: 'failed',
        debugLogId,
        userPrompt: normalizedText,
        processedOutput,
        invalidParserOutput: diagnostics?.invalidParserOutput ?? null,
        resolutionNotes,
        modelCalls,
        timings,
        error: this.formatError(error),
      });
      throw error;
    }
  }

  private async commitTaskCapture(
    userId: string,
    prepared: PreparedAssistantTaskCapture,
    listId?: string | null
  ): Promise<AssistantTaskCreationResult> {
    const commitStartedAt = performance.now();
    const timings = { ...prepared.timings };
    try {
      const preferences = await this.preferencesService.getPreferences(userId);
      const messageLanguage =
        normalizeAppLanguage(prepared.responseLanguage) ?? preferences.language;
      const listsEnabled = preferences.listsExtension === true;
      const preparedListId = prepared.listId ?? null;
      const requestedListId = listId ?? null;
      if (preparedListId !== requestedListId) {
        throw new BadRequestException(
          translateAssistant(preferences.language, 'listDestinationUnavailable')
        );
      }
      if (
        !listsEnabled &&
        prepared.taskDrafts.some(draft => Boolean(draft.listId))
      ) {
        throw new BadRequestException(
          translateAssistant(preferences.language, 'listDestinationUnavailable')
        );
      }
      if (
        preparedListId &&
        prepared.taskDrafts.some(draft => draft.listId !== preparedListId)
      ) {
        throw new BadRequestException(
          translateAssistant(preferences.language, 'listDestinationUnavailable')
        );
      }
      const taskDrafts = prepared.taskDrafts
        .filter(draft => !draft.listId || !listsEnabled)
        .map(draft => (listsEnabled ? draft : { ...draft, listId: null }));
      const listDrafts = listsEnabled
        ? prepared.taskDrafts.filter(draft => draft.listId)
        : [];
      const preparedTasks = await this.measureDebugStage(
        timings,
        'validationMs',
        () =>
          this.validateTaskBatch(
            userId,
            taskDrafts,
            TASK_CREATION_SOURCES.ASSISTANT
          )
      );
      const tasks = await this.measureDebugStage(
        timings,
        'taskCreationMs',
        () => this.createTasks(preparedTasks)
      );
      const listItems = await this.measureDebugStage(
        timings,
        'taskCreationMs',
        () =>
          this.createListItems(
            userId,
            listDrafts,
            TASK_CREATION_SOURCES.ASSISTANT
          )
      );
      timings.totalMs = prepared.preparationMs + elapsedMs(commitStartedAt);
      void this.assistantDebugService
        .recordLog(userId, {
          kind: 'taskCapture',
          source: prepared.debugLogId ? 'dictation' : 'typed',
          status: prepared.usedFallback ? 'fallback' : 'succeeded',
          debugLogId: prepared.debugLogId,
          userPrompt: prepared.normalizedText,
          processedOutput: { tasks: prepared.taskDrafts },
          invalidParserOutput: prepared.invalidParserOutput,
          resolutionNotes: prepared.resolutionNotes,
          modelCalls: prepared.modelCalls,
          timings,
          error: prepared.interpretationError,
        })
        .catch(() => undefined);
      return {
        tasks: tasks.map(task => this.formatTask(task)),
        listItems: listItems.map(item => this.formatListItem(item)),
        usedFallback: prepared.usedFallback,
        message: prepared.usedFallback
          ? translateAssistant(messageLanguage, 'taskCreatedFallback')
          : this.formatCreatedItemsMessage(tasks, listItems, messageLanguage),
        costUsd: prepared.costUsd,
      };
    } catch (error) {
      timings.totalMs = prepared.preparationMs + elapsedMs(commitStartedAt);
      await this.assistantDebugService
        .recordLog(userId, {
          kind: 'taskCapture',
          source: prepared.debugLogId ? 'dictation' : 'typed',
          status: 'failed',
          debugLogId: prepared.debugLogId,
          userPrompt: prepared.normalizedText,
          processedOutput: { tasks: prepared.taskDrafts },
          invalidParserOutput: prepared.invalidParserOutput,
          resolutionNotes: prepared.resolutionNotes,
          modelCalls: prepared.modelCalls,
          timings,
          error: this.formatError(error),
        })
        .catch(() => undefined);
      throw error;
    }
  }

  async transcribeTaskInput(
    userId: string,
    input: {
      audioBase64: string;
      mimeType: string;
      debugLogId?: string | null;
    }
  ): Promise<AssistantTranscriptionResult> {
    const totalStartedAt = performance.now();
    const timings: AssistantDebugTimings = {};
    const modelCalls: AssistantDebugModelCall[] = [];
    try {
      const runtime = await this.measureDebugStage(timings, 'contextMs', () =>
        this.assistantService.prepareRequest(userId, 'dictation')
      );
      const transcription = await this.measureDebugStage(
        timings,
        'transcriptionMs',
        () => this.assistantService.transcribe(userId, input, runtime.settings)
      );
      if (transcription.modelCall) {
        modelCalls.push(transcription.modelCall);
      }
      timings.totalMs = elapsedMs(totalStartedAt);
      const debugLogId = await this.assistantDebugService.recordLog(userId, {
        kind: 'taskCapture',
        source: 'dictation',
        status: 'dictated',
        debugLogId: input.debugLogId,
        userPrompt: transcription.text.trim(),
        modelCalls,
        timings,
      });
      return {
        transcript: transcription.text.trim(),
        costUsd: transcription.costUsd,
        debugLogId,
      };
    } catch (error) {
      this.appendModelCall(modelCalls, error);
      timings.totalMs = elapsedMs(totalStartedAt);
      await this.assistantDebugService.recordLog(userId, {
        kind: 'taskCapture',
        source: 'dictation',
        status: 'failed',
        debugLogId: input.debugLogId,
        modelCalls,
        timings,
        error: this.formatError(error),
      });
      throw error;
    }
  }

  async transcribeVoiceChunk(
    userId: string,
    input: {
      preparationId: string;
      index: number;
      audioBase64: string;
      mimeType: string;
      debugLogId?: string | null;
    }
  ): Promise<AssistantTranscriptionResult> {
    const manifest = await this.taskPreparationStore.requireVoiceChunkManifest(
      userId,
      input.preparationId
    );
    const expected = manifest.chunks[input.index];
    const audioSha256 = createHash('sha256')
      .update(input.audioBase64)
      .digest('hex');
    if (
      !expected ||
      expected.audioSha256 !== audioSha256 ||
      expected.mimeType !== input.mimeType
    ) {
      const preferences = await this.preferencesService.getPreferences(userId);
      throw new BadRequestException(
        translateAssistant(preferences.language, 'voiceChunkManifestMismatch')
      );
    }
    const chunk = await this.taskPreparationStore.getOrCreateVoiceChunk(
      userId,
      input.preparationId,
      input.index,
      {
        audioSha256,
        mimeType: input.mimeType,
        transcriptionModel: manifest.transcriptionModel,
        debugLogId: input.debugLogId,
      },
      async () => {
        const runtime = await this.assistantService.prepareRequest(
          userId,
          'voiceCommand'
        );
        const transcription = await this.assistantService.transcribe(
          userId,
          {
            audioBase64: input.audioBase64,
            mimeType: input.mimeType,
          },
          {
            ...runtime.settings,
            transcriptionModel: manifest.transcriptionModel,
          }
        );
        return {
          transcript: transcription.text.trim(),
          costUsd: transcription.costUsd,
          debugLogId: input.debugLogId ?? null,
          modelCall: transcription.modelCall,
        };
      }
    );
    return {
      transcript: chunk.transcript,
      costUsd: chunk.costUsd,
      debugLogId: chunk.debugLogId,
    };
  }

  async registerVoiceChunks(
    userId: string,
    preparationId: string,
    chunks: Array<{ audioSha256: string; mimeType: string }>
  ): Promise<{ preparationId: string }> {
    const existing = await this.taskPreparationStore.getVoiceChunkManifest(
      userId,
      preparationId
    );
    if (existing) {
      await this.taskPreparationStore.registerVoiceChunkManifest(
        userId,
        preparationId,
        { chunks, transcriptionModel: existing.transcriptionModel }
      );
      return { preparationId };
    }
    const runtime = await this.assistantService.prepareRequest(
      userId,
      'voiceCommand'
    );
    if (!runtime.settings.transcriptionModel) {
      throw new BadRequestException(
        translateAssistant(
          runtime.preferences.language,
          'assistantTranscriptionModelRequired'
        )
      );
    }
    await this.taskPreparationStore.registerVoiceChunkManifest(
      userId,
      preparationId,
      {
        chunks,
        transcriptionModel: runtime.settings.transcriptionModel,
      }
    );
    return { preparationId };
  }

  async prepareVoiceChunks(
    userId: string,
    preparationId: string
  ): Promise<{ preparationId: string }> {
    const manifest = await this.taskPreparationStore.requireVoiceChunkManifest(
      userId,
      preparationId
    );
    const chunks = await Promise.all(
      manifest.chunks.map((_, index) =>
        this.taskPreparationStore.requireVoiceChunk(
          userId,
          preparationId,
          index
        )
      )
    );
    const transcript = chunks
      .map(chunk => chunk.transcript.trim())
      .filter(Boolean)
      .join('\n\n');
    if (!transcript) {
      const preferences = await this.preferencesService.getPreferences(userId);
      throw new BadRequestException(
        translateAssistant(preferences.language, 'noSpeechDetected')
      );
    }
    return this.prepareVoiceCommand(userId, preparationId, {
      transcript,
      transcriptionCostUsd: chunks.reduce(
        (total, chunk) => total + chunk.costUsd,
        0
      ),
      debugLogId: chunks[chunks.length - 1]?.debugLogId ?? null,
      transcriptionModelCalls: chunks.flatMap(chunk =>
        chunk.modelCall ? [chunk.modelCall] : []
      ),
    });
  }

  async prepareVoiceCommand(
    userId: string,
    preparationId: string,
    input: AssistantVoiceInput
  ): Promise<{ preparationId: string }> {
    const preparationInput = this.voicePreparationInput(input);
    if (!preparationInput) {
      const preferences = await this.preferencesService.getPreferences(userId);
      throw new BadRequestException(
        translateAssistant(preferences.language, 'voiceInputRequired')
      );
    }
    await this.taskPreparationStore.getOrCreateVoice(
      userId,
      preparationId,
      preparationInput,
      () => this.prepareVoiceCapture(userId, input)
    );
    return { preparationId };
  }

  async commitPreparedVoiceCommand(
    userId: string,
    preparationId: string
  ): Promise<AssistantVoiceCommandResult> {
    const existing = await this.taskPreparationStore.getVoiceCommitResult(
      userId,
      preparationId
    );
    if (existing) return existing.result;
    const prepared = await this.taskPreparationStore.requireVoice(
      userId,
      preparationId
    );
    const committed = await this.commitVoiceCapture(
      userId,
      prepared,
      preparationId
    );
    return committed.result;
  }

  async getPreparedVoiceCommitResult(
    userId: string,
    preparationId: string
  ): Promise<AssistantVoiceCommandResult | null> {
    const committed = await this.taskPreparationStore.getVoiceCommitResult(
      userId,
      preparationId
    );
    return committed?.result ?? null;
  }

  async finalizePreparedVoiceCommand(
    userId: string,
    preparationId: string
  ): Promise<AssistantVoiceCommandResult> {
    const key = `${userId}:${preparationId}`;
    const running = this.voiceFinalizations.get(key);
    if (running) return running;
    const finalization = this.finalizeVoiceCommand(userId, preparationId);
    this.voiceFinalizations.set(key, finalization);
    try {
      return await finalization;
    } finally {
      if (this.voiceFinalizations.get(key) === finalization) {
        this.voiceFinalizations.delete(key);
      }
    }
  }

  private async finalizeVoiceCommand(
    userId: string,
    preparationId: string
  ): Promise<AssistantVoiceCommandResult> {
    const committed = await this.taskPreparationStore.requireVoiceCommitResult(
      userId,
      preparationId
    );
    return this.assistantService.addSpokenAudio(
      userId,
      {
        speechModel: committed.speechModel,
        speechVoice: committed.speechVoice,
      },
      committed.result
    );
  }

  private async prepareVoiceCapture(
    userId: string,
    input: AssistantVoiceInput
  ): Promise<PreparedAssistantVoiceCapture> {
    const totalStartedAt = performance.now();
    const timings: AssistantDebugTimings = {};
    let transcript = '';
    const transcriptionModelCalls: AssistantDebugModelCall[] = [
      ...(input.transcriptionModelCalls ?? []),
    ];
    const usagePersistence: Promise<void>[] = [];

    try {
      const [runtime, intentions] = await this.measureDebugStage(
        timings,
        'contextMs',
        async () =>
          Promise.all([
            this.assistantService.prepareRequest(userId, 'voiceCommand'),
            this.getActiveIntentions(userId),
          ])
      );
      if (
        input.transcript === undefined &&
        (!input.audioBase64 || !input.mimeType)
      ) {
        throw new BadRequestException(
          translateAssistant(runtime.preferences.language, 'voiceInputRequired')
        );
      }
      const transcription =
        input.transcript !== undefined
          ? { text: input.transcript, costUsd: input.transcriptionCostUsd ?? 0 }
          : await this.measureDebugStage(timings, 'transcriptionMs', () =>
              this.assistantService.transcribe(
                userId,
                {
                  audioBase64: input.audioBase64 as string,
                  mimeType: input.mimeType as string,
                },
                runtime.settings
              )
            );
      transcript = transcription.text.trim();
      if ('modelCall' in transcription && transcription.modelCall) {
        transcriptionModelCalls.push(transcription.modelCall);
      }
      const interpretation = transcript
        ? await this.inputInterpreter.prepare({
            mode: 'voiceCommand',
            text: transcript,
            today: runtime.today,
            accountLanguage: runtime.preferences.language,
            intentions: this.formatCaptureIntentions(intentions),
            requestJson: async (
              messages,
              options: AssistantModelRequestOptions
            ) => {
              const response = await this.assistantService.requestJson(
                userId,
                runtime.settings.textModel,
                messages,
                options,
                runtime.today
              );
              if (response.usagePersistence) {
                usagePersistence.push(response.usagePersistence);
              }
              return response;
            },
          })
        : this.emptyVoiceInterpretation(runtime.preferences.language);
      await Promise.all(usagePersistence);
      return {
        transcript,
        debugLogId: input.debugLogId ?? null,
        interpretation,
        transcriptionCostUsd: transcription.costUsd,
        transcriptionModelCalls,
        timings,
        preparationMs: elapsedMs(totalStartedAt),
      };
    } catch (error) {
      await Promise.allSettled(usagePersistence);
      const diagnostics = this.readInterpretationDiagnostics(error);
      if (diagnostics?.modelCalls) {
        transcriptionModelCalls.push(...diagnostics.modelCalls);
      }
      this.appendModelCall(transcriptionModelCalls, error);
      Object.assign(timings, diagnostics?.timings);
      timings.totalMs = elapsedMs(totalStartedAt);
      await this.assistantDebugService.recordLog(userId, {
        kind: 'voiceCommand',
        source: 'assistantVoice',
        status: 'failed',
        debugLogId: input.debugLogId,
        userPrompt: transcript || null,
        invalidParserOutput: diagnostics?.invalidParserOutput ?? null,
        modelCalls: transcriptionModelCalls,
        timings,
        error: this.formatError(error),
      });
      throw error;
    }
  }

  private async commitVoiceCapture(
    userId: string,
    prepared: PreparedAssistantVoiceCapture,
    preparationId?: string
  ): Promise<CommittedAssistantVoiceCapture> {
    const commitStartedAt = performance.now();
    const timings = {
      ...prepared.timings,
      ...prepared.interpretation.timings,
    };
    let processedOutput: AssistantDebugProcessedOutput | null = null;
    let resolutionNotes: string[] = [];
    try {
      const [runtime, intentions, currentTimer, lists] =
        await this.measureDebugStage(timings, 'contextMs', async () =>
          Promise.all([
            this.assistantService.prepareVoiceCommitContext(userId),
            this.getActiveIntentions(userId),
            this.timerService.getTimerByUserId(userId),
            this.listsService.list(userId, false),
          ])
        );
      const { preferences } = runtime;
      const responseLanguage =
        prepared.interpretation.responseLanguage || preferences.language;
      const messageLanguage =
        normalizeAppLanguage(responseLanguage) ?? preferences.language;
      const interpreted = this.inputInterpreter.resolve(
        {
          today: runtime.today,
          accountLanguage: preferences.language,
          intentions: this.formatCaptureIntentions(intentions),
          defaults: this.getVoiceTaskDefaults(currentTimer),
          taskTranscriptEnabled: preferences.assistantTaskTranscriptsEnabled,
          taskTranscriptMinWords: preferences.assistantTaskTranscriptMinWords,
        },
        prepared.interpretation
      );
      Object.assign(timings, interpreted.timings);
      const routedTaskDrafts =
        this.assistantListRoutingService.routeExplicitListItems(
          interpreted.tasks,
          prepared.transcript,
          preferences.listsExtension ? lists : [],
          preferences.language
        );
      const taskDrafts = this.applyDefaultDueDates(
        routedTaskDrafts,
        preferences,
        runtime.today
      );
      processedOutput = {
        tasks: taskDrafts,
        timerCommand: interpreted.timerCommand,
      };
      resolutionNotes = interpreted.resolutionNotes;
      const costUsd = prepared.transcriptionCostUsd + interpreted.costUsd;
      const actions: AssistantVoiceAction[] = [];
      const messages: string[] = [];
      const tasks: TaskEntity[] = [];
      const listItems: TaskEntity[] = [];

      if (taskDrafts.length > 0) {
        if (!preferences.tasksExtension) {
          messages.push(translateAssistant(messageLanguage, 'tasksOff'));
        } else {
          const regularDrafts = taskDrafts.filter(draft => !draft.listId);
          const listDrafts = taskDrafts.filter(draft => draft.listId);
          const preparedTasks = await this.measureDebugStage(
            timings,
            'validationMs',
            () =>
              this.validateTaskBatch(
                userId,
                regularDrafts,
                TASK_CREATION_SOURCES.VOICE
              )
          );
          tasks.push(
            ...(await this.measureDebugStage(timings, 'taskCreationMs', () =>
              this.createTasks(preparedTasks)
            ))
          );
          listItems.push(
            ...(await this.measureDebugStage(timings, 'taskCreationMs', () =>
              this.createListItems(
                userId,
                listDrafts,
                TASK_CREATION_SOURCES.VOICE
              )
            ))
          );
          if (tasks.length > 0) {
            actions.push('createTask');
            messages.push(
              this.assistantVoiceReadbackService.formatVoiceTasksCreatedMessage(
                tasks,
                regularDrafts,
                prepared.interpretation.rawTasks,
                prepared.transcript,
                intentions,
                messageLanguage,
                runtime.today
              )
            );
          }
          if (listItems.length > 0) {
            actions.push('createListItem');
            messages.push(
              this.formatListItemsCreatedMessage(listItems, messageLanguage)
            );
          }
        }
      }

      if (interpreted.timerCommand.action !== 'none') {
        const timerResult = await this.measureDebugStage(
          timings,
          'timerActionMs',
          () =>
            this.executeTimerCommand(
              userId,
              interpreted.timerCommand,
              messageLanguage
            )
        );
        if (timerResult.succeeded)
          actions.push(interpreted.timerCommand.action);
        messages.push(timerResult.message);
      }
      if (actions.length === 0) actions.push('none');

      const result: AssistantVoiceCommitResult = {
        actions,
        transcript: prepared.transcript,
        message: !prepared.transcript
          ? translateAssistant(messageLanguage, 'noSpeechDetected')
          : messages.length > 0
            ? messages.join(' ')
            : translateAssistant(messageLanguage, 'noSafeAction'),
        tasks: tasks.map(task => this.formatTask(task)),
        listItems: listItems.map(item => this.formatListItem(item)),
        usedFallback: false,
        costUsd,
        spokenAudioBase64: null,
        spokenAudioMimeType: null,
        responseLanguage,
      };
      timings.totalMs = prepared.preparationMs + elapsedMs(commitStartedAt);
      const committed = {
        version: 1 as const,
        result,
        debugLogId: prepared.debugLogId,
        speechModel: runtime.settings.speechModel,
        speechVoice: runtime.settings.speechVoice,
      };
      const stored = preparationId
        ? this.taskPreparationStore.putVoiceCommitResult(
            userId,
            preparationId,
            committed
          )
        : committed;
      const durableCommit = await stored;
      void this.assistantDebugService
        .recordLog(userId, {
          kind: 'voiceCommand',
          source: 'assistantVoice',
          status: 'succeeded',
          debugLogId: prepared.debugLogId,
          userPrompt: prepared.transcript,
          processedOutput,
          resolutionNotes,
          modelCalls: [
            ...prepared.transcriptionModelCalls,
            ...prepared.interpretation.modelCalls,
          ],
          timings,
        })
        .catch(() => undefined);
      return durableCommit;
    } catch (error) {
      timings.totalMs = prepared.preparationMs + elapsedMs(commitStartedAt);
      await this.assistantDebugService.recordLog(userId, {
        kind: 'voiceCommand',
        source: 'assistantVoice',
        status: 'failed',
        debugLogId: prepared.debugLogId,
        userPrompt: prepared.transcript || null,
        processedOutput,
        invalidParserOutput: prepared.interpretation.invalidParserOutput,
        resolutionNotes,
        modelCalls: [
          ...prepared.transcriptionModelCalls,
          ...prepared.interpretation.modelCalls,
        ],
        timings,
        error: this.formatError(error),
      });
      throw error;
    }
  }

  private voicePreparationInput(
    input: AssistantVoiceInput
  ): AssistantVoicePreparationInput | null {
    if (input.transcript !== undefined) {
      return {
        kind: 'transcript',
        transcript: input.transcript.trim().slice(0, 1_000_000),
        transcriptionCostUsd: input.transcriptionCostUsd ?? 0,
        debugLogId: input.debugLogId ?? null,
      };
    }
    if (!input.audioBase64 || !input.mimeType) {
      return null;
    }
    return {
      kind: 'audio',
      audioSha256: createHash('sha256').update(input.audioBase64).digest('hex'),
      mimeType: input.mimeType,
      debugLogId: input.debugLogId ?? null,
    };
  }

  private emptyVoiceInterpretation(
    language: string | null | undefined
  ): PreparedAssistantVoiceCapture['interpretation'] {
    return {
      mode: 'voiceCommand',
      text: '',
      parsed: {
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
          action: 'none',
          timerType: null,
          intentionSlugs: [],
          subIntentions: {},
        },
      },
      rawTasks: [],
      costUsd: 0,
      invalidParserOutput: null,
      modelFailure: null,
      modelCalls: [],
      timings: {},
      responseLanguage: language ?? 'en',
    };
  }

  private async validateTaskBatch(
    userId: string,
    drafts: ParsedTaskDraft[],
    creationSource: TaskCreationSource
  ): Promise<PreparedTaskCreation[]> {
    const preparedTasks: PreparedTaskCreation[] = [];
    for (const draft of drafts) {
      preparedTasks.push(
        await this.tasksService.validateTaskCreation(
          this.buildTaskInput(userId, draft, creationSource)
        )
      );
    }
    return preparedTasks;
  }

  private async createTasks(preparedTasks: PreparedTaskCreation[]) {
    return this.tasksService.createPreparedTasks(preparedTasks);
  }

  private createListItems(
    userId: string,
    drafts: ParsedTaskDraft[],
    creationSource: TaskCreationSource
  ) {
    return Promise.all(
      drafts.map(draft =>
        this.listsService.createItem(userId, draft.listId!, {
          title: draft.title,
          dueDate: draft.dueDate ?? null,
          priority: draft.priority,
          creationSource,
        })
      )
    );
  }

  private formatListItem(item: TaskEntity): ListItem {
    return {
      id: item.id,
      userId: item.userId,
      listId: item.listId!,
      title: item.title,
      dueDate: item.dueDate,
      priority: item.priority,
      status: item.status,
      manualOrder: item.manualOrder,
      manualOrderOverride: item.manualOrderOverride,
      itemKind: 'listItem',
      vacationEligible: item.vacationEligible,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private formatCreatedItemsMessage(
    tasks: TaskEntity[],
    listItems: TaskEntity[],
    language: string | null | undefined
  ) {
    return [
      tasks.length ? this.formatTasksCreatedMessage(tasks, language) : '',
      listItems.length
        ? this.formatListItemsCreatedMessage(listItems, language)
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  private formatListItemsCreatedMessage(
    items: TaskEntity[],
    language: string | null | undefined
  ) {
    return items.length === 1
      ? translateAssistant(language, 'listItemAdded', {
          title: items[0].title,
        })
      : translateAssistant(language, 'listItemsAdded', { count: items.length });
  }

  private buildTaskInput(
    userId: string,
    draft: ParsedTaskDraft,
    creationSource: TaskCreationSource
  ) {
    return {
      userId,
      title: draft.title,
      description: draft.description,
      sourceTranscript: draft.sourceTranscript ?? null,
      dueDate: draft.dueDate ?? null,
      dueTime: draft.dueTime ?? null,
      priority: draft.priority,
      timerType: draft.timerType,
      intentionSlug: draft.intentionSlug ?? null,
      subIntentionSlug: draft.subIntentionSlug ?? null,
      recurrenceRule: draft.recurrenceRule ?? null,
      recurrenceInterval: draft.recurrenceInterval ?? null,
      recurrenceAnchorMode: draft.recurrenceAnchorMode,
      creationSource,
    };
  }

  private applyDefaultDueDates(
    drafts: ParsedTaskDraft[],
    preferences: Preferences,
    today: string
  ) {
    if (preferences.taskDefaultDueDateMode === 'off') {
      return drafts;
    }
    const days =
      preferences.taskDefaultDueDateMode === 'week'
        ? 7
        : preferences.taskDefaultDueDateMode === 'custom'
          ? preferences.taskDefaultDueDateDays
          : 1;
    const [year, month, day] = today.split('-').map(Number);
    const defaultDate = new Date(Date.UTC(year, month - 1, day + days))
      .toISOString()
      .slice(0, 10);
    return drafts.map(draft =>
      draft.dueDate ? draft : { ...draft, dueDate: defaultDate }
    );
  }

  private async executeTimerCommand(
    userId: string,
    command: ParsedTimerCommand,
    language: string | null | undefined
  ): Promise<{ message: string; succeeded: boolean }> {
    if (command.action === 'startTimer') {
      try {
        await this.timerService.createOrResumeTimer(userId, {
          type: command.timerType ?? TIMER_TYPES.WORK,
          intentions: command.intentionSlugs,
          subIntentions: command.subIntentions,
        });
      } catch (error) {
        if (this.isIntentionRequiredError(error)) {
          return {
            message: translateAssistant(language, 'chooseIntention'),
            succeeded: false,
          };
        }
        return {
          message: translateAssistant(language, 'timerCouldNotStart'),
          succeeded: false,
        };
      }
      return {
        message: this.formatTimerStartedMessage(
          command.timerType ?? TIMER_TYPES.WORK,
          language
        ),
        succeeded: true,
      };
    }
    if (command.action === 'pauseTimer') {
      const timer = await this.timerService.pauseTimer(userId);
      return timer
        ? {
            message: translateAssistant(language, 'timerPaused'),
            succeeded: true,
          }
        : {
            message: translateAssistant(language, 'noTimerToPause'),
            succeeded: false,
          };
    }
    if (command.action === 'addFiveMinutes') {
      const timer = await this.timerService.addFiveMinutesTimer(userId);
      return timer
        ? {
            message: translateAssistant(language, 'fiveMinutesAdded'),
            succeeded: true,
          }
        : {
            message: translateAssistant(language, 'noTimerToExtend'),
            succeeded: false,
          };
    }
    return {
      message: translateAssistant(language, 'noSafeAction'),
      succeeded: false,
    };
  }

  private async getActiveIntentions(userId: string) {
    return this.intentionsService.getActiveIntentionsForAssistant(userId);
  }

  private formatCaptureIntentions(intentions: Intention[]) {
    return intentions.map(intention => ({
      slug: intention.slug,
      title: intention.title,
      type: intention.type,
      parentSlug: intention.parentIntention?.slug ?? null,
      description: intention.description,
    }));
  }

  private readInterpretationDiagnostics(error: unknown) {
    return error instanceof AssistantInterpretationError
      ? error.diagnostics
      : null;
  }

  private appendModelCall(
    modelCalls: AssistantDebugModelCall[],
    error: unknown
  ) {
    if (error instanceof AssistantModelRequestError) {
      modelCalls.push(error.modelCall);
    }
  }

  private async measureDebugStage<T>(
    timings: AssistantDebugTimings,
    key: Exclude<keyof AssistantDebugTimings, 'totalMs'>,
    operation: () => Promise<T>
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      timings[key] = (timings[key] ?? 0) + elapsedMs(startedAt);
    }
  }

  private isIntentionRequiredError(error: unknown) {
    if (!(error instanceof BadRequestException)) return false;
    const response = error.getResponse();
    if (typeof response === 'string') {
      return (
        response.includes('Intention is required') ||
        response.includes('Sub-intention is required')
      );
    }
    if (response && typeof response === 'object' && 'message' in response) {
      const message = (response as { message?: unknown }).message;
      const messages = Array.isArray(message) ? message : [message];
      return messages.some(
        item =>
          typeof item === 'string' &&
          (item.includes('Intention is required') ||
            item.includes('Sub-intention is required'))
      );
    }
    return false;
  }

  private normalizeUserText(value: string) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text ? text.slice(0, 1_000_000) : null;
  }

  private formatTasksCreatedMessage(
    tasks: Array<{ title: string }>,
    language: string | null | undefined
  ) {
    return tasks.length === 1
      ? translateAssistant(language, 'taskCreated', { title: tasks[0].title })
      : translateAssistant(language, 'tasksCreated', { count: tasks.length });
  }

  private formatTimerStartedMessage(
    timerType: TimerTypes,
    language: string | null | undefined
  ) {
    if (timerType === TIMER_TYPES.BREAK)
      return translateAssistant(language, 'breakTimerStarted');
    if (timerType === TIMER_TYPES.LONG_BREAK)
      return translateAssistant(language, 'longBreakStarted');
    return translateAssistant(language, 'timerStarted');
  }

  private getVoiceTaskDefaults(
    currentTimer: Timer | null
  ): AssistantTaskDefaults | undefined {
    if (!currentTimer) return undefined;

    const intentionSlug =
      currentTimer.intention ?? currentTimer.intentionSlugs?.[0];
    return {
      timerType: currentTimer.type,
      intentionSlug,
      subIntentionSlug:
        currentTimer.subIntention ??
        (intentionSlug
          ? currentTimer.subIntentions?.[intentionSlug]
          : undefined),
    };
  }

  private formatTask(task: TaskEntity) {
    const { recurrenceSequenceIndex, ...publicTask } = task;
    void recurrenceSequenceIndex;
    return {
      ...publicTask,
      itemKind: 'task' as const,
      pinnedAt:
        task.pinnedAt instanceof Date
          ? task.pinnedAt.toISOString()
          : task.pinnedAt
            ? String(task.pinnedAt)
            : null,
      createdAt:
        task.createdAt instanceof Date
          ? task.createdAt.toISOString()
          : String(task.createdAt),
      updatedAt:
        task.updatedAt instanceof Date
          ? task.updatedAt.toISOString()
          : String(task.updatedAt),
    };
  }

  private formatError(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
