import { BadRequestException } from '@nestjs/common';
import type { AssistantDebugModelCall } from '@pomi/shared';
import { normalizeOptionalString, toRecord } from './assistant-input-utils';
import { AssistantTaskPolicy } from './assistant-task-policy';
import { elapsedMs } from './assistant-timing';
import {
  EMPTY_TIMER_COMMAND,
  AssistantTimerCommandPolicy,
} from './assistant-timer-command-policy';
import {
  AssistantInterpretationError,
  AssistantExtractionReviewMetadata,
  AssistantInterpretationInput,
  AssistantInterpretationResolutionInput,
  AssistantInterpretationResult,
  AssistantPreparedInterpretation,
  AssistantInterpretationTimings,
  AssistantModelRequestOptions,
  AssistantModelResponse,
  AssistantModelRequestError,
  MAX_TASKS_PER_REQUEST,
} from './assistant-input-types';
import { translateAssistant } from '../i18n/assistant-localization';

export {
  AssistantInterpretationError,
  AssistantTaskDefaults,
  ParsedTaskDraft,
  ParsedTimerCommand,
} from './assistant-input-types';

const MAX_SOURCE_SEGMENTS_PER_TASK = 32;
const CONFIDENCE_FIELDS = [
  'title',
  'dueDate',
  'dueTime',
  'recurrence',
  'priority',
  'intention',
] as const;
const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);

/**
 * One response shape is used for initial extraction, repair, and review.  We
 * used to force a function call and JSON mode at the same time; Gemini rejects
 * that combination and the service then burned through several fallback
 * requests before returning the useful response. JSON object mode plus the
 * explicit prompt shape keeps extraction deterministic without that rejected
 * request.
 */
const ASSISTANT_CAPTURE_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: {
      type: 'array',
      maxItems: MAX_TASKS_PER_REQUEST,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          description: { type: ['string', 'null'] },
          sourceSegments: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_SOURCE_SEGMENTS_PER_TASK,
            items: { type: 'string', minLength: 1 },
          },
          // Exact source fragments that carry concrete nouns, names, places,
          // numbers, or other constraints which must survive normalization.
          essentialDetails: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
          },
          // Same key means the passages describe one outcome, even when the
          // user returns to it after discussing another outcome.
          outcomeKey: { type: 'string' },
          dueDate: { type: ['string', 'null'] },
          dueTime: { type: ['string', 'null'] },
          priority: {
            type: ['string', 'null'],
            enum: ['low', 'normal', 'high', 'urgent', null],
          },
          timerType: {
            type: ['string', 'null'],
            enum: ['work', 'break', 'longBreak', null],
          },
          recurrenceRule: { type: ['string', 'null'] },
          recurrenceInterval: { type: ['number', 'null'] },
          recurrenceAnchorMode: {
            type: ['string', 'null'],
            enum: ['planned', 'completion', null],
          },
          intentionSlug: { type: ['string', 'null'] },
          subIntentionSlug: { type: ['string', 'null'] },
          intentionMention: { type: ['string', 'null'] },
        },
        required: [
          'title',
          'description',
          'sourceSegments',
          'essentialDetails',
          'outcomeKey',
          'dueDate',
          'dueTime',
          'priority',
          'timerType',
          'recurrenceRule',
          'recurrenceInterval',
          'recurrenceAnchorMode',
          'intentionSlug',
          'subIntentionSlug',
          'intentionMention',
        ],
      },
    },
    reviewRequired: { type: 'boolean' },
    confidence: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        CONFIDENCE_FIELDS.map(field => [
          field,
          { type: 'string', enum: ['high', 'medium', 'low'] },
        ])
      ),
      required: [...CONFIDENCE_FIELDS],
    },
    unresolvedMetadata: {
      type: 'array',
      items: { type: 'string' },
    },
    responseLanguage: { type: 'string', minLength: 2, maxLength: 32 },
    timerAction: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['startTimer', 'pauseTimer', 'addFiveMinutes', 'none'],
        },
        timerType: {
          type: ['string', 'null'],
          enum: ['work', 'break', 'longBreak', null],
        },
        intentionSlugs: { type: 'array', items: { type: 'string' } },
        subIntentions: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['action', 'timerType', 'intentionSlugs', 'subIntentions'],
    },
  },
  required: ['tasks', 'reviewRequired', 'confidence', 'unresolvedMetadata'],
};

