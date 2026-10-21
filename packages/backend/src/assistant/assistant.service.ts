import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  AssistantDebugModelCall,
  ASSISTANT_MAX_RECORDING_MINUTES,
  AssistantModelOption,
  Preferences,
  AssistantSettings,
  AssistantStatus,
  AssistantUsageBudgetPeriod,
  AssistantVoiceCommandResult,
} from '@pomi/shared';
import { Repository } from 'typeorm';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { PomiLogger } from '../logging/pomi-logger';
import { PreferencesService } from '../preferences/preferences.service';
import { AssistantSettingsEntity } from './assistant-settings.entity';
import { AssistantUsageEntity } from './assistant-usage.entity';
import {
  type AssistantModelResponse,
  AssistantModelRequestError,
  AssistantModelOutputError,
  type AssistantModelRequestOptions,
} from './assistant-input-types';
import { toProviderJsonSchema } from './assistant-output-schemas';
import { translateAssistant } from '../i18n/assistant-localization';
import { AssistantPreparationStore } from './assistant-task-preparation.store';

type OpenRouterUsage = {
  cost?: number;
};

type OpenRouterMessage = {
  content?:
    | string
    | Array<{
        type?: string;
        text?: string;
      }>
    | null;
};

type OpenRouterDecisionResponse = {
  answers?: unknown;
  usage?: OpenRouterUsage;
};

type OpenRouterChatResponse = {
  choices?: Array<{
    message?: OpenRouterMessage;
  }>;
  usage?: OpenRouterUsage;
};

type OpenRouterTranscriptionResponse = {
  text?: string;
  usage?: OpenRouterUsage;
};

type OpenRouterModel = {
  id?: string;
  name?: string;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[] | Record<string, unknown>;
  supported_voices?: string[];
};

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/';
// Decision models are served beside the versioned chat API, not under it.
const OPENROUTER_DECISIONS_PATH = '../alpha/decisions';
const ASSISTANT_SETTINGS_ID = 'default';
const OPENROUTER_TIMEOUT_MS = 30_000;
// The parsing gate only saves time and cost, so a slow answer goes to the text model instead.
const OPENROUTER_DECISION_TIMEOUT_MS = 3_000;

export type AssistantRuntimeSettings = Pick<
  AssistantSettingsEntity,
  | 'textModel'
  | 'transcriptionModel'
  | 'speechModel'
  | 'speechVoice'
  | 'assistantRecordingMaxMinutes'
>;

@Injectable()
export class AssistantService {
  private readonly logger = new PomiLogger(AssistantService.name);
  constructor(
    @InjectRepository(AssistantSettingsEntity)
    private assistantSettingsRepository: Repository<AssistantSettingsEntity>,
    @InjectRepository(AssistantUsageEntity)
    private assistantUsageRepository: Repository<AssistantUsageEntity>,
    private preferencesService: PreferencesService,
    @Optional() private preparationStore?: AssistantPreparationStore
  ) {}

  async getStatus(userId: string): Promise<AssistantStatus> {
    const [settings, preferences] = await Promise.all([
      this.getSettingsEntity(),
      this.preferencesService.getPreferences(userId),
    ]);
    const usageBudgetCapUsd = this.toNullableNumber(settings.usageBudgetCapUsd);
    const usageBudgetUsedUsd =
      usageBudgetCapUsd === null
        ? 0
        : await this.getUsageBudgetUsedUsd(userId, settings, preferences);
    const aiTaskCaptureConfigured = this.isAiTaskCaptureConfigured(settings);
    const speechCaptureConfigured = this.isSpeechCaptureConfigured(settings);
    const assistantVoiceConfigured = this.isAssistantVoiceConfigured(settings);

    return {
      apiKeyConfigured: this.hasApiKey(),
      settingsConfigured: assistantVoiceConfigured,
      aiTaskCaptureEnabled: Boolean(
        preferences.tasksExtension && aiTaskCaptureConfigured
      ),
      speechCaptureEnabled: Boolean(
        preferences.tasksExtension && speechCaptureConfigured
      ),
      assistantEnabled: Boolean(
        preferences.assistantExtension && assistantVoiceConfigured
      ),
      tasksEnabled: preferences.tasksExtension === true,
      assistantRecordingMaxMinutes: this.sanitizeRecordingMaxMinutes(
        settings.assistantRecordingMaxMinutes
      ),
      usageBudgetPeriod: this.sanitizeUsageBudgetPeriod(
        settings.usageBudgetPeriod
      ),
      usageBudgetCapUsd,
      usageBudgetUsedUsd,
    };
  }

