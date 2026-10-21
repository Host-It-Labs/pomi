import { z } from 'zod';
import { TASK_PRIORITIES, TIMER_TYPES } from '@pomi/shared';

export const MAX_TASKS_PER_REQUEST = 25;
export const MAX_SOURCE_SEGMENTS_PER_TASK = 32;
export const MAX_DESCRIPTION_DESTINATIONS = 25;

const timerTypeSchema = z.enum(TIMER_TYPES);
const confidenceSchema = z.enum(['high', 'medium', 'low']);

export const assistantTaskSchema = z.strictObject({
  title: z.string(),
  description: z.string().nullable(),
  sourceSegments: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_SOURCE_SEGMENTS_PER_TASK),
  essentialDetails: z.array(z.string().min(1)),
  outcomeKey: z.string(),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  priority: z.enum(TASK_PRIORITIES).nullable(),
  timerType: timerTypeSchema.nullable(),
  recurrenceRule: z.string().nullable(),
  recurrenceInterval: z.number().nullable(),
  recurrenceAnchorMode: z.enum(['planned', 'completion']).nullable(),
  intentionSlug: z.string().nullable(),
  subIntentionSlug: z.string().nullable(),
  intentionMention: z.string().nullable(),
});

export const assistantCaptureSchema = z.strictObject({
  tasks: z.array(assistantTaskSchema).max(MAX_TASKS_PER_REQUEST),
  reviewRequired: z.boolean(),
  confidence: z.strictObject({
    title: confidenceSchema,
    dueDate: confidenceSchema,
    dueTime: confidenceSchema,
    recurrence: confidenceSchema,
    priority: confidenceSchema,
    intention: confidenceSchema,
  }),
  unresolvedMetadata: z.array(z.string()),
  responseLanguage: z.string().min(2).max(32),
});

// Review has the same Task contract; timer classification belongs to the initial voice call.
export const assistantReviewSchema = assistantCaptureSchema;

export const assistantTimerActionSchema = z.strictObject({
  action: z.enum(['startTimer', 'pauseTimer', 'addFiveMinutes', 'none']),
  timerType: timerTypeSchema.nullable(),
  intentionSlugs: z.array(z.string()),
  // An array keeps every object closed for providers enforcing strict JSON Schema.
  subIntentions: z.array(
    z.strictObject({
      intentionSlug: z.string(),
      subIntentionSlug: z.string(),
    })
  ),
});

export const assistantVoiceSchema = assistantCaptureSchema.extend({
  timerAction: assistantTimerActionSchema,
});

export const assistantDescriptionsSchema = z.strictObject({
  descriptions: z
    .array(
      z.strictObject({
        kind: z.enum(['intention', 'list']),
        id: z.string(),
        description: z.string(),
      })
    )
    .max(MAX_DESCRIPTION_DESTINATIONS),
});

// Gemini rejects array length bounds as too many grammar states, so providers
// get unbounded arrays and the reply's Zod parse enforces the limits instead.
export function toProviderJsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, {
    target: 'draft-7',
    override: ({ jsonSchema }) => {
      delete jsonSchema.maxItems;
    },
  });
}

export type AssistantModelTask = z.infer<typeof assistantTaskSchema>;
export type AssistantCaptureOutput = z.infer<typeof assistantCaptureSchema>;
export type AssistantVoiceOutput = z.infer<typeof assistantVoiceSchema>;
export type AssistantTimerActionOutput = z.infer<
  typeof assistantTimerActionSchema
>;
