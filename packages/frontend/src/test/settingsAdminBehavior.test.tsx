import type { AssistantModelOption, Preferences, User } from '@pomi/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import { AssistantSettings } from '../pages/AssistantSettings';
import { GeneralSettings } from '../pages/GeneralSettings';
import { TimerSettings } from '../pages/TimerSettings';
import { setLanguage } from '../i18n';

const mocks = vi.hoisted(() => ({
  user: null as User | null,
  signOut: vi.fn(),
  setActiveTab: vi.fn(),
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: {
    use: {
      user: () => mocks.user,
      signOut: () => mocks.signOut,
    },
  },
}));

vi.mock('../stores/uiStore', () => ({
  useUiStore: { use: { setActiveTab: () => mocks.setActiveTab } },
}));

vi.mock('../utils/userActionQueue', () => ({
  submitUserMutation: async ({
    payload,
    reconcile,
  }: {
    payload: { payload: unknown };
    reconcile?: (result: unknown) => Promise<void>;
  }) => {
    const response = await fetch('http://localhost:3000/assistant/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload.payload),
    });
    const body = await response.json();
    if (response.ok) {
      await reconcile?.(body);
    }
    return { status: response.status, body };
  },
}));

const assistantSettings = {
  textModel: 'openai/gpt-4.1-mini',
  transcriptionModel: 'openai/gpt-4o-mini-transcribe',
  speechModel: 'google/gemini-3.1-flash-tts-preview',
  speechVoice: 'Zephyr',
  assistantRecordingMaxMinutes: 10,
  usageBudgetPeriod: 'daily' as const,
  usageBudgetCapUsd: null,
  apiKeyConfigured: true,
};

const models: AssistantModelOption[] = [
  {
    id: 'openai/gpt-4.1-mini',
    name: 'OpenAI: GPT-4.1 Mini',
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportedParameters: [],
    supportedVoices: null,
  },
  {
    id: 'google/gemini-3.5-flash-lite',
    name: 'Google: Gemini 3.5 Flash Lite',
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportedParameters: [],
    supportedVoices: null,
  },
];

const server = setupServer(
  http.get('http://localhost:3000/assistant/settings', () =>
    HttpResponse.json(assistantSettings)
  ),
  http.get('http://localhost:3000/assistant/models', ({ request }) => {
    const output = new URL(request.url).searchParams.get('outputModalities');
    if (output === 'transcription') {
      return HttpResponse.json([
        {
          ...models[0],
          id: 'openai/gpt-4o-mini-transcribe',
          name: 'OpenAI: GPT-4o Mini Transcribe',
          inputModalities: ['audio'],
          outputModalities: ['transcription'],
        },
        {
          ...models[0],
          id: 'nvidia/parakeet-tdt-0.6b-v3',
          name: 'NVIDIA: Parakeet TDT 0.6B v3',
          inputModalities: ['audio'],
          outputModalities: ['transcription'],
        },
      ]);
    }
    if (output === 'speech') {
      return HttpResponse.json([
        {
          ...models[0],
          id: 'google/gemini-3.1-flash-tts-preview',
          name: 'Google: Gemini 3.1 Flash TTS Preview',
          supportedVoices: ['Zephyr'],
        },
        {
          ...models[0],
          id: 'hexgrad/kokoro-82m',
          name: 'hexgrad: Kokoro 82M',
          supportedVoices: ['af_alloy'],
        },
      ]);
    }
    return HttpResponse.json(models);
  }),
  http.patch(
    'http://localhost:3000/assistant/settings',
    async ({ request }) => {
      const updates = (await request.json()) as Partial<
        typeof assistantSettings
      >;
      return HttpResponse.json({ ...assistantSettings, ...updates });
    }
  )
);

const preferences = (overrides: Partial<Preferences>) =>
  ({
    workTimerDuration: 25 * 60_000,
    breakTimerDuration: 5 * 60_000,
    autoStartBreak: true,
    advancedSkip: false,
    timerExtension: false,
    undoAlerts: true,
    hiddenHelpTips: [],
    ...overrides,
  }) as Preferences;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  setLanguage('en', { persist: false });
});
afterAll(() => server.close());