  async getSettings(): Promise<
    AssistantSettings & { apiKeyConfigured: boolean }
  > {
    const settings = await this.getSettingsEntity();

    return {
      ...this.formatSettings(settings),
      apiKeyConfigured: this.hasApiKey(),
    };
  }

  async updateSettings(
    updates: Partial<AssistantSettings>
  ): Promise<AssistantSettings & { apiKeyConfigured: boolean }> {
    const settings = await this.getSettingsEntity();
    if (updates.textModel !== undefined) {
      settings.textModel = this.normalizeOptionalString(updates.textModel);
    }
    if (updates.transcriptionModel !== undefined) {
      settings.transcriptionModel = this.normalizeOptionalString(
        updates.transcriptionModel
      );
    }
    if (updates.speechModel !== undefined) {
      settings.speechModel = this.normalizeOptionalString(updates.speechModel);
    }
    if (updates.speechVoice !== undefined) {
      settings.speechVoice = this.normalizeOptionalString(updates.speechVoice);
    }
    if (updates.assistantRecordingMaxMinutes !== undefined) {
      settings.assistantRecordingMaxMinutes = this.sanitizeRecordingMaxMinutes(
        updates.assistantRecordingMaxMinutes
      );
    }
    if (updates.usageBudgetPeriod !== undefined) {
      settings.usageBudgetPeriod = this.sanitizeUsageBudgetPeriod(
        updates.usageBudgetPeriod
      );
    }
    if (updates.usageBudgetCapUsd !== undefined) {
      settings.usageBudgetCapUsd =
        updates.usageBudgetCapUsd === null
          ? null
          : Math.max(0, updates.usageBudgetCapUsd).toFixed(6);
    }

    const saved = await this.assistantSettingsRepository.save(settings);
    return {
      ...this.formatSettings(saved),
      apiKeyConfigured: this.hasApiKey(),
    };
  }

