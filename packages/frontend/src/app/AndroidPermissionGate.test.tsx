import type { Preferences, User } from '@pomi/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../stores/authStore';
import { usePreferencesStore } from '../stores/preferencesStore';

const platform = vi.hoisted(() => ({
  isAndroid: true,
  isDesktop: false,
  isMobile: true,
  isTauri: false,
  isDebugMobileSimulator: false,
  platformName: 'android',
}));
const notification = vi.hoisted(() => ({
  checkPermission: vi.fn<() => Promise<boolean>>(),
  registerForPushNotificationsIfMobile: vi.fn<() => Promise<boolean>>(),
  requestPermissionIfNeeded: vi.fn<() => Promise<boolean>>(),
}));
const battery = vi.hoisted(() => ({
  check: vi.fn(),
  request: vi.fn(),
}));
const foreground = vi.hoisted(() => ({
  reconcile: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('../utils/osUtils', () => platform);
vi.mock('../utils/notificationUtils', () => ({
  notificationService: notification,
}));
vi.mock('../utils/batteryOptimization', () => ({
  checkBatteryOptimizationStatus: battery.check,
  requestBatteryOptimizationExemption: battery.request,
}));
vi.mock('../utils/androidForegroundSync', () => ({
  reconcileAndroidForegroundSync: foreground.reconcile,
  stopAndroidForegroundSync: foreground.stop,
}));

import { NotificationsSettings } from '../pages/NotificationsSettings';
import { AndroidPermissionGate } from './AndroidPermissionGate';

const preferences = {
  pushNotifications: true,
  notifications: true,
  soundNotifications: true,
  notifyOnWorkComplete: true,
  notifyOnBreakComplete: true,
  notifyBeforeWorkComplete: true,
  notifyBeforeTime: 60_000,
  workTimerDuration: 25 * 60_000,
  tasksExtension: false,
} as Preferences;

describe('Android permission setup', () => {
  beforeEach(() => {
    localStorage.clear();
    platform.isDebugMobileSimulator = false;
    vi.clearAllMocks();
    notification.registerForPushNotificationsIfMobile.mockResolvedValue(true);
    notification.requestPermissionIfNeeded.mockResolvedValue(true);
    battery.request.mockResolvedValue(true);
    foreground.reconcile.mockResolvedValue({ enabled: true, running: true });
    foreground.stop.mockResolvedValue({ enabled: false, running: false });
    useAuthStore.setState({
      user: { id: 'android-user' } as User,
      token: 'android-token',
      isAuthenticated: true,
    });
    usePreferencesStore.setState({ preferences });
  });

  it('blocks app entry while the required notification permission is missing', async () => {
    notification.checkPermission.mockResolvedValue(false);
    battery.check.mockResolvedValue({
      isOptimized: false,
      isIgnoringOptimizations: true,
    });

    render(
      <AndroidPermissionGate>
        <div>Authenticated app</div>
      </AndroidPermissionGate>
    );

    expect(await screen.findByText('Keep Pomi on time')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Needs access')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open app' })).toBeDisabled();
    expect(screen.queryByText('Authenticated app')).not.toBeInTheDocument();
    expect(foreground.reconcile).not.toHaveBeenCalled();
  });

  it('bypasses the permission gate in the debug Mobile Simulator', async () => {
    platform.isDebugMobileSimulator = true;
    notification.checkPermission.mockResolvedValue(false);

    render(
      <AndroidPermissionGate>
        <div>Authenticated app</div>
      </AndroidPermissionGate>
    );

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
    expect(notification.checkPermission).not.toHaveBeenCalled();
  });

  it('does not gate app entry on an exact-alarm permission', async () => {
    notification.checkPermission.mockResolvedValue(true);
    battery.check.mockResolvedValue({
      isOptimized: false,
      isIgnoringOptimizations: true,
    });

    render(
      <AndroidPermissionGate>
        <div>Authenticated app</div>
      </AndroidPermissionGate>
    );

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
    expect(screen.queryByText('Keep Pomi on time')).not.toBeInTheDocument();
  });

  it('allows the optional battery setup to be dismissed', async () => {
    notification.checkPermission.mockResolvedValue(true);
    battery.check.mockResolvedValue({
      isOptimized: true,
      isIgnoringOptimizations: false,
    });

    render(
      <AndroidPermissionGate>
        <div>Authenticated app</div>
      </AndroidPermissionGate>
    );

    expect(await screen.findByText('Background')).toBeInTheDocument();
    const openApp = screen.getByRole('button', { name: 'Open app' });
    expect(openApp).toBeEnabled();
    fireEvent.click(openApp);
    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
    expect(
      localStorage.getItem('pomi_android_permission_setup_optional_done')
    ).toBe('true');
  });

  it('starts foreground sync automatically and exposes no manual sync setting', async () => {
    notification.checkPermission.mockResolvedValue(true);
    battery.check.mockResolvedValue({
      isOptimized: false,
      isIgnoringOptimizations: true,
    });

    render(
      <AndroidPermissionGate>
        <NotificationsSettings
          preferences={preferences}
          updatePreference={vi.fn()}
        />
      </AndroidPermissionGate>
    );

    await waitFor(() => {
      expect(foreground.reconcile).toHaveBeenCalledWith('android-token', true);
    });
    expect(
      notification.registerForPushNotificationsIfMobile
    ).toHaveBeenCalledWith('android-user', 'android');
    expect(screen.queryByText('Background timer sync')).not.toBeInTheDocument();
    expect(document.querySelector('#android-background-timer-sync')).toBeNull();
  });
});
