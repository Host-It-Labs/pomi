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
import { usePreferencesStore } from '../stores/preferencesStore';
import { useTimerStore } from '../stores/timerStore';
import { useTasksStore } from '../stores/tasksStore';
import { useUiStore } from '../stores/uiStore';
import { useAuthStore } from '../stores/authStore';
import { useAssistantStore } from '../stores/assistantStore';
import { apiClient } from '../utils/apiClient';
import { setLanguage } from '../i18n';

vi.mock('../utils/desktopNotificationHandler', () => ({
  desktopNotificationHandler: {
    checkPermission: vi.fn(),
    requestPermission: vi.fn(),
  },
}));
const device = vi.hoisted(() => ({ mobile: false }));
vi.mock('../utils/osUtils', async importOriginal => ({
  ...(await importOriginal<object>()),
  isDesktop: false,
  isMac: true,
  isMobile: true,
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

describe('Mobile workspace', () => {
  it('keeps mobile tasks scrollable and nine intention slots readable in French', async () => {
    device.mobile = true;
    await page.viewport(360, 640);
    host.style.height = '640px';
    setLanguage('fr', { persist: false });
    root.render(<Timer useTallSafeAreaFallback={false} />);
    await vi.waitFor(() =>
      expect(host.querySelectorAll('[data-testid="task-row"]')).toHaveLength(8)
    );
    expect(host.scrollWidth).toBeLessThanOrEqual(360);
    expect(
      host.querySelector('.compact-countdown')!.getBoundingClientRect().width
    ).toBeGreaterThan(70);
    await page.screenshot({
      path: '.scratch/workspace-verification/workspace-mobile.png',
    });
  });
});
