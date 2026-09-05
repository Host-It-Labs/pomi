import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type {
  Intention,
  Preferences,
  Task,
  Timer as TimerState,
} from '@pomi/shared';
import '../App.css';
import { Timer } from './Timer';
import { Settings } from './Settings';
import { TaskFormModal } from '../components/tasks/TaskFormModal';
import { MinimizedTimer } from './MinimizedTimer';
import * as userActions from '../utils/userActionQueue';
import { AiAdministration } from './AiAdministration';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useTimerStore } from '../stores/timerStore';
import { useTasksStore } from '../stores/tasksStore';
import { useUiStore } from '../stores/uiStore';
import { useAuthStore } from '../stores/authStore';
import { useAssistantStore } from '../stores/assistantStore';
import { apiClient } from '../utils/apiClient';
import { setLanguage } from '../i18n';

vi.mock('../utils/userActionQueue', { spy: true });
vi.mock('../utils/desktopNotificationHandler', () => ({
  desktopNotificationHandler: {
    checkPermission: vi.fn(),
    requestPermission: vi.fn(),
  },
}));
const device = vi.hoisted(() => ({ mobile: false }));
vi.mock('../utils/osUtils', async importOriginal => ({
  ...(await importOriginal<object>()),
  get isDesktop() {
    return !device.mobile;
  },
  isMac: true,
  get isMobile() {
    return device.mobile;
  },
  isTauri: false,
}));
const preferences = {
  id: 'workspace-preferences',
  language: 'en',
  timeZone: 'UTC',
  workTimerDuration: 1500000,
  breakTimerDuration: 300000,
  sessionLongBreakDuration: 900000,
  sessionPomodorosCount: 3,
  keyboardShortcuts: true,
  sessionHasLongBreak: true,
  sessionsExtension: true,
  tasksExtension: true,
  intentionExtension: true,
  intentionHabits: true,
  intentionSubIntentions: true,
  intentionCustomDurations: true,
  sessionShowEta: true,
  listsExtension: true,
  taskDefaultSortMode: 'default',
  taskDefaultDueDateMode: 'none',
  taskReminderPriorities: ['high'],
  hiddenHelpTips: [],
  dismissedSettingSuggestions: [],
} as unknown as Preferences;
const intentions = Array.from({ length: 9 }, (_, index) => ({
  id: `intention-${index}`,
  slug: `intention-${index}`,
  title: [
    'Write',
    'Read',
    'Learn',
    'Build',
    'Plan',
    'Move',
    'Practice',
    'Reflect',
    'Rest',
  ][index],
  emoji: ['✍️', '📚', '🌱', '🛠️', '📝', '🌿', '🎹', '☕', '🍵'][index],
  type: 'work',
  isHabit: index < 3,
  habitCadence: index < 3 ? 'daily' : 'off',
  createdAt: '2026-09-01T12:00:00.000Z',
})) as Intention[];
const tasks = Array.from({ length: 8 }, (_, index) => ({
  id: `task-${index}`,
  title: `Read the project notes and prepare a thoughtful response for tomorrow ${index + 1}`,
  slug: `task-${index}`,
  status: 'active',
  timerType: 'work',
  priority: 'normal',
  pinnedAt: null,
  intentionSlug: null,
  subIntentionSlug: null,
  dueDate: null,
  description: 'A useful note for this task.',
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
})) as unknown as Task[];
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  device.mobile = false;
  await page.viewport(440, 700);
  setLanguage('en', { persist: false });
  host = document.createElement('div');
  host.style.height = '700px';
  document.body.append(host);
  root = createRoot(host);
  useUiStore.setState({
    expanded: true,
    activeTab: 'timer',
    taskCreateRequested: false,
  });
  usePreferencesStore.setState({
    preferences,
    loadPreferences: vi.fn().mockResolvedValue(undefined),
  });
  useAuthStore.setState({
    user: { id: 'user', username: 'copyme', isAdmin: true } as never,
  });
  useAssistantStore.setState({
    status: null,
    loadStatus: vi.fn().mockResolvedValue(undefined),
  });
  useTimerStore.setState({
    timer: {
      id: 'timer',
      type: 'work',
      status: 'running',
      duration: 1500000,
      remainingTime: 1000000,
      sessionPosition: 1,
      sessionTotal: 3,
      intention: 'intention-0',
    } as TimerState,
    connectionStatus: {
      isConnected: true,
      isReconnecting: false,
      isWaitingForServer: false,
      reconnectAttempts: 0,
      lastError: null,
    },
    extensionState: null,
  });
  useTasksStore.setState({
    tasks,
    isLoading: false,
    loadTasks: vi.fn().mockResolvedValue(undefined),
    completingTaskIds: [],
  });
  vi.spyOn(apiClient.intentions, 'list').mockResolvedValue({
    status: 200,
    body: intentions,
  } as never);
  vi.spyOn(apiClient.lists, 'list').mockResolvedValue({
    status: 200,
    body: [],
  } as never);
  vi.spyOn(apiClient.lists, 'items').mockResolvedValue({
    status: 200,
    body: [],
  } as never);
  vi.spyOn(apiClient.tasks, 'importStatus').mockResolvedValue({
    status: 200,
    body: { hasImportedTasks: true },
  } as never);
});
afterEach(() => {
  root?.unmount();
  host?.remove();
  vi.restoreAllMocks();
});