export class AssistantInputInterpreter {
  private readonly taskPolicy = new AssistantTaskPolicy();
  private readonly timerPolicy = new AssistantTimerCommandPolicy();

  async interpret(
    input: AssistantInterpretationInput
  ): Promise<AssistantInterpretationResult> {
    const prepared = await this.prepare(input);
    return this.resolve(input, prepared);
  }

  async prepare(
    input: AssistantInterpretationInput
  ): Promise<AssistantPreparedInterpretation> {
    const timings: AssistantInterpretationTimings = {};
    const modelCalls: AssistantDebugModelCall[] = [];
    let costUsd = 0;
    const requestStartedAt = performance.now();
    let firstResponse: AssistantModelResponse;
    try {
      firstResponse = await this.requestJson(
        input,
        this.buildMessages(input),
        this.buildRequestOptions(input, 'initial'),
        modelCalls
      );
    } catch (error) {
      timings.modelRequestMs = elapsedMs(requestStartedAt);
      return this.handleModelFailure(
        input,
        error,
        costUsd,
        null,
        timings,
        modelCalls
      );
    }
    timings.modelRequestMs = elapsedMs(requestStartedAt);
    costUsd += firstResponse.costUsd;

    let parsed: Record<string, unknown>;
    let invalidParserOutput: string | null = null;
    try {
      parsed = this.parseJsonObject(
        firstResponse.content,
        input.accountLanguage
      );
    } catch {
      invalidParserOutput = firstResponse.content;
      const repairStartedAt = performance.now();
      let repairResponse: AssistantModelResponse;
      try {
        repairResponse = await this.requestJson(
          input,
          this.buildRepairMessages(input, firstResponse.content),
          this.buildRequestOptions(input, 'repair'),
          modelCalls
        );
      } catch (error) {
        timings.modelRepairMs = elapsedMs(repairStartedAt);
        return this.handleModelFailure(
          input,
          error,
          costUsd,
          invalidParserOutput,
          timings,
          modelCalls
        );
      }
      timings.modelRepairMs = elapsedMs(repairStartedAt);
      costUsd += repairResponse.costUsd;
      try {
        parsed = this.parseJsonObject(
          repairResponse.content,
          input.accountLanguage
        );
      } catch {
        invalidParserOutput = repairResponse.content;
        return this.handleModelFailure(
          input,
          new Error(
            translateAssistant(
              input.accountLanguage,
              'assistantResponseInvalid'
            )
          ),
          costUsd,
          invalidParserOutput,
          timings,
          modelCalls
        );
      }
    }

    let rawTasks = this.readTasks(parsed, input.mode === 'voiceCommand');
    if (this.shouldReviewExtraction(parsed, rawTasks, input.text)) {
      const reviewStartedAt = performance.now();
      try {
        const reviewResponse = await this.requestJson(
          input,
          this.buildReviewMessages(input, parsed),
          this.buildRequestOptions(input, 'review'),
          modelCalls
        );
        costUsd += reviewResponse.costUsd;
        const reviewed = this.parseJsonObject(
          reviewResponse.content,
          input.accountLanguage
        );
        const reviewedTasks = this.readTasks(
          reviewed,
          input.mode === 'voiceCommand'
        );
        if (
          reviewedTasks.length > 0 &&
          reviewedTasks.length <= MAX_TASKS_PER_REQUEST &&
          !this.taskPolicy.needsReview(reviewedTasks, input.text)
        ) {
          parsed = {
            ...parsed,
            ...reviewed,
            ...(input.mode === 'voiceCommand'
              ? { timerAction: parsed.timerAction }
              : {}),
          };
          rawTasks = reviewedTasks;
        }
      } catch {
        // Keep first valid extraction when optional review fails.
      } finally {
        timings.modelReviewMs = elapsedMs(reviewStartedAt);
      }
    }
    if (rawTasks.length > MAX_TASKS_PER_REQUEST) {
      throw new AssistantInterpretationError(
        translateAssistant(
          input.accountLanguage,
          'assistantTasksLimitExceeded',
          {
            count: MAX_TASKS_PER_REQUEST,
          }
        ),
        {
          costUsd,
          invalidParserOutput: '',
          modelCalls,
          timings,
        }
      );
    }
    if (
      rawTasks.length > 0 &&
      (this.taskPolicy.hasInvalidSourceSegments(rawTasks, input.text) ||
        this.taskPolicy.hasUnassignedSourceUrls(rawTasks, input.text))
    ) {
      return this.handleModelFailure(
        input,
        new Error(
          translateAssistant(
            input.accountLanguage,
            'assistantSourceEvidenceInvalid'
          )
        ),
        costUsd,
        invalidParserOutput,
        timings,
        modelCalls
      );
    }

    return {
      mode: input.mode,
      text: input.text,
      parsed,
      rawTasks,
      costUsd,
      invalidParserOutput,
      modelFailure: null,
      modelCalls,
      timings,
      responseLanguage: this.readResponseLanguage(
        parsed,
        input.accountLanguage
      ),
    };
  }

