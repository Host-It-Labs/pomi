import type {
  AssistantDebugLogEntry,
  UserDataExport,
  UserDataImportResult,
} from '@pomi/shared';
import {
  CLIENT_NOTIFICATION_TYPES,
  TIMER_TYPES,
} from '@pomi/shared/src/constants';
import * as Sentry from '@sentry/react';
import clsx from 'clsx';
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { FaChevronDown, FaChevronUp, FaFlag } from 'react-icons/fa';
import { BackButton } from '../components/BackButton';
import {
  MOBILE_SIMULATOR_PRESETS,
  MobileSimulator,
  type MobileSimulatorPresetId,
} from '../components/debug/MobileSimulator';
import { useToast } from '../components/toast/ToastContext';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PageContainer } from '../components/ui/PageContainer';
import { PageShell } from '../components/ui/PageShell';
import { SectionHeader } from '../components/ui/SectionHeader';
import { type TranslateFunction, useI18n } from '../i18n';
import { useAuthStore } from '../stores/authStore';
import { useDebugStore } from '../stores/debugStore';
import { apiClient } from '../utils/apiClient';
import { isDesktop } from '../utils/osUtils';
import { submitUserMutation } from '../utils/userActionQueue';

type NotificationTestType =
  | typeof CLIENT_NOTIFICATION_TYPES.COMPLETE
  | typeof CLIENT_NOTIFICATION_TYPES.WARNING
  | typeof CLIENT_NOTIFICATION_TYPES.LONG_BREAK_DETECTED
  | typeof CLIENT_NOTIFICATION_TYPES.PAUSED_TIMER_REMINDER;
type NotificationTimerType =
  | typeof TIMER_TYPES.WORK
  | typeof TIMER_TYPES.BREAK
  | typeof TIMER_TYPES.LONG_BREAK;

type NotificationTest = {
  id: string;
  labelKey: string;
  payload: {
    type: NotificationTestType;
    timerType: NotificationTimerType;
    minutesLeft?: number;
    isLastWorkTimerInSession?: boolean;
  };
};

const NOTIFICATION_TESTS: NotificationTest[] = [
  {
    id: 'work-complete',
    labelKey: 'debug.workComplete',
    payload: {
      type: CLIENT_NOTIFICATION_TYPES.COMPLETE,
      timerType: TIMER_TYPES.WORK,
    },
  },
  {
    id: 'break-complete',
    labelKey: 'debug.breakComplete',
    payload: {
      type: CLIENT_NOTIFICATION_TYPES.COMPLETE,
      timerType: TIMER_TYPES.BREAK,
    },
  },
  {
    id: 'long-break-complete',
    labelKey: 'debug.longBreakComplete',
    payload: {
      type: CLIENT_NOTIFICATION_TYPES.COMPLETE,
      timerType: TIMER_TYPES.LONG_BREAK,
    },
  },
  {
    id: 'work-warning',
    labelKey: 'debug.workWarning',
    payload: {
      type: CLIENT_NOTIFICATION_TYPES.WARNING,
      timerType: TIMER_TYPES.WORK,
      minutesLeft: 3,
    },
  },
  {
    id: 'long-break-detected',
    labelKey: 'debug.longBreakDetected',
    payload: {
      type: CLIENT_NOTIFICATION_TYPES.LONG_BREAK_DETECTED,
      timerType: TIMER_TYPES.WORK,
    },
  },
  {
    id: 'paused-timer-reminder',
    labelKey: 'debug.pausedTimerReminder',
    payload: {
      type: CLIENT_NOTIFICATION_TYPES.PAUSED_TIMER_REMINDER,
      timerType: TIMER_TYPES.WORK,
    },
  },
];

