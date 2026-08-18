import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { ActionQueueDetails } from '../components/UserActionIndicator';
import { Spinner } from '../components/ui/Spinner';
import { useAuthStore } from '../stores/authStore';
import { useConnectionStatusUi } from '../stores/connectionStatusUiStore';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';
import { useUserActionQueue } from '../utils/userActionQueue';
import { useI18n } from '../i18n';

const CONNECTION_STATUS_DELAY_MS = 1000;
const OFFLINE_THRESHOLD_MS = 30_000;

export function ConnectionStatus() {
  const connectionStatus = useTimerStore.use.connectionStatus();
  const expanded = useUiStore.use.expanded();
  const activeTab = useUiStore.use.activeTab();
  const isAuthenticated = useAuthStore.use.isAuthenticated();
  const actions = useUserActionQueue.use.actions();
  const isNetworkBlocked = useUserActionQueue.use.isNetworkBlocked();
  const isCollapsed = useConnectionStatusUi.use.isCollapsed();
  const dismiss = useConnectionStatusUi.use.dismiss();
  const reset = useConnectionStatusUi.use.reset();
  const setTone = useConnectionStatusUi.use.setTone();
  const tone = useConnectionStatusUi.use.tone();
  const retry = useUserActionQueue.use.retry();
  const [showStatus, setShowStatus] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const statusDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offlineCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const reconnectingStartTimeRef = useRef<number | null>(null);
  const hasConnectedRef = useRef(connectionStatus.isConnected);
  const { t } = useI18n();

  const isDisconnected =
    connectionStatus.isReconnecting || !connectionStatus.isConnected;
  const isInitialConnection =
    isAuthenticated &&
    !hasConnectedRef.current &&
    isDisconnected &&
    !isNetworkBlocked;
  const isUnavailable = isAuthenticated && (isDisconnected || isNetworkBlocked);

  useEffect(() => {
    if (connectionStatus.isConnected) {
      hasConnectedRef.current = true;
    }
  }, [connectionStatus.isConnected]);

  useEffect(() => {
    const clearStatusDelay = () => {
      if (statusDelayRef.current) {
        clearTimeout(statusDelayRef.current);
        statusDelayRef.current = null;
      }
    };

    const clearOfflineCheck = () => {
      if (offlineCheckIntervalRef.current) {
        clearInterval(offlineCheckIntervalRef.current);
        offlineCheckIntervalRef.current = null;
      }
    };

    if (!isUnavailable) {
      reconnectingStartTimeRef.current = null;
      setIsOffline(false);
      setDetailsOpen(false);
      setShowStatus(false);
      reset();
      clearStatusDelay();
      clearOfflineCheck();
      return () => {
        clearStatusDelay();
        clearOfflineCheck();
      };
    }

    if (reconnectingStartTimeRef.current === null) {
      reconnectingStartTimeRef.current = Date.now();
      setIsOffline(false);
      setShowStatus(false);
      setDetailsOpen(false);
      reset();
    }

    const elapsed =
      Date.now() - (reconnectingStartTimeRef.current ?? Date.now());
    // Initial bootstrap renders shell and skeletons silently. Only prolonged
    // initial outage becomes visible; later reconnects remain prompt.
    const displayDelay = isInitialConnection
      ? OFFLINE_THRESHOLD_MS
      : CONNECTION_STATUS_DELAY_MS;
    const remainingDelay = Math.max(0, displayDelay - elapsed);

    if (remainingDelay === 0) {
      clearStatusDelay();
      setShowStatus(true);
    } else if (!statusDelayRef.current) {
      statusDelayRef.current = setTimeout(() => {
        setShowStatus(true);
        statusDelayRef.current = null;
      }, remainingDelay);
    }

    const updateOfflineState = () => {
      const startedAt = reconnectingStartTimeRef.current;
      const offline =
        startedAt !== null && Date.now() - startedAt >= OFFLINE_THRESHOLD_MS;
      setIsOffline(previous => (previous === offline ? previous : offline));
    };

    updateOfflineState();
    clearOfflineCheck();
    offlineCheckIntervalRef.current = setInterval(
      updateOfflineState,
      CONNECTION_STATUS_DELAY_MS
    );

    return () => {
      clearStatusDelay();
      clearOfflineCheck();
    };
  }, [isInitialConnection, isUnavailable, reset]);

  useEffect(() => {
    setTone(
      isOffline || (isInitialConnection && showStatus) ? 'offline' : 'warning'
    );
  }, [isInitialConnection, isOffline, setTone, showStatus]);

  if (!showStatus) {
    return null;
  }

  const statusTone = tone === 'offline' ? 'offline' : 'warning';
  const statusMessage =
    statusTone === 'offline'
      ? t('connection.offline')
      : t('connection.connectingEllipsis');
  const statusClasses =
    statusTone === 'offline'
      ? 'bg-red-600/90 text-white'
      : 'bg-yellow-600/90 text-white';
  const dismissToast = () => {
    setDetailsOpen(false);
    dismiss(statusTone);
  };

  // Timer and minimized surfaces have no BackButton slot. Keep the dismissed
  // connection state visible in the app chrome instead of dropping feedback.
  // Full-page views render the same spinner through their BackButton slot.
  const showGlobalCompactIndicator =
    isCollapsed && (!expanded || activeTab === 'timer');

  if (isCollapsed && showGlobalCompactIndicator) {
    return (
      <div className="pointer-events-none fixed left-2 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[65] flex flex-col items-start gap-2">
        <div className="pointer-events-auto relative">
          <button
            type="button"
            aria-label={t('connection.connecting')}
            aria-expanded={detailsOpen}
            data-testid="connection-status-collapsed-global"
            title={t('connection.connecting')}
            onClick={() => {
              if (actions.length > 0) setDetailsOpen(open => !open);
            }}
            onMouseEnter={() => {
              if (actions.length > 0) setDetailsOpen(true);
            }}
            onFocus={() => {
              if (actions.length > 0) setDetailsOpen(true);
            }}
            className={`relative flex h-9 w-9 items-center justify-center rounded-full border bg-slate-950 shadow-lg focus:outline-none focus:ring-2 ${
              statusTone === 'offline'
                ? 'border-red-400/60 text-red-300 focus:ring-red-300'
                : 'border-yellow-300/60 text-yellow-200 focus:ring-yellow-200'
            }`}
          >
            <Spinner size="sm" />
            {actions.length > 1 && (
              <span
                data-testid="connection-action-count"
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-700 px-1 text-[10px] font-bold text-white"
              >
                {actions.length}
              </span>
            )}
          </button>
          {detailsOpen && actions.length > 0 && (
            <div className="absolute left-0 top-full mt-2">
              <ActionQueueDetails
                actions={actions}
                isNetworkBlocked={isNetworkBlocked}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isCollapsed) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.3 }}
        className="pointer-events-none fixed bottom-0 left-0 right-0 z-50 flex items-center justify-center px-3"
      >
        <div
          className={`pointer-events-auto relative mb-4 rounded-lg px-4 py-2 pr-9 shadow-lg ${statusClasses}`}
        >
          <button
            type="button"
            aria-label={t('connection.dismiss')}
            data-testid="connection-status-dismiss"
            title={t('common.dismiss')}
            onClick={event => {
              event.stopPropagation();
              dismissToast();
            }}
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded text-base leading-none text-white/75 transition hover:bg-black/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/80"
          >
            <span aria-hidden="true">×</span>
          </button>
          <button
            type="button"
            aria-label={
              actions.length > 0
                ? `${statusMessage} ${t('actionQueue.show')}`
                : statusMessage
            }
            aria-expanded={detailsOpen}
            onClick={() => {
              if (actions.length > 0) setDetailsOpen(open => !open);
            }}
            onMouseEnter={() => {
              if (actions.length > 0) setDetailsOpen(true);
            }}
            onFocus={() => {
              if (actions.length > 0) setDetailsOpen(true);
            }}
            className="flex items-center gap-2 text-left focus:outline-none focus:ring-2 focus:ring-white/80"
          >
            {statusTone === 'warning' ? (
              <Spinner size="sm" />
            ) : (
              <span
                aria-hidden="true"
                className="h-4 w-4 rounded-full border border-current opacity-90"
              />
            )}
            <span className="text-sm font-medium">
              {statusMessage}
              {connectionStatus.reconnectAttempts > 0 &&
                statusTone === 'warning' && (
                  <span className="ml-1 text-xs opacity-80">
                    (attempt {connectionStatus.reconnectAttempts})
                  </span>
                )}
            </span>
            {actions.length > 1 && (
              <span
                data-testid="connection-action-count"
                className="flex h-5 min-w-5 items-center justify-center rounded-full bg-black/20 px-1 text-[10px] font-bold"
              >
                {actions.length}
              </span>
            )}
          </button>
          {detailsOpen && actions.length > 0 && (
            <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2">
              <ActionQueueDetails
                actions={actions}
                isNetworkBlocked={isNetworkBlocked}
              />
            </div>
          )}
          {isNetworkBlocked && actions.length === 0 && (
            <button
              type="button"
              onClick={() => retry()}
              className="mt-2 block w-full rounded bg-black/20 px-2 py-1 text-xs font-medium hover:bg-black/30 focus:outline-none focus:ring-2 focus:ring-white/80"
            >
              Retry connection
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
