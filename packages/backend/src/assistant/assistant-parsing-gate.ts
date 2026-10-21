import { z } from 'zod';
import type {
  AssistantCaptureIntention,
  AssistantLocalParse,
} from './assistant-input-types';
import { FALLBACK_TITLE_WORDS } from './assistant-task-policy';

export const PARSING_GATE_MODEL = 'inception/mercury-decide';
// Skipping the text model is only worth it when the decision model is near
// certain; anything less costs one model call, while a wrong skip loses data.
const LOCAL_PARSE_MIN_PROBABILITY = 0.9;
const INTENTION_MIN_PROBABILITY = 0.7;
const MAX_CHOICE_OPTIONS = 255;
const NO_INTENTION_OPTION = 'no-intention';

const LOCAL_PARSE_INSTRUCTIONS =
  'Can this to-do input become exactly one Task whose title is the input text, optionally without an English priority word, without losing any information?';
const LOCAL_PARSE_CRITERIA = {
  true: 'A single plain Task title in any language. No due date, weekday, time, relative day, deadline, recurrence, several Tasks or items, or rambling dictation that needs rewriting.',
  false:
    'Mentions a date, weekday, time, relative day (tomorrow, demain, mañana), deadline, recurrence (every, each month), several Tasks or items, or needs rewriting into a clean title.',
};
const INTENTION_INSTRUCTIONS =
  'Which existing Intention does this Task clearly belong to? Choose no-intention unless one fits clearly.';

export const assistantParsingGateAnswersSchema = z.object({
  localParse: z.object({ noul: z.number().min(0).max(1) }),
  intention: z.object({
    choice: z.string(),
    probabilities: z.record(z.string(), z.number().min(0).max(1)),
  }),
});

export type AssistantParsingGateAnswers = z.infer<
  typeof assistantParsingGateAnswersSchema
>;

export function shouldAskParsingGate(
  text: string,
  intentions: AssistantCaptureIntention[]
) {
  // Longer input would be truncated by the local title rules.
  return (
    !/\n/.test(text) &&
    text.split(/\s+/).filter(Boolean).length <= FALLBACK_TITLE_WORDS &&
    intentions.length < MAX_CHOICE_OPTIONS
  );
}

export function buildParsingGateRequest(
  text: string,
  intentions: AssistantCaptureIntention[]
) {
  const intentionOptions: Record<string, string> = {
    [NO_INTENTION_OPTION]: 'No existing Intention clearly fits this Task.',
  };
  for (const intention of intentions) {
    const parent = intentions.find(
      candidate => candidate.slug === intention.parentSlug
    );
    intentionOptions[intention.slug] = [
      parent ? `${parent.title} / ${intention.title}` : intention.title,
      intention.description,
    ]
      .filter(Boolean)
      .join(': ');
  }
  return {
    state: { input: text },
    questions: {
      localParse: {
        type: 'noul',
        instructions: LOCAL_PARSE_INSTRUCTIONS,
        criteria: LOCAL_PARSE_CRITERIA,
      },
      intention: {
        type: 'choice',
        instructions: INTENTION_INSTRUCTIONS,
        criteria: intentionOptions,
      },
    },
  };
}

/** Returns the local parse to apply, or null when the text model must parse the input. */
export function readParsingGateDecision(
  answers: AssistantParsingGateAnswers,
  intentions: AssistantCaptureIntention[]
): AssistantLocalParse | null {
  if (answers.localParse.noul < LOCAL_PARSE_MIN_PROBABILITY) return null;
  const { choice, probabilities } = answers.intention;
  if ((probabilities[choice] ?? 0) < INTENTION_MIN_PROBABILITY) return null;
  if (choice === NO_INTENTION_OPTION) {
    return { intentionSlug: null, subIntentionSlug: null };
  }
  const intention = intentions.find(candidate => candidate.slug === choice);
  if (!intention) return null;
  return intention.parentSlug
    ? { intentionSlug: intention.parentSlug, subIntentionSlug: intention.slug }
    : { intentionSlug: intention.slug, subIntentionSlug: null };
}
