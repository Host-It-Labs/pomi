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

vi.mock('./VacationSetupModal', () => ({
  VacationSetupModal: ({
    isOpen,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) =>
    isOpen ? <button onClick={onClose}>Close coverage selector</button> : null,
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

  it('reconfigures coverage without losing pending activation choices', async () => {
    const user = userEvent.setup();
    render(<VacationControl />);

    await user.click(screen.getByRole('button', { name: 'Vacation mode' }));
    const returnDate = screen.getByLabelText(/Return date/);
    await user.type(returnDate, '2026-08-20');
    await user.click(
      screen.getByRole('button', { name: 'Choose affected Tasks' })
    );
    expect(
      screen.queryByRole('button', { name: 'Start vacation' })
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Close coverage selector' })
    );

    expect(screen.getByLabelText(/Return date/)).toHaveValue('2026-08-20');
    expect(
      screen.getByRole('checkbox', { name: 'Hide covered Tasks' })
    ).toBeChecked();
  });
});