  async listModels(filter: {
    inputModalities?: string;
    outputModalities?: string;
  }): Promise<AssistantModelOption[]> {
    this.requireApiKey();
    const inputFilter = this.splitModalities(filter.inputModalities);
    const outputFilter = this.splitModalities(filter.outputModalities);
    const requiresStructuredOutputs =
      outputFilter.length === 0 || outputFilter.includes('text');
    let response: Response;
    try {
      response = await this.fetchWithTimeout(
        this.buildModelsEndpoint(outputFilter),
        {
          method: 'GET',
          headers: this.openRouterHeaders(),
        }
      );
    } catch {
      throw new BadRequestException(
        this.getOpenRouterFailureMessage(null, 'model list')
      );
    }
    if (!response.ok) {
      throw new BadRequestException(
        this.getOpenRouterFailureMessage(response.status, 'model list')
      );
    }

    const body = (await response.json()) as { data?: OpenRouterModel[] };

    const formattedModels = (body.data ?? []).map(model =>
      this.formatModel(model)
    );

    return formattedModels
      .filter(model =>
        this.modelHasInputModalities(model.inputModalities, inputFilter)
      )
      .filter(model =>
        this.modelHasOutputModalities(model.outputModalities, outputFilter)
      )
      .filter(
        model =>
          !requiresStructuredOutputs ||
          (model.outputModalities.includes('text') &&
            model.supportedParameters.includes('structured_outputs'))
      )
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private buildModelsEndpoint(outputFilter: string[]) {
    const url = new URL(this.openRouterEndpoint('models'));
    if (outputFilter.length > 0) {
      url.searchParams.set('output_modalities', outputFilter.join(','));
    }
    return url.toString();
  }

  private modelHasInputModalities(actual: string[], required: string[]) {
    return required.every(modality => actual.includes(modality));
  }

  private modelHasOutputModalities(actual: string[], required: string[]) {
    return required.every(modality => {
      if (modality === 'audio') {
        return actual.includes('audio') || actual.includes('speech');
      }
      if (modality === 'text') {
        return actual.includes('text') || actual.includes('transcription');
      }
      return actual.includes(modality);
    });
  }

  async transcribe(
    userId: string,
    input: { audioBase64: string; mimeType: string },
    settings: AssistantRuntimeSettings
  ) {
    await this.ensureWithinUsageBudget(userId);
    const request = {
      model: settings.transcriptionModel,
      input_audio: {
        // Audio bytes are intentionally excluded from debug traces.
        format: this.getAudioFormat(input.mimeType),
      },
    };
    const startedAt = performance.now();
    let response: Response;
    let responseStatus: number | null = null;
    let body: unknown;
    try {
      response = await this.fetchWithTimeout(
        this.openRouterEndpoint('audio/transcriptions'),
        {
          method: 'POST',
          headers: this.openRouterHeaders(),
          body: JSON.stringify({
            ...request,
            input_audio: {
              ...request.input_audio,
              data: input.audioBase64,
            },
          }),
        }
      );
      responseStatus = response.status;
      body = await this.readResponseBody(response);
    } catch (error) {
      throw new AssistantModelRequestError(
        this.getOpenRouterFailureMessage(responseStatus, 'voice transcription'),
        this.buildModelCall(
          'transcription',
          request,
          [
            {
              request,
              status: responseStatus,
              response: null,
              error: this.formatErrorForLog(error),
            },
          ],
          null,
          null,
          0,
          startedAt
        )
      );
    }

    const transcriptionBody =
      body && typeof body === 'object'
        ? (body as OpenRouterTranscriptionResponse)
        : {};
    const modelCall = this.buildModelCall(
      'transcription',
      request,
      [
        {
          request,
          status: response.status,
          response: body,
          error: null,
        },
      ],
      body,
      typeof transcriptionBody.text === 'string'
        ? transcriptionBody.text
        : null,
      0,
      startedAt
    );
    if (!response.ok) {
      throw new AssistantModelRequestError(
        this.getOpenRouterFailureMessage(
          response.status,
          'voice transcription'
        ),
        modelCall
      );
    }

    const costUsd = this.readUsageCost(
      transcriptionBody.usage,
      'transcription'
    );
    if (costUsd !== null) {
      await this.recordCost(userId, 'transcription', costUsd);
    }
    modelCall.costUsd = costUsd ?? 0;

    return {
      text: transcriptionBody.text ?? '',
      costUsd: costUsd ?? 0,
      modelCall,
    };
  }

  async transcribeFeedback(
    userId: string,
    input: {
      audioBase64: string;
      mimeType: string;
      idempotencyKey: string;
    }
  ): Promise<{ transcript: string; costUsd: number }> {
    const [settings, preferences] = await Promise.all([
      this.getSettingsEntity(),
      this.preferencesService.getPreferences(userId),
    ]);
    if (!this.isSpeechCaptureConfigured(settings)) {
      throw new ForbiddenException(
        translateAssistant(
          preferences.language,
          'feedbackTranscriptionNotConfigured'
        )
      );
    }
    const transcribe = async () => {
      const result = await this.transcribe(userId, input, settings);
      return {
        transcript: result.text.trim(),
        costUsd: result.costUsd,
        debugLogId: null,
        modelCall: result.modelCall,
      };
    };
    const result = this.preparationStore
      ? await this.preparationStore.getOrCreateVoiceChunk(
          userId,
          `feedback:${input.idempotencyKey}`,
          0,
          {
            audioSha256: createHash('sha256')
              .update(input.audioBase64)
              .digest('hex'),
            mimeType: input.mimeType,
            transcriptionModel: settings.transcriptionModel ?? null,
            debugLogId: null,
          },
          transcribe
        )
      : await transcribe();
    return { transcript: result.transcript, costUsd: result.costUsd };
  }

  async addSpokenAudio(
    _userId: string,
    settings: Pick<AssistantRuntimeSettings, 'speechModel' | 'speechVoice'>,
    result: AssistantVoiceCommandResult
  ): Promise<AssistantVoiceCommandResult> {
    if (!settings.speechModel || !settings.speechVoice || !result.message) {
      return result;
    }

    try {
      const response = await this.fetchWithTimeout(
        this.openRouterEndpoint('audio/speech'),
        {
          method: 'POST',
          headers: this.openRouterHeaders(),
          body: JSON.stringify({
            model: settings.speechModel,
            voice: settings.speechVoice,
            input: result.message,
            response_format: 'mp3',
          }),
        }
      );
      if (!response.ok) {
        this.logger.warn(
          `OpenRouter TTS failed with status ${response.status}.`
        );
        return result;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        ...result,
        spokenAudioBase64: buffer.toString('base64'),
        spokenAudioMimeType:
          response.headers.get('content-type') ?? 'audio/mpeg',
      };
    } catch (error) {
      this.logger.warn(
        `OpenRouter TTS failed. ${this.formatErrorForLog(error)}`
      );
      return result;
    }
  }

  async requestObject<S extends z.ZodType>(
    userId: string,
    model: string | null,
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    options: AssistantModelRequestOptions<S>,
    preparedLocalDate?: string
  ): Promise<
    AssistantModelResponse<S> & { modelCall: AssistantDebugModelCall }
  > {
    if (!model) {
      const preferences = await this.preferencesService.getPreferences(userId);
      throw new BadRequestException(
        translateAssistant(
          preferences.language,
          'assistantTextModelNotConfigured'
        )
      );
    }

    if (!preparedLocalDate) {
      await this.ensureWithinUsageBudget(userId);
    }
    const baseBody = {
      model,
      messages,
    };
    const jsonBody = {
      ...baseBody,
      usage: { include: true },
      provider: { require_parameters: true },
      // Structured output must never be combined with forced tool calls (Gemini).
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: options.schemaName,
          strict: true,
          schema: toProviderJsonSchema(options.schema),
        },
      },
    };
    const startedAt = performance.now();
    const attempts: AssistantDebugModelCall['attempts'] = [];
    const runAttempt = async (requestBody: Record<string, unknown>) => {
      let responseStatus: number | null = null;
      try {
        const response = await this.fetchWithTimeout(
          this.openRouterEndpoint('chat/completions'),
          {
            method: 'POST',
            headers: this.openRouterHeaders(),
            body: JSON.stringify(requestBody),
          }
        );
        responseStatus = response.status;
        const responseBody = await this.readResponseBody(response);
        attempts.push({
          request: requestBody,
          status: response.status,
          response: responseBody,
          error: null,
        });
        return { response, body: responseBody };
      } catch (error) {
        attempts.push({
          request: requestBody,
          status: responseStatus,
          response: null,
          error: this.formatErrorForLog(error),
        });
        throw new AssistantModelRequestError(
          this.getOpenRouterFailureMessage(null, 'model request'),
          this.buildModelCall(
            options.debugStage ?? 'initial',
            jsonBody,
            attempts,
            null,
            null,
            0,
            startedAt
          )
        );
      }
    };

