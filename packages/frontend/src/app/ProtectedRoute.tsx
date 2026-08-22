import { ReactNode, useEffect } from 'react';
import { AndroidPermissionGate } from './AndroidPermissionGate';
import { Button } from '../components/ui/Button';
import { APP_COLORS } from '../config/colors';
import { useI18n } from '../i18n';
import { Login } from '../pages/Login';
import { useAuthStore } from '../stores/authStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useUiStore } from '../stores/uiStore';

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

  useEffect(() => {
    if (!isAuthenticated) {
      setExpanded(true);
      setActiveTab('login');
      return;
    }

    if (!preferences && !isLoadingPreferences && !preferencesLoadError) {
      void loadPreferences();
    }
  }, [
    isAuthenticated,
    isLoadingPreferences,
    loadPreferences,
    preferences,
    preferencesLoadError,
    setActiveTab,
    setExpanded,
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
    return <Login />;
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
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
    </AndroidPermissionGate>
  );
}