  resolve(
    input: AssistantInterpretationResolutionInput,
    prepared: AssistantPreparedInterpretation
  ): AssistantInterpretationResult {
    const processingStartedAt = performance.now();
    const timings = { ...prepared.timings };
    const resolutionNotes: string[] = [];
    if (prepared.modelFailure !== null || prepared.parsed === null) {
      const task = this.taskPolicy.createFallbackTask(
        prepared.text,
        input.today,
        input.defaults,
        input.intentions,
        resolutionNotes,
        this.buildTranscriptSettings(input),
        translateAssistant(input.accountLanguage, 'fallbackTaskTitle')
      );
      timings.outputProcessingMs = elapsedMs(processingStartedAt);
      return {
        tasks: [task],
        timerCommand: EMPTY_TIMER_COMMAND,
        costUsd: prepared.costUsd,
        usedFallback: true,
        invalidParserOutput: prepared.invalidParserOutput,
        error: prepared.modelFailure,
        resolutionNotes,
        modelCalls: prepared.modelCalls,
        timings,
        responseLanguage: prepared.responseLanguage,
      };
    }

    const tasks = this.taskPolicy.normalizeTasks(
      prepared.rawTasks,
      prepared.text,
      input.today,
      input.intentions,
      input.defaults,
      resolutionNotes,
      this.readReviewMetadata(prepared.parsed)?.unresolvedMetadata ?? [],
      prepared.mode === 'voiceCommand',
      this.buildTranscriptSettings(input)
    );
    let usedFallback = false;
    if (tasks.length === 0 && prepared.mode === 'taskCapture') {
      tasks.push(
        this.taskPolicy.createFallbackTask(
          prepared.text,
          input.today,
          input.defaults,
          input.intentions,
          resolutionNotes,
          this.buildTranscriptSettings(input),
          translateAssistant(input.accountLanguage, 'fallbackTaskTitle')
        )
      );
      usedFallback = true;
    }
    const timerCommand =
      prepared.mode === 'voiceCommand'
        ? this.timerPolicy.normalize(
            prepared.parsed.timerAction,
            input.intentions,
            prepared.text
          )
        : EMPTY_TIMER_COMMAND;
    timings.outputProcessingMs = elapsedMs(processingStartedAt);

    return {
      tasks,
      timerCommand,
      costUsd: prepared.costUsd,
      usedFallback,
      invalidParserOutput: prepared.invalidParserOutput,
      error: null,
      resolutionNotes,
      modelCalls: prepared.modelCalls,
      timings,
      responseLanguage: prepared.responseLanguage,
    };
  }

  private handleModelFailure(
    input: AssistantInterpretationInput,
    error: unknown,
    costUsd: number,
    invalidParserOutput: string | null,
    timings: AssistantInterpretationTimings,
    modelCalls: AssistantDebugModelCall[]
  ): AssistantPreparedInterpretation {
    const message =
      error instanceof Error ? error.message : 'Assistant model request failed';
    if (input.mode === 'voiceCommand') {
      throw new AssistantInterpretationError(message, {
        costUsd,
        invalidParserOutput: invalidParserOutput ?? '',
        modelCalls,
        timings,
      });
    }
    return {
      mode: input.mode,
      text: input.text,
      parsed: null,
      rawTasks: [],
      costUsd,
      invalidParserOutput,
      modelFailure: message,
      modelCalls,
      timings,
      responseLanguage: input.accountLanguage ?? 'en',
    };
  }

