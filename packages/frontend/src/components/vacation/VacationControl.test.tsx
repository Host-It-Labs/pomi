import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VacationControl } from './VacationControl';

const mocks = vi.hoisted(() => ({
  preferences: {
    timeZone: 'UTC',
    tasksShowVacationCovered: false,
  },
  updatePreferenceWithResult: vi.fn(),
  loadStatus: vi.fn(),
  submitUserMutation: vi.fn(),
}));

vi.mock('../../stores/preferencesStore', () => ({
  usePreferencesStore: {
    use: {
      preferences: () => mocks.preferences,
      updatePreferenceWithResult: () => mocks.updatePreferenceWithResult,
    },
  },
}));

vi.mock('../../stores/vacationStore', () => ({
  useVacationStore: {
    use: {
      status: () => ({
        active: false,
        runId: null,
        startedOn: null,
        endsOn: null,
      }),
      loadStatus: () => mocks.loadStatus,
    },
  },
}));

vi.mock('../../utils/userActionQueue', () => ({
  submitUserMutation: mocks.submitUserMutation,
}));

describe('Vacation activation', () => {
  beforeEach(() => {
    mocks.preferences.tasksShowVacationCovered = false;
    mocks.updatePreferenceWithResult.mockReset().mockResolvedValue(true);
    mocks.loadStatus.mockReset().mockResolvedValue(undefined);
    mocks.submitUserMutation.mockReset().mockResolvedValue(undefined);
  });

  it('defaults to hiding covered Tasks and persists activation changes', async () => {
    const user = userEvent.setup();
    render(<VacationControl />);

    await user.click(screen.getByRole('button', { name: 'Vacation mode' }));
    const hideCovered = screen.getByRole('checkbox', {
      name: 'Hide covered Tasks',
    });
    expect(hideCovered).toBeChecked();

    await user.click(hideCovered);
    await user.click(screen.getByRole('button', { name: 'Start vacation' }));

    await waitFor(() =>
      expect(mocks.updatePreferenceWithResult).toHaveBeenCalledWith(
        'tasksShowVacationCovered',
        true
      )
    );
    expect(mocks.submitUserMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { operation: 'activate', endsOn: null },
      })
    );
  });

  it('restores the previously saved visibility choice', async () => {
    mocks.preferences.tasksShowVacationCovered = true;
    const user = userEvent.setup();
    render(<VacationControl />);

    await user.click(screen.getByRole('button', { name: 'Vacation mode' }));

    expect(
      screen.getByRole('checkbox', { name: 'Hide covered Tasks' })
    ).not.toBeChecked();
  });
});
