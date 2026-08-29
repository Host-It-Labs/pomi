import { useEffect, useRef, useState } from 'react';
import { Spinner } from './ui/Spinner';
import {
  UserActionLifecycle,
  UserActionStatus,
  useUserActionQueue,
  useUserActionQueueBase,
} from '../utils/userActionQueue';
import { useTimerStore } from '../stores/timerStore';
import { useI18n } from '../i18n';
import { requestBackendConnectionRecovery } from '../utils/backendConnectionRecovery';

const INDICATOR_DELAY_MS = 1000;

const userActionStatusKey: Record<UserActionStatus, string> = {
  queued: 'actionQueue.waiting',
  submitting: 'actionQueue.sending',
  accepted: 'actionQueue.accepted',
  running: 'actionQueue.running',
  reconciling: 'actionQueue.refreshing',
  succeeded: 'actionQueue.done',
  failed: 'actionQueue.failed',
  cancelled: 'actionQueue.cancelled',
  outcomeUnknown: 'actionQueue.needsReview',
};

interface ActionQueueDetailsProps {
  actions: UserActionLifecycle[];
  canRetryConnection: boolean;
}

export function ActionQueueDetails({
  actions,
  canRetryConnection,
}: ActionQueueDetailsProps) {
  const { t } = useI18n();
  const canClearHead =
    actions.some(
      action => action.status === 'queued' || action.status === 'submitting'
    ) ||
    !['accepted', 'running', 'reconciling'].includes(actions[0]?.status ?? '');
  const clearQueue = () =>
    useUserActionQueueBase.getState().clearQueuedActions();

  return (
    <div
      role="dialog"
      aria-label={t('actionQueue.pending')}
      data-testid="user-action-details"
      className="pointer-events-auto max-h-64 w-72 overflow-auto rounded-lg border border-slate-700 bg-slate-900/95 p-2 text-xs text-slate-200 shadow-xl backdrop-blur"
    >
      <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <span>{t('actionQueue.title')}</span>
        <span>{actions.length}</span>
      </div>
      <ol className="space-y-1">
        {actions.map((action, index) => (
          <li
            key={action.id}
            className="flex items-center gap-2 rounded bg-slate-800/80 px-2 py-1.5"
          >
            <span className="w-4 shrink-0 text-center text-slate-500">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate" title={action.label}>
              {action.label}
            </span>
            <span className="shrink-0 text-[10px] text-slate-400">
              {t(userActionStatusKey[action.status])}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-2 flex items-center gap-2">
        {canRetryConnection && (
          <button
            type="button"
            className="flex-1 rounded bg-amber-600/90 px-2 py-1 text-xs font-medium text-white hover:bg-amber-500"
            onClick={() => {
              useUserActionQueueBase.getState().retry();
              requestBackendConnectionRecovery();
            }}
          >
            {t('actionQueue.retryConnection')}
          </button>
        )}
        {canClearHead && (
          <button
            type="button"
            aria-label={t('actionQueue.clear')}
            title={t('actionQueue.clear')}
            onClick={clearQueue}
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            {t('actionQueue.clearUnsent')}
          </button>
        )}
      </div>
    </div>
  );
}

export function UserActionIndicator() {
  const { t } = useI18n();
  const actions = useUserActionQueue.use.actions();
  const isNetworkBlocked = useUserActionQueue.use.isNetworkBlocked();
  const connectionStatus = useTimerStore.use.connectionStatus();
  const isConnectionIssue =
    isNetworkBlocked ||
    !connectionStatus.isConnected ||
    connectionStatus.isReconnecting;
  const [visible, setVisible] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (actions.length === 0) {
      if (delayRef.current) clearTimeout(delayRef.current);
      delayRef.current = null;
      setVisible(false);
      setDetailsOpen(false);
      return;
    }
    if (isConnectionIssue) return;
    if (visible || delayRef.current) return;
    delayRef.current = setTimeout(() => {
      delayRef.current = null;
      setVisible(true);
    }, INDICATOR_DELAY_MS);
    return () => {
      if (delayRef.current) {
        clearTimeout(delayRef.current);
        delayRef.current = null;
      }
    };
  }, [actions.length, isConnectionIssue, visible]);

  // ConnectionStatus owns the single visible surface while reconnecting. Reset
  // the queue delay so it does not flash underneath the reconnect toast.
  useEffect(() => {
    if (!isConnectionIssue) return;
    if (delayRef.current) clearTimeout(delayRef.current);
    delayRef.current = null;
    setVisible(false);
    setDetailsOpen(false);
  }, [isConnectionIssue]);

  if (isConnectionIssue || !visible || actions.length === 0) return null;

  const count = actions.length;

  return (
    <div className="pointer-events-none fixed right-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-[70] flex flex-col items-end gap-2 sm:right-4 sm:bottom-4">
      {detailsOpen && (
        <ActionQueueDetails
          actions={actions}
          canRetryConnection={isNetworkBlocked}
        />
      )}
      <div
        data-testid="user-action-indicator"
        className="pointer-events-auto flex items-center gap-1"
      >
        <button
          type="button"
          aria-label={t('actionQueue.show')}
          aria-expanded={detailsOpen}
          title={t('actionQueue.pending')}
          onClick={() => setDetailsOpen(open => !open)}
          onMouseEnter={() => setDetailsOpen(true)}
          onFocus={() => setDetailsOpen(true)}
          className="relative flex h-9 w-9 items-center justify-center rounded-full border border-indigo-400/50 bg-slate-900 text-indigo-300 shadow-lg transition hover:border-indigo-300 hover:text-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <Spinner size="sm" />
          {count > 1 && (
            <span
              data-testid="user-action-count"
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-bold text-white"
            >
              {count}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
