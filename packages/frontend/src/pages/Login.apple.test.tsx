import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/toast/ToastContext';
import { setLanguage } from '../i18n';
import { useAuthStoreBase } from '../stores/authStore';
import { Login } from './Login';

const systemState = vi.hoisted(() => ({
  appleConfigured: true,
  googleConfigured: true,
}));

vi.mock('../utils/osUtils', () => ({
  isAndroid: false,
  isIos: false,
  isLinux: false,
  isMac: true,
  isTauri: true,
  platformName: 'macos',
}));

vi.mock('../stores/systemStore', () => ({
  useSystemStore: {
    use: {
      systemInfo: () => ({
        hostingMode: 'hosted',
        selfHosted: false,
        paymentsRequired: true,
        authProviders: {
          google: systemState.googleConfigured,
          apple: systemState.appleConfigured,
        },
      }),
    },
  },
}));

beforeEach(() => {
  setLanguage('en', { persist: false });
  systemState.appleConfigured = true;
  systemState.googleConfigured = true;
  useAuthStoreBase.setState({
    user: null,
    token: null,
    isAuthenticated: false,
    hasExplicitlySignedOut: false,
  });
});

describe('native Apple login', () => {
  it('shows Apple alongside Google on supported macOS builds', () => {
    render(
      <ToastProvider>
        <Login />
      </ToastProvider>
    );

    expect(
      screen.getByRole('button', { name: 'Continue with Apple' })
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Continue with Google' })
    ).toBeVisible();
  });

  it('keeps Apple visible but disabled until account configuration is supplied', () => {
    systemState.appleConfigured = false;
    systemState.googleConfigured = false;

    render(
      <ToastProvider>
        <Login />
      </ToastProvider>
    );

    expect(
      screen.getByRole('button', { name: 'Continue with Apple' })
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Continue with Apple' })
    ).toBeDisabled();
  });
});
