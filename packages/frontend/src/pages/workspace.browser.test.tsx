import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
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
import { AppTheme } from '../components/AppTheme';
import { getTimerAccentColor } from '../config/colors';

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
    taskMode: 'general',
    taskQuickCreateFocusRequest: 0,
    taskSearchFocusRequest: 0,
    intentionPickerOpenRequest: 0,
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

function KeyboardWorkspace() {
  useKeyboardShortcuts();
  const expanded = useUiStore.use.expanded();
  return expanded ? (
    <Timer useTallSafeAreaFallback={false} />
  ) : (
    <MinimizedTimer />
  );
}

describe('Unified workspace', () => {
  it('repeats expansion, quick-create, search and destination shortcuts from focused inputs', async () => {
    useUiStore.setState({ taskQuickCreateFocusRequest: 1 });
    root.render(<KeyboardWorkspace />);
    const press = (code: string) => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', {
          code,
          key: code === 'Escape' ? 'Escape' : code.slice(3).toLowerCase(),
          metaKey: code !== 'Escape',
          bubbles: true,
          cancelable: true,
        })
      );
    };
    await vi.waitFor(() =>
      expect(host.querySelector('.quick-create-input input')).not.toBeNull()
    );
    for (const expanded of [false, true, false, true]) {
      press('KeyE');
      await vi.waitFor(() =>
        expect(useUiStore.getState().expanded).toBe(expanded)
      );
      if (expanded)
        await vi.waitFor(() =>
          expect(document.activeElement).toBe(
            host.querySelector('.quick-create-input input')
          )
        );
    }
    for (const code of ['KeyN', 'KeyT']) {
      const input = host.querySelector<HTMLInputElement>(
        '.quick-create-input input'
      )!;
      input.focus();
      press(code);
      await vi.waitFor(() => expect(document.activeElement).not.toBe(input));
      press(code);
      await vi.waitFor(() => expect(document.activeElement).toBe(input));
      press('Escape');
      expect(document.activeElement).not.toBe(input);
    }
    const search = host.querySelector<HTMLInputElement>(
      '[data-testid="task-search-field"] input'
    )!;
    press('KeyK');
    await vi.waitFor(() => expect(document.activeElement).toBe(search));
    press('KeyK');
    await vi.waitFor(() => expect(document.activeElement).not.toBe(search));
    press('KeyK');
    await vi.waitFor(() => expect(document.activeElement).toBe(search));
    press('Escape');
    expect(document.activeElement).not.toBe(search);
    const filter = host.querySelector(
      '[data-testid="task-intention-filter-trigger"]'
    )!;
    for (const expanded of ['true', 'false', 'true']) {
      press('KeyI');
      await vi.waitFor(() =>
        expect(filter.getAttribute('aria-expanded')).toBe(expanded)
      );
    }
    press('Escape');
    await vi.waitFor(() =>
      expect(filter.getAttribute('aria-expanded')).toBe('false')
    );
    usePreferencesStore.setState({
      preferences: { ...preferences, tasksShowInMinimizedTimer: true },
    });
    press('KeyE');
    await vi.waitFor(() => expect(useUiStore.getState().expanded).toBe(false));
    press('KeyK');
    const minimizedSearch = page.getByRole('searchbox');
    await expect.element(minimizedSearch).toHaveFocus();
    await minimizedSearch.fill('Read');
    press('KeyK');
    await expect.element(minimizedSearch).not.toHaveFocus();
    await expect.element(minimizedSearch).toHaveValue('Read');
    press('KeyK');
    await expect.element(minimizedSearch).toHaveFocus();
    press('Escape');
    await expect.element(minimizedSearch).not.toHaveFocus();
    press('KeyK');
    await expect.element(minimizedSearch).toHaveFocus();
  });
  it('shows only the current timer type even in All mode and search', async () => {
    useUiStore.setState({ taskMode: 'general' });
    useTasksStore.setState({
      tasks: ['work', 'break', 'longBreak'].map(type => ({
        ...tasks[0],
        id: `type-${type}`,
        title: `Only ${type}`,
        timerType: type,
      })) as Task[],
    });
    root.render(<KeyboardWorkspace />);
    for (const type of ['work', 'break', 'longBreak', 'work'] as const) {
      useTimerStore.setState({
        timer: { ...useTimerStore.getState().timer!, type },
      });
      await vi.waitFor(() => {
        const rows = host.querySelectorAll('[data-testid="task-row"]');
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain(`Only ${type}`);
      });
      await page
        .getByTestId('task-search-field')
        .getByRole('textbox')
        .fill('Only');
      expect(host.querySelectorAll('[data-testid="task-row"]')).toHaveLength(1);
    }
  });
  it('closes Sort and Filter with Escape and restores their trigger focus', async () => {
    root.render(<Timer useTallSafeAreaFallback={false} />);
    await vi.waitFor(() =>
      expect(host.querySelector('.workspace-filter-summary')).not.toBeNull()
    );
    for (const label of ['Default task order', 'Task filters']) {
      const trigger = page.getByRole('button', { name: label, exact: true });
      await trigger.click();
      await expect.element(trigger).toHaveAttribute('aria-expanded', 'true');
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        })
      );
      await expect.element(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect.element(trigger).toHaveFocus();
    }
  });
  it.each(['work', 'break', 'longBreak'] as const)(
    'uses the %s app accent for the tray',
    async type => {
      useTimerStore.setState({
        timer: { ...useTimerStore.getState().timer!, type },
      });
      root.render(
        <>
          <AppTheme />
          <span className="text-indigo-400">Accent</span>
        </>
      );
      await vi.waitFor(() =>
        expect(document.documentElement.dataset.timerAccent).toBe(type)
      );
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      context.fillStyle = getTimerAccentColor(type);
      const trayColor = context.fillStyle;
      context.fillStyle = getComputedStyle(host.querySelector('span')!).color;
      expect(context.fillStyle).toBe(trayColor);
    }
  );
  it.each([1, 2, 3, 4])(
    'centers %i favorite destinations between the pager and Reset',
    async count => {
      vi.spyOn(apiClient.intentions, 'list').mockResolvedValue({
        status: 200,
        body: intentions.map((item, index) => ({
          ...item,
          isFavorite: index < count,
        })),
      } as never);
      root.render(<Timer useTallSafeAreaFallback={false} />);
      await vi.waitFor(() =>
        expect(
          host.querySelectorAll('.favorite-destination-items button')
        ).toHaveLength(count)
      );
      const buttons = host.querySelectorAll(
        '.favorite-destination-items button'
      );
      const left = buttons[0].getBoundingClientRect().left;
      const right = buttons[count - 1].getBoundingClientRect().right;
      const pager = host
        .querySelector('.workspace-pagination')!
        .getBoundingClientRect();
      const reset = host
        .querySelector('.workspace-filter-actions > button')!
        .getBoundingClientRect();
      expect(
        Math.abs((left + right) / 2 - (pager.right + reset.left) / 2)
      ).toBeLessThan(2);
    }
  );
  it('fits six intentions and five two-line tasks below a centered timer', async () => {
    root.render(<Timer useTallSafeAreaFallback={false} />);
    await vi.waitFor(() =>
      expect(host.querySelectorAll('[data-testid="task-row"]')).toHaveLength(5)
    );
    const rows = Array.from(host.querySelectorAll('[data-testid="task-row"]'));
    expect(rows[4].getBoundingClientRect().bottom).toBeLessThanOrEqual(
      host.querySelector('.workspace-task-rows')!.getBoundingClientRect().bottom
    );
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
      expect(host.querySelector('[data-task-id="task-5"]')).not.toBeNull()
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
  it('handles Mod+G once and preserves a destination through timer updates', async () => {
    useUiStore.setState({ taskMode: 'general' });
    root.render(<KeyboardWorkspace />);
    await vi.waitFor(() =>
      expect(host.querySelector('[data-testid="task-row"]')).not.toBeNull()
    );
    const toggle = () =>
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', {
          code: 'KeyG',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    toggle();
    await vi.waitFor(() =>
      expect(useUiStore.getState().taskMode).toBe('intention')
    );
    toggle();
    await vi.waitFor(() =>
      expect(useUiStore.getState().taskMode).toBe('general')
    );
    await page.getByTestId('task-intention-filter-trigger').click();
    await page.getByTestId('task-intention-filter-work:intention-0').click();
    useTimerStore.setState({
      timer: {
        ...useTimerStore.getState().timer!,
        intention: 'intention-1',
        intentionSlugs: ['intention-1'],
      },
    });
    await expect
      .element(page.getByTestId('task-intention-filter-trigger'))
      .toHaveTextContent(intentions[0].title);
    toggle();
    await expect
      .element(page.getByTestId('task-intention-filter-trigger'))
      .toHaveTextContent('All');
    expect(useUiStore.getState().taskMode).toBe('general');
  });
  it('keeps every historical List page and its actions inside the desktop viewport', async () => {
    const list = {
      id: 'list-history',
      title: 'History',
      emoji: '📋',
      isFavorite: true,
      vacationDefault: false,
    };
    vi.spyOn(apiClient.lists, 'list').mockResolvedValue({
      status: 200,
      body: [list],
    } as never);
    vi.spyOn(apiClient.lists, 'items').mockResolvedValue({
      status: 200,
      body: Array.from({ length: 11 }, (_, index) => ({
        id: `history-${index}`,
        listId: list.id,
        title: `Historical item ${index}`,
        status: index < 6 ? 'completed' : 'archived',
        priority: 'normal',
        dueDate: null,
        vacationEligible: false,
        createdAt: '2026-09-01T12:00:00.000Z',
        updatedAt: '2026-09-01T12:00:00.000Z',
      })),
    } as never);
    root.render(<Timer useTallSafeAreaFallback={false} />);
    await page.getByTestId('task-intention-filter-trigger').click();
    await page.getByTestId('task-intention-filter-list:list-history').click();
    const seen = new Set<string>();
    for (let index = 0; index < 4; index += 1) {
      await vi.waitFor(() =>
        expect(
          host.querySelectorAll('[data-testid="list-item-row"]').length
        ).toBeGreaterThan(0)
      );
      for (const row of host.querySelectorAll<HTMLElement>(
        '[data-testid="list-item-row"]'
      )) {
        seen.add(row.dataset.listItemId!);
        expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(
          host.querySelector('.workspace-task-rows')!.getBoundingClientRect()
            .bottom
        );
      }
      if (index < 3)
        await page
          .getByRole('button', { name: 'Next page', exact: true })
          .click();
    }
    expect(seen.size).toBe(11);
  });
  it('loads Settings without changing hook order and keeps optional settings searchable', async () => {
    usePreferencesStore.setState({ preferences: null });
    root.render(<Settings />);
    await vi.waitFor(() => expect(host.textContent).toContain('Loading'));
    usePreferencesStore.setState({ preferences });
    await vi.waitFor(() =>
      expect(host.querySelector('#settings-search')).not.toBeNull()
    );
    expect(
      parseFloat(
        getComputedStyle(host.querySelector('.max-w-5xl')!).paddingBottom
      )
    ).toBe(24);
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
    await expect
      .element(page.getByLabelText('Task priority'))
      .not.toBeVisible();
    await page
      .getByRole('button', { name: 'More options', exact: true })
      .click();
    await expect.element(page.getByLabelText('Task priority')).toBeVisible();
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
    await dialog.getByRole('textbox').nth(0).fill('🎯');
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
