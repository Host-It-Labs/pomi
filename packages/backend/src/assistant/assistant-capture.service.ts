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
import { ListEntity } from '../lists/lists.entity';
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
import { toRecord } from './assistant-input-utils';
import { elapsedMs } from './assistant-timing';
import { AssistantService } from './assistant.service';
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

type VoiceTaskReadbackSource = {
  rawTask: Record<string, unknown>;
  text: string;
};

type ListRouteMatch = {
  listId: string;
  titleStart: number;
  titleTokenCount: number;
  end: number;
  lead: string;
  hasMarkerBeforeTitle: boolean;
};

const LIST_ROUTE_LEADS = [
  ['to'],
  ['in'],
  ['into'],
  ['on'],
  ['under'],
  ['within'],
  ['for'],
  ['a'],
  ['ao'],
  ['aos'],
  ['à'],
  ['au'],
  ['aux'],
  ['dans'],
  ['sur'],
  ['pour'],
  ['en'],
  ['на'],
  ['в'],
  ['для'],
  ['у'],
  ['के', 'लिए'],
  ['में'],
  ['पर'],
  ['को'],
  ['para'],
  ['em'],
  ['no'],
  ['na'],
  ['nos'],
  ['nas'],
  ['di'],
  ['ke'],
  ['dalam'],
  ['untuk'],
  ['di', 'dalam'],
  ['إلى'],
  ['في'],
  ['على'],
  ['من', 'أجل'],
  ['إلى', 'قائمة'],
  ['في', 'قائمة'],
  ['إلى', 'القائمة'],
  ['في', 'القائمة'],
  ['إلى', 'لیست'],
  ['میں'],
] as const;

const LIST_ROUTE_ARTICLES = [
  'the',
  'la',
  'le',
  'les',
  'el',
  'los',
  'las',
  'a',
  'o',
  'os',
  'as',
  'der',
  'die',
  'das',
  'den',
  'de',
  'da',
  'do',
  'dos',
  'um',
  'uma',
  '列表',
  '列表中的',
  'قائمة',
  'सूची',
  'তালিকা',
  'daftar',
  'فہرست',
] as const;