  private async requestJson(
    input: AssistantInterpretationInput,
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    options: AssistantModelRequestOptions,
    modelCalls: AssistantDebugModelCall[]
  ) {
    try {
      const response = await input.requestJson(messages, options);
      if (response.modelCall) {
        modelCalls.push(response.modelCall);
      }
      return response;
    } catch (error) {
      if (error instanceof AssistantModelRequestError) {
        modelCalls.push(error.modelCall);
      }
      throw error;
    }
  }

  private buildMessages(input: AssistantInterpretationInput) {
    const taskRules = [
      'Extract zero or more Pomi Tasks using supplied Task shape.',
      'Input may come from voice-to-text, so correct likely recognition mistakes from supplied context.',
      'Create one Task per distinct user outcome, not one Task per sentence. A later passage that continues, clarifies, or adds a requirement to an earlier outcome must use the same outcomeKey and be merged into that Task, even when another outcome was discussed between the passages.',
      'When the user explicitly enumerates independent, stand-alone actions or items under one shared action, create one Task per item. Give each independent item its own sourceSegments and outcomeKey, even when the action verb and Intention are shared.',
      'Keep one Task when an enumeration lists properties, components, acceptance criteria, ingredients, examples, or other details that collectively describe one larger outcome. Decide from meaning and grammar, not from a fixed domain or vocabulary.',
      `Never create more than ${MAX_TASKS_PER_REQUEST} Tasks.`,
      'Task titles must be clean action labels, usually 8 to 10 words and never more than 15 words.',
      'Interpret the input naturally and flexibly in any language; never require English or match a fixed phrase list.',
      'Keep each Task title and description in the language used by its source passages. Return responseLanguage as the primary BCP-47 language of the request for spoken confirmation.',
      'Resolve relative dates and weekdays against supplied today.',
      'Recognize recurrence expressed in different ways, including every N units and every other unit.',
      'If recurrence is requested without an explicit due date, leave dueDate null; Pomi will default it to tomorrow.',
      'Do not repeat due date, due time, priority, recurrence, Task Timer type, intention, or sub-intention wording in title when represented by its Task field. Never remove concrete requested nouns, names, places, objects, numbers, or constraints merely to make a title shorter; keep them in the description or essentialDetails.',
      'Use the shortest clear action label that distinguishes the Task. If a linked Intention or Task field already supplies a category or action that is obvious from context, do not repeat it in the title.',
      'When a Task is linked to an existing Intention and the action is already obvious from that Intention, keep only the differentiating object or outcome in the title; apply this consistently to every Intention rather than relying on a fixed vocabulary.',
      'Keep descriptions concise and purposeful: include only context not represented by Task fields, while preserving requested URLs, names, numbers, and constraints exactly. Never copy a transcript or source passage into description.',
      "For every Task, sourceSegments must contain one or more exact contiguous passages copied from the input that belong to that Task. Include every passage that contributes to the same outcome, including interleaved continuation passages; do not put a different outcome's passage in this Task.",
      'For every Task, essentialDetails must contain short exact contiguous source fragments for concrete details that must not be lost (for example a place, object, person, project, house, number, URL, or constraint). Exclude capture boilerplate and metadata represented by fields.',
      'outcomeKey is an internal stable grouping label. Reuse it for interleaved continuation passages and use a different key only for a genuinely independent outcome.',
      'sourceSegments are internal evidence used for optional transcripts; keep them exact even when title, description, or Task fields represent the same facts.',
      'Use only supplied existing intention slugs. A valid supplied model slug is retained unless the source confidently names a different supplied intention. Treat phrases like intention NAME and NAME intention as strong intention-link signals, including likely transcription mistakes; use fuzzy matching only against supplied titles and slugs.',
      'Set intentionMention to wording that identified intention when exact slug is uncertain.',
      'If Parent intention has children, include valid child as subIntentionSlug rather than guessing.',
      'Due date format is YYYY-MM-DD; due time is HH:mm.',
      'Priority is low, normal, high, or urgent.',
      'Recurrence allows FREQ=DAILY, WEEKLY, or MONTHLY with optional INTERVAL.',
      'Set reviewRequired when any requested Task metadata may be missing or ambiguous.',
      'Use high, medium, or low confidence for title, dueDate, dueTime, recurrence, priority, and intention.',
    ].join(' ');
    const voiceRules =
      input.mode === 'voiceCommand'
        ? ' Also classify one safe timer action: startTimer, pauseTimer, addFiveMinutes, or none. A recording may contain both Tasks and one timer action. Do not emit other actions.'
        : '';

    return [
      {
        role: 'system' as const,
        content: `Return exactly one JSON object matching the supplied shape. Do not return a tool call, markdown, commentary, or a bare array. ${taskRules}${voiceRules}`,
      },
      {
        role: 'user' as const,
        content: JSON.stringify({
          today: input.today,
          text: input.text,
          intentions: input.intentions,
          shape: {
            tasks: [
              {
                title: 'string',
                description: 'string|null',
                sourceSegments: ['exact contiguous source passage'],
                essentialDetails: [
                  'exact source fragments for concrete details',
                ],
                outcomeKey: 'stable grouping key for one outcome',
                dueDate: 'YYYY-MM-DD|null',
                dueTime: 'HH:mm|null',
                priority: 'low|normal|high|urgent',
                timerType: 'work|break|longBreak',
                recurrenceRule: 'RRULE|null',
                recurrenceInterval: 'number|null',
                recurrenceAnchorMode: 'planned|completion',
                intentionSlug: 'existing parent slug|null',
                subIntentionSlug: 'existing child slug|null',
                intentionMention: 'heard or typed intention wording|null',
              },
            ],
            reviewRequired: 'boolean',
            confidence: {
              title: 'high|medium|low',
              dueDate: 'high|medium|low',
              dueTime: 'high|medium|low',
              recurrence: 'high|medium|low',
              priority: 'high|medium|low',
              intention: 'high|medium|low',
            },
            unresolvedMetadata: ['string'],
            responseLanguage:
              'BCP-47 language code for the primary request language',
            timerAction: {
              action: 'startTimer|pauseTimer|addFiveMinutes|none',
              timerType: 'work|break|longBreak|null',
              intentionSlugs: ['existing parent intention slug'],
              subIntentions: {
                parentIntentionSlug: 'existing child intention slug',
              },
            },
          },
        }),
      },
    ];
  }

