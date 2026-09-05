import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FaArrowRight,
  FaBatteryThreeQuarters,
  FaBell,
  FaCheck,
} from 'react-icons/fa';
import type { BatteryStatus } from 'tauri-plugin-android-battery-optimization-api';
import { Button } from '../components/ui/Button';
import { PageContainer } from '../components/ui/PageContainer';
import { PageShell } from '../components/ui/PageShell';
import { Spinner } from '../components/ui/Spinner';
import { useI18n } from '../i18n';
import { useAuthStore } from '../stores/authStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { reconcileAndroidForegroundSync } from '../utils/androidForegroundSync';
import {
  checkBatteryOptimizationStatus,
  requestBatteryOptimizationExemption,
} from '../utils/batteryOptimization';
import { notificationService } from '../utils/notificationUtils';
import {
  isAndroid,
  isDebugMobileSimulator,
  platformName,
} from '../utils/osUtils';

interface AndroidPermissionGateProps {
  children: ReactNode;
}

type PermissionAction = 'notifications' | 'battery' | null;

const OPTIONAL_DISMISSED_KEY = 'pomi_android_permission_setup_optional_done';

const DEFAULT_BATTERY_STATUS: BatteryStatus = {
  isOptimized: false,
  isIgnoringOptimizations: true,
};

export function AndroidPermissionGate({
  children,
}: AndroidPermissionGateProps) {
  const user = useAuthStore.use.user();
  const token = useAuthStore.use.token();
  const preferences = usePreferencesStore.use.preferences();
  const [isChecking, setIsChecking] = useState(true);
  const [activeAction, setActiveAction] = useState<PermissionAction>(null);
  const [notificationGranted, setNotificationGranted] = useState<
    boolean | null
  >(null);
  const [batteryStatus, setBatteryStatus] = useState<BatteryStatus>(
    DEFAULT_BATTERY_STATUS
  );
  const [optionalDismissed, setOptionalDismissed] = useState(
    () => localStorage.getItem(OPTIONAL_DISMISSED_KEY) === 'true'
  );
  const { t } = useI18n();

  const shouldCheckAndroidPermissions =
    isAndroid &&
    !isDebugMobileSimulator &&
    preferences?.pushNotifications === true;

  const refreshStatuses = useCallback(async () => {
    if (!shouldCheckAndroidPermissions) {
      setIsChecking(false);
      return;
    }

    setIsChecking(true);
    try {
      const [notificationPermission, battery] = await Promise.all([
        notificationService.checkPermission(),
        checkBatteryOptimizationStatus(),
      ]);

      setNotificationGranted(notificationPermission);
      setBatteryStatus(battery);
    } finally {
      setIsChecking(false);
    }
  }, [shouldCheckAndroidPermissions]);

  useEffect(() => {
    void refreshStatuses();

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void refreshStatuses();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', refreshStatuses);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', refreshStatuses);
    };
  }, [refreshStatuses]);

  const notificationRequired = notificationGranted !== true;
  const requiredReady = !notificationRequired;
  const batteryRecommended = batteryStatus.isOptimized;
  const showOptionalSetup =
    requiredReady && batteryRecommended && !optionalDismissed;
  const shouldShowSetup =
    shouldCheckAndroidPermissions && (!requiredReady || showOptionalSetup);

  useEffect(() => {
    if (!shouldCheckAndroidPermissions || !requiredReady || !token) {
      return;
    }

    void reconcileAndroidForegroundSync(token, true);
  }, [requiredReady, shouldCheckAndroidPermissions, token]);

  const permissionRows = useMemo(
    () => [
      {
        id: 'notifications' as const,
        icon: <FaBell />,
        label: t('permissions.notifications'),
        detail: t('permissions.required'),
        ready: !notificationRequired,
        actionLabel: t('permissions.allow'),
        hidden: false,
      },
      {
        id: 'battery' as const,
        icon: <FaBatteryThreeQuarters />,
        label: t('permissions.background'),
        detail: t('permissions.recommended'),
        ready: !batteryRecommended,
        actionLabel: t('permissions.allow'),
        hidden: false,
      },
    ],
    [batteryRecommended, notificationRequired, t]
  );

  const requestNotifications = async () => {
    if (!user?.id) {
      return;
    }

    setActiveAction('notifications');
    try {
      await notificationService.registerForPushNotificationsIfMobile(
        user.id,
        platformName === 'ios' ? 'ios' : 'android'
      );
      await refreshStatuses();
    } finally {
      setActiveAction(null);
    }
  };

  const requestBattery = async () => {
    setActiveAction('battery');
    try {
      const requested = await requestBatteryOptimizationExemption();
      if (requested) {
        window.setTimeout(() => void refreshStatuses(), 800);
      }
    } finally {
      setActiveAction(null);
    }
  };

  const handleRowAction = (id: 'notifications' | 'battery') => {
    if (id === 'notifications') {
      void requestNotifications();
      return;
    }

    void requestBattery();
  };

  const continueToApp = () => {
    localStorage.setItem(OPTIONAL_DISMISSED_KEY, 'true');
    setOptionalDismissed(true);
  };

  if (!shouldCheckAndroidPermissions) {
    return <>{children}</>;
  }

  if (isChecking && notificationGranted === null) {
    return (
      <PageShell className="flex items-center justify-center">
        <Spinner size="lg" />
      </PageShell>
    );
  }

  if (!shouldShowSetup) {
    return <>{children}</>;
  }

  return (
    <PageShell className="flex items-center justify-center px-4">
      <PageContainer size="sm" className="max-w-md px-0">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-indigo-300">
              {t('permissions.androidSetup')}
            </p>
            <h1 className="text-2xl font-semibold text-ink">
              {t('permissions.keepPomiOnTime')}
            </h1>
            <p className="text-sm text-slate-400">
              {t('permissions.enableAlerts')}
            </p>
          </div>

          <div className="space-y-2">
            {permissionRows
              .filter(row => !row.hidden)
              .map(row => (
                <div
                  key={row.id}
                  className="flex min-h-16 items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-800 text-indigo-200">
                    {row.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-ink">
                        {row.label}
                      </p>
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                        {row.detail}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {row.ready
                        ? t('permissions.ready')
                        : t('permissions.needsAccess')}
                    </p>
                  </div>
                  {row.ready ? (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
                      <FaCheck size={13} />
                    </div>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      isLoading={activeAction === row.id}
                      loadingText="..."
                      onClick={() => handleRowAction(row.id)}
                    >
                      {row.actionLabel}
                    </Button>
                  )}
                </div>
              ))}
          </div>

          <Button
            type="button"
            className="w-full gap-2"
            disabled={!requiredReady}
            onClick={continueToApp}
          >
            <span>{t('timer.openApp')}</span>
            <FaArrowRight size={13} />
          </Button>
        </div>
      </PageContainer>
    </PageShell>
  );
}
