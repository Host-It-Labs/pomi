import {
  Timer,
  TimerExtensionResolutionAction,
  TimerExtensionState,
  TimerSkipLogMode,
  TimerTypes,
  Preferences,
} from '@pomi/shared';
import {
  SOCKET_EVENTS,
  TIMER_STATUSES,
  TIMER_TYPES,
} from '@pomi/shared/src/constants';
import { getNextTimerType } from '@pomi/shared/src/utils/timerUtils';
import { platform } from '@tauri-apps/plugin-os';
import { create } from 'zustand';

import { showToastFromStore } from '../components/toast/ToastContext';
import { translateCurrent } from '../i18n';
import {
  DesktopNotificationEvent,
  desktopNotificationHandler,
} from '../utils/desktopNotificationHandler';
import {
  MobileNotificationEvent,
  mobileNotificationHandler,
} from '../utils/mobileNotificationHandler';
import { notificationService } from '../utils/notificationUtils';
import { isDesktop, isMobile, isTauri } from '../utils/osUtils';
import { submitUserMutation } from '../utils/userActionQueue';
import { subscribeToServerResponseState } from '../utils/serverResponseMonitor';
import {
  emitSocketEvent,
  forceReconnect,
  getConnectionStatus,
  getOrCreateSocket,
  isTimerErrorReported,
  registerSocketEventHandler,
  subscribeToConnectionState,
  waitForAuthoritativeTimer,
} from '../utils/socketManager';
import { useAuthStoreBase } from './authStore';
import { createSelectors } from './createSelectors';
import { usePreferencesStore } from './preferencesStore';
import { useTasksStore } from './tasksStore';
import { requestListRefresh } from '../utils/listRefresh';
import { type HistoryActionId, useUiStore } from './uiStore';

let localTimerInterval: NodeJS.Timeout | null = null;
let lastSyncTime = 0;
let isInitialized = false;
const pendingTimerHistoryActionIds: HistoryActionId[] = [];
let hasReceivedInitialTimer = false;

interface TimerState {
  timer: Timer | null;
  undoVisible: boolean;
  redoVisible: boolean;
  extensionState: TimerExtensionState | null;
  connectionStatus: {
    isConnected: boolean;
    isReconnecting: boolean;
    isWaitingForServer: boolean;
    reconnectAttempts: number;
    lastError: string | null;
  };
  initializeSocket: () => void;
  forceReconnect: (skipIfConnected?: boolean) => void;
  setTimer: (timer: Timer | null) => void;
  pauseTimer: () => void;
  toggleTimer: () => void;
  resetTimer: () => void;
  skipTimer: (logMode?: TimerSkipLogMode) => void;
  createOrResumeTimer: (
    type?: TimerTypes,
    intention?: string,
    intentions?: string[],
    subIntentions?: Record<string, string>,
    focusedTaskId?: string,
    resetOnFirstIntention?: boolean
  ) => Promise<boolean>;
  removeFocusedTask: (taskId: string) => void;
  startLongBreakTimer: () => void;
  convertLongBreakToBreak: (label: string) => Promise<void>;
  addFiveMinutesTimer: () => void;
  undoLastTimerAction: () => void;
  redoLastTimerAction: () => void;
  stackTimer: () => void;
  setSessionPosition: (position: number) => void;
  resolveTimerExtension: (action: TimerExtensionResolutionAction) => void;
  startLocalCountdown: () => void;
  stopLocalCountdown: () => void;
  updateLocalTime: () => void;
  syncWithServer: () => void;
  updateConnectionStatus: () => void;
  markUndoVisible: () => void;
  clearUndoVisible: () => void;
  clearTimerHistory: () => void;
}

