import { getCurrentWindow } from '@tauri-apps/api/window';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { useEffect } from 'react';
import { useI18n } from '../i18n';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useTasksStore } from '../stores/tasksStore';
import { useTimerStore } from '../stores/timerStore';
import { type HistorySource, useUiStore } from '../stores/uiStore';
import { shouldOpenAdvancedSkipModal } from '../utils/advancedSkip';
import { getLongBreakSwitchAction } from '../utils/longBreakSwitch';
import { hasOpenModal } from '../utils/modalRegistry';
import { isDesktop, isLinux } from '../utils/osUtils';
import { canStackSessionTimer } from '../utils/sessionStacking';

export function useKeyboardShortcuts() {
  const { t } = useI18n();
  const timer = useTimerStore.use.timer();
  const toggleTimer = useTimerStore.use.toggleTimer();
  const resetTimer = useTimerStore.use.resetTimer();
  const skipTimer = useTimerStore.use.skipTimer();
  const undoVisible = useTimerStore.use.undoVisible();
  const redoVisible = useTimerStore.use.redoVisible();
  const undoLastTimerAction = useTimerStore.use.undoLastTimerAction();
  const redoLastTimerAction = useTimerStore.use.redoLastTimerAction();
  const canUndoTask = useTasksStore.use.canUndo();
  const canRedoTask = useTasksStore.use.canRedo();
  const undoTaskAction = useTasksStore.use.undoTaskAction();
  const redoTaskAction = useTasksStore.use.redoTaskAction();
  const addFiveMinutesTimer = useTimerStore.use.addFiveMinutesTimer();
  const startLongBreakTimer = useTimerStore.use.startLongBreakTimer();
  const convertLongBreakToBreak = useTimerStore.use.convertLongBreakToBreak();
  const setSessionPosition = useTimerStore.use.setSessionPosition();
  const stackTimer = useTimerStore.use.stackTimer();
  const extensionState = useTimerStore.use.extensionState();
  const connectionStatus = useTimerStore.use.connectionStatus();
  const activeTab = useUiStore.use.activeTab();
  const setActiveTab = useUiStore.use.setActiveTab();
  const requestTaskModeToggle = useUiStore.use.requestTaskModeToggle();
  const requestIntentionPickerOpen =
    useUiStore.use.requestIntentionPickerOpen();
  const requestTaskSearchFocus = useUiStore.use.requestTaskSearchFocus();
  const requestTaskQuickCreateFocus =
    useUiStore.use.requestTaskQuickCreateFocus();
  const expanded = useUiStore.use.expanded();
  const setExpanded = useUiStore.use.setExpanded();
  const latestUndoSource = useUiStore.use.latestUndoSource();
  const latestRedoSource = useUiStore.use.latestRedoSource();
  const advancedSkipModalOpen = useUiStore.use.advancedSkipModalOpen();
  const timerExtensionModalOpen = useUiStore.use.timerExtensionModalOpen();
  const advancedSkipStartPending = useUiStore.use.advancedSkipStartPending();
  const setAdvancedSkipModalOpen = useUiStore.use.setAdvancedSkipModalOpen();
  const setTimerExtensionModalOpen =
    useUiStore.use.setTimerExtensionModalOpen();
  const preferences = usePreferencesStore.use.preferences();
  const undoActionSource = getKeyboardHistorySource(
    latestUndoSource,
    undoVisible,
    canUndoTask,
    'timer'
  );
  const redoActionSource = getKeyboardHistorySource(
    latestRedoSource,
    redoVisible,
    canRedoTask,
    'timer'
  );

  // Helper: platform-agnostic "mod" key (Command on macOS, Control otherwise)
  const isMod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;

  // Helper: ignore shortcuts while typing in inputs/textarea or contenteditable
  const isTypingInField = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return false;
    const tag = target.tagName?.toLowerCase();
    const editable = (target as HTMLElement).isContentEditable;
    return tag === 'input' || tag === 'textarea' || editable === true;
  };

  // Local shortcut registration
  useEffect(() => {
    if (!preferences?.keyboardShortcuts) return;

    // Build shortcuts from latest state each effect run to avoid stale closures.
    const localShortcuts = [
      {
        id: 'toggle-play-pause',
        match: (e: KeyboardEvent) => e.code === 'Space' && !isMod(e),
        when: () => activeTab === 'timer',
        run: () => toggleTimer(),
      },
      {
        id: 'reset-timer',
        match: (e: KeyboardEvent) => isMod(e) && e.code === 'KeyR',
        when: () => activeTab === 'timer' && !timer?.isExtension,
        run: () => resetTimer(),
      },
      {
        id: 'skip-timer',
        match: (e: KeyboardEvent) =>
          isMod(e) && !e.shiftKey && e.code === 'KeyS',
        when: () => activeTab === 'timer',
        run: () => {
          const shouldPromptOnSkip =
            shouldOpenAdvancedSkipModal(timer, preferences) ||
            (!!preferences?.advancedSkip &&
              useUiStore.getState().advancedSkipStartPending);

          if (shouldPromptOnSkip) {
            setAdvancedSkipModalOpen(true);
            return;
          }

          skipTimer();
        },
      },
      {
        id: 'undo-current-action',
        match: (e: KeyboardEvent) =>
          isMod(e) && !e.shiftKey && e.code === 'KeyZ',
        when: () => activeTab === 'timer' && undoActionSource !== null,
        run: () => {
          if (undoActionSource === 'task') {
            void undoTaskAction();
            return;
          }
          undoLastTimerAction();
        },
      },
      {
        id: 'redo-current-action',
        match: (e: KeyboardEvent) =>
          isMod(e) && e.shiftKey && e.code === 'KeyZ',
        when: () => activeTab === 'timer' && redoActionSource !== null,
        run: () => {
          if (redoActionSource === 'task') {
            void redoTaskAction();
            return;
          }
          redoLastTimerAction();
        },
      },
      {
        id: 'add-five-minutes',
        match: (e: KeyboardEvent) =>
          isMod(e) && !e.shiftKey && e.code === 'KeyA',
        when: () => activeTab === 'timer',
        run: () => addFiveMinutesTimer(),
      },
      {
        id: 'stack-timer',
        match: (e: KeyboardEvent) =>
          isMod(e) && e.shiftKey && e.code === 'KeyA',
        when: () =>
          activeTab === 'timer' && canStackSessionTimer(timer, preferences),
        run: () => stackTimer(),
      },
      ...(!isLinux
        ? [
            {
              id: 'expand-window',
              match: (e: KeyboardEvent) => isMod(e) && e.code === 'KeyE',
              when: () => activeTab === 'timer',
              run: () => setExpanded(),
            },
          ]
        : []),
      {
        id: 'switch-long-break',
        match: (e: KeyboardEvent) => isMod(e) && e.code === 'KeyL',
        when: () =>
          activeTab === 'timer' &&
          getLongBreakSwitchAction(timer?.type, preferences) !== null,
        run: () => {
          if (
            getLongBreakSwitchAction(timer?.type, preferences) ===
            'switchToShortBreak'
          ) {
            void convertLongBreakToBreak(t('timer.shortenLongBreak'));
            return;
          }
          startLongBreakTimer();
        },
      },
      {
        id: 'open-extension-options',
        match: (e: KeyboardEvent) => isMod(e) && e.code === 'KeyD',
        when: () => activeTab === 'timer' && !!extensionState,
        run: () => {
          if (!expanded) {
            setExpanded(true);
          }
          setTimerExtensionModalOpen(true);
        },
      },
      {
        id: 'open-tasks',
        match: (e: KeyboardEvent) => isMod(e) && e.code === 'KeyT',
        when: () => !!preferences?.tasksExtension,
        run: () => {
          if (!expanded) {
            setExpanded(true);
          }
          setActiveTab('timer');
          requestTaskQuickCreateFocus();
        },
      },
      {
        id: 'tasks-mode-toggle',
        match: (e: KeyboardEvent) =>
          isMod(e) && !e.altKey && !e.shiftKey && e.code === 'KeyG',
        when: () =>
          activeTab === 'timer' && expanded && !!preferences?.tasksExtension,
        run: requestTaskModeToggle,
      },
      {
        id: 'tasks-create',
        match: (e: KeyboardEvent) =>
          isMod(e) && !e.shiftKey && e.code === 'KeyN',
        when: () => activeTab === 'timer' && !!preferences?.tasksExtension,
        run: () => {
          if (!expanded) setExpanded(true);
          requestTaskQuickCreateFocus();
        },
      },
      {
        id: 'open-active-intention-picker',
        match: (e: KeyboardEvent) =>
          isMod(e) && !e.altKey && !e.shiftKey && e.code === 'KeyI',
        when: () => activeTab === 'timer',
        run: () => requestIntentionPickerOpen(),
      },
      {
        id: 'focus-task-search',
        match: (e: KeyboardEvent) =>
          isMod(e) && !e.altKey && !e.shiftKey && e.code === 'KeyK',
        when: () => !!preferences?.tasksExtension && activeTab === 'timer',
        run: () => requestTaskSearchFocus(),
      },
      {
        id: 'open-statistics',
        match: (e: KeyboardEvent) =>
          isMod(e) && !e.altKey && !e.shiftKey && e.code === 'KeyO',
        when: () => activeTab === 'timer',
        run: () => setActiveTab('statistics'),
      },
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `set-session-position-${i + 1}`,
        match: (e: KeyboardEvent) =>
          isMod(e) && e.altKey && !e.shiftKey && e.code === `Digit${i + 1}`,
        when: () =>
          activeTab === 'timer' &&
          !timer?.isExtension &&
          !!preferences?.sessionsExtension &&
          !!timer?.sessionTotal &&
          i + 1 <= timer.sessionTotal,
        run: () => setSessionPosition(i + 1),
      })),
    ];

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return; // avoid repeat spam
      const isSurfaceNavigationShortcut =
        isMod(event) &&
        !event.altKey &&
        !event.shiftKey &&
        (event.code === 'KeyI' ||
          event.code === 'KeyK' ||
          event.code === 'KeyO' ||
          event.code === 'KeyT');
      if (isTypingInField(event) && !isSurfaceNavigationShortcut) return;
      if (hasOpenModal()) return;
      if (advancedSkipModalOpen || timerExtensionModalOpen) return;
      if (
        (!connectionStatus.isConnected || connectionStatus.isReconnecting) &&
        !isSurfaceNavigationShortcut
      ) {
        return;
      }

      for (const sc of localShortcuts) {
        if (sc.match(event) && sc.when()) {
          event.preventDefault();
          sc.run();
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeTab,
    setActiveTab,
    addFiveMinutesTimer,
    advancedSkipModalOpen,
    advancedSkipStartPending,
    canRedoTask,
    canUndoTask,
    connectionStatus.isConnected,
    connectionStatus.isReconnecting,
    convertLongBreakToBreak,
    expanded,
    extensionState,
    latestRedoSource,
    latestUndoSource,
    redoActionSource,
    toggleTimer,
    preferences?.keyboardShortcuts,
    preferences?.sessionHasLongBreak,
    preferences?.sessionShowLongBreakButton,
    preferences?.longBreakToBreakEnabled,
    preferences?.sessionsExtension,
    preferences?.sessionStackTimers,
    preferences?.tasksExtension,
    resetTimer,
    redoTaskAction,
    setAdvancedSkipModalOpen,
    setExpanded,
    setSessionPosition,
    setTimerExtensionModalOpen,
    skipTimer,
    stackTimer,
    startLongBreakTimer,
    t,
    timerExtensionModalOpen,
    preferences?.advancedSkip,
    timer?.isExtension,
    timer?.sessionPosition,
    timer?.sessionTotal,
    timer?.status,
    timer?.type,
    undoTaskAction,
    undoLastTimerAction,
    undoActionSource,
    undoVisible,
    redoLastTimerAction,
    redoVisible,
    requestIntentionPickerOpen,
    requestTaskSearchFocus,
    requestTaskQuickCreateFocus,
    requestTaskModeToggle,
  ]);

  useEffect(() => {
    if (preferences?.globalShortcut && isDesktop) registerGlobalShortcut();
    return () => {
      if (preferences?.globalShortcut && isDesktop) unregisterGlobalShortcut();
    };
  }, [preferences?.globalShortcut]);
}

async function registerGlobalShortcut() {
  try {
    const Window = getCurrentWindow();
    await register('Control+Shift+P', () => {
      Window.show();
      Window.setFocus();
    });
  } catch (error) {
    console.error('Failed to register global shortcut:', error);
  }
}

async function unregisterGlobalShortcut() {
  try {
    await unregister('Control+Shift+P');
  } catch (error) {
    console.error('Failed to unregister global shortcut:', error);
  }
}

function getKeyboardHistorySource(
  preferredSource: HistorySource | null,
  canUseTimer: boolean,
  canUseTask: boolean,
  fallbackSource: HistorySource
): HistorySource | null {
  if (preferredSource === 'timer' && canUseTimer) {
    return 'timer';
  }
  if (preferredSource === 'task' && canUseTask) {
    return 'task';
  }
  if (fallbackSource === 'timer') {
    return canUseTimer ? 'timer' : canUseTask ? 'task' : null;
  }
  return canUseTask ? 'task' : canUseTimer ? 'timer' : null;
}