  private buildRequestOptions(
    input: AssistantInterpretationInput,
    phase: 'initial' | 'repair' | 'review'
  ): AssistantModelRequestOptions {
    const schemaProperties =
      ASSISTANT_CAPTURE_RESPONSE_SCHEMA.properties as Record<string, unknown>;
    const schemaRequired = [
      ...((ASSISTANT_CAPTURE_RESPONSE_SCHEMA.required as string[]) ?? []),
    ];
    if (input.mode === 'voiceCommand') {
      schemaRequired.push('timerAction');
    }
    return {
      debugStage: phase,
      responseSchema: {
        ...ASSISTANT_CAPTURE_RESPONSE_SCHEMA,
        properties: schemaProperties,
        required: schemaRequired,
      },
    };
  }

  private buildTranscriptSettings(
    input: Pick<
      AssistantInterpretationInput,
      'taskTranscriptEnabled' | 'taskTranscriptMinWords'
    >
  ) {
    return {
      enabled: input.taskTranscriptEnabled === true,
      minWords: input.taskTranscriptMinWords ?? 15,
    };
  }

  private buildRepairMessages(
    input: AssistantInterpretationInput,
    invalidOutput: string
  ) {
    const messages = this.buildMessages(input);
    return [
      messages[0],
      {
        role: 'user' as const,
        content: JSON.stringify({
          instruction:
            'Repair invalid output below. Return exactly one JSON object matching the requested shape and no surrounding text. Do not drop sourceSegments, essentialDetails, or outcomeKey.',
          originalRequest: JSON.parse(messages[1].content),
          invalidOutput,
        }),
      },
    ];
  }

