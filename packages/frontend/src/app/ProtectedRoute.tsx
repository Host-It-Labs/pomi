import { ReactNode, useEffect } from 'react';
import { AndroidPermissionGate } from './AndroidPermissionGate';
import { Button } from '../components/ui/Button';
import { APP_COLORS } from '../config/colors';
import { AccessCoordinator } from '../pages/access/AccessCoordinator';
import { useAuthStore } from '../stores/authStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useUiStore } from '../stores/uiStore';
import { useBillingStore } from '../stores/billingStore';
import { useSystemStore } from '../stores/systemStore';
import { useI18n } from '../i18n';
import { Paywall } from '../pages/Paywall';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { t } = useI18n();
  const isAuthenticated = useAuthStore.use.isAuthenticated();
  const isLoading = useAuthStore.use.isLoading();
  const setExpanded = useUiStore.use.setExpanded();
  const setActiveTab = useUiStore.use.setActiveTab();
  const preferences = usePreferencesStore.use.preferences();
  const isLoadingPreferences = usePreferencesStore.use.isLoading();
  const preferencesLoadError = usePreferencesStore.use.loadError();
  const loadPreferences = usePreferencesStore.use.loadPreferences();
  const systemInfo = useSystemStore.use.systemInfo();
  const loadSystemInfo = useSystemStore.use.loadSystemInfo();
  const entitlement = useBillingStore.use.entitlement();
  const isLoadingEntitlement = useBillingStore.use.isLoading();
  const entitlementError = useBillingStore.use.error();
  const loadEntitlement = useBillingStore.use.loadEntitlement();
  const resetBilling = useBillingStore.use.reset();

  useEffect(() => {
    if (!isAuthenticated) {
      resetBilling();
      setExpanded(true);
      setActiveTab('login');
      return;
    }

    if (!systemInfo) {
      void loadSystemInfo();
      return;
    }

    if (
      systemInfo.paymentsRequired &&
      !entitlement &&
      !isLoadingEntitlement &&
      !entitlementError
    ) {
      void loadEntitlement();
      return;
    }

    if (
      (!systemInfo.paymentsRequired || entitlement?.active) &&
      !preferences &&
      !isLoadingPreferences &&
      !preferencesLoadError
    ) {
      void loadPreferences();
    }
  }, [
    isAuthenticated,
    isLoadingPreferences,
    isLoadingEntitlement,
    entitlement,
    entitlementError,
    loadEntitlement,
    loadSystemInfo,
    loadPreferences,
    preferences,
    preferencesLoadError,
    setActiveTab,
    setExpanded,
    systemInfo,
    resetBilling,
  ]);

  if (isLoading) {
    return (
      <div
        className={`flex items-center justify-center h-dvh ${APP_COLORS.background}`}
      >
        <div
          className={`animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 ${APP_COLORS.loader.primary}`}
        />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AccessCoordinator />;
  }

  if (!systemInfo || (systemInfo.paymentsRequired && !entitlement)) {
    if (systemInfo?.paymentsRequired && entitlementError) {
      return (
        <div
          className={`flex h-dvh items-center justify-center px-5 ${APP_COLORS.background}`}
        >
          <div className="w-full max-w-sm rounded-xl border border-red-900/50 bg-red-950/50 p-4 text-center text-sm text-white shadow-lg">
            <p>{entitlementError}</p>
            <Button
              size="sm"
              className="mt-4"
              onClick={() => void loadEntitlement()}
            >
              {t('common.retry')}
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div
        className={`flex h-dvh items-center justify-center ${APP_COLORS.background}`}
      >
        <div
          className={`h-12 w-12 animate-spin rounded-full border-b-2 border-t-2 ${APP_COLORS.loader.primary}`}
        />
      </div>
    );
  }

  if (systemInfo.paymentsRequired && entitlement && !entitlement.active) {
    return <Paywall />;
  }

  return (
    <AndroidPermissionGate>
      {children}
      {preferencesLoadError && !preferences ? (
        <div className="fixed inset-x-3 bottom-3 z-50 flex items-center justify-between gap-3 rounded-lg bg-red-950 px-4 py-3 text-sm text-white shadow-lg">
          <span>{preferencesLoadError}</span>
          <Button
            variant="danger"
            size="sm"
            className="shrink-0"
            onClick={() => void loadPreferences()}
          >
            Retry
          </Button>
        </div>
      ) : null}
    </AndroidPermissionGate>
  );
}
