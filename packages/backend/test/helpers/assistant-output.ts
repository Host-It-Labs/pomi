import type {
  AssistantModelTask,
  AssistantVoiceOutput,
} from '../../src/assistant/assistant-output-schemas';

export function modelTask(
  overrides: Partial<AssistantModelTask>
): AssistantModelTask {
  return {
    title: '',
    description: null,
    sourceSegments: [overrides.title || 'unassigned'],
    essentialDetails: [],
    outcomeKey: '',
    dueDate: null,
    dueTime: null,
    priority: null,
    timerType: null,
    recurrenceRule: null,
    recurrenceInterval: null,
    recurrenceAnchorMode: null,
    intentionSlug: null,
    subIntentionSlug: null,
    intentionMention: null,
    ...overrides,
  };
}

export function captureObject(
  overrides: Omit<Partial<AssistantVoiceOutput>, 'tasks'> & {
    tasks?: Partial<AssistantModelTask>[];
  }
): AssistantVoiceOutput {
  return {
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
    responseLanguage: 'en',
    ...overrides,
    timerAction: {
      action: 'none',
      timerType: null,
      intentionSlugs: [],
      subIntentions: [],
      ...overrides.timerAction,
    },
    tasks: (overrides.tasks ?? []).map(modelTask),
  };
}
