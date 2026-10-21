import type { AssistantDebugModelCall } from '@pomi/shared';
import { z } from 'zod';
import {
  assistantCaptureSchema,
  assistantReviewSchema,
  assistantVoiceSchema,
  type AssistantCaptureOutput,
  type AssistantVoiceOutput,
  type AssistantModelTask,
} from './assistant-output-schemas';
import { AssistantTaskPolicy } from './assistant-task-policy';
import { elapsedMs } from './assistant-timing';
import {
  EMPTY_TIMER_COMMAND,
  AssistantTimerCommandPolicy,
} from './assistant-timer-command-policy';
import {
  AssistantInterpretationError,
  AssistantInterpretationInput,
  AssistantInterpretationResolutionInput,
  AssistantInterpretationResult,
  AssistantPreparedInterpretation,
  AssistantInterpretationTimings,
  AssistantLocalParse,
  AssistantModelRequestOptions,
  AssistantModelRequestError,
  AssistantModelOutputError,
  MAX_TASKS_PER_REQUEST,
} from './assistant-input-types';
import { translateAssistant } from '../i18n/assistant-localization';

export {
  AssistantInterpretationError,
  AssistantTaskDefaults,
  ParsedTaskDraft,
  ParsedTimerCommand,
} from './assistant-input-types';

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
    let parsed: AssistantCaptureOutput | AssistantVoiceOutput;
    try {
      const schema =
        input.mode === 'voiceCommand'
          ? assistantVoiceSchema
          : assistantCaptureSchema;
      const firstResponse = await this.requestObject(
        input,
        this.buildMessages(input),
        {
          schema,
          schemaName: input.mode,
          debugStage: 'initial',
          language: input.accountLanguage,
        },
        modelCalls
      );
      costUsd += firstResponse.costUsd;
      parsed = firstResponse.object;
    } catch (error) {
      timings.modelRequestMs = elapsedMs(requestStartedAt);
      if (error instanceof AssistantModelOutputError) {
        throw new AssistantInterpretationError(error.message, {
          costUsd: error.modelCall.costUsd,
          invalidParserOutput: error.modelCall.content ?? '',
          timings,
          modelCalls,
        });
      }
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
    const invalidParserOutput = null;
    let rawTasks = parsed.tasks;
    if (this.shouldReviewExtraction(parsed, rawTasks, input.text)) {
      const reviewStartedAt = performance.now();
      try {
        const reviewResponse = await this.requestObject(
          input,
          this.buildReviewMessages(input, parsed),
          {
            schema: assistantReviewSchema,
            schemaName: 'taskReview',
            debugStage: 'review',
            language: input.accountLanguage,
          },
          modelCalls
        );
        costUsd += reviewResponse.costUsd;
        const reviewed = reviewResponse.object;
        if (
          reviewed.tasks.length > 0 &&
          !this.taskPolicy.needsReview(reviewed.tasks, input.text)
        ) {
          parsed = {
            ...parsed,
            ...reviewed,
            ...('timerAction' in parsed
              ? { timerAction: parsed.timerAction }
              : {}),
          };
          rawTasks = reviewed.tasks;
        }
      } catch (error) {
        // Keep first valid extraction when optional review fails, including its billed cost.
        if (error instanceof AssistantModelRequestError)
          costUsd += error.modelCall.costUsd;
      } finally {
        timings.modelReviewMs = elapsedMs(reviewStartedAt);
      }
    }
    if (
      rawTasks.length > 0 &&
      this.taskPolicy.hasAmbiguousSourceOwnership(rawTasks, input.text)
    ) {
      throw new AssistantInterpretationError(
        translateAssistant(
          input.accountLanguage,
          'assistantSourceEvidenceInvalid'
        ),
        {
          costUsd,
          invalidParserOutput: invalidParserOutput ?? '',
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
      responseLanguage:
        parsed.responseLanguage.trim() || input.accountLanguage || 'en',
    };
  }

  interpretLocally(
    input: AssistantInterpretationResolutionInput &
      Pick<AssistantInterpretationInput, 'text'>,
    localParse: AssistantLocalParse
  ): AssistantInterpretationResult {
    const processingStartedAt = performance.now();
    const resolutionNotes = [
      'Parsed locally: the decision model judged the input a plain Task.',
    ];
    const task = this.taskPolicy.createPlainTask(
      input.text,
      input.today,
      input.defaults,
      input.intentions,
      localParse,
      this.buildTranscriptSettings(input)
    );
    return {
      tasks: [task],
      timerCommand: EMPTY_TIMER_COMMAND,
      costUsd: 0,
      usedFallback: false,
      invalidParserOutput: null,
      error: null,
      resolutionNotes,
      modelCalls: [],
      timings: { outputProcessingMs: elapsedMs(processingStartedAt) },
      responseLanguage: input.accountLanguage ?? 'en',
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
      prepared.parsed.unresolvedMetadata,
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
      prepared.mode === 'voiceCommand' && 'timerAction' in prepared.parsed
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

  private async requestObject<S extends z.ZodType>(
    input: AssistantInterpretationInput,
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    options: AssistantModelRequestOptions<S>,
    modelCalls: AssistantDebugModelCall[]
  ) {
    try {
      const response = await input.requestObject(messages, options);
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
        }),
      },
    ];
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

  private buildReviewMessages(
    input: AssistantInterpretationInput,
    firstExtraction: AssistantCaptureOutput
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
            'Return corrected tasks plus responseLanguage, reviewRequired, confidence, and unresolvedMetadata.',
        }),
      },
    ];
  }

  private shouldReviewExtraction(
    parsed: AssistantCaptureOutput,
    rawTasks: AssistantModelTask[],
    sourceText: string
  ) {
    if (parsed.reviewRequired || parsed.unresolvedMetadata.length > 0)
      return true;
    if (Object.values(parsed.confidence).some(value => value !== 'high'))
      return true;
    return (
      this.taskPolicy.needsReview(rawTasks, sourceText) ||
      this.taskPolicy.hasUnassignedSourceUrls(rawTasks, sourceText)
    );
  }
}
