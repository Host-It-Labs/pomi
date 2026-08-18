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
}));

vi.mock('./AndroidPermissionGate', () => ({
  AndroidPermissionGate: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('../pages/Login', () => ({ Login: () => <div>Login</div> }));
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

beforeEach(() => {
  state.authenticated = true;
  state.loading = false;
  state.preferences = null;
  state.loadingPreferences = true;
  state.loadError = null;
  state.loadPreferences.mockClear();
  state.setExpanded.mockClear();
  state.setActiveTab.mockClear();
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
});