    const attempt = await runAttempt(jsonBody);
    const responseBody = attempt.body;
    const body =
      attempt.body && typeof attempt.body === 'object'
        ? (attempt.body as OpenRouterChatResponse)
        : {};
    const responseModelCall = this.buildModelCall(
      options.debugStage ?? 'initial',
      jsonBody,
      attempts,
      responseBody,
      null,
      0,
      startedAt
    );
    if (!attempt.response.ok) {
      throw new AssistantModelRequestError(
        this.getOpenRouterFailureMessage(
          attempt.response.status,
          'model request'
        ),
        responseModelCall
      );
    }

    const costUsd = this.readUsageCost(body.usage, 'chat');
    const usagePersistence =
      costUsd === null
        ? undefined
        : preparedLocalDate
          ? this.recordCostForLocalDate(
              userId,
              'chat',
              costUsd,
              preparedLocalDate
            )
          : this.recordCost(userId, 'chat', costUsd);
    void usagePersistence?.catch(() => undefined);

    const content = this.getMessageText(body.choices?.[0]?.message);
    responseModelCall.content = content || null;
    responseModelCall.costUsd = costUsd ?? 0;
    let object: z.infer<S>;
    try {
      object = options.schema.parse(JSON.parse(content));
    } catch {
      // Even rejected output is billable. Finish accounting before returning the error.
      await usagePersistence?.catch(() => undefined);
      throw new AssistantModelOutputError(
        translateAssistant(options.language, 'assistantResponseInvalid'),
        responseModelCall
      );
    }
    return {
      object,
      content,
      costUsd: costUsd ?? 0,
      modelCall: responseModelCall,
      usagePersistence,
    };
  }

  async requestDecision<S extends z.ZodType>(
    userId: string,
    model: string,
    request: {
      state: Record<string, unknown>;
      questions: Record<string, unknown>;
    },
    schema: S,
    preparedLocalDate: string
  ): Promise<{
    answers: z.infer<S>;
    costUsd: number;
    modelCall: AssistantDebugModelCall;
    usagePersistence?: Promise<void>;
  }> {
    const requestBody = { model, ...request };
    const startedAt = performance.now();
    const attempts: AssistantDebugModelCall['attempts'] = [];
    let response: Response;
    let responseBody: unknown;
    try {
      ({ response, body: responseBody } = await this.fetchBodyWithTimeout(
        this.openRouterEndpoint(OPENROUTER_DECISIONS_PATH),
        {
          method: 'POST',
          headers: this.openRouterHeaders(),
          body: JSON.stringify(requestBody),
        },
        OPENROUTER_DECISION_TIMEOUT_MS
      ));
    } catch (error) {
      attempts.push({
        request: requestBody,
        status: null,
        response: null,
        error: this.formatErrorForLog(error),
      });
      throw new AssistantModelRequestError(
        this.getOpenRouterFailureMessage(null, 'decision request'),
        this.buildModelCall(
          'gate',
          requestBody,
          attempts,
          null,
          null,
          0,
          startedAt
        )
      );
    }
    attempts.push({
      request: requestBody,
      status: response.status,
      response: responseBody,
      error: null,
    });
    const modelCall = this.buildModelCall(
      'gate',
      requestBody,
      attempts,
      responseBody,
      null,
      0,
      startedAt
    );
    if (!response.ok) {
      throw new AssistantModelRequestError(
        this.getOpenRouterFailureMessage(response.status, 'decision request'),
        modelCall
      );
    }

    const body =
      responseBody && typeof responseBody === 'object'
        ? (responseBody as OpenRouterDecisionResponse)
        : {};
    const costUsd = this.readUsageCost(body.usage, 'decision');
    const usagePersistence =
      costUsd === null
        ? undefined
        : this.recordCostForLocalDate(
            userId,
            'chat',
            costUsd,
            preparedLocalDate
          );
    void usagePersistence?.catch(() => undefined);
    modelCall.costUsd = costUsd ?? 0;
    const answers = schema.safeParse(body.answers);
    if (!answers.success) {
      await usagePersistence?.catch(() => undefined);
      throw new AssistantModelOutputError(
        'Decision model returned invalid answers',
        modelCall
      );
    }
    return {
      answers: answers.data,
      costUsd: costUsd ?? 0,
      modelCall,
      usagePersistence,
    };
  }

  private buildModelCall(
    stage: AssistantDebugModelCall['stage'],
    request: Record<string, unknown>,
    attempts: AssistantDebugModelCall['attempts'],
    response: unknown,
    content: string | null,
    costUsd: number,
    startedAt: number
  ): AssistantDebugModelCall {
    return {
      provider: 'openrouter',
      endpoint: this.openRouterEndpoint(
        stage === 'transcription'
          ? 'audio/transcriptions'
          : stage === 'gate'
            ? OPENROUTER_DECISIONS_PATH
            : 'chat/completions'
      ),
      stage,
      request,
      attempts: [...attempts],
      response,
      content,
      costUsd,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  }

  async prepareRequest(
    userId: string,
    mode: 'taskCapture' | 'dictation' | 'voiceCommand' | 'descriptionGeneration'
  ) {
    const [settings, preferences] = await Promise.all([
      this.getSettingsEntity(),
      this.preferencesService.getPreferences(userId),
    ]);
    this.requirePreparedMode(mode, settings, preferences);
    await this.ensurePreparedUsageBudget(userId, settings, preferences);
    return {
      settings,
      preferences,
      today: this.getLocalDate(preferences.timeZone),
    };
  }

  async prepareVoiceCommitContext(userId: string) {
    const [settings, preferences] = await Promise.all([
      this.getSettingsEntity(),
      this.preferencesService.getPreferences(userId),
    ]);
    this.requirePreparedMode('voiceCommand', settings, preferences);
    return {
      settings,
      preferences,
      today: this.getLocalDate(preferences.timeZone),
    };
  }

  private requirePreparedMode(
    mode:
      'taskCapture' | 'dictation' | 'voiceCommand' | 'descriptionGeneration',
    settings: AssistantSettingsEntity,
    preferences: Preferences
  ) {
    if (
      (mode === 'taskCapture' || mode === 'descriptionGeneration') &&
      !this.isAiTaskCaptureConfigured(settings)
    ) {
      throw new ForbiddenException(
        translateAssistant(preferences.language, 'aiTaskCaptureNotConfigured')
      );
    }
    if (mode === 'dictation' && !this.isSpeechCaptureConfigured(settings)) {
      throw new ForbiddenException(
        translateAssistant(preferences.language, 'speechCaptureNotConfigured')
      );
    }
    if (mode === 'voiceCommand' && !this.isAssistantVoiceConfigured(settings)) {
      throw new ForbiddenException(
        translateAssistant(preferences.language, 'assistantNotConfigured')
      );
    }
    if (
      (mode === 'taskCapture' || mode === 'dictation') &&
      !preferences.tasksExtension
    ) {
      throw new ForbiddenException(
        translateAssistant(preferences.language, 'tasksDisabled')
      );
    }
    if (
      (mode === 'voiceCommand' || mode === 'descriptionGeneration') &&
      !preferences.assistantExtension
    ) {
      throw new ForbiddenException(
        translateAssistant(preferences.language, 'assistantDisabled')
      );
    }
  }

  private async ensurePreparedUsageBudget(
    userId: string,
    settings: AssistantSettingsEntity,
    preferences: Preferences
  ) {
    const cap = this.toNullableNumber(settings.usageBudgetCapUsd);
    if (cap === null) return;
    const used = await this.getUsageBudgetUsedUsd(
      userId,
      settings,
      preferences
    );
    if (used >= cap) {
      throw new ForbiddenException(
        translateAssistant(preferences.language, 'aiUsageBudgetReached')
      );
    }
  }

  private async ensureWithinUsageBudget(
    userId: string,
    status?: AssistantStatus
  ) {
    const resolvedStatus = status ?? (await this.getStatus(userId));
    if (
      resolvedStatus.usageBudgetCapUsd !== null &&
      resolvedStatus.usageBudgetUsedUsd >= resolvedStatus.usageBudgetCapUsd
    ) {
      const preferences = await this.preferencesService.getPreferences(userId);
      throw new ForbiddenException(
        translateAssistant(preferences.language, 'aiUsageBudgetReached')
      );
    }
  }

  private async getSettingsEntity() {
    await this.assistantSettingsRepository
      .createQueryBuilder()
      .insert()
      .into(AssistantSettingsEntity)
      .values({ id: ASSISTANT_SETTINGS_ID })
      .orIgnore()
      .execute();

    const settings = await this.assistantSettingsRepository.findOne({
      where: { id: ASSISTANT_SETTINGS_ID },
    });
    if (!settings) {
      throw new BadRequestException('Assistant settings are unavailable');
    }

    return settings;
  }

  private async getUsageBudgetUsedUsd(
    userId: string,
    settings: AssistantSettingsEntity,
    preferences: Preferences
  ) {
    const localDate = this.getLocalDate(preferences.timeZone);
    const query = this.assistantUsageRepository
      .createQueryBuilder('usage')
      .select('COALESCE(SUM(usage."costUsd"), 0)', 'total')
      .where('usage."userId" = :userId', { userId });

    if (
      this.sanitizeUsageBudgetPeriod(settings.usageBudgetPeriod) === 'monthly'
    ) {
      const bounds = this.getLocalMonthBounds(localDate);
      query
        .andWhere('usage."localDate" >= :monthStart', {
          monthStart: bounds.start,
        })
        .andWhere('usage."localDate" < :nextMonthStart', {
          nextMonthStart: bounds.nextStart,
        });
    } else {
      query.andWhere('usage."localDate" = :localDate', { localDate });
    }

    const result = (await query.getRawOne()) as { total?: string } | undefined;

    return Number(result?.total ?? 0);
  }

  private async recordCost(
    userId: string,
    kind: AssistantUsageEntity['kind'],
    costUsd: number
  ) {
    if (!Number.isFinite(costUsd) || costUsd <= 0) {
      return;
    }
    const preferences = await this.preferencesService.getPreferences(userId);
    await this.recordCostForLocalDate(
      userId,
      kind,
      costUsd,
      this.getLocalDate(preferences.timeZone)
    );
  }

  private async recordCostForLocalDate(
    userId: string,
    kind: AssistantUsageEntity['kind'],
    costUsd: number,
    localDate: string
  ) {
    if (!Number.isFinite(costUsd) || costUsd <= 0) {
      return;
    }
    await this.assistantUsageRepository.save(
      this.assistantUsageRepository.create({
        userId,
        localDate,
        kind,
        costUsd: costUsd.toFixed(6),
      })
    );
  }

  private getLocalDate(timeZone: string) {
    const normalizedTimeZone = this.normalizeTimeZone(timeZone);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: normalizedTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  }

  private normalizeTimeZone(timeZone: string | null | undefined) {
    if (!timeZone) {
      return 'UTC';
    }

    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
      return timeZone;
    } catch {
      return 'UTC';
    }
  }

  private readUsageCost(usage: OpenRouterUsage | undefined, kind: string) {
    if (typeof usage?.cost === 'number' && Number.isFinite(usage.cost)) {
      return usage.cost;
    }

    this.logger.warn(`OpenRouter ${kind} response did not include usage.cost.`);
    return null;
  }

  private getAudioFormat(mimeType: string) {
    const [type] = mimeType.toLowerCase().split(';');
    if (type.includes('webm')) return 'webm';
    if (type.includes('wav')) return 'wav';
    if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
    if (type.includes('mp4')) return 'mp4';
    if (type.includes('m4a')) return 'm4a';
    if (type.includes('ogg')) return 'ogg';
    if (type.includes('flac')) return 'flac';
    return 'webm';
  }

  private getMessageText(message: OpenRouterMessage | undefined) {
    const content = message?.content;
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map(item => (item.type === 'text' ? item.text : ''))
        .filter(Boolean)
        .join('\n');
    }

    return '';
  }

  private formatModel(model: OpenRouterModel): AssistantModelOption {
    const supportedParameters = this.readSupportedParameters(
      model.supported_parameters
    );
    return {
      id: model.id ?? '',
      name: model.name ?? model.id ?? '',
      inputModalities: model.architecture?.input_modalities ?? [],
      outputModalities: model.architecture?.output_modalities ?? [],
      supportedParameters,
      supportedVoices: model.supported_voices ?? null,
    };
  }

  private readSupportedParameters(
    value: OpenRouterModel['supported_parameters']
  ) {
    const hiddenParameters = new Set([
      'reasoning',
      'reasoning_effort',
      'include_reasoning',
      'reasoning_details',
    ]);
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is string =>
          typeof item === 'string' && !hiddenParameters.has(item)
      );
    }
    if (value && typeof value === 'object') {
      return Object.keys(value).filter(item => !hiddenParameters.has(item));
    }

    return [];
  }

  private splitModalities(value: string | undefined) {
    return (value ?? '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }

  private formatSettings(settings: AssistantSettingsEntity): AssistantSettings {
    return {
      textModel: settings.textModel ?? null,
      transcriptionModel: settings.transcriptionModel ?? null,
      speechModel: settings.speechModel ?? null,
      speechVoice: settings.speechVoice ?? null,
      assistantRecordingMaxMinutes: this.sanitizeRecordingMaxMinutes(
        settings.assistantRecordingMaxMinutes
      ),
      usageBudgetPeriod: this.sanitizeUsageBudgetPeriod(
        settings.usageBudgetPeriod
      ),
      usageBudgetCapUsd: this.toNullableNumber(settings.usageBudgetCapUsd),
    };
  }

  private toNullableNumber(value: string | null | undefined) {
    return value == null ? null : Number(value);
  }

  private sanitizeRecordingMaxMinutes(value: unknown) {
    if (value === null) return ASSISTANT_MAX_RECORDING_MINUTES;
    const minutes = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(minutes) || minutes < 1) return 10;
    return Math.min(minutes, ASSISTANT_MAX_RECORDING_MINUTES);
  }

  private isAiTaskCaptureConfigured(settings: AssistantSettingsEntity) {
    return Boolean(this.hasApiKey() && settings.textModel);
  }

  private isSpeechCaptureConfigured(settings: AssistantSettingsEntity) {
    return Boolean(this.hasApiKey() && settings.transcriptionModel);
  }

  private isAssistantVoiceConfigured(settings: AssistantSettingsEntity) {
    return Boolean(
      this.hasApiKey() && settings.textModel && settings.transcriptionModel
    );
  }

  private sanitizeUsageBudgetPeriod(
    value: unknown
  ): AssistantUsageBudgetPeriod {
    return value === 'monthly' ? 'monthly' : 'daily';
  }

  private getLocalMonthBounds(localDate: string) {
    const [yearText, monthText] = localDate.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    return {
      start: `${yearText}-${monthText}-01`,
      nextStart: `${nextYear.toString().padStart(4, '0')}-${nextMonth
        .toString()
        .padStart(2, '0')}-01`,
    };
  }

  private hasApiKey() {
    return Boolean(process.env.OPENROUTER_API_KEY?.trim());
  }

  private requireApiKey() {
    if (!this.hasApiKey()) {
      throw new ForbiddenException('OPENROUTER_API_KEY is not configured');
    }
  }

  private openRouterHeaders() {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      throw new ForbiddenException('OPENROUTER_API_KEY is not configured');
    }

    const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(referer ? { 'HTTP-Referer': referer } : {}),
      'X-Title': 'Pomi',
    };
  }

  private openRouterEndpoint(path: string) {
    const configuredBaseUrl = process.env.OPENROUTER_BASE_URL?.trim();
    const baseUrl = configuredBaseUrl || DEFAULT_OPENROUTER_BASE_URL;
    return new URL(
      path,
      baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    ).toString();
  }

  // Unlike fetchWithTimeout, the deadline also covers a body that stalls after its headers.
  private async fetchBodyWithTimeout(
    input: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<{ response: Response; body: unknown }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      });
      return { response, body: await this.readResponseBody(response) };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchWithTimeout(
    input: string,
    init: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readResponseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private normalizeOptionalString(value: unknown) {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return normalized.length ? normalized : null;
  }

  private formatErrorForLog(error: unknown) {
    return error instanceof Error ? error.name : 'Unknown error';
  }

  private getOpenRouterFailureMessage(
    status: number | null,
    operation: string
  ) {
    if (status === 401 || status === 403) {
      return 'OpenRouter authentication failed. Check the backend API key.';
    }
    if (status === 429) {
      return 'OpenRouter is rate limited. Try again shortly.';
    }
    if (status !== null && status >= 500) {
      return 'OpenRouter is temporarily unavailable. Try again shortly.';
    }
    if (status === null) {
      return 'Could not reach OpenRouter. Check backend connectivity and retry.';
    }
    return `OpenRouter ${operation} failed. Try again shortly.`;
  }
}