const LIST_ROUTE_MARKERS = [
  'list',
  'liste',
  'lista',
  'قائمة',
  'सूची',
  'তালিকা',
  'daftar',
  'فہرست',
  '列表',
  '列表中的',
] as const;

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
    private readonly listsService: ListsService
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
        ? this.routeSelectedListItems(
            interpreted.tasks,
            normalizedText,
            listId,
            preferences.listsExtension ? lists : [],
            preferences.language
          )
        : this.routeExplicitListItems(
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
      if (preparedListId && !listsEnabled) {
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
      const routedTaskDrafts = this.routeExplicitListItems(
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
              this.formatVoiceTasksCreatedMessage(
                tasks,
                regularDrafts,
                prepared.interpretation.rawTasks,
                prepared.transcript,
                intentions,
                messageLanguage
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

  private routeExplicitListItems(
    drafts: ParsedTaskDraft[],
    sourceText: string,
    lists: Array<Pick<ListEntity, 'id' | 'title'>>,
    language: string | null | undefined
  ) {
    const sourceTokens = this.normalizeRoutingText(sourceText)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (sourceTokens.length === 0) {
      return drafts;
    }

    if (lists.length === 0) {
      if (this.hasExplicitListDestination(sourceTokens)) {
        throw new BadRequestException(
          translateAssistant(language, 'listDestinationUnavailable')
        );
      }
      return drafts;
    }

    const matches = lists.flatMap(list =>
      this.findListRouteMatches(sourceTokens, list)
    );
    const strongestMatches = matches.filter(
      match =>
        !matches.some(
          other =>
            other.titleStart === match.titleStart &&
            other.titleTokenCount > match.titleTokenCount
        )
    );
    const matchedListIds = new Set(strongestMatches.map(match => match.listId));
    if (matchedListIds.size > 1) {
      throw new BadRequestException(
        translateAssistant(language, 'listDestinationAmbiguous')
      );
    }
    if (matchedListIds.size === 0) {
      if (this.hasExplicitListDestination(sourceTokens)) {
        throw new BadRequestException(
          translateAssistant(language, 'listDestinationUnavailable')
        );
      }
      return drafts;
    }

    const [matchedListId] = matchedListIds;
    const existingListIds = new Set(
      drafts
        .map(draft => draft.listId)
        .filter((listId): listId is string => Boolean(listId))
    );
    if (
      existingListIds.size > 0 &&
      (existingListIds.size > 1 || !existingListIds.has(matchedListId))
    ) {
      throw new BadRequestException(
        translateAssistant(language, 'listDestinationAmbiguous')
      );
    }

    const match = strongestMatches.find(
      candidate => candidate.listId === matchedListId
    );
    if (drafts.some(draft => this.hasUnsupportedListItemMetadata(draft))) {
      throw new BadRequestException(
        translateAssistant(language, 'listMetadataUnsupported')
      );
    }
    if (!match) return drafts;
    if (!this.isUsableListRouteMatch(match, sourceTokens, drafts)) {
      const containsTrailingTask =
        drafts.length > 1 &&
        drafts.some(draft =>
          this.draftAppearsAfterListTarget(draft, sourceTokens, match.end)
        );
      throw new BadRequestException(
        translateAssistant(
          language,
          containsTrailingTask
            ? 'listDestinationAmbiguous'
            : 'listMetadataUnsupported'
        )
      );
    }
    return drafts.map(draft => ({ ...draft, listId: match.listId }));
  }

  private routeSelectedListItems(
    drafts: ParsedTaskDraft[],
    sourceText: string,
    selectedListId: string,
    lists: Array<Pick<ListEntity, 'id' | 'title'>>,
    language: string | null | undefined
  ) {
    if (!lists.some(list => list.id === selectedListId)) {
      throw new BadRequestException(
        translateAssistant(language, 'listDestinationUnavailable')
      );
    }
    if (drafts.length !== 1) {
      throw new BadRequestException(
        translateAssistant(language, 'listQuickAddSingleItem')
      );
    }

    const explicitlyRouted = this.routeExplicitListItems(
      drafts,
      sourceText,
      lists,
      language
    );
    const explicitListIds = new Set(
      explicitlyRouted
        .map(draft => draft.listId)
        .filter((listId): listId is string => Boolean(listId))
    );
    if (explicitListIds.size > 0 && !explicitListIds.has(selectedListId)) {
      throw new BadRequestException(
        translateAssistant(language, 'listDestinationAmbiguous')
      );
    }
    if (drafts.some(draft => this.hasUnsupportedListItemMetadata(draft))) {
      throw new BadRequestException(
        translateAssistant(language, 'listMetadataUnsupported')
      );
    }
    return drafts.map(draft => ({ ...draft, listId: selectedListId }));
  }

  private findListRouteMatches(
    sourceTokens: string[],
    list: Pick<ListEntity, 'id' | 'title'>
  ): ListRouteMatch[] {
    const titleTokens = this.normalizeRoutingText(list.title)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (titleTokens.length === 0) return [];

    const matches: ListRouteMatch[] = [];
    for (
      let titleStart = 0;
      titleStart <= sourceTokens.length - titleTokens.length;
      titleStart += 1
    ) {
      if (!this.tokensMatch(sourceTokens, titleStart, titleTokens)) continue;

      const prefix = this.findListRoutePrefix(sourceTokens, titleStart);
      if (!prefix) continue;

      const markerAfterTitle = this.isListRouteMarker(
        sourceTokens[titleStart + titleTokens.length]
      )
        ? 1
        : 0;
      const hasListMarker = prefix.hasMarkerBeforeTitle || markerAfterTitle > 0;
      if (prefix.lead === 'for' && !hasListMarker) continue;

      matches.push({
        listId: list.id,
        titleStart,
        titleTokenCount: titleTokens.length,
        end: titleStart + titleTokens.length + markerAfterTitle,
        lead: prefix.lead,
        hasMarkerBeforeTitle: prefix.hasMarkerBeforeTitle,
      });
    }
    return matches;
  }

  private findListRoutePrefix(sourceTokens: string[], titleStart: number) {
    for (const leadTokens of LIST_ROUTE_LEADS) {
      const articleVariants = [
        [],
        ...LIST_ROUTE_ARTICLES.map(article => [article]),
      ];
      const markerVariants = [
        [],
        ...LIST_ROUTE_MARKERS.map(marker => [marker]),
      ];
      for (const article of articleVariants) {
        for (const marker of markerVariants) {
          const prefixTokens = [...leadTokens, ...article, ...marker];
          const prefixStart = titleStart - prefixTokens.length;
          if (
            prefixStart < 0 ||
            !this.tokensMatch(sourceTokens, prefixStart, prefixTokens)
          ) {
            continue;
          }
          return {
            lead: leadTokens.join(' '),
            hasMarkerBeforeTitle: marker.length > 0,
          };
        }
      }
    }
    return null;
  }

  private isUsableListRouteMatch(
    match: ListRouteMatch,
    sourceTokens: string[],
    drafts: ParsedTaskDraft[]
  ) {
    const trailingTokens = sourceTokens.slice(match.end);
    if (trailingTokens.length === 0) return true;

    if (
      drafts.length > 1 &&
      drafts.some(draft =>
        this.draftAppearsAfterListTarget(draft, sourceTokens, match.end)
      )
    ) {
      return false;
    }

    return this.looksLikeListMetadata(trailingTokens.join(' '));
  }

  private draftAppearsAfterListTarget(
    draft: ParsedTaskDraft,
    sourceTokens: string[],
    targetEnd: number
  ) {
    const evidence = draft.sourceTranscript?.trim() || draft.title;
    const evidenceTokens = this.normalizeRoutingText(evidence)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (evidenceTokens.length === 0) return false;

    for (
      let index = targetEnd;
      index <= sourceTokens.length - evidenceTokens.length;
      index += 1
    ) {
      if (this.tokensMatch(sourceTokens, index, evidenceTokens)) return true;
    }
    return false;
  }

  private tokensMatch(
    sourceTokens: string[],
    start: number,
    expectedTokens: readonly string[]
  ) {
    return expectedTokens.every(
      (token, offset) => sourceTokens[start + offset] === token
    );
  }

  private isListRouteMarker(token: string | undefined) {
    return Boolean(
      token && LIST_ROUTE_MARKERS.some(marker => marker === token)
    );
  }

  private looksLikeListMetadata(value: string) {
    let remaining = this.normalizeRoutingText(value).trim();
    if (!remaining) return true;

    const date =
      '(?:\\d{4} \\d{2} \\d{2}|today|tomorrow|tonight|yesterday|next week|next month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|aujourd’hui|aujourd hui|demain|mañana|hoy|amanhã|hoje|besok|hari ini|明天|今天|कल|आज|غد|اليوم|আগামীকাল|আজ|کل|آج)';
    remaining = remaining
      .replace(
        new RegExp(
          `\\b(?:due date|due|on|by)\\s+(?:next\\s+)?${date}\\b`,
          'giu'
        ),
        ' '
      )
      .replace(new RegExp(`\\b${date}\\b`, 'giu'), ' ')
      .replace(
        /\b(?:priority\s+(?:is\s+)?(?:low|normal|high|urgent)|(?:low|normal|high|urgent)(?:\s+priority)?)\b/giu,
        ' '
      )
      .replace(
        /\b(?:vacation coverage|vacation eligible|holiday coverage|holiday eligible)\b/giu,
        ' '
      )
      .replace(/\b(?:and|also|please|with)\b/giu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return remaining.length === 0;
  }

  private hasExplicitListDestination(sourceTokens: string[]) {
    const routableLeads = LIST_ROUTE_LEADS.filter(
      leadTokens => leadTokens.join(' ') !== 'a'
    );
    return LIST_ROUTE_MARKERS.some(marker => {
      const markerTokens = this.normalizeRoutingText(marker)
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      for (
        let markerStart = 0;
        markerStart + markerTokens.length <= sourceTokens.length;
        markerStart += 1
      ) {
        if (!this.tokensMatch(sourceTokens, markerStart, markerTokens)) {
          continue;
        }
        for (const leadTokens of routableLeads) {
          for (let start = 0; start < markerStart; start += 1) {
            const leadEnd = start + leadTokens.length;
            if (
              leadEnd < markerStart &&
              this.tokensMatch(sourceTokens, start, leadTokens)
            ) {
              return true;
            }
            if (
              leadEnd === markerStart &&
              markerStart + markerTokens.length < sourceTokens.length
            ) {
              return true;
            }
          }
        }
      }
      return false;
    });
  }

  private hasUnsupportedListItemMetadata(draft: ParsedTaskDraft) {
    return Boolean(
      draft.description?.trim() ||
      draft.dueTime ||
      draft.recurrenceRule ||
      draft.recurrenceInterval ||
      (draft.timerType && draft.timerType !== TIMER_TYPES.WORK)
    );
  }

  private normalizeRoutingText(value: string) {
    return ` ${value
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()} `;
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
      ? translateAssistant(language, 'listItemAdded')
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

  private formatVoiceTasksCreatedMessage(
    tasks: TaskEntity[],
    drafts: ParsedTaskDraft[],
    rawTasks: unknown[],
    sourceText: string,
    intentions: Intention[],
    language: string | null | undefined
  ) {
    const readbacks = tasks.map((task, index) => {
      const draft = drafts[index] ?? { title: task.title };
      const metadataSource = this.findVoiceTaskMetadataSource(
        draft,
        rawTasks,
        sourceText,
        index,
        tasks.length
      );
      return {
        title: task.title,
        details: this.formatVoiceTaskReadbackDetails(
          task,
          metadataSource,
          intentions,
          language
        ),
      };
    });
    const created = this.formatTasksCreatedMessage(tasks, language);
    if (readbacks.length === 1) {
      const details = readbacks[0].details;
      return `${created}${details ? ` (${details})` : ''}`;
    }
    return `${created} ${readbacks
      .map(({ title, details }) => (details ? `${title} (${details})` : title))
      .join('; ')}`;
  }

  private formatVoiceTaskReadbackDetails(
    task: TaskEntity,
    metadataSource: VoiceTaskReadbackSource,
    intentions: Intention[],
    language: string | null | undefined
  ) {
    const { rawTask, text: sourceText } = metadataSource;
    const linkedIntention = task.intentionSlug
      ? intentions.find(intention => intention.slug === task.intentionSlug)
      : undefined;
    const linkedSubIntention = task.subIntentionSlug
      ? intentions.find(intention => intention.slug === task.subIntentionSlug)
      : undefined;
    const rawIntentionSlug = this.voiceTaskString(rawTask, 'intentionSlug');
    const rawSubIntentionSlug = this.voiceTaskString(
      rawTask,
      'subIntentionSlug'
    );
    const rawIntentionMention = this.voiceTaskString(
      rawTask,
      'intentionMention'
    );
    const explicitSubIntention = Boolean(
      rawSubIntentionSlug ||
      (linkedSubIntention &&
        (rawIntentionSlug === linkedSubIntention.slug ||
          this.hasExplicitVoiceIntention(
            sourceText,
            linkedSubIntention.title
          ) ||
          (rawIntentionMention &&
            this.hasExplicitVoiceIntention(
              rawIntentionMention,
              linkedSubIntention.title
            ))))
    );
    const explicitIntention = Boolean(
      rawIntentionSlug ||
      explicitSubIntention ||
      (linkedIntention &&
        (this.hasExplicitVoiceIntention(sourceText, linkedIntention.title) ||
          (rawIntentionMention &&
            this.hasExplicitVoiceIntention(
              rawIntentionMention,
              linkedIntention.title
            ))))
    );
    const recurrence = this.getVoiceRecurrence(task);
    const explicitRecurrence = Boolean(
      recurrence && this.hasExplicitVoiceRecurrence(sourceText, rawTask)
    );
    const explicitRecurrenceAnchor = Boolean(
      explicitRecurrence &&
      task.recurrenceAnchorMode &&
      this.hasExplicitVoiceRecurrenceAnchor(sourceText, rawTask)
    );
    return translateAssistant(language, 'taskReadbackDetails', {
      dueDate:
        task.dueDate && this.hasExplicitVoiceDueDate(rawTask)
          ? task.dueDate
          : '',
      dueTime:
        task.dueTime && this.hasExplicitVoiceDueTime(sourceText, rawTask)
          ? task.dueTime
          : '',
      priority: this.hasExplicitVoicePriority(sourceText, rawTask)
        ? task.priority
        : '',
      timerType: this.hasExplicitVoiceTimerType(sourceText, rawTask)
        ? task.timerType
        : '',
      intention: explicitIntention
        ? (linkedIntention?.title ?? task.intentionSlug ?? '')
        : '',
      subIntention: explicitSubIntention
        ? (linkedSubIntention?.title ?? task.subIntentionSlug ?? '')
        : '',
      recurrenceFrequency: explicitRecurrence
        ? (recurrence?.frequency ?? '')
        : '',
      recurrenceInterval: explicitRecurrence
        ? String(recurrence?.interval ?? 1)
        : '',
      recurrenceAnchor: explicitRecurrenceAnchor
        ? task.recurrenceAnchorMode
        : '',
    });
  }

  private findVoiceTaskMetadataSource(
    draft: ParsedTaskDraft,
    rawTasks: unknown[],
    sourceText: string,
    taskIndex: number,
    taskCount: number
  ): VoiceTaskReadbackSource {
    const normalizedTitle = this.normalizeReadbackText(draft.title);
    const candidates = rawTasks.map(rawTask => toRecord(rawTask));
    const matchedTask = candidates.find(rawTask => {
      const sourceSegments = Array.isArray(rawTask.sourceSegments)
        ? rawTask.sourceSegments.filter(
            (segment): segment is string => typeof segment === 'string'
          )
        : [];
      return sourceSegments.some(segment => {
        const normalizedSegment = this.normalizeReadbackText(segment);
        return Boolean(
          normalizedTitle &&
          (normalizedSegment.includes(normalizedTitle) ||
            normalizedTitle.includes(normalizedSegment))
        );
      });
    });
    const rawTask =
      matchedTask ??
      (candidates.length === taskCount ? (candidates[taskIndex] ?? {}) : {});
    const sourceSegments = Array.isArray(rawTask?.sourceSegments)
      ? rawTask.sourceSegments.filter(
          (segment): segment is string => typeof segment === 'string'
        )
      : [];
    return {
      rawTask,
      text:
        sourceSegments.length > 0
          ? sourceSegments.join(' ')
          : taskCount === 1
            ? sourceText
            : '',
    };
  }

  private hasExplicitVoiceDueDate(rawTask: Record<string, unknown>) {
    return /^\d{4}-\d{2}-\d{2}$/.test(this.voiceTaskString(rawTask, 'dueDate'));
  }

  private hasExplicitVoiceDueTime(
    sourceText: string,
    rawTask: Record<string, unknown>
  ) {
    if (
      /^([01]\d|2[0-3]):[0-5]\d$/.test(this.voiceTaskString(rawTask, 'dueTime'))
    ) {
      return true;
    }
    return (
      /\b(?:at|by)\s+(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)?\b|\b(?:noon|midnight|morning|afternoon|evening|tonight)\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b/i.test(
        sourceText
      ) ||
      /(?:midi|minuit|ce matin|cet après-midi|ce soir|mediodía|medianoche|中午|午夜|今天早上|今天下午|今天晚上|दोपहर|आधी रात|आज सुबह|आज दोपहर|आज शाम|ظهر|منتصف الليل|هذا الصباح|بعد الظهر|الليلة|দুপুর|মধ্যরাত|আজ সকালে|আজ দুপুরে|আজ রাতে|meio-dia|meia-noite|esta manhã|esta tarde|esta noite|pagi ini|siang ini|malam ini|دوپہر|نصف شب|آج صبح|آج دوپہر|آج شام|آج رات)/u.test(
        sourceText
      )
    );
  }

  private hasExplicitVoicePriority(
    sourceText: string,
    rawTask: Record<string, unknown>
  ) {
    const rawPriority = this.voiceTaskString(rawTask, 'priority');
    if (
      ['low', 'normal', 'high', 'urgent'].includes(rawPriority) &&
      rawPriority !== 'normal'
    ) {
      return true;
    }
    return (
      /\b(?:low|normal|high|urgent)\s+(?:priority|task|item|request)\b|\bpriority\s+(?:is\s+|to\s+)?(?:low|normal|high|urgent)\b|\b(?:make|mark|set|put|flag|label|treat)(?:\s+(?:this|it))?(?:\s+as)?(?:\s+to)?\s+(?:low|normal|high|urgent)\b|\b(?:low|normal|high|urgent)(?=\s*[.!?]?$)/i.test(
        sourceText.trim()
      ) ||
      /(?:priorité basse|priorité normale|priorité haute|priorité urgente|prioridad baja|prioridad normal|prioridad alta|prioridad urgente|优先级低|优先级普通|优先级高|优先级紧急|कम प्राथमिकता|सामान्य प्राथमिकता|उच्च प्राथमिकता|अत्यावश्यक प्राथमिकता|أولوية منخفضة|أولوية عادية|أولوية عالية|أولوية عاجلة|কম অগ্রাধিকার|স্বাভাবিক অগ্রাধিকার|উচ্চ অগ্রাধিকার|জরুরি অগ্রাধিকার|prioridade baixa|prioridade normal|prioridade alta|prioridade urgente|prioritas rendah|prioritas normal|prioritas tinggi|prioritas mendesak|کم ترجیح|معمول ترجیح|زیادہ ترجیح|فوری ترجیح)/u.test(
        sourceText
      )
    );
  }

  private hasExplicitVoiceTimerType(
    sourceText: string,
    rawTask: Record<string, unknown>
  ) {
    const rawTimerType = this.voiceTaskString(rawTask, 'timerType');
    if (
      [TIMER_TYPES.WORK, TIMER_TYPES.BREAK, TIMER_TYPES.LONG_BREAK].includes(
        rawTimerType as TimerTypes
      ) &&
      rawTimerType !== TIMER_TYPES.WORK
    ) {
      return true;
    }
    return /\b(?:work|break|long[- ]?break)\s+(?:task|item|request)\b|\b(?:task|item|request)\s+(?:for|of)\s+(?:work|break|long[- ]?break)\b/i.test(
      sourceText
    );
  }

  private hasExplicitVoiceIntention(sourceText: string, title: string) {
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(
      `(?:\\b(?:for|under|within|in|to)\\s+(?:the\\s+)?${escapedTitle}(?:\\s+intention)?\\b|\\bintention\\s+${escapedTitle}\\b|\\b${escapedTitle}\\s+intention\\b)`,
      'i'
    ).test(sourceText);
  }

  private hasExplicitVoiceRecurrence(
    sourceText: string,
    rawTask: Record<string, unknown>
  ) {
    if (
      this.hasVoiceTaskValue(rawTask, 'recurrenceRule') ||
      this.hasVoiceTaskValue(rawTask, 'recurrenceInterval') ||
      this.hasVoiceTaskValue(rawTask, 'recurrenceAnchorMode')
    ) {
      return true;
    }
    return /\b(?:every|each)\s+(?:other\s+)?(?:\d+\s+)?(?:day|days|week|weeks|month|months)\b|\b(?:daily|weekly|monthly|recurring|repeat(?:ing)?)\b|(?:每天|每周|每月|每日|ہر روز|ہر ہفتے|ہر ماہ|روزانہ|ہفتہ وار|ماہانہ)/iu.test(
      sourceText
    );
  }

  private hasExplicitVoiceRecurrenceAnchor(
    sourceText: string,
    rawTask: Record<string, unknown>
  ) {
    if (this.hasVoiceTaskValue(rawTask, 'recurrenceAnchorMode')) return true;
    return /\b(?:from completion|after completion|when completed|when complete|from the due date|from planned date)\b|(?:完成后|पूरा होने के बाद|بعد الإكمال|সম্পন্ন হওয়ার পর|após a conclusão|setelah selesai|تکمیل کے بعد)/iu.test(
      sourceText
    );
  }

  private getVoiceRecurrence(task: TaskEntity) {
    const rule = task.recurrenceRule?.toUpperCase().replace(/^RRULE:/, '');
    const frequencyMatch = rule?.match(
      /(?:^|;)FREQ=(DAILY|WEEKLY|MONTHLY)(?:;|$)/
    );
    const frequency = frequencyMatch?.[1]?.toLowerCase();
    if (!frequency) return null;
    const interval =
      rule?.match(/(?:^|;)INTERVAL=(\d+)(?:;|$)/)?.[1] ??
      (task.recurrenceInterval ? String(task.recurrenceInterval) : '1');
    return { frequency, interval: Number(interval) || 1 };
  }

  private voiceTaskString(rawTask: Record<string, unknown>, key: string) {
    const value = rawTask[key];
    return typeof value === 'string' ? value.trim() : '';
  }

  private hasVoiceTaskValue(rawTask: Record<string, unknown>, key: string) {
    const value = rawTask[key];
    return (
      (typeof value === 'string' && value.trim().length > 0) ||
      (typeof value === 'number' && Number.isFinite(value))
    );
  }

  private normalizeReadbackText(value: string) {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
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