beforeEach(() => {
  setLanguage('en', { persist: false });
  mocks.user = { id: 'user', username: 'developer', isAdmin: false } as User;
  mocks.signOut.mockReset();
  mocks.setActiveTab.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('Settings and admin behavior replacements', () => {
  it('allows auto-start breaks and Timer extension to coexist', async () => {
    const updatePreference = vi.fn().mockResolvedValue(undefined);
    render(
      <TimerSettings
        preferences={preferences({
          autoStartBreak: true,
          timerExtension: true,
        })}
        updatePreference={updatePreference}
        workMinutes={25}
        breakMinutes={5}
      />
    );

    expect(screen.getByLabelText('Auto-start breaks')).not.toBeDisabled();
    const labels = [
      screen.getByText('Save time when skipping'),
      screen.getByText('Keep going after a timer'),
    ];
    expect(labels.map(label => label.textContent)).toEqual([
      'Save time when skipping',
      'Keep going after a timer',
    ]);

    fireEvent.click(screen.getByLabelText('Keep going after a timer'));
    expect(updatePreference).toHaveBeenCalledWith('timerExtension', false);
  });

  it('documents General settings debug entry and durable preference intent', async () => {
    const updatePreference = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <GeneralSettings
        preferences={preferences({ hiddenHelpTips: ['timer-tip'] })}
        updatePreference={updatePreference}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Open Debug Panel' }));
    expect(mocks.setActiveTab).toHaveBeenCalledWith('debug');
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(updatePreference).toHaveBeenCalledWith('hiddenHelpTips', []);
    await user.click(screen.getByLabelText('Undo alerts'));
    expect(updatePreference).toHaveBeenCalledWith('undoAlerts', false);
  });

  it('updates the account language immediately from General settings', async () => {
    const updatePreference = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <GeneralSettings
        preferences={preferences({})}
        updatePreference={updatePreference}
      />
    );

    await user.selectOptions(screen.getByLabelText('Language'), 'ar');

    expect(updatePreference).toHaveBeenCalledWith('language', 'ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('rolls back the language and persisted locale when saving fails', async () => {
    const updateLanguagePreference = vi.fn().mockResolvedValue(false);
    const reloadPreferences = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    setLanguage('en', { persist: true });
    render(
      <GeneralSettings
        preferences={preferences({})}
        updatePreference={vi.fn().mockResolvedValue(undefined)}
        updateLanguagePreference={updateLanguagePreference}
        reloadPreferences={reloadPreferences}
      />
    );

    await user.selectOptions(screen.getByLabelText('Language'), 'ar');

    await waitFor(() =>
      expect(updateLanguagePreference).toHaveBeenCalledWith('ar')
    );
    expect(reloadPreferences).toHaveBeenCalledWith({ syncTimeZone: false });
    expect(screen.getByLabelText('Language')).toHaveValue('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(localStorage.getItem('pomi-locale')).toBe('en');
  });

  it('loads recommended Assistant models through HTTP and preserves an explicit save failure', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<AssistantSettings onSaved={onSaved} />);

    const taskModel = await screen.findByLabelText('AI Task capture model');
    expect(taskModel.querySelectorAll('option')[1]).toHaveTextContent(
      'Recommended - Google: Gemini 3.5 Flash Lite'
    );
    expect(
      screen
        .getByLabelText('Voice transcription model')
        .querySelectorAll('option')[1]
    ).toHaveTextContent('Recommended - NVIDIA: Parakeet TDT 0.6B v3');
    expect(
      screen.getByLabelText('Spoken reply model').querySelectorAll('option')[1]
    ).toHaveTextContent('Recommended - hexgrad: Kokoro 82M');

    server.use(
      http.patch('http://localhost:3000/assistant/settings', () =>
        HttpResponse.json({ message: 'Admin policy denied' }, { status: 403 })
      )
    );
    await user.selectOptions(taskModel, 'google/gemini-3.5-flash-lite');
    await waitFor(() =>
      expect(screen.getByText('Admin policy denied')).toBeVisible()
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('reconciles a saved Assistant setting after the explicit load-attempt cap', async () => {
    let settingsReads = 0;
    server.use(
      http.get('http://localhost:3000/assistant/settings', () => {
        settingsReads += 1;
        return settingsReads < 3
          ? HttpResponse.json({ message: 'temporary failure' }, { status: 503 })
          : HttpResponse.json(assistantSettings);
      })
    );

    const user = userEvent.setup();
    render(<AssistantSettings onSaved={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    const taskModel = await screen.findByLabelText('AI Task capture model');
    await user.selectOptions(taskModel, 'google/gemini-3.5-flash-lite');

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('AI settings saved.')
    );
    expect(settingsReads).toBe(4);
  });
});
