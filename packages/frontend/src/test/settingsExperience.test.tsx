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
      General controls
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
  TimerSettings: () => <div>Timer controls</div>,
}));
vi.mock('../pages/NotificationsSettings', () => ({
  NotificationsSettings: () => <div>Notification controls</div>,
}));
vi.mock('../pages/KeyboardShortcutsSettings', () => ({
  KeyboardShortcutsSettings: () => <div>Shortcut controls</div>,
}));
vi.mock('../pages/SessionSettings', () => ({
  SessionSettings: () => <div>Session controls</div>,
}));
vi.mock('../pages/IntentionSettings', () => ({
  IntentionSettings: () => <div>Intention controls</div>,
}));
vi.mock('../pages/TaskSettings', () => ({
  TaskSettings: () => <div>Task controls</div>,
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
  window.scrollTo = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
});

describe('Settings experience', () => {
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
});
