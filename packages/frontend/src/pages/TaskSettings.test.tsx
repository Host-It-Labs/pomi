import type { Preferences } from '@pomi/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskSettings } from './TaskSettings';

describe('Task settings', () => {
  it('briefly explains default ordering and keeps Vacation visibility out of Settings', () => {
    render(
      <TaskSettings
        preferences={
          {
            tasksExtension: true,
            taskDefaultSortMode: 'default',
            taskDefaultDueDateMode: 'tomorrow',
            vacationExtension: true,
          } as Preferences
        }
        updatePreference={vi.fn().mockResolvedValue(undefined)}
        onShowNotificationSettings={vi.fn()}
      />
    );

    expect(
      screen.getByText(
        'Overdue by priority, upcoming by due date, undated by priority then newest.'
      )
    ).toBeVisible();
    expect(
      screen.queryByRole('checkbox', { name: 'Hide covered Tasks' })
    ).toBeNull();
    expect(
      screen.queryByRole('combobox', { name: 'Default Tasks view' })
    ).toBeNull();
  });
});
