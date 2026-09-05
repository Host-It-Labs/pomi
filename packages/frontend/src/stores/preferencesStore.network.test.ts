import type { Preferences } from '@pomi/shared';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { usePreferencesStore } from './preferencesStore';

const gateway = vi.hoisted(() => ({
  submitUserMutation: vi.fn(),
}));

vi.mock('../utils/userActionQueue', () => ({
  submitUserMutation: gateway.submitUserMutation,
}));

const preferences = (overrides: Partial<Preferences>): Preferences => ({
  language: 'en',
  workTimerDuration: 25 * 60_000,
  breakTimerDuration: 5 * 60_000,
  autoStartBreak: false,
  notifications: true,
  notifyOnWorkComplete: true,
  notifyOnBreakComplete: true,
  notifyBeforeWorkComplete: false,
  notifyBeforeTime: 60,
  soundNotifications: true,
  pushNotifications: false,
  timeZone: 'UTC',
  globalShortcut: false,
  keyboardShortcuts: true,
  intentionExtension: true,
  intentionRequireSelection: false,
  intentionShowDailyCount: true,
  intentionBreakIntentions: false,
  intentionMultiSelect: false,
  intentionShowBreakIntentionsInLongBreak: false,
  intentionCustomDurations: false,
  intentionSubIntentions: true,
  intentionHabits: false,
  workTimerLogsExtension: true,
  sessionsExtension: true,
  sessionPomodorosCount: 4,
  sessionHasLongBreak: true,
  sessionLongBreakDuration: 15 * 60_000,
  resetBreakOnFirstIntention: false,
  resetLongBreakOnFirstIntention: false,
  sessionShowLongBreakButton: true,
  sessionShowEta: true,
  sessionStackTimers: false,
  sessionAutoDetectLongBreak: true,
  keepScreenAwake: false,
  undoAlerts: true,
  advancedSkip: false,
  timerExtension: false,
  timerExtrasSeen: false,
  sessionsExtrasSeen: false,
  intentionsExtrasSeen: false,
  assistantExtension: false,
  assistantTaskTranscriptsEnabled: false,
  assistantTaskTranscriptMinWords: 15,
  tasksExtension: true,
  tasksShowSetupPrompts: true,
  tasksShowInMinimizedTimer: false,
  tasksAutoSwitchToIntentionMode: false,

  taskDefaultDueDateMode: 'off',
  taskDefaultDueDateDays: 1,
  taskDefaultSortMode: 'default',
  hiddenHelpTips: [],
  dismissedSettingSuggestions: [],
  taskReminderPriorities: ['high', 'urgent'],
  taskBeforeDueReminderMinutes: 30,
  taskUrgentReminderRepeatEnabled: true,
  taskUrgentReminderRepeatIntervalMinutes: 15,
  ...overrides,
});

let authoritative = preferences({});
const server = setupServer(
  http.get('http://localhost:3000/preferences', () =>
    HttpResponse.json(authoritative)
  ),
  http.put('http://localhost:3000/preferences', async ({ request }) => {
    const updates = (await request.json()) as Partial<Preferences>;
    authoritative = { ...authoritative, ...updates };
    return HttpResponse.json(authoritative);
  })
);

const resetStore = () => {
  usePreferencesStore.setState({
    preferences: null,
    isLoading: false,
    hasLoaded: false,
    loadError: null,
  });
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetStore();
});
afterAll(() => server.close());

beforeEach(() => {
  authoritative = preferences({});
  resetStore();
  gateway.submitUserMutation.mockReset();
  gateway.submitUserMutation.mockImplementation(
    async ({ payload }: { payload: { updates: Partial<Preferences> } }) => {
      authoritative = { ...authoritative, ...payload.updates };
      return { status: 200, body: authoritative };
    }
  );
});

describe('preferences store network boundary', () => {
  it('documents cross-client settings synchronization by replacing local state with the next authoritative read', async () => {
    await usePreferencesStore
      .getState()
      .loadPreferences({ syncTimeZone: false });
    expect(usePreferencesStore.getState().preferences?.autoStartBreak).toBe(
      false
    );

    authoritative = preferences({
      autoStartBreak: true,
      workTimerDuration: 50 * 60_000,
    });
    await usePreferencesStore
      .getState()
      .loadPreferences({ syncTimeZone: false });

    expect(usePreferencesStore.getState().preferences).toMatchObject({
      autoStartBreak: true,
      workTimerDuration: 50 * 60_000,
    });
  });

  it('documents durable preference saves and preserves confirmed settings when saving fails', async () => {
    await usePreferencesStore
      .getState()
      .loadPreferences({ syncTimeZone: false });
    const saved = await usePreferencesStore
      .getState()
      .updatePreferenceWithResult('autoStartBreak', true);
    expect(saved).toBe(true);
    expect(usePreferencesStore.getState().preferences?.autoStartBreak).toBe(
      true
    );
    expect(gateway.submitUserMutation).toHaveBeenCalledWith(
      expect.not.objectContaining({ reconcile: expect.any(Function) })
    );

    gateway.submitUserMutation.mockRejectedValueOnce(
      new Error('Failed to save')
    );
    const rejected = await usePreferencesStore
      .getState()
      .updatePreferenceWithResult('autoStartBreak', false);

    expect(rejected).toBe(false);
    expect(usePreferencesStore.getState().preferences?.autoStartBreak).toBe(
      true
    );
    expect(usePreferencesStore.getState().loadError).toBeNull();
  });

  it('documents bootstrap recovery: a failed settings read remains retryable and does not invent preferences', async () => {
    server.use(
      http.get('http://localhost:3000/preferences', () =>
        HttpResponse.json(
          { message: 'Preferences unavailable' },
          { status: 503 }
        )
      )
    );

    await usePreferencesStore
      .getState()
      .loadPreferences({ syncTimeZone: false });
    expect(usePreferencesStore.getState()).toMatchObject({
      preferences: null,
      hasLoaded: false,
      isLoading: false,
      loadError: 'Preferences unavailable',
    });

    server.use(
      http.get('http://localhost:3000/preferences', () =>
        HttpResponse.json(authoritative)
      )
    );
    await usePreferencesStore
      .getState()
      .loadPreferences({ syncTimeZone: false });

    expect(usePreferencesStore.getState()).toMatchObject({
      preferences: authoritative,
      hasLoaded: true,
      isLoading: false,
      loadError: null,
    });
  });
});
