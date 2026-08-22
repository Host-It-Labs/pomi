import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute';

const state = vi.hoisted(() => ({
  authenticated: true,
  loading: false,
  preferences: null as object | null,
  loadingPreferences: true,
  loadError: null as string | null,
  loadPreferences: vi.fn(async () => undefined),
  setExpanded: vi.fn(),
  setActiveTab: vi.fn(),
  systemInfo: {
    hostingMode: 'self-hosted',
    selfHosted: true,
    paymentsRequired: false,
    authProviders: { google: false, apple: false },
  } as {
    hostingMode: 'hosted' | 'self-hosted';
    selfHosted: boolean;
    paymentsRequired: boolean;
    authProviders: { google: boolean; apple: boolean };
  },
  loadSystemInfo: vi.fn(async () => undefined),
  entitlement: null as { active: boolean } | null,
  entitlementError: null as string | null,
  loadingEntitlement: false,
  loadEntitlement: vi.fn(async () => null),
  resetBilling: vi.fn(),
}));

vi.mock('./AndroidPermissionGate', () => ({
  AndroidPermissionGate: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('../pages/access/AccessCoordinator', () => ({
  AccessCoordinator: () => <div>Welcome to Pomi</div>,
}));
vi.mock('../pages/Paywall', () => ({ Paywall: () => <div>Pomi paywall</div> }));
vi.mock('../stores/authStore', () => ({
  useAuthStore: {
    use: {
      isAuthenticated: () => state.authenticated,
      isLoading: () => state.loading,
    },
  },
}));
vi.mock('../stores/preferencesStore', () => ({
  usePreferencesStore: {
    use: {
      preferences: () => state.preferences,
      isLoading: () => state.loadingPreferences,
      loadError: () => state.loadError,
      loadPreferences: () => state.loadPreferences,
    },
  },
}));
vi.mock('../stores/uiStore', () => ({
  useUiStore: {
    use: {
      setExpanded: () => state.setExpanded,
      setActiveTab: () => state.setActiveTab,
    },
  },
}));
vi.mock('../stores/systemStore', () => ({
  useSystemStore: {
    use: {
      systemInfo: () => state.systemInfo,
      loadSystemInfo: () => state.loadSystemInfo,
    },
  },
}));
vi.mock('../stores/billingStore', () => ({
  useBillingStore: {
    use: {
      entitlement: () => state.entitlement,
      isLoading: () => state.loadingEntitlement,
      error: () => state.entitlementError,
      loadEntitlement: () => state.loadEntitlement,
      reset: () => state.resetBilling,
    },
  },
}));

beforeEach(() => {
  state.authenticated = true;
  state.loading = false;
  state.systemInfo = {
    hostingMode: 'self-hosted',
    selfHosted: true,
    paymentsRequired: false,
    authProviders: { google: false, apple: false },
  };
  state.entitlement = null;
  state.entitlementError = null;
  state.loadingEntitlement = false;
  state.preferences = null;
  state.loadingPreferences = true;
  state.loadError = null;
  state.loadPreferences.mockClear();
  state.setExpanded.mockClear();
  state.setActiveTab.mockClear();
  state.loadSystemInfo.mockClear();
  state.loadEntitlement.mockClear();
  state.resetBilling.mockClear();
});

describe('ProtectedRoute startup shell', () => {
  it('renders app content while preferences are still loading', () => {
    render(
      <ProtectedRoute>
        <div>Timer shell</div>
      </ProtectedRoute>
    );

    expect(screen.getByText('Timer shell')).toBeVisible();
    expect(
      screen.queryByText('Connecting to server...')
    ).not.toBeInTheDocument();
  });

  it('keeps the app shell visible and offers recovery after preferences fail', () => {
    state.loadingPreferences = false;
    state.loadError = 'Failed to load app settings.';
    render(
      <ProtectedRoute>
        <div>Timer shell</div>
      </ProtectedRoute>
    );

    expect(screen.getByText('Timer shell')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.loadPreferences).toHaveBeenCalledOnce();
  });

  it('shows the paywall after hosted sign-in until entitlement is active', async () => {
    state.systemInfo = {
      hostingMode: 'hosted',
      selfHosted: false,
      paymentsRequired: true,
      authProviders: { google: true, apple: true },
    };
    state.entitlement = { active: false };

    render(
      <ProtectedRoute>
        <div>Timer shell</div>
      </ProtectedRoute>
    );

    expect(await screen.findByText('Pomi paywall')).toBeVisible();
    expect(screen.queryByText('Timer shell')).not.toBeInTheDocument();
  });

  it('stops automatic entitlement retries and exposes a controlled retry', () => {
    state.systemInfo = {
      hostingMode: 'hosted',
      selfHosted: false,
      paymentsRequired: true,
      authProviders: { google: true, apple: true },
    };
    state.entitlementError = 'Unable to load subscription status';

    render(
      <ProtectedRoute>
        <div>Timer shell</div>
      </ProtectedRoute>
    );

    expect(state.loadEntitlement).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.loadEntitlement).toHaveBeenCalledOnce();
  });
});
