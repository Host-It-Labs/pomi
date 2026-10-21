import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type {
  AssistantCaptureOutput,
  AssistantVoiceOutput,
  AssistantModelTask,
} from './assistant-output-schemas';
export { MAX_TASKS_PER_REQUEST } from './assistant-output-schemas';
import {
  AssistantDebugModelCall,
  AssistantDebugModelCallStage,
  AssistantTaskDraft,
  AssistantTimerCommand,
  TimerTypes,
} from '@pomi/shared';

export type ParsedTaskDraft = AssistantTaskDraft & {
  /** Internal capture evidence; never accepted by public Task create/update DTOs. */
  sourceTranscript?: string | null;
  /** Set only after an explicit, exact List-name mention is resolved. */
  listId?: string | null;
};

export type AssistantModelRequestOptions<S extends z.ZodType> = {
  schema: S;
  schemaName: string;
  debugStage?: AssistantDebugModelCallStage;
  language?: string;
};

export type AssistantTaskDefaults = Omit<Partial<AssistantTaskDraft>, 'title'>;

export type AssistantTaskTranscriptSettings = {
  enabled: boolean;
  minWords: number;
};

export type ParsedTimerCommand = AssistantTimerCommand;

export type AssistantCaptureIntention = {
  slug: string;
  title: string;
  type: TimerTypes;
  parentSlug: string | null;
  description: string | null;
};

export type AssistantInterpretationTimings = {
  modelRequestMs?: number;
  modelReviewMs?: number;
  outputProcessingMs?: number;
};

export type AssistantModelResponse<S extends z.ZodType> = {
  object: z.infer<S>;
  content: string;
  costUsd: number;
  modelCall?: AssistantDebugModelCall;
  usagePersistence?: Promise<void>;
};

export type AssistantInterpretationInput = {
  mode: 'taskCapture' | 'voiceCommand';
  text: string;
  today: string;
  accountLanguage?: string;
  intentions: AssistantCaptureIntention[];
  defaults?: AssistantTaskDefaults;
  taskTranscriptEnabled?: boolean;
  taskTranscriptMinWords?: number;
  requestObject: <S extends z.ZodType>(
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    options: AssistantModelRequestOptions<S>
  ) => Promise<AssistantModelResponse<S>>;
};

export type AssistantInterpretationResult = {
  tasks: ParsedTaskDraft[];
  timerCommand: ParsedTimerCommand;
  costUsd: number;
  usedFallback: boolean;
  invalidParserOutput: string | null;
  error: string | null;
  resolutionNotes: string[];
  modelCalls: AssistantDebugModelCall[];
  timings: AssistantInterpretationTimings;
  responseLanguage: string;
};

export type AssistantPreparedInterpretation = {
  mode: AssistantInterpretationInput['mode'];
  text: string;
  parsed: AssistantCaptureOutput | AssistantVoiceOutput | null;
  rawTasks: AssistantModelTask[];
  costUsd: number;
  invalidParserOutput: string | null;
  modelFailure: string | null;
  modelCalls: AssistantDebugModelCall[];
  timings: AssistantInterpretationTimings;
  responseLanguage: string;
};

export type AssistantInterpretationResolutionInput = Pick<
  AssistantInterpretationInput,
  | 'today'
  | 'accountLanguage'
  | 'intentions'
  | 'defaults'
  | 'taskTranscriptEnabled'
  | 'taskTranscriptMinWords'
>;

export class AssistantInterpretationError extends BadRequestException {
  constructor(
    message: string,
    readonly diagnostics: {
      costUsd: number;
      invalidParserOutput: string;
      modelCalls: AssistantDebugModelCall[];
      timings: AssistantInterpretationTimings;
    }
  ) {
    super(message);
  }
}

export class AssistantModelRequestError extends BadRequestException {
  constructor(
    message: string,
    readonly modelCall: AssistantDebugModelCall
  ) {
    super(message);
  }
}

export class AssistantModelOutputError extends AssistantModelRequestError {}