export function DebugPanel() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const user = useAuthStore.use.user();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isUserDataOpen, setIsUserDataOpen] = useState(false);
  const [isSentryOpen, setIsSentryOpen] = useState(false);
  const [isAssistantDebugOpen, setIsAssistantDebugOpen] = useState(false);
  const [isLagOpen, setIsLagOpen] = useState(false);
  const [mobileSimulatorPresetId, setMobileSimulatorPresetId] =
    useState<MobileSimulatorPresetId | null>(null);
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [isSendingFrontendError, setIsSendingFrontendError] = useState(false);
  const [isSendingBackendError, setIsSendingBackendError] = useState(false);
  const [isExportingUserData, setIsExportingUserData] = useState(false);
  const [isImportingUserData, setIsImportingUserData] = useState(false);
  const [isAssistantDebugEnabled, setIsAssistantDebugEnabled] = useState(false);
  const [isAssistantDebugInitialLoading, setIsAssistantDebugInitialLoading] =
    useState(true);
  const [isAssistantDebugRefreshing, setIsAssistantDebugRefreshing] =
    useState(false);
  const [assistantDebugLoadError, setAssistantDebugLoadError] = useState<{
    kind: 'initial' | 'refresh';
    message: string;
  } | null>(null);
  const [assistantDebugMutationError, setAssistantDebugMutationError] =
    useState<string | null>(null);
  const [isAssistantDebugSaving, setIsAssistantDebugSaving] = useState(false);
  const [isAssistantDebugClearing, setIsAssistantDebugClearing] =
    useState(false);
  const [isAssistantDebugExporting, setIsAssistantDebugExporting] =
    useState(false);
  const [updatingAssistantDebugLogId, setUpdatingAssistantDebugLogId] =
    useState<string | null>(null);
  const [assistantDebugLogs, setAssistantDebugLogs] = useState<
    AssistantDebugLogEntry[]
  >([]);
  const [expandedAssistantDebugLogId, setExpandedAssistantDebugLogId] =
    useState<string | null>(null);
  const lagMs = useDebugStore.use.lagMs();
  const setLagMs = useDebugStore.use.setLagMs();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const assistantDebugLogsRef = useRef<AssistantDebugLogEntry[]>([]);
  const assistantDebugLoadGenerationRef = useRef(0);
  const hasRequestedAssistantDebugInitialLoadRef = useRef(false);
  const expandedAssistantDebugLogIdRef = useRef<string | null>(null);
  const assistantDebugRowRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingAssistantDebugAnchorRef = useRef<{
    id: string;
    top: number;
  } | null>(null);
  const showUserDataTransfer = user?.isAdmin === true;

  const LAG_PRESETS = [0, 200, 500, 1000, 2000, 5000];

  useEffect(() => {
    assistantDebugLogsRef.current = assistantDebugLogs;
  }, [assistantDebugLogs]);

  useEffect(() => {
    expandedAssistantDebugLogIdRef.current = expandedAssistantDebugLogId;
  }, [expandedAssistantDebugLogId]);

  useLayoutEffect(() => {
    const anchor = pendingAssistantDebugAnchorRef.current;
    if (!anchor) return;
    pendingAssistantDebugAnchorRef.current = null;
    const row = assistantDebugRowRefs.current.get(anchor.id);
    if (!row) return;
    window.scrollBy({ top: row.getBoundingClientRect().top - anchor.top });
  }, [assistantDebugLogs]);

  const rememberAssistantDebugAnchor = useCallback(() => {
    const expandedId = expandedAssistantDebugLogIdRef.current;
    const rows = assistantDebugLogsRef.current;
    const visibleId = rows.find(log => {
      const bounds = assistantDebugRowRefs.current
        .get(log.id)
        ?.getBoundingClientRect();
      return bounds
        ? bounds.bottom > 0 && bounds.top < window.innerHeight
        : false;
    })?.id;
    const id = expandedId ?? visibleId;
    const row = id ? assistantDebugRowRefs.current.get(id) : null;
    if (!id || !row) return null;
    return { id, top: row.getBoundingClientRect().top };
  }, []);

  const loadAssistantDebugState = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const requestGeneration = assistantDebugLoadGenerationRef.current + 1;
      assistantDebugLoadGenerationRef.current = requestGeneration;
      const isRefresh = mode === 'refresh';
      const oldLogs = assistantDebugLogsRef.current;
      const anchor = isRefresh ? rememberAssistantDebugAnchor() : null;
      if (isRefresh) setIsAssistantDebugRefreshing(true);
      else setIsAssistantDebugInitialLoading(true);
      setAssistantDebugLoadError(null);
      try {
        const [statusResponse, logsResponse] = await Promise.all([
          apiClient.assistant.debugStatus(),
          apiClient.assistant.debugLogs(),
        ]);
        if (statusResponse.status !== 200 || logsResponse.status !== 200) {
          throw new Error(t('debug.loadFailed'));
        }
        if (requestGeneration !== assistantDebugLoadGenerationRef.current) {
          return;
        }
        setIsAssistantDebugEnabled(statusResponse.body.enabled);
        const nextLogs = logsResponse.body;
        const expandedId = expandedAssistantDebugLogIdRef.current;
        let nextAnchor = anchor;
        if (expandedId && !nextLogs.some(log => log.id === expandedId)) {
          const oldIndex = oldLogs.findIndex(log => log.id === expandedId);
          const nearest =
            nextLogs[Math.min(Math.max(oldIndex, 0), nextLogs.length - 1)];
          setExpandedAssistantDebugLogId(null);
          if (nearest && anchor) nextAnchor = { ...anchor, id: nearest.id };
        }
        pendingAssistantDebugAnchorRef.current = nextAnchor;
        setAssistantDebugLogs(nextLogs);
      } catch (error) {
        if (requestGeneration !== assistantDebugLoadGenerationRef.current) {
          return;
        }
        console.error('Failed to load Assistant debug logs:', error);
        const message =
          error instanceof Error ? error.message : t('debug.loadFailed');
        setAssistantDebugLoadError({ kind: mode, message });
        if (isRefresh) showToast(t('debug.refreshFailed'), 'error');
      } finally {
        if (requestGeneration === assistantDebugLoadGenerationRef.current) {
          if (isRefresh) setIsAssistantDebugRefreshing(false);
          else setIsAssistantDebugInitialLoading(false);
        }
      }
    },
    [rememberAssistantDebugAnchor, showToast, t]
  );

  useEffect(() => {
    if (hasRequestedAssistantDebugInitialLoadRef.current) return;
    hasRequestedAssistantDebugInitialLoadRef.current = true;
    void loadAssistantDebugState('initial');
  }, [loadAssistantDebugState]);

  const handleToggleAssistantDebug = async () => {
    if (
      isAssistantDebugSaving ||
      isAssistantDebugClearing ||
      isAssistantDebugRefreshing
    ) {
      return;
    }
    const nextEnabled = !isAssistantDebugEnabled;
    if (!nextEnabled && !window.confirm(t('debug.turnOffDeleteLogs'))) {
      return;
    }

    setIsAssistantDebugSaving(true);
    assistantDebugLoadGenerationRef.current += 1;
    pendingAssistantDebugAnchorRef.current = null;
    setIsAssistantDebugRefreshing(false);
    setIsAssistantDebugInitialLoading(false);
    setAssistantDebugMutationError(null);
    try {
      const result = await submitUserMutation({
        kind: 'assistant',
        label: nextEnabled
          ? t('debug.enableLogging')
          : t('debug.disableLogging'),
        payload: {
          operation: 'updateDebugStatus',
          payload: { enabled: nextEnabled },
        },
      });
      const response =
        result &&
        typeof result === 'object' &&
        'status' in result &&
        'body' in result
          ? (result as { status: number; body: { enabled: boolean } })
          : { status: 200, body: result as { enabled: boolean } };
      if (response.status !== 200) {
        setAssistantDebugMutationError(t('debug.updateLoggingFailed'));
        showToast(t('debug.updateLoggingFailed'), 'error');
        return;
      }
      setIsAssistantDebugEnabled(response.body.enabled);
      if (!response.body.enabled) {
        setAssistantDebugLogs([]);
        setExpandedAssistantDebugLogId(null);
      }
      showToast(
        response.body.enabled
          ? t('debug.loggingEnabled')
          : t('debug.loggingDisabled'),
        'success'
      );
    } catch (error) {
      console.error('Failed to update AI debug logging:', error);
      setAssistantDebugMutationError(t('debug.updateLoggingFailed'));
      showToast(t('debug.updateLoggingFailed'), 'error');
    } finally {
      setIsAssistantDebugSaving(false);
    }
  };

  const handleClearAssistantDebugLogs = async () => {
    if (
      isAssistantDebugClearing ||
      isAssistantDebugSaving ||
      isAssistantDebugRefreshing
    ) {
      return;
    }
    if (!window.confirm(t('debug.deleteLogsConfirm'))) {
      return;
    }

    setIsAssistantDebugClearing(true);
    assistantDebugLoadGenerationRef.current += 1;
    pendingAssistantDebugAnchorRef.current = null;
    setIsAssistantDebugRefreshing(false);
    setIsAssistantDebugInitialLoading(false);
    setAssistantDebugMutationError(null);
    try {
      const result = await submitUserMutation({
        kind: 'assistant',
        label: t('debug.clearLogsAction'),
        payload: { operation: 'clearDebugLogs' },
      });
      const response =
        result &&
        typeof result === 'object' &&
        'status' in result &&
        'body' in result
          ? (result as { status: number; body: { success: boolean } })
          : { status: 200, body: result as { success: boolean } };
      if (response.status !== 200) {
        setAssistantDebugMutationError(t('debug.clearLogsFailed'));
        showToast(t('debug.clearLogsFailed'), 'error');
        return;
      }
      setAssistantDebugLogs([]);
      setExpandedAssistantDebugLogId(null);
      showToast(t('debug.logsCleared'), 'success');
    } catch (error) {
      console.error('Failed to clear AI debug logs:', error);
      setAssistantDebugMutationError(t('debug.clearLogsFailed'));
      showToast(t('debug.clearLogsFailed'), 'error');
    } finally {
      setIsAssistantDebugClearing(false);
    }
  };

  const handleToggleAssistantDebugLogFlag = async (
    log: AssistantDebugLogEntry
  ) => {
    if (updatingAssistantDebugLogId) {
      return;
    }

    setUpdatingAssistantDebugLogId(log.id);
    setAssistantDebugMutationError(null);
    try {
      const result = await submitUserMutation({
        kind: 'assistant',
        label: t('debug.updateLogFlagAction'),
        payload: {
          operation: 'updateDebugLogFlag',
          payload: { id: log.id, flagged: !log.flagged },
        },
      });
      const response =
        result &&
        typeof result === 'object' &&
        'status' in result &&
        'body' in result
          ? (result as { status: number; body: AssistantDebugLogEntry })
          : { status: 200, body: result as AssistantDebugLogEntry };
      if (response.status !== 200) {
        setAssistantDebugMutationError(t('debug.updateFlagFailed'));
        showToast(t('debug.updateFlagFailed'), 'error');
        return;
      }

      setAssistantDebugLogs(currentLogs =>
        currentLogs.map(currentLog =>
          currentLog.id === log.id
            ? { ...currentLog, flagged: response.body.flagged }
            : currentLog
        )
      );
    } catch (error) {
      console.error('Failed to update AI debug log flag:', error);
      setAssistantDebugMutationError(t('debug.updateFlagFailed'));
      showToast(t('debug.updateFlagFailed'), 'error');
    } finally {
      setUpdatingAssistantDebugLogId(null);
    }
  };

  const handleExportFlaggedAssistantDebugLogs = async () => {
    if (
      isAssistantDebugExporting ||
      !assistantDebugLogs.some(log => log.flagged)
    ) {
      return;
    }

    setIsAssistantDebugExporting(true);
    try {
      const response = await apiClient.assistant.exportFlaggedDebugLogs();
      if (response.status !== 200) {
        showToast(t('debug.exportFailed'), 'error');
        return;
      }

      const blob = new Blob([JSON.stringify(response.body, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = createAssistantDebugLogsFileName(user?.username);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(t('debug.exported'), 'success');
    } catch (error) {
      console.error('Failed to export flagged AI debug logs:', error);
      showToast(t('debug.exportFailed'), 'error');
    } finally {
      setIsAssistantDebugExporting(false);
    }
  };

  const handleSendTestNotification = async (test: NotificationTest) => {
    if (activeTestId) {
      return;
    }

    setActiveTestId(test.id);
    const testLabel = t(test.labelKey);

    try {
      const result = await submitUserMutation({
        kind: 'notifications',
        label: t('debug.sendNotification', { label: testLabel }),
        payload: {
          operation: 'test',
          payload: test.payload,
        },
      });
      const response =
        result && typeof result === 'object' && 'status' in result
          ? (result as { status: number })
          : { status: 200 };
      if (response.status === 200) {
        showToast(
          t('debug.testNotificationSent', { label: testLabel }),
          'success'
        );
      } else {
        showToast(
          t('debug.testNotificationFailed', { label: testLabel }),
          'error'
        );
      }
    } catch (error) {
      console.error('Failed to send test notification:', error);
      showToast(
        t('debug.testNotificationFailed', { label: testLabel }),
        'error'
      );
    } finally {
      setActiveTestId(null);
    }
  };

  const handleSendFrontendError = async () => {
    if (isSendingFrontendError) {
      return;
    }

    setIsSendingFrontendError(true);
    try {
      Sentry.captureException(new Error(t('debug.frontendSentryTestError')));
      showToast(t('debug.frontendSentrySent'), 'success');
    } catch (error) {
      console.error('Failed to send frontend Sentry test error:', error);
      showToast(t('debug.sentryTestFailed'), 'error');
    } finally {
      setIsSendingFrontendError(false);
    }
  };

  const handleSendBackendError = async () => {
    if (isSendingBackendError) {
      return;
    }

    setIsSendingBackendError(true);
    try {
      const response = await apiClient.system.debugSentry({ body: {} });
      if (response.status === 200) {
        showToast(t('debug.backendSentrySent'), 'success');
      } else {
        showToast(t('debug.sentryTestFailed'), 'error');
      }
    } catch (error) {
      console.error('Failed to send backend Sentry test error:', error);
      showToast(t('debug.sentryTestFailed'), 'error');
    } finally {
      setIsSendingBackendError(false);
    }
  };

  const handleExportUserData = async () => {
    if (isExportingUserData) {
      return;
    }

    setIsExportingUserData(true);
    try {
      const response = await apiClient.system.exportUserData();
      if (response.status !== 200) {
        showToast(t('debug.userDataExportFailed'), 'error');
        return;
      }

      const payload = response.body;
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = createUserDataFileName(payload.sourceUser.username);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(t('debug.userDataExported'), 'success');
    } catch (error) {
      console.error('Failed to export user data:', error);
      showToast(t('debug.userDataExportFailed'), 'error');
    } finally {
      setIsExportingUserData(false);
    }
  };

  const handleImportUserDataFile = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || isImportingUserData) {
      return;
    }

    try {
      const payload = JSON.parse(await file.text()) as UserDataExport;
      if (payload.version !== 1 || !payload.data) {
        throw new Error(t('debug.unsupportedFile'));
      }

      const sourceUsername = payload.sourceUser?.username ?? 'exported user';
      if (
        !window.confirm(
          t('debug.replaceUserDataConfirm', { username: sourceUsername })
        )
      ) {
        return;
      }

      setIsImportingUserData(true);
      // User-data exports use the dedicated endpoint because it has the 50 MB
      // parser limit required for legitimate exports.
      const response = await apiClient.system.importUserData({
        body: payload,
      });
      if (response.status !== 200) {
        showToast(t('debug.userDataImportFailed'), 'error');
        return;
      }

      showToast(
        formatUserDataImportToast(response.body.imported, t),
        'success'
      );
      window.setTimeout(() => window.location.reload(), 750);
    } catch (error) {
      console.error('Failed to import user data:', error);
      showToast(t('debug.userDataImportFailed'), 'error');
    } finally {
      setIsImportingUserData(false);
    }
  };

  return (
    <PageShell>
      <PageContainer className="pb-12">
        {isDesktop && (
          <div
            data-tauri-drag-region
            className="fixed top-0 left-0 right-0 h-6 z-50"
          />
        )}
        <div
          className={`sticky ${isDesktop ? 'top-5' : 'top-0'} z-20 bg-slate-950/95 backdrop-blur supports-backdrop-filter:bg-slate-950/80 border-b border-slate-900`}
        >
          <div className="py-3">
            <BackButton targetTab="settings" />
          </div>
        </div>

        <div className="pt-8 space-y-4">
          <SectionHeader
            title={t('debug.title')}
            description={t('debug.description')}
          />

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-white">
              {t('debug.mobileSimulator')}
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {t('debug.mobileSimulatorDescription')}
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {MOBILE_SIMULATOR_PRESETS.map(preset => (
                <Button
                  key={preset.id}
                  type="button"
                  onClick={() => setMobileSimulatorPresetId(preset.id)}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                >
                  {preset.label} · {preset.width}×{preset.height}
                </Button>
              ))}
            </div>
          </Card>

          {showUserDataTransfer && (
            <Card className="p-4">
              <button
                type="button"
                onClick={() => setIsUserDataOpen(current => !current)}
                className="flex w-full items-start justify-between text-left"
                aria-expanded={isUserDataOpen}
              >
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    {t('debug.userData')}
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">
                    {t('debug.userDataDescription')}
                  </p>
                </div>
                <span className="mt-1 text-slate-400">
                  {isUserDataOpen ? <FaChevronUp /> : <FaChevronDown />}
                </span>
              </button>

              {isUserDataOpen && (
                <div className="mt-4 space-y-3">
                  <p className="text-xs text-slate-400">
                    {t('debug.userDataImportDescription')}
                  </p>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={event => void handleImportUserDataFile(event)}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      onClick={handleExportUserData}
                      disabled={isExportingUserData || isImportingUserData}
                      variant="outline"
                      size="sm"
                      className="text-xs"
                    >
                      {isExportingUserData
                        ? t('debug.exporting')
                        : t('debug.exportData')}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => importInputRef.current?.click()}
                      disabled={isExportingUserData || isImportingUserData}
                      variant="danger"
                      size="sm"
                      className="text-xs"
                    >
                      {isImportingUserData
                        ? t('debug.importing')
                        : t('debug.importData')}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}

          <Card className="p-4">
            <button
              type="button"
              onClick={() => setIsNotificationsOpen(current => !current)}
              className="flex w-full items-start justify-between text-left"
              aria-expanded={isNotificationsOpen}
            >
              <div>
                <h2 className="text-sm font-semibold text-white">
                  {t('debug.notifications')}
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  {t('debug.notificationsDescription')}
                </p>
              </div>
              <span className="mt-1 text-slate-400">
                {isNotificationsOpen ? <FaChevronUp /> : <FaChevronDown />}
              </span>
            </button>

            {isNotificationsOpen && (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-slate-400">
                  These tests use the same services as live notifications and
                  may trigger push and desktop alerts.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {NOTIFICATION_TESTS.map(test => (
                    <Button
                      key={test.id}
                      type="button"
                      onClick={() => handleSendTestNotification(test)}
                      disabled={activeTestId !== null}
                      variant="outline"
                      size="sm"
                      className="text-xs"
                    >
                      {activeTestId === test.id
                        ? t('debug.sending')
                        : t('debug.sendNotification', {
                            label: t(test.labelKey),
                          })}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <button
              type="button"
              onClick={() => setIsAssistantDebugOpen(current => !current)}
              className="flex w-full items-start justify-between text-left"
              aria-expanded={isAssistantDebugOpen}
            >
              <div>
                <h2 className="text-sm font-semibold text-white">
                  {t('debug.aiLogs')}
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Store this user's Assistant and AI Task capture diagnostics.
                  {isAssistantDebugEnabled && (
                    <span className="text-amber-400 ml-1">
                      {t('debug.active')}
                    </span>
                  )}
                </p>
              </div>
              <span className="mt-1 text-slate-400">
                {isAssistantDebugOpen ? <FaChevronUp /> : <FaChevronDown />}
              </span>
            </button>

            {isAssistantDebugOpen && (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-slate-400">
                  {t('debug.logsDescription')}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={handleToggleAssistantDebug}
                    disabled={
                      isAssistantDebugInitialLoading ||
                      isAssistantDebugSaving ||
                      isAssistantDebugClearing ||
                      isAssistantDebugRefreshing
                    }
                    variant={isAssistantDebugEnabled ? 'danger' : 'primary'}
                    size="sm"
                    className="text-xs"
                  >
                    {isAssistantDebugSaving
                      ? t('debug.saving')
                      : isAssistantDebugEnabled
                        ? t('debug.turnOffDeleteLogs')
                        : t('debug.turnOnLogging')}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void loadAssistantDebugState('refresh')}
                    disabled={
                      isAssistantDebugInitialLoading ||
                      isAssistantDebugRefreshing ||
                      isAssistantDebugSaving ||
                      isAssistantDebugClearing
                    }
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    {isAssistantDebugRefreshing
                      ? t('debug.refreshing')
                      : t('common.retry')}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleExportFlaggedAssistantDebugLogs()}
                    disabled={
                      isAssistantDebugExporting ||
                      !assistantDebugLogs.some(log => log.flagged)
                    }
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    {isAssistantDebugExporting
                      ? t('debug.exporting')
                      : t('debug.exportFlaggedLogs')}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleClearAssistantDebugLogs}
                    disabled={
                      assistantDebugLogs.length === 0 ||
                      isAssistantDebugClearing ||
                      isAssistantDebugSaving ||
                      isAssistantDebugRefreshing
                    }
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    {isAssistantDebugClearing
                      ? t('debug.clearing')
                      : t('debug.clearLogs')}
                  </Button>
                </div>

                {assistantDebugMutationError && (
                  <p className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                    {assistantDebugMutationError}
                  </p>
                )}
                {assistantDebugLoadError?.kind === 'refresh' && (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                    <span>
                      {t('debug.showingSavedResults')}{' '}
                      {assistantDebugLoadError.message}
                    </span>
                    <Button
                      type="button"
                      onClick={() => void loadAssistantDebugState('refresh')}
                      disabled={
                        isAssistantDebugRefreshing ||
                        isAssistantDebugSaving ||
                        isAssistantDebugClearing
                      }
                      variant="outline"
                      size="xs"
                    >
                      {t('common.retry')}
                    </Button>
                  </div>
                )}

                <div className="min-h-[7.75rem]">
                  {isAssistantDebugInitialLoading ? (
                    <div
                      aria-label={t('debug.loadingLogs')}
                      className="space-y-2"
                    >
                      {[0, 1, 2].map(index => (
                        <div
                          key={index}
                          className="h-9 animate-pulse rounded-md border border-slate-800/70 bg-slate-950/35"
                        />
                      ))}
                    </div>
                  ) : assistantDebugLoadError?.kind === 'initial' ? (
                    <div className="flex min-h-[7.75rem] items-center justify-between gap-2 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                      <span>{assistantDebugLoadError.message}</span>
                      <Button
                        type="button"
                        onClick={() => void loadAssistantDebugState('initial')}
                        disabled={
                          isAssistantDebugSaving || isAssistantDebugClearing
                        }
                        variant="outline"
                        size="xs"
                      >
                        {t('common.retry')}
                      </Button>
                    </div>
                  ) : assistantDebugLogs.length === 0 ? (
                    <p className="min-h-[7.75rem] rounded-md border border-slate-800/70 bg-slate-950/30 px-3 py-2 text-xs text-slate-500">
                      {t('debug.noLogs')}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {assistantDebugLogs.map(log => {
                        const isExpanded =
                          expandedAssistantDebugLogId === log.id;
                        return (
                          <div
                            key={log.id}
                            ref={element => {
                              if (element)
                                assistantDebugRowRefs.current.set(
                                  log.id,
                                  element
                                );
                              else assistantDebugRowRefs.current.delete(log.id);
                            }}
                            className="overflow-hidden rounded-md border border-slate-800/70 bg-slate-950/35"
                          >
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                aria-expanded={isExpanded}
                                onClick={() =>
                                  setExpandedAssistantDebugLogId(current =>
                                    current === log.id ? null : log.id
                                  )
                                }
                                className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left text-xs text-slate-300"
                              >
                                <span className="min-w-0">
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    <span className="truncate">
                                      {formatAssistantDebugKind(log.kind, t)} ·{' '}
                                      {formatAssistantDebugSource(
                                        log.source,
                                        t
                                      )}{' '}
                                      ·{' '}
                                      {new Date(log.createdAt).toLocaleString()}
                                      {typeof log.timings.totalMs ===
                                        'number' &&
                                        ` · ${log.timings.totalMs}ms`}
                                    </span>
                                    <span
                                      className={clsx(
                                        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                                        log.status === 'failed' &&
                                          'bg-red-950/70 text-red-300',
                                        log.status === 'fallback' &&
                                          'bg-amber-950/70 text-amber-300',
                                        log.status === 'dictated' &&
                                          'bg-sky-950/70 text-sky-300',
                                        log.status === 'succeeded' &&
                                          'bg-emerald-950/70 text-emerald-300'
                                      )}
                                    >
                                      {formatAssistantDebugStatus(
                                        log.status,
                                        t
                                      )}
                                    </span>
                                  </span>
                                  {log.error && (
                                    <span className="mt-1 block truncate text-[11px] text-red-300">
                                      {log.error}
                                    </span>
                                  )}
                                </span>
                                <span className="shrink-0 text-slate-500">
                                  {isExpanded ? (
                                    <FaChevronUp />
                                  ) : (
                                    <FaChevronDown />
                                  )}
                                </span>
                              </button>
                              <Button
                                type="button"
                                onClick={() =>
                                  void handleToggleAssistantDebugLogFlag(log)
                                }
                                disabled={updatingAssistantDebugLogId !== null}
                                aria-label={
                                  log.flagged
                                    ? 'Remove AI debug log flag'
                                    : 'Flag AI debug log for export'
                                }
                                aria-pressed={log.flagged}
                                title={
                                  log.flagged
                                    ? 'Remove flag'
                                    : 'Flag for export'
                                }
                                variant="ghost"
                                size="xs"
                                className={clsx(
                                  'mr-2 shrink-0 p-1.5',
                                  log.flagged
                                    ? 'text-amber-300 hover:text-amber-200'
                                    : 'text-slate-500 hover:text-slate-300'
                                )}
                              >
                                <FaFlag aria-hidden="true" />
                              </Button>
                            </div>
                            {isExpanded && (
                              <div className="space-y-3 border-t border-slate-800/70 px-3 py-3 text-xs text-slate-300">
                                <DebugLogField
                                  label={t('debug.userPrompt')}
                                  value={log.userPrompt}
                                />
                                <DebugLogField
                                  label={t('debug.processedOutput')}
                                  value={log.processedOutput}
                                />
                                <DebugLogField
                                  label={t('debug.invalidOutput')}
                                  value={log.invalidParserOutput}
                                />
                                <DebugLogField
                                  label={t('debug.openRouterTrace')}
                                  value={
                                    log.modelCalls.length > 0
                                      ? log.modelCalls
                                      : null
                                  }
                                />
                                <DebugLogField
                                  label={t('debug.intentionResolution')}
                                  value={
                                    log.resolutionNotes.length > 0
                                      ? log.resolutionNotes.join('\n')
                                      : null
                                  }
                                />
                                <DebugLogField
                                  label={t('debug.timingBreakdown')}
                                  value={formatAssistantDebugTimings(
                                    log.timings,
                                    t
                                  )}
                                />
                                <DebugLogField
                                  label={t('common.error')}
                                  value={log.error}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <button
              type="button"
              onClick={() => setIsSentryOpen(current => !current)}
              className="flex w-full items-start justify-between text-left"
              aria-expanded={isSentryOpen}
            >
              <div>
                <h2 className="text-sm font-semibold text-white">Sentry</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {t('debug.sentryDescription')}
                </p>
              </div>
              <span className="mt-1 text-slate-400">
                {isSentryOpen ? <FaChevronUp /> : <FaChevronDown />}
              </span>
            </button>

            {isSentryOpen && (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-slate-400">
                  {t('debug.sentryTestDescription')}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    onClick={handleSendFrontendError}
                    disabled={isSendingFrontendError || isSendingBackendError}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    {isSendingFrontendError
                      ? t('debug.sending')
                      : t('debug.sendFrontendError')}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSendBackendError}
                    disabled={isSendingFrontendError || isSendingBackendError}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    {isSendingBackendError
                      ? t('debug.sending')
                      : t('debug.sendBackendError')}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <button
              type="button"
              onClick={() => setIsLagOpen(current => !current)}
              className="flex w-full items-start justify-between text-left"
              aria-expanded={isLagOpen}
            >
              <div>
                <h2 className="text-sm font-semibold text-white">
                  {t('debug.networkLagSimulator')}
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Delay socket traffic and accepted-action HTTP requests.
                  {lagMs > 0 && (
                    <span className="text-amber-400 ml-1">
                      {t('debug.activeLag', { ms: lagMs })}
                    </span>
                  )}
                </p>
              </div>
              <span className="mt-1 text-slate-400">
                {isLagOpen ? <FaChevronUp /> : <FaChevronDown />}
              </span>
            </button>

            {isLagOpen && (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-slate-400">
                  {t('debug.networkLagDescription')}
                </p>
                <div className="grid gap-2 grid-cols-3">
                  {LAG_PRESETS.map(ms => (
                    <Button
                      key={ms}
                      type="button"
                      onClick={() => {
                        setLagMs(ms);
                        showToast(
                          ms === 0
                            ? 'Lag simulator disabled'
                            : `Lag set to ${ms}ms`,
                          'success'
                        );
                      }}
                      variant={lagMs === ms ? 'primary' : 'outline'}
                      size="sm"
                      className="text-xs"
                    >
                      {ms === 0 ? 'Off' : `${ms}ms`}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>

        {mobileSimulatorPresetId && (
          <MobileSimulator
            initialPresetId={mobileSimulatorPresetId}
            isOpen
            onClose={() => setMobileSimulatorPresetId(null)}
          />
        )}
      </PageContainer>
    </PageShell>
  );
}

function formatAssistantDebugKind(
  kind: AssistantDebugLogEntry['kind'],
  translate: TranslateFunction
) {
  switch (kind) {
    case 'voiceCommand':
      return translate('debug.voiceCommand');
    case 'taskCapture':
      return translate('debug.taskCapture');
    default:
      return kind;
  }
}

function formatAssistantDebugSource(
  source: AssistantDebugLogEntry['source'],
  translate: TranslateFunction
) {
  switch (source) {
    case 'assistantVoice':
      return translate('debug.assistantVoice');
    case 'dictation':
      return translate('debug.dictation');
    case 'typed':
      return translate('debug.typed');
  }
}

function formatAssistantDebugStatus(
  status: AssistantDebugLogEntry['status'],
  translate: TranslateFunction
) {
  switch (status) {
    case 'dictated':
      return translate('debug.notCaptured');
    case 'fallback':
      return translate('debug.fallback');
    case 'failed':
      return translate('common.error');
    case 'succeeded':
      return translate('common.success');
  }
}

function formatAssistantDebugTimings(
  timings: AssistantDebugLogEntry['timings'],
  translate: TranslateFunction
) {
  const labels: Record<keyof typeof timings, string> = {
    transcriptionMs: translate('debug.transcription'),
    contextMs: translate('debug.context'),
    modelRequestMs: translate('debug.modelRequest'),
    modelRepairMs: translate('debug.modelRepair'),
    modelReviewMs: translate('debug.modelReview'),
    outputProcessingMs: translate('debug.outputProcessing'),
    validationMs: translate('debug.validation'),
    taskCreationMs: translate('debug.taskCreation'),
    timerActionMs: translate('debug.timerAction'),
    speechSynthesisMs: translate('debug.speechSynthesis'),
    totalMs: translate('debug.processingTotal'),
  };
  const lines = Object.entries(timings).map(
    ([key, value]) => `${labels[key as keyof typeof timings]}: ${value}ms`
  );
  return lines.length > 0 ? lines.join('\n') : null;
}

function createUserDataFileName(username: string) {
  const safeUsername =
    username
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'user';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `pomi-user-data-${safeUsername}-${timestamp}.json`;
}

function createAssistantDebugLogsFileName(username?: string | null) {
  const safeUsername =
    username
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'user';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `pomi-ai-debug-logs-${safeUsername}-${timestamp}.json`;
}

function formatUserDataImportToast(
  imported: UserDataImportResult['imported'],
  translate: TranslateFunction
) {
  return translate('debug.imported', {
    tasks: imported.tasks,
    statistics: imported.statistics,
    intentions: imported.intentions,
  });
}

function DebugLogField({ label, value }: { label: string; value?: unknown }) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const formattedValue =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);

  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-slate-800/70 bg-slate-950/70 p-2 text-[11px] leading-relaxed text-slate-300">
        {formattedValue}
      </pre>
    </div>
  );
}
