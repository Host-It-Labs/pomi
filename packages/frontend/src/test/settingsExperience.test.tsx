import type { Preferences, User } from '@pomi/shared';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SettingsSearchFilter,
  SettingsSectionFrame,
} from '../components/settings/SettingsExperience';

const mocks = vi.hoisted(() => ({
  user: { id: 'user-1', username: 'member', isAdmin: false } as User,
  preferences: {
    workTimerDuration: 25 * 60_000,
    breakTimerDuration: 5 * 60_000,
    autoStartBreak: false,
    notifications: true,
    taskReminderPriorities: ['high', 'urgent'],
    taskUrgentReminderRepeatEnabled: true,
    taskUrgentReminderRepeatIntervalMinutes: 30,
    sessionsExtension: false,
    sessionPomodorosCount: 3,
    sessionHasLongBreak: true,
    sessionLongBreakDuration: 15 * 60_000,
    intentionExtension: false,
    intentionShowDailyCount: false,
    intentionMultiSelect: false,
    tasksExtension: false,
    tasksShowInMinimizedTimer: false,
    assistantExtension: false,
  } as Preferences,
  loadPreferences: vi.fn().mockResolvedValue(undefined),
  setPreferences: vi.fn(),
  loadAssistantStatus: vi.fn().mockResolvedValue(undefined),
  setExpanded: vi.fn(),
  setActiveTab: vi.fn(),
  requestTaskCreate: vi.fn(),
  createOrResumeTimer: vi.fn(),
}));

vi.mock('../stores/preferencesStore', () => ({
  usePreferencesStore: {
    use: {
      preferences: () => mocks.preferences,
      loadPreferences: () => mocks.loadPreferences,
      setPreferences: () => mocks.setPreferences,
      updatePreferenceWithResult: () => vi.fn().mockResolvedValue(true),
    },
  },
}));

