import type { UserDataExport, UserDataImportResult } from '@pomi/shared';
import {
  CLIENT_NOTIFICATION_TYPES,
  TIMER_TYPES,
} from '@pomi/shared/src/constants';
import * as Sentry from '@sentry/react';
import { type ChangeEvent, useRef, useState } from 'react';
import { FaChevronDown, FaChevronUp } from 'react-icons/fa';
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
  const [isLagOpen, setIsLagOpen] = useState(false);
  const [mobileSimulatorPresetId, setMobileSimulatorPresetId] =
    useState<MobileSimulatorPresetId | null>(null);
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [isSendingFrontendError, setIsSendingFrontendError] = useState(false);
  const [isSendingBackendError, setIsSendingBackendError] = useState(false);
  const [isExportingUserData, setIsExportingUserData] = useState(false);
  const [isImportingUserData, setIsImportingUserData] = useState(false);
  const lagMs = useDebugStore.use.lagMs();
  const setLagMs = useDebugStore.use.setLagMs();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const showUserDataTransfer = user?.isAdmin === true;

  const LAG_PRESETS = [0, 200, 500, 1000, 2000, 5000];

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

      const sourceUsername =
        payload.sourceUser?.username ?? t('debug.exportedUser');
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
            <h2 className="text-sm font-semibold text-ink">
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
                  <h2 className="text-sm font-semibold text-ink">
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
                <h2 className="text-sm font-semibold text-ink">
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
              onClick={() => setIsSentryOpen(current => !current)}
              className="flex w-full items-start justify-between text-left"
              aria-expanded={isSentryOpen}
            >
              <div>
                <h2 className="text-sm font-semibold text-ink">Sentry</h2>
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
                <h2 className="text-sm font-semibold text-ink">
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
                            ? t('debug.lagDisabled')
                            : t('debug.lagSet', { milliseconds: ms }),
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
