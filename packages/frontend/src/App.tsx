import clsx from 'clsx';
import { LogicalSize } from '@tauri-apps/api/window';
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import './App.css';
import { ConnectionStatus } from './app/ConnectionStatus';
import { InAppNotification } from './app/InAppNotification';
import { ProtectedRoute } from './app/ProtectedRoute';
import { SystemTray } from './app/SystemTray';
import { ToastProvider } from './components/toast/ToastContext';
import { UserActionIndicator } from './components/UserActionIndicator';
import { AssistantLauncher } from './components/assistant/AssistantLauncher';
import { FeedbackRecorder } from './components/feedback/FeedbackRecorder';
import { Spinner } from './components/ui/Spinner';
import { environmentVariables } from './config/environmentVariables';
import { getMinimizedWindowHeight, WINDOW_WIDTH } from './constants/window';
import { TIMER_TYPES } from '@pomi/shared/src/constants';
import { useApp } from './hooks/useApp';
import { useDevAutoLogin } from './hooks/useDevAutoLogin';
import { useMobileFeatures } from './hooks/useMobileFeatures';
import { MinimizedTimer } from './pages/MinimizedTimer';
import { Timer } from './pages/Timer';
import { useAuthStore } from './stores/authStore';
import { useInAppNotificationStore } from './stores/inAppNotificationStore';
import { usePreferencesStore } from './stores/preferencesStore';
import { useTimerStore } from './stores/timerStore';
import { useUiStore } from './stores/uiStore';
import { canUseDebugPanel } from './utils/debugAccess';
import { isDesktop } from './utils/osUtils';
import { useI18n } from './i18n';

const DebugPanel = lazy(() =>
  import('./pages/DebugPanel').then(module => ({
    default: module.DebugPanel,
  }))
);
const IntentionsManager = lazy(() =>
  import('./pages/IntentionsManager').then(module => ({
    default: module.IntentionsManager,
  }))
);
const Settings = lazy(() =>
  import('./pages/Settings').then(module => ({ default: module.Settings }))
);
const Statistics = lazy(() =>
  import('./pages/Statistics').then(module => ({ default: module.Statistics }))
);
const Tasks = lazy(() =>
  import('./pages/Tasks').then(module => ({ default: module.Tasks }))
);

function PageLoadingSkeleton() {
  const { t } = useI18n();
  return (
    <div
      className="h-full animate-pulse px-5 pb-6 pt-8"
      aria-label={t('common.loadingView')}
      aria-busy="true"
    >
      <div className="mb-8 h-8 w-40 rounded-lg bg-slate-800/75" />
      <div className="space-y-4">
        <div className="h-24 rounded-xl bg-slate-900" />
        <div className="h-36 rounded-xl bg-slate-900" />
        <div className="h-24 rounded-xl bg-slate-900" />
      </div>
    </div>
  );
}

declare global {
  interface Window {
    __POMI_TEST_CONTEXT_SLUG__?: string;
  }
}

function getTestContextSlug() {
  const injectedSlug =
    typeof window !== 'undefined'
      ? (window.__POMI_TEST_CONTEXT_SLUG__ ?? '')
      : '';
  const slug = String(
    injectedSlug || environmentVariables.TEST_CONTEXT_SLUG || ''
  );

  return slug.trim().slice(0, 36);
}