const useTimerStoreBase = create<TimerState>((set, get) => ({
  timer: null,
  undoVisible: false,
  redoVisible: false,
  extensionState: null,
  connectionStatus: {
    isConnected: false,
    isReconnecting: false,
    isWaitingForServer: false,
    reconnectAttempts: 0,
    lastError: null,
  },

  initializeSocket: () => {
    if (isInitialized) {
      getOrCreateSocket();
      return;
    }
    isInitialized = true;

    subscribeToConnectionState(() => {
      get().updateConnectionStatus();
    });

    subscribeToServerResponseState(() => {
      get().updateConnectionStatus();
    });

    if (isDesktop) {
      desktopNotificationHandler.setPreferencesGetter(
        () => usePreferencesStore.getState().preferences
      );
    }

    if (isMobile) {
      mobileNotificationHandler.setPreferencesGetter(
        () => usePreferencesStore.getState().preferences
      );
    }

    registerSocketEventHandler(SOCKET_EVENTS.PUSH_TOKEN_REQUIRED, async () => {
      if (!isMobile) return;

      const { user } = useAuthStoreBase.getState();
      if (!user?.id) return;

      console.warn('[Socket] Server requires push token registration');

      try {
        // Extra check for Tauri context
        if (!isTauri) {
          console.warn(
            '[Socket] Not in Tauri context, skipping push token registration'
          );
          return;
        }

        const registered =
          await notificationService.registerForPushNotificationsIfMobile(
            user.id,
            platform()
          );

        if (!registered) {
          console.warn(
            '[Socket] Failed to register push token after server request'
          );
        }
      } catch (error) {
        console.error('[Socket] Error registering push token:', error);
      }
    });

    registerSocketEventHandler(SOCKET_EVENTS.TIMER_UPDATE, (data: unknown) => {
      const updatedTimer = data as Timer;
      const previousTimer = get().timer;
      if (updatedTimer.status === TIMER_STATUSES.RUNNING) {
        lastSyncTime = Date.now();
        const elapsedTime = updatedTimer.duration - updatedTimer.remainingTime;
        updatedTimer.startTime = Date.now() - elapsedTime;
      }

      set({ timer: { ...updatedTimer } });

      if (
        hasReceivedInitialTimer &&
        getTimerIntentionSignature(previousTimer) !==
          getTimerIntentionSignature(updatedTimer)
      ) {
        useUiStore.getState().setTaskMode('intention');
      }
      hasReceivedInitialTimer = true;

      if (updatedTimer.status === TIMER_STATUSES.RUNNING) {
        get().startLocalCountdown();
      } else {
        get().stopLocalCountdown();
      }
    });

    registerSocketEventHandler(
      SOCKET_EVENTS.DESKTOP_NOTIFICATION,
      (data: unknown) => {
        const event = data as DesktopNotificationEvent;
        desktopNotificationHandler.handleNotificationEvent(event);
      }
    );

    registerSocketEventHandler(
      SOCKET_EVENTS.MOBILE_NOTIFICATION,
      (data: unknown) => {
        const event = data as MobileNotificationEvent;
        mobileNotificationHandler.handleNotificationEvent(event);
      }
    );

    registerSocketEventHandler(SOCKET_EVENTS.TIMER_ERROR, (data: unknown) => {
      const error = data as { message: string };
      discardPendingTimerHistoryAction();
      useUiStore.getState().setAdvancedSkipStartPending(false);
      useUiStore.getState().setAdvancedSkipModalOpen(false);
      showToastFromStore(error.message, 'error');
    });

    registerSocketEventHandler(
      SOCKET_EVENTS.TIMER_HISTORY_UPDATE,
      (data: unknown) => {
        const update = data as {
          canUndo: boolean;
          canRedo: boolean;
          appliedAction?: {
            direction: 'undo' | 'redo';
            label: string;
            logEffect?: 'added' | 'removed' | 'restored' | 'updated';
          };
        };
        set({
          undoVisible: update.canUndo,
          redoVisible: update.canRedo,
        });

        const uiState = useUiStore.getState();
        if (update.appliedAction?.direction === 'undo') {
          uiState.recordHistoryUndo('timer');
        } else if (update.appliedAction?.direction === 'redo') {
          uiState.recordHistoryRedo('timer');
        } else {
          confirmPendingTimerHistoryAction();
          if (!update.canUndo && !update.canRedo) {
            pendingTimerHistoryActionIds.length = 0;
            uiState.clearHistorySource('timer');
          }
        }

        const preferences = usePreferencesStore.getState().preferences;
        if (preferences?.undoAlerts && update.appliedAction) {
          showToastFromStore(
            getUndoAlertMessage(update.appliedAction),
            'success'
          );
        }
      }
    );

    registerSocketEventHandler(
      SOCKET_EVENTS.EXTENSION_STATE_UPDATE,
      (data: unknown) => {
        set({ extensionState: (data as TimerExtensionState) || null });
      }
    );

    registerSocketEventHandler(
      SOCKET_EVENTS.PREFERENCES_UPDATE,
      (data: unknown) => {
        usePreferencesStore.getState().setPreferences(data as Preferences);
      }
    );

    registerSocketEventHandler(SOCKET_EVENTS.TASKS_UPDATE, () => {
      void useTasksStore.getState().refreshTasks();
      requestListRefresh();
    });

    getOrCreateSocket();
  },

  forceReconnect: (skipIfConnected = false) => {
    forceReconnect(skipIfConnected);
  },

  setTimer: timer => set({ timer }),

  updateConnectionStatus: () => {
    set({ connectionStatus: getConnectionStatus() });
  },

  syncWithServer: () => {
    const socket = getOrCreateSocket();

    if (!socket) return;

    if (socket.connected) {
      try {
        socket.emit(SOCKET_EVENTS.GET_CURRENT_TIMER);
      } catch {
        get().forceReconnect();
      }
    } else {
      get().forceReconnect();
    }
  },

  startLocalCountdown: () => {
    if (localTimerInterval) {
      clearInterval(localTimerInterval);
    }

    localTimerInterval = setInterval(() => {
      get().updateLocalTime();

      if (Date.now() - lastSyncTime > 30000) {
        get().syncWithServer();
      }
    }, 1000);
  },

  stopLocalCountdown: () => {
    if (localTimerInterval) {
      clearInterval(localTimerInterval);
      localTimerInterval = null;
    }
  },

  updateLocalTime: () => {
    const currentTimer = get().timer;
    if (!currentTimer || currentTimer.status !== TIMER_STATUSES.RUNNING) {
      return;
    }

    const timeSinceLastSync = Date.now() - lastSyncTime;
    if (timeSinceLastSync > 60000) {
      get().stopLocalCountdown();
      get().syncWithServer();
      return;
    }

    const elapsedTime = Date.now() - currentTimer.startTime;
    const newRemainingTime = Math.max(0, currentTimer.duration - elapsedTime);

    if (newRemainingTime === 0 && currentTimer.remainingTime > 0) {
      set({
        timer: {
          ...currentTimer,
          remainingTime: 0,
        },
      });
      get().stopLocalCountdown();
      get().syncWithServer();
      return;
    }

    if (
      Math.floor(currentTimer.remainingTime / 1000) !==
      Math.floor(newRemainingTime / 1000)
    ) {
      set({
        timer: {
          ...currentTimer,
          remainingTime: newRemainingTime,
        },
      });
    }
  },

  createOrResumeTimer: async (
    inputtedType,
    intention,
    intentions,
    subIntentions,
    focusedTaskId,
    resetOnFirstIntention
  ) => {
    const timer = get().timer;
    const type = inputtedType || getNextTimerType(timer);
    if (
      intention !== undefined ||
      intentions !== undefined ||
      subIntentions !== undefined
    ) {
      get().markUndoVisible();
    }
    try {
      await submitUserMutation({
        kind: 'timer',
        label: focusedTaskId
          ? translateCurrent('timer.focusPinnedTask')
          : translateCurrent('timer.createOrResume'),
        payload: {
          operation: 'createOrResume',
          timerType: type,
          intention,
          intentions,
          subIntentions,
          focusedTaskId,
          resetOnFirstIntention,
        },
        reconcile: async result => {
          await waitForAuthoritativeTimer(result);
        },
      });
      return true;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : translateCurrent('timer.actionFailed');
      if (!isTimerErrorReported(error)) {
        showToastFromStore(message, 'error');
      }
      return false;
    }
  },

  removeFocusedTask: taskId => {
    emitSocketEvent(SOCKET_EVENTS.REMOVE_FOCUSED_TASK, { taskId });
  },

  pauseTimer: () => {
    emitSocketEvent(SOCKET_EVENTS.PAUSE_TIMER);
  },

  toggleTimer: () => {
    const currentTimer = get().timer;
    const isRunning = currentTimer?.status === TIMER_STATUSES.RUNNING;
    void submitUserMutation({
      kind: 'timer',
      label: isRunning
        ? translateCurrent('timer.pause')
        : translateCurrent('timer.startAction'),
      payload: isRunning
        ? { operation: 'pause' }
        : {
            operation: 'createOrResume',
            timerType: currentTimer?.type ?? TIMER_TYPES.WORK,
          },
      reconcile: async result => {
        await waitForAuthoritativeTimer(result);
      },
    }).catch(error => {
      const message =
        error instanceof Error
          ? error.message
          : translateCurrent('timer.actionFailed');
      if (!isTimerErrorReported(error)) {
        showToastFromStore(message, 'error');
      }
    });
  },

  resetTimer: () => {
    get().markUndoVisible();
    emitSocketEvent(SOCKET_EVENTS.RESET_TIMER);
  },

  skipTimer: (logMode?: TimerSkipLogMode) => {
    const nextLogMode = logMode ?? 'none';
    get().markUndoVisible();
    emitSocketEvent(
      SOCKET_EVENTS.SKIP_TIMER,
      nextLogMode === 'none' ? undefined : { logMode: nextLogMode }
    );
  },

  addFiveMinutesTimer: () => {
    get().markUndoVisible();
    emitSocketEvent(SOCKET_EVENTS.ADD_FIVE_MINUTES_TIMER);
  },

  undoLastTimerAction: () => {
    if (!get().undoVisible) {
      return;
    }

    emitSocketEvent(SOCKET_EVENTS.UNDO_TIMER_ACTION);
  },

  redoLastTimerAction: () => {
    if (!get().redoVisible) {
      return;
    }

    emitSocketEvent(SOCKET_EVENTS.REDO_TIMER_ACTION);
  },

  startLongBreakTimer: () => {
    get().markUndoVisible();
    emitSocketEvent(SOCKET_EVENTS.CREATE_OR_RESUME_TIMER, {
      type: TIMER_TYPES.LONG_BREAK,
    });
  },

  convertLongBreakToBreak: async label => {
    try {
      await submitUserMutation({
        kind: 'timer',
        label,
        payload: { operation: 'convertLongBreakToBreak' },
        reconcile: async result => {
          await waitForAuthoritativeTimer(result);
        },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : translateCurrent('timer.actionFailed');
      if (!isTimerErrorReported(error)) {
        showToastFromStore(message, 'error');
      }
    }
  },

  stackTimer: () => {
    get().markUndoVisible();
    emitSocketEvent(SOCKET_EVENTS.STACK_TIMER);
  },

  setSessionPosition: (position: number) => {
    get().markUndoVisible();
    emitSocketEvent(SOCKET_EVENTS.SET_SESSION_POSITION, { position });
  },

  resolveTimerExtension: (action: TimerExtensionResolutionAction) => {
    get().markUndoVisible();
    emitSocketEvent(SOCKET_EVENTS.RESOLVE_TIMER_EXTENSION, { action });
  },

  markUndoVisible: () => {
    pendingTimerHistoryActionIds.push(
      useUiStore.getState().recordHistoryAction('timer')
    );
    set({ undoVisible: true, redoVisible: false });
  },

  clearUndoVisible: () => {
    pendingTimerHistoryActionIds.length = 0;
    useUiStore.getState().clearHistorySource('timer');
    set({ undoVisible: false, redoVisible: false });
  },

  clearTimerHistory: () => {
    pendingTimerHistoryActionIds.length = 0;
    useUiStore.getState().clearHistorySource('timer');
    set({ undoVisible: false, redoVisible: false });
    emitSocketEvent(SOCKET_EVENTS.CLEAR_TIMER_HISTORY);
  },
}));

function getTimerIntentionSignature(timer: Timer | null) {
  if (!timer) return '';
  const intentions = (timer.intentionSlugs ?? []).map(
    intention => `${intention}:${timer.subIntentions?.[intention] ?? ''}`
  );
  if (intentions.length === 0 && timer.intention) {
    intentions.push(`${timer.intention}:${timer.subIntention ?? ''}`);
  }
  return intentions.sort().join('|');
}

function confirmPendingTimerHistoryAction() {
  pendingTimerHistoryActionIds.shift();
}

function discardPendingTimerHistoryAction() {
  const historyActionId = pendingTimerHistoryActionIds.shift();
  if (historyActionId) {
    useUiStore.getState().discardHistoryAction('timer', historyActionId);
  }
}

function getUndoAlertMessage(action: {
  direction: 'undo' | 'redo';
  label: string;
  logEffect?: 'added' | 'removed' | 'restored' | 'updated';
}): string {
  const prefix = action.direction === 'undo' ? 'Undid' : 'Redid';
  const logNote = getUndoAlertLogNote(action.direction, action.logEffect);

  return `${prefix} ${action.label}${logNote}`;
}

function getUndoAlertLogNote(
  direction: 'undo' | 'redo',
  logEffect?: 'added' | 'removed' | 'restored' | 'updated'
): string {
  if (!logEffect) return '';

  if (direction === 'undo') {
    return logEffect === 'added' ? ', removed work log' : ', restored work log';
  }

  return logEffect === 'added' ? ', added work log' : ', updated work log';
}

export const useTimerStore = createSelectors(useTimerStoreBase);

useAuthStoreBase.subscribe((state, prevState) => {
  if (state.token !== prevState.token) {
    hasReceivedInitialTimer = false;
  }
  if (!state.token && prevState.token && localTimerInterval) {
    clearInterval(localTimerInterval);
    localTimerInterval = null;
  }

  if (!state.token && prevState.token) {
    useTimerStoreBase.getState().clearUndoVisible();
  }
});
