import { BadRequestException } from '@nestjs/common';
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

export const MAX_TASKS_PER_REQUEST = 25;

export type AssistantModelTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AssistantModelRequestOptions = {
  debugStage?: AssistantDebugModelCallStage;
  /** Provider-neutral schema for structured JSON extraction. */
  responseSchema?: Record<string, unknown>;
  tools?: AssistantModelTool[];
  toolChoice?:
    | 'auto'
    | 'required'
    | { type: 'function'; function: { name: string } };
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
  modelRepairMs?: number;
  modelReviewMs?: number;
  outputProcessingMs?: number;
};

export type AssistantModelResponse = {
  content: string;
  costUsd: number;
  modelCall?: AssistantDebugModelCall;
  usagePersistence?: Promise<void>;
};

export type AssistantExtractionConfidenceLevel = 'high' | 'medium' | 'low';

export type AssistantExtractionReviewMetadata = {
  reviewRequired: boolean;
  confidence: {
    title: AssistantExtractionConfidenceLevel;
    dueDate: AssistantExtractionConfidenceLevel;
    dueTime: AssistantExtractionConfidenceLevel;
    recurrence: AssistantExtractionConfidenceLevel;
    priority: AssistantExtractionConfidenceLevel;
    intention: AssistantExtractionConfidenceLevel;
  };
  unresolvedMetadata: string[];
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
  requestJson: (
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    options: AssistantModelRequestOptions
  ) => Promise<AssistantModelResponse>;
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
  parsed: Record<string, unknown> | null;
  rawTasks: unknown[];
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
