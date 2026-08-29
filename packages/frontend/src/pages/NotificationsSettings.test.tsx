import type { Preferences } from '@pomi/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const notification = vi.hoisted(() => ({
  checkPermission: vi.fn<() => Promise<boolean>>(),
  requestPermissionIfNeeded: vi.fn<() => Promise<boolean>>(),
  openMacNotificationSettings: vi.fn<() => Promise<boolean>>(),
}));

vi.mock('../utils/osUtils', () => ({
  isAndroid: false,
  isDesktop: true,
  isMac: true,
}));

vi.mock('../utils/notificationUtils', () => ({
  notificationService: notification,
}));

import { NotificationsSettings } from './NotificationsSettings';

const preferences = {
  notifications: true,
  pushNotifications: true,
  soundNotifications: true,
  notifyOnWorkComplete: true,
  notifyOnBreakComplete: true,
  notifyBeforeWorkComplete: true,
  notifyBeforeTime: 60_000,
  workTimerDuration: 25 * 60_000,
  tasksExtension: false,
} as Preferences;

describe('macOS notification settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notification.checkPermission.mockResolvedValue(false);
    notification.requestPermissionIfNeeded.mockResolvedValue(false);
    notification.openMacNotificationSettings.mockResolvedValue(true);
  });

  it('offers a native settings link when macOS notifications are not granted', async () => {
    const user = userEvent.setup();
    render(
      <NotificationsSettings
        preferences={preferences}
        updatePreference={vi.fn()}
      />
    );

    expect(await screen.findByTestId('macos-notification-setup')).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Open Notification Settings' })
    );

    expect(notification.requestPermissionIfNeeded).toHaveBeenCalledOnce();
    expect(notification.openMacNotificationSettings).toHaveBeenCalledOnce();
  });

  it('shows manual instructions when the native settings link fails', async () => {
    const user = userEvent.setup();
    notification.openMacNotificationSettings.mockResolvedValue(false);
    render(
      <NotificationsSettings
        preferences={preferences}
        updatePreference={vi.fn()}
      />
    );

    await user.click(
      await screen.findByRole('button', { name: 'Open Notification Settings' })
    );

    expect(
      screen.getByText(
        'If the button does not open System Settings, go to Notifications > Pomi and allow notifications.'
      )
    ).toBeVisible();
  });

  it('refreshes permission when returning from System Settings', async () => {
    render(
      <NotificationsSettings
        preferences={preferences}
        updatePreference={vi.fn()}
      />
    );
    await screen.findByTestId('macos-notification-setup');

    notification.checkPermission.mockResolvedValue(true);
    fireEvent(document, new Event('visibilitychange'));

    await waitFor(() => {
      expect(
        screen.queryByTestId('macos-notification-setup')
      ).not.toBeInTheDocument();
    });
    expect(notification.checkPermission).toHaveBeenCalledTimes(2);
  });
});
