import type { Preferences, User } from '@pomi/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsSectionFrame } from '../components/settings/SettingsExperience';

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
    <div data-setting-id="focusLength">
      <button type="button">Focus length</button>
      <span>Length of each focus block.</span>
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

import { Settings } from '../pages/Settings';

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

  it('does not render or mount Admin for non-admin users', () => {
    render(<Settings />);

    const toolbar = screen.getByRole('navigation');
    expect(within(toolbar).queryByRole('button', { name: 'Admin' })).toBeNull();
    expect(screen.queryByTestId('ai-infrastructure')).toBeNull();
  });

  it('mounts Admin inside General without adding navigation', () => {
    mocks.user = {
      id: 'admin-1',
      username: 'admin',
      isAdmin: true,
    } as User;
    render(<Settings />);

    const toolbar = screen.getByRole('navigation');
    expect(within(toolbar).queryByRole('button', { name: 'Admin' })).toBeNull();
    expect(screen.getByTestId('ai-infrastructure')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Admin' })).toBeVisible();
  });

  it('filters section navigation and content with a trimmed case-insensitive query', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const search = screen.getByRole('searchbox', { name: 'Search' });
    await user.type(search, '  NOTIFICATIONS  ');

    expect(sectionKeys()).toEqual(['notifications', 'tasks']);
    const navigation = screen.getByRole('navigation');
    expect(
      within(navigation).getByRole('button', { name: 'Notifications' })
    ).toBeVisible();
    expect(
      within(navigation).queryByRole('button', { name: 'General' })
    ).toBeNull();
    expect(
      within(navigation).getByRole('button', { name: 'Tasks' })
    ).toBeVisible();
  });

  it('exposes an accessible clear action that restores all visible sections', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const search = screen.getByRole('searchbox', { name: 'Search' });
    const clear = screen.getByRole('button', { name: 'Clear' });
    expect(clear).toBeDisabled();

    await user.type(search, 'task');
    expect(clear).toBeEnabled();
    clear.focus();
    await user.keyboard('{Enter}');

    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(sectionKeys()).toHaveLength(6);
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
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
  });

  it('matches a translated control description and highlights its control', async () => {
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
    ).toHaveAttribute('data-settings-search-match', 'true');

    await user.keyboard('{Enter}');

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledOnce();

    expect(
      target?.querySelector('[data-setting-id="intentionSubIntentions"] button')
    ).toHaveFocus();
  });

  it('focuses the activation action when a matching feature is disabled', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const search = screen.getByRole('searchbox', { name: 'Search' });
    await user.type(search, 'sub-intentions');

    const enableIntentions = screen.getByRole('button', {
      name: 'Enable Intentions',
    });
    expect(enableIntentions).toHaveAttribute(
      'data-settings-search-match',
      'true'
    );

    await user.keyboard('{Enter}');

    expect(enableIntentions).toHaveFocus();
  });
});
