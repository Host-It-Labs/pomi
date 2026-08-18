import { listen } from '@tauri-apps/api/event';
import { Window } from '@tauri-apps/api/window';
import { useEffect } from 'react';

import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useAuthStore } from '../stores/authStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useSystemStore } from '../stores/systemStore';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';

import { isDesktop, isLinux, isMobile, isTauri } from '../utils/osUtils';
import {
  reconcileAndroidForegroundSync,
  stopAndroidForegroundSync,
} from '../utils/androidForegroundSync';

type UseAppOptions = {
  pauseBootstrap?: boolean;
};

export function useApp({ pauseBootstrap = false }: UseAppOptions = {}) {
  const initializeSocket = useTimerStore.use.initializeSocket();
  const setAppWindow = useUiStore.use.setAppWindow();
  const setExpanded = useUiStore.use.setExpanded();
  const hasLoggedIn = useUiStore.use.hasLoggedIn();
  const setActiveTab = useUiStore.use.setActiveTab();
  const isAuthenticated = useAuthStore.use.isAuthenticated();
  const token = useAuthStore.use.token();
  const preferences = usePreferencesStore.use.preferences();
  const isLoadingPreferences = usePreferencesStore.use.isLoading();
  const preferencesLoadError = usePreferencesStore.use.loadError();
  const loadPreferences = usePreferencesStore.use.loadPreferences();
  const connectionStatus = useTimerStore.use.connectionStatus();
  const systemInfo = useSystemStore.use.systemInfo();
  const loadSystemInfo = useSystemStore.use.loadSystemInfo();

  useKeyboardShortcuts();

  useEffect(() => {
    if (!isTauri || !isDesktop) {
      setAppWindow(null);
      return;
    }

    try {
      setAppWindow(Window.getCurrent());
    } catch (error) {
      console.warn('[App] Window API unavailable:', error);
      setAppWindow(null);
    }
  }, [setAppWindow]);

  useEffect(() => {
    if (pauseBootstrap) {
      return;
    }

    loadSystemInfo();
  }, [loadSystemInfo, pauseBootstrap]);

  useEffect(() => {
    if (pauseBootstrap) {
      return;
    }

    if (isAuthenticated) {
      initializeSocket();

      // never collapse on linux; desktop windows start minimized for first login on other platforms
      if (isDesktop === true && hasLoggedIn === false && !isLinux)
        setExpanded(false);

      setActiveTab('timer');
    }
  }, [
    isAuthenticated,
    hasLoggedIn,
    pauseBootstrap,
    setExpanded,
    setActiveTab,
    initializeSocket,
  ]);

  useEffect(() => {
    if (pauseBootstrap) {
      return;
    }

    if (!isAuthenticated || !connectionStatus.isConnected) {
      return;
    }

    if (!preferences && !isLoadingPreferences && !preferencesLoadError) {
      void loadPreferences();
    }

    if (!systemInfo) {
      void loadSystemInfo();
    }
  }, [
    connectionStatus.isConnected,
    isAuthenticated,
    isLoadingPreferences,
    loadPreferences,
    loadSystemInfo,
    preferences,
    preferencesLoadError,
    pauseBootstrap,
    systemInfo,
  ]);

  useEffect(() => {
    if (pauseBootstrap) {
      return;
    }

    if (!isAuthenticated) {
      void stopAndroidForegroundSync({
        clearOptIn: false,
        clearAuth: true,
      });
      return;
    }

    void reconcileAndroidForegroundSync(
      token,
      preferences?.pushNotifications === true
    );
  }, [isAuthenticated, pauseBootstrap, preferences, token]);

  // Ensure the timer state resyncs when app returns to foreground or resumes (mobile)
  useEffect(() => {
    if (pauseBootstrap) return;
    if (!isAuthenticated) return;

    const { forceReconnect, stopLocalCountdown } = useTimerStore.getState();
    let lastBackgroundTime = 0;

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (isMobile && lastBackgroundTime === 0) {
          return;
        }

        const timeInBackground = lastBackgroundTime
          ? Date.now() - lastBackgroundTime
          : 0;
        if (isMobile && timeInBackground > 15000) {
          forceReconnect(false);
        } else {
          forceReconnect(true);
        }

        lastBackgroundTime = 0;
      } else {
        lastBackgroundTime = Date.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    let unlisten: (() => void) | undefined;
    listen('tauri://resumed', () => {
      console.warn('[App] Tauri resumed event, syncing timer');
      forceReconnect(false);
      void reconcileAndroidForegroundSync(
        useAuthStore.getState().token,
        usePreferencesStore.getState().preferences?.pushNotifications === true
      );
    })
      .then(unsub => (unlisten = unsub))
      .catch(() => {});

    let unlistenSuspend: (() => void) | undefined;
    listen('tauri://suspend', () => {
      console.warn('[App] Tauri suspend event, stopping local countdown');
      lastBackgroundTime = Date.now();
      stopLocalCountdown();
    })
      .then(unsub => (unlistenSuspend = unsub))
      .catch(() => {});

    const onFocus = () => {
      if (isMobile) {
        if (lastBackgroundTime === 0) {
          return;
        }

        const timeInBackground = lastBackgroundTime
          ? Date.now() - lastBackgroundTime
          : 0;
        if (timeInBackground > 15000) {
          forceReconnect(false);
        } else {
          forceReconnect(true);
        }
        lastBackgroundTime = 0;
      } else {
        forceReconnect(true);
      }
    };
    window.addEventListener('focus', onFocus);

    const onBlur = () => {
      if (isMobile) {
        lastBackgroundTime = Date.now();
        stopLocalCountdown();
      }
    };
    window.addEventListener('blur', onBlur);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      if (unlisten) unlisten();
      if (unlistenSuspend) unlistenSuspend();
    };
  }, [isAuthenticated, pauseBootstrap]);
}