describe('Unified workspace', () => {
  it('fits nine intentions and four two-line tasks below a centered timer', async () => {
    root.render(<Timer useTallSafeAreaFallback={false} />);
    await vi.waitFor(() =>
      expect(host.querySelectorAll('[data-testid="task-row"]')).toHaveLength(4)
    );
    const rows = Array.from(host.querySelectorAll('[data-testid="task-row"]'));
    expect(rows[3].getBoundingClientRect().bottom).toBeLessThanOrEqual(674);
    const countdown = host
      .querySelector('.compact-countdown')!
      .getBoundingClientRect();
    expect(Math.abs(countdown.x + countdown.width / 2 - 220)).toBeLessThan(2);
    await vi.waitFor(() => expect(host.scrollWidth).toBeLessThanOrEqual(440));
    await page.screenshot({
      path: '.scratch/workspace-verification/workspace-desktop.png',
    });
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    await vi.waitFor(() =>
      expect(host.querySelector('[data-task-id="task-4"]')).not.toBeNull()
    );
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        code: 'KeyF',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })
    );
    await vi.waitFor(() =>
      expect(host.querySelector('[data-task-id="task-0"]')).not.toBeNull()
    );
  });
  it('loads Settings without changing hook order and keeps optional settings searchable', async () => {
    usePreferencesStore.setState({ preferences: null });
    root.render(<Settings />);
    await vi.waitFor(() => expect(host.textContent).toContain('Loading'));
    usePreferencesStore.setState({ preferences });
    await vi.waitFor(() =>
      expect(host.querySelector('#settings-search')).not.toBeNull()
    );
    await page.screenshot({
      path: '.scratch/workspace-verification/settings-desktop.png',
    });
    await page.getByRole('searchbox').fill('duration');
    await vi.waitFor(() => expect(host.textContent).toContain('duration'));
  });
  it('keeps task essentials visible and preserves text through sheet expansion', async () => {
    root.render(
      <TaskFormModal
        isOpen
        task={null}
        intentions={intentions}
        lists={[]}
        preferences={preferences}
        timer={null}
        taskMode="general"
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onArchive={vi.fn()}
        onCreateListItem={vi.fn()}
        onConvertToListItem={vi.fn()}
      />
    );
    await page
      .getByRole('textbox', { name: 'Task title' })
      .fill('Keep my draft');
    await expect.element(page.getByLabelText('Task description')).toBeVisible();
    await expect.element(page.getByLabelText('Task due date')).toBeVisible();
    await expect.element(page.getByLabelText('Task priority')).toBeVisible();
    await page
      .getByRole('button', { name: 'More options', exact: true })
      .click();
    await expect
      .element(page.getByRole('textbox', { name: 'Task title' }))
      .toHaveValue('Keep my draft');
    await page.screenshot({
      path: '.scratch/workspace-verification/task-editor.png',
    });
  });
  it('renders the compact timer and denies infrastructure controls to non-admins', async () => {
    await page.viewport(440, 96);
    host.style.height = '96px';
    useUiStore.setState({ expanded: false });
    root.render(<MinimizedTimer />);
    await vi.waitFor(() =>
      expect(host.querySelector('.compact-countdown')).not.toBeNull()
    );
    await vi.waitFor(() => expect(host.scrollWidth).toBeLessThanOrEqual(440));
    await page.screenshot({
      path: '.scratch/workspace-verification/minimized.png',
    });
    useAuthStore.setState({ user: { id: 'user', isAdmin: false } as never });
    root.render(<AiAdministration />);
    await expect.element(page.getByRole('alert')).toBeVisible();
  });
  it('opens a content-sized intention sheet without changing the workspace behind it', async () => {
    root.render(<Timer useTallSafeAreaFallback={false} />);
    await vi.waitFor(() =>
      expect(
        host.querySelector('[data-testid="expanded-intentions-grid"]')
      ).not.toBeNull()
    );
    useUiStore.getState().requestIntentionCreate();
    const dialog = page.getByRole('dialog', { name: 'New Intention' });
    await expect.element(dialog).toBeVisible();
    const fields = document.querySelectorAll<HTMLInputElement>(
      '[role="dialog"] input[type="text"]'
    );
    await dialog.getByRole('textbox').nth(1).fill('New intention');
    expect(fields.length).toBeGreaterThanOrEqual(2);
    await vi.waitFor(() => {
      const body = document.querySelector('[role="dialog"] form > div')!;
      expect(body.scrollHeight).toBeLessThanOrEqual(body.clientHeight + 1);
    });
    expect(useUiStore.getState().activeTab).toBe('timer');
    await page.screenshot({
      path: '.scratch/workspace-verification/intention-editor.png',
    });
    vi.spyOn(userActions, 'submitUserMutation').mockResolvedValue({
      title: 'New intention',
    } as never);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(useUiStore.getState().activeTab).toBe('timer');
  });
});