function App() {
  const expanded = useUiStore.use.expanded();
  const activeTab = useUiStore.use.activeTab();
  const isAuthenticated = useAuthStore.use.isAuthenticated();
  const user = useAuthStore.use.user();
  const preferences = usePreferencesStore.use.preferences();
  const appWindow = useUiStore.use.appWindow();
  const timer = useTimerStore.use.timer();
  const notification = useInAppNotificationStore.use.notification();
  const dismissNotification =
    useInAppNotificationStore.use.dismissNotification();
  const [useTallSafeAreaFallback, setUseTallSafeAreaFallback] = useState(false);
  const previousActiveTabRef = useRef(activeTab);
  const showDebugPanel = canUseDebugPanel(user);
  const [testContextSlug] = useState(getTestContextSlug);
  const showMinimizedTaskView = Boolean(
    !expanded &&
    !timer?.isExtension &&
    (timer?.type === TIMER_TYPES.WORK ||
      ((timer?.type === TIMER_TYPES.BREAK ||
        timer?.type === TIMER_TYPES.LONG_BREAK) &&
        preferences?.tasksDuringBreaks)) &&
    Boolean(
      preferences?.tasksExtension && preferences.tasksShowInMinimizedTimer
    )
  );
  const minimizedWindowHeight = getMinimizedWindowHeight(showMinimizedTaskView);

  const isDevAutoLoginPending = useDevAutoLogin();
  useApp({ pauseBootstrap: isDevAutoLoginPending });
  useMobileFeatures();

  useLayoutEffect(() => {
    if (activeTab !== 'timer') {
      return;
    }

    const resetScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    resetScroll();
    const animationFrame = window.requestAnimationFrame(resetScroll);
    const timeout = window.setTimeout(resetScroll, 40);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeout);
    };
  }, [activeTab]);

  useEffect(() => {
    const previousTab = previousActiveTabRef.current;
    setUseTallSafeAreaFallback(
      previousTab === 'settings' && activeTab === 'timer'
    );
    previousActiveTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    if (!isDesktop || expanded || !appWindow) {
      return;
    }

    void appWindow.setSize(
      new LogicalSize(WINDOW_WIDTH, minimizedWindowHeight)
    );
  }, [appWindow, expanded, minimizedWindowHeight]);

  return (
    <ToastProvider>
      {isDevAutoLoginPending ? (
        <div className="flex h-dvh items-center justify-center bg-slate-950 text-indigo-400">
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          {testContextSlug && (
            <div
              data-testid="test-context-slug"
              className="pointer-events-none fixed top-1 right-2 z-[60] max-w-[180px] select-none truncate font-mono text-[9px] uppercase leading-none tracking-normal text-slate-500"
              title={testContextSlug}
            >
              {testContextSlug}
            </div>
          )}
          <InAppNotification
            isMinimized={!expanded}
            notification={notification}
            onClose={dismissNotification}
          />
          {isDesktop && environmentVariables.RENDER_SYSTEM_TRAY_ICON && (
            <SystemTray />
          )}
          <ProtectedRoute>
            {isDesktop && (
              <div
                data-tauri-drag-region
                className="fixed top-0 left-0 right-0 h-6 z-50"
              />
            )}
            {/* Do not hide overflow on the expanded desktop shell. Settings, Tasks,
                Intentions, and other full-page views own their internal scroll areas.
                If top padding creates a desktop page scrollbar, fix sizing/padding instead. */}
            <main
              className={clsx(
                'box-border bg-slate-950',
                expanded
                  ? [
                      !isDesktop && activeTab === 'timer'
                        ? 'h-svh overflow-hidden'
                        : !isDesktop && activeTab === 'statistics'
                          ? 'h-dvh overflow-y-auto overscroll-y-none'
                          : 'h-dvh',
                      isDesktop
                        ? activeTab === 'statistics'
                          ? 'pt-0'
                          : 'pt-3'
                        : activeTab === 'timer' || activeTab === 'statistics'
                          ? null
                          : 'pt-[env(safe-area-inset-top)]',
                    ]
                  : 'overflow-hidden'
              )}
              style={
                expanded ? undefined : { height: `${minimizedWindowHeight}px` }
              }
            >
              {!expanded && <MinimizedTimer />}
              {expanded && activeTab === 'timer' && (
                <Timer useTallSafeAreaFallback={useTallSafeAreaFallback} />
              )}
              <Suspense fallback={<PageLoadingSkeleton />}>
                {expanded && activeTab === 'statistics' && <Statistics />}
                {expanded && activeTab === 'settings' && <Settings />}
                {expanded &&
                  activeTab === 'tasks' &&
                  preferences?.tasksExtension && <Tasks />}
                {expanded && activeTab === 'debug' && showDebugPanel && (
                  <DebugPanel />
                )}
                {expanded && activeTab === 'intentions' && (
                  <IntentionsManager />
                )}
              </Suspense>
              {isAuthenticated && <AssistantLauncher />}
              {isAuthenticated && <FeedbackRecorder />}
              <ConnectionStatus />
              {isAuthenticated && <UserActionIndicator />}
            </main>
          </ProtectedRoute>
        </>
      )}
    </ToastProvider>
  );
}

export default App;