  private buildReviewMessages(
    input: AssistantInterpretationInput,
    firstExtraction: Record<string, unknown>
  ) {
    return [
      {
        role: 'system' as const,
        content: `Review the original multilingual Task request against the first extraction and return exactly one corrected JSON object matching the supplied shape. Recover omitted concrete details and ambiguous due date, due time, recurrence, priority, and intention fields. Merge passages that continue the same outcome by assigning one outcomeKey; do not split one outcome into multiple Tasks just because the user returned to it later. Produce the shortest clear action-only title in the source language without dropping concrete nouns, names, places, objects, numbers, URLs, or constraints; keep those in essentialDetails or description. Preserve exact per-Task sourceSegments, and never return more than ${MAX_TASKS_PER_REQUEST} Tasks. Use supplied today and return responseLanguage.`,
      },
      {
        role: 'user' as const,
        content: JSON.stringify({
          today: input.today,
          text: input.text,
          intentions: input.intentions,
          firstExtraction,
          instruction:
            'Return corrected tasks plus responseLanguage, reviewRequired, confidence, unresolvedMetadata, and timerAction.',
        }),
      },
    ];
  }

  private shouldReviewExtraction(
    parsed: Record<string, unknown>,
    rawTasks: unknown[],
    sourceText: string
  ) {
    const metadata = this.readReviewMetadata(parsed);
    if (!metadata) return true;
    if (metadata.reviewRequired || metadata.unresolvedMetadata.length > 0)
      return true;
    if (Object.values(metadata.confidence).some(value => value !== 'high'))
      return true;
    if (rawTasks.length > MAX_TASKS_PER_REQUEST) return true;
    return (
      this.taskPolicy.needsReview(rawTasks, sourceText) ||
      this.taskPolicy.hasUnassignedSourceUrls(rawTasks, sourceText)
    );
  }

  private readReviewMetadata(
    parsed: Record<string, unknown>
  ): AssistantExtractionReviewMetadata | null {
    if (typeof parsed.reviewRequired !== 'boolean') return null;
    if (
      !Array.isArray(parsed.unresolvedMetadata) ||
      !parsed.unresolvedMetadata.every(value => typeof value === 'string')
    ) {
      return null;
    }
    const confidence = toRecord(parsed.confidence);
    if (
      !CONFIDENCE_FIELDS.every(field =>
        CONFIDENCE_LEVELS.has(String(confidence[field]))
      )
    ) {
      return null;
    }
    return {
      reviewRequired: parsed.reviewRequired,
      confidence: Object.fromEntries(
        CONFIDENCE_FIELDS.map(field => [field, confidence[field]])
      ) as AssistantExtractionReviewMetadata['confidence'],
      unresolvedMetadata: parsed.unresolvedMetadata,
    };
  }

  private readTasks(input: Record<string, unknown>, allowEmpty: boolean) {
    if (Array.isArray(input.tasks)) return input.tasks;
    if (normalizeOptionalString(input.title)) return [input];
    return allowEmpty ? [] : [{}];
  }

  private readResponseLanguage(
    parsed: Record<string, unknown>,
    fallback: string | undefined
  ): string {
    const value = normalizeOptionalString(parsed.responseLanguage);
    return value?.slice(0, 32) ?? fallback ?? 'en';
  }

  private parseJsonObject(
    content: string,
    language: string | null | undefined
  ) {
    const normalizeParsed = (value: unknown) => {
      if (Array.isArray(value)) {
        return {
          tasks: value,
          reviewRequired: false,
          confidence: Object.fromEntries(
            CONFIDENCE_FIELDS.map(field => [field, 'high'])
          ),
          unresolvedMetadata: [],
        } as Record<string, unknown>;
      }
      const record = toRecord(value);
      if (Object.keys(record).length === 0) {
        throw new BadRequestException(
          translateAssistant(language, 'assistantResponseInvalid')
        );
      }
      return record;
    };
    try {
      return normalizeParsed(JSON.parse(content));
    } catch {
      const match = content.match(/(?:\{[\s\S]*\}|\[[\s\S]*\])/);
      if (!match) {
        throw new BadRequestException(
          translateAssistant(language, 'assistantResponseInvalid')
        );
      }
      return normalizeParsed(JSON.parse(match[0]));
    }
  }
}
