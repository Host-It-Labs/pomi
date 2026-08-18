import type { Preferences } from '@pomi/shared';
import { TASK_PRIORITIES } from '@pomi/shared/src/constants';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsSettings } from '../pages/NotificationsSettings';

const notification = vi.hoisted(() => ({
  checkPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock('../utils/osUtils', () => ({
  isAndroid: false,
  isDesktop: true,
}));

vi.mock('../utils/notificationUtils', () => ({
  notificationService: {
    checkPermission: notification.checkPermission,
  },
}));

const initialPreferences = {
  notifications: true,
  pushNotifications: true,
  soundNotifications: true,
  notifyOnWorkComplete: true,
  notifyOnBreakComplete: true,
  notifyBeforeWorkComplete: false,
  notifyBeforeTime: 60_000,
  workTimerDuration: 25 * 60_000,
  tasksExtension: true,
  taskReminderPriorities: [TASK_PRIORITIES.HIGH, TASK_PRIORITIES.URGENT],
  taskUrgentReminderRepeatEnabled: true,
  taskUrgentReminderRepeatIntervalMinutes: 30,
} as Preferences;

function NotificationsHarness({
  onUpdate,
}: {
  onUpdate: (key: keyof Preferences, value: unknown) => void;
}) {
  const [preferences, setPreferences] = useState(initialPreferences);
  return (
    <NotificationsSettings
      preferences={preferences}
      updatePreference={async (key, value) => {
        onUpdate(key, value);
        setPreferences(current => ({ ...current, [key]: value }));
      }}
    />
  );
}

describe('centralized Task notification settings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('supports a checkable priority dropdown and an empty selection', async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(<NotificationsHarness onUpdate={onUpdate} />);

    await user.click(
      screen.getByRole('button', { name: 'Task reminder priorities' })
    );
    await user.click(screen.getByLabelText('High Task reminders'));
    await user.click(screen.getByLabelText('Urgent Task reminders'));

    expect(onUpdate).toHaveBeenNthCalledWith(1, 'taskReminderPriorities', [
      TASK_PRIORITIES.URGENT,
    ]);
    expect(onUpdate).toHaveBeenNthCalledWith(2, 'taskReminderPriorities', []);
    expect(
      screen.getByRole('button', { name: 'Task reminder priorities' })
    ).toHaveTextContent('Off');
  });

  it('disables repetition without Urgent and only shows its interval when usable', async () => {
    const user = userEvent.setup();
    render(<NotificationsHarness onUpdate={vi.fn()} />);

    expect(
      screen.getByLabelText('Repeat overdue urgent reminders')
    ).toBeEnabled();
    expect(screen.getByLabelText('Repeat every')).toBeVisible();

    await user.click(
      screen.getByRole('button', { name: 'Task reminder priorities' })
    );
    await user.click(screen.getByLabelText('Urgent Task reminders'));

    expect(
      screen.getByLabelText('Repeat overdue urgent reminders')
    ).toBeDisabled();
    expect(screen.queryByLabelText('Repeat every')).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'About Repeat overdue urgent reminders',
      })
    ).toHaveAttribute(
      'title',
      'Select Urgent above to repeat its due notification.'
    );
  });
});