vi.mock('../stores/assistantStore', () => ({
  useAssistantStore: {
    use: {
      status: () => null,
      loadStatus: () => mocks.loadAssistantStatus,
    },
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: { use: { user: () => mocks.user } },
}));

vi.mock('../stores/timerStore', () => ({
  useTimerStore: {
    use: { createOrResumeTimer: () => mocks.createOrResumeTimer },
  },
}));

vi.mock('../stores/uiStore', () => ({
  useUiStore: {
    use: {
      setExpanded: () => mocks.setExpanded,
      setActiveTab: () => mocks.setActiveTab,
      requestTaskCreate: () => mocks.requestTaskCreate,
    },
  },
}));

vi.mock('../utils/osUtils', () => ({
  isTauri: false,
  isAndroid: false,
  isDesktop: false,
  isMobile: false,
  isIos: false,
  isMac: false,
  isWindows: false,
  isLinux: false,
  isDebugMobileSimulator: false,
  platformName: 'web',
}));

vi.mock('../utils/apiClient', () => ({
  apiClient: { tasks: { list: vi.fn() } },
}));
vi.mock('../utils/userActionQueue', () => ({
  submitUserMutation: vi.fn(),
}));

vi.mock('../components/BackButton', () => ({
  BackButton: () => <button type="button">Back</button>,
}));
vi.mock('../components/feedback/FeedbackModal', () => ({
  FeedbackModal: () => null,
}));
vi.mock('../components/descriptions/DescriptionWizardModal', () => ({
  DescriptionWizardModal: () => null,
}));
vi.mock('../components/tasks/TaskImportModal', () => ({
  TaskImportModal: () => null,
}));
vi.mock('../pages/extensions/SessionConfigModal', () => ({
  SessionConfigModal: () => null,
}));

vi.mock('../pages/GeneralSettings', () => ({
  GeneralSettings: ({ adminContent }: { adminContent?: React.ReactNode }) => (
    <div>
      <div data-setting-id="general-account">General controls</div>
      <div data-setting-id="settings-language">
        <label htmlFor="mock-language">Language</label>
        <select id="mock-language" aria-label="Language" />
      </div>
      <div data-setting-id="undoAlerts">
        Undo alerts Show what undo or redo changed.
      </div>
      {adminContent ? (
        <section>
          <h3>Admin</h3>
          {adminContent}
        </section>
      ) : null}
    </div>
  ),
}));
vi.mock('../pages/TimerSettings', () => ({
  TimerSettings: () => (
    <div>
      <div data-setting-id="focusLength">
        <button type="button">Focus length</button>
        <span>Length of each focus block.</span>
      </div>
      <div data-setting-id="autoStartBreak">Auto-start timers</div>
      <div data-setting-id="resetBreakOnFirstIntention">
        Reset timer on first Intention
      </div>
    </div>
  ),
}));
vi.mock('../pages/NotificationsSettings', () => ({
  NotificationsSettings: () => <div>Notification controls</div>,
}));
vi.mock('../pages/KeyboardShortcutsSettings', () => ({
  KeyboardShortcutsSettings: () => <div>Shortcut controls</div>,
}));
vi.mock('../pages/SessionSettings', () => ({
  SessionSettings: () => (
    <div data-setting-id="sessionShowEta">
      <button type="button">Show finish times</button>
      <span>Show expected finish times in the session view.</span>
    </div>
  ),
}));
vi.mock('../pages/IntentionSettings', () => ({
  IntentionSettings: () => (
    <div data-setting-id="intentionSubIntentions">
      <button type="button">Sub-intentions</button>
      <span>Organize intentions into nested sub-intentions.</span>
    </div>
  ),
}));
vi.mock('../pages/TaskSettings', () => ({
  TaskSettings: () => (
    <div data-setting-id="taskImport">
      <button type="button">Import Tasks</button>
    </div>
  ),
}));

vi.mock('../pages/AssistantSettings', () => ({
  AssistantSettings: () => (
    <div data-testid="ai-infrastructure">AI controls</div>
  ),
}));

import { Settings, settingsSearchMatches } from '../pages/Settings';

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 'user-1', username: 'member', isAdmin: false } as User;
  mocks.preferences.sessionsExtension = false;
  mocks.preferences.intentionExtension = false;
  mocks.preferences.tasksExtension = false;
  mocks.preferences.assistantExtension = false;
  window.scrollTo = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('Settings experience', () => {
  it('matches singular and plural search terms in either direction', () => {
    expect(settingsSearchMatches(['Break timer'], 'breaks')).toBe(true);
    expect(settingsSearchMatches(['Auto-start breaks'], 'break')).toBe(true);
    expect(settingsSearchMatches(['Work timer'], 'breaks')).toBe(false);
  });

  const sectionKeys = () =>
    Array.from(document.querySelectorAll<HTMLElement>('section[data-section]'))
      .map(section => section.dataset.section)
      .filter((key): key is string => Boolean(key));

  it('uses the same activation header and hides disabled feature controls', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <SettingsSectionFrame
        title="Tasks"
        icon={<span>T</span>}
        feature={{ enabled: false, onToggle }}
      >
        <div>Task configuration</div>
      </SettingsSectionFrame>
    );

    expect(screen.queryByText('Task configuration')).not.toBeInTheDocument();
    expect(screen.queryByText(/see its settings/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Enable Tasks' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('keeps only matching controls while preserving their group heading', () => {
    render(
      <SettingsSearchFilter active targetIds={['matching-setting']}>
        <section data-settings-control-group>
          <h3>Essentials</h3>
          <div data-setting-id="matching-setting">Matching setting</div>
          <div data-settings-separator />
          <div data-setting-id="other-setting">Other setting</div>
        </section>
      </SettingsSearchFilter>
    );

    expect(screen.getByText('Essentials')).toBeVisible();
    expect(screen.getByText('Matching setting')).toBeVisible();
    expect(screen.getByText('Other setting')).not.toBeVisible();
  });

  it('keeps an entire compound control visible when its parent target matches', () => {
    render(
      <SettingsSearchFilter active targetIds={['auto-start']}>
        <section data-settings-control-group>
          <div data-setting-id="auto-start">
            <div data-setting-id="auto-start-toggle">Auto-start timers</div>
            <div>Work Break Long break</div>
          </div>
          <div data-setting-id="other-setting">Other setting</div>
        </section>
      </SettingsSearchFilter>
    );

    expect(screen.getByText('Auto-start timers')).toBeVisible();
    expect(screen.getByText('Work Break Long break')).toBeVisible();
    expect(screen.getByText('Other setting')).not.toBeVisible();
  });

  it('does not render or mount Admin for non-admin users', () => {
    render(<Settings />);

    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByTestId('ai-infrastructure')).toBeNull();
  });

  it('finds AI administration in the General section for administrators', async () => {
    mocks.user = { id: 'admin-1', username: 'admin', isAdmin: true } as User;
    const user = userEvent.setup();
    render(<Settings />);
    await user.type(
      screen.getByRole('searchbox', { name: 'Search' }),
      'AI administration'
    );
    expect(sectionKeys()).toEqual(['general']);
    expect(screen.queryByTestId('ai-infrastructure')).toBeNull();
  });

  it('filters sections and their individual controls with a trimmed case-insensitive query', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const search = screen.getByRole('searchbox', { name: 'Search' });
    await user.type(search, '  NOTIFICATIONS  ');

    expect(sectionKeys()).toEqual(['notifications', 'tasks']);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('keeps badge-matched timer controls and the Language control visible', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const search = screen.getByRole('searchbox', { name: 'Search' });
    await user.type(search, 'break');

    expect(screen.getByText('Auto-start timers')).toBeVisible();
    expect(screen.getByText('Reset timer on first Intention')).toBeVisible();

    await user.clear(search);
    await user.type(search, 'work');
    expect(screen.getByText('Auto-start timers')).toBeVisible();
    expect(screen.getByText('Reset timer on first Intention')).toBeVisible();

    await user.clear(search);
    await user.type(search, 'language');

    expect(sectionKeys()).toEqual(['general']);
    expect(screen.getByLabelText('Language')).toBeVisible();
  });

  it('uses only the native search clear affordance', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const search = screen.getByRole('searchbox', { name: 'Search' });
    await user.type(search, 'task');
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(search).toHaveValue('task');
  });

  it('announces an empty search result without rendering section blocks', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.type(
      screen.getByRole('searchbox', { name: 'Search' }),
      'no such setting'
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'No matching settings sections'
    );
    expect(sectionKeys()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('matches a translated control description without highlighting or moving focus', async () => {
    const user = userEvent.setup();
    mocks.preferences.intentionExtension = true;
    render(<Settings />);

    const search = screen.getByRole('searchbox', { name: 'Search' });
    await user.type(search, 'nested sub-intentions');

    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();

    const target = document.querySelector<HTMLElement>(
      'section[data-section="intentions"]'
    );
    expect(target).not.toBeNull();
    expect(sectionKeys()).toEqual(['intentions']);
    expect(
      target?.querySelector('[data-setting-id="intentionSubIntentions"]')
    ).toBeVisible();

    await user.keyboard('{Enter}');

    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(search).toHaveFocus();
  });

  it('keeps the activation action available when a matching feature is disabled', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const search = screen.getByRole('searchbox', { name: 'Search' });
    await user.type(search, 'sub-intentions');

    const enableIntentions = screen.getByRole('button', {
      name: 'Enable Intentions',
    });
    expect(enableIntentions).toBeVisible();

    await user.keyboard('{Enter}');

    expect(search).toHaveFocus();
  });
});
