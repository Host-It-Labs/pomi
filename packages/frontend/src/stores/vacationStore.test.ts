import type { VacationState } from '@pomi/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  authListener: undefined as
    | undefined
    | ((
        state: { token: string | null },
        previous: { token: string | null }
      ) => void),
}));

vi.mock('../utils/apiClient', () => ({
  apiClient: { vacation: { status: mocks.status } },
}));
vi.mock('./authStore', () => ({
  useAuthStoreBase: {
    subscribe: vi.fn(listener => {
      mocks.authListener = listener;
    }),
  },
}));

import { useVacationStore } from './vacationStore';

const inactiveState: VacationState = {
  active: false,
  runId: null,
  startedOn: null,
  endsOn: null,
};

const activeState: VacationState = {
  active: true,
  runId: 'run-new',
  startedOn: '2026-08-08',
  endsOn: '2026-08-12',
};

beforeEach(() => {
  mocks.status.mockReset();
  useVacationStore.setState({ status: inactiveState });
});

describe('Vacation store network loading', () => {
  it('contains persistent read failures and preserves the last confirmed status', async () => {
    useVacationStore.setState({ status: activeState });
    mocks.status.mockRejectedValueOnce(new TypeError('ClientError'));

    await expect(
      useVacationStore.getState().loadStatus()
    ).resolves.toBeUndefined();
    expect(useVacationStore.getState().status).toEqual(activeState);

    mocks.status.mockResolvedValueOnce({ status: 200, body: inactiveState });
    await useVacationStore.getState().loadStatus();

    expect(useVacationStore.getState().status).toEqual(inactiveState);
  });

  it('ignores a status response from a previous auth session', async () => {
    let resolvePrevious!: (value: {
      status: number;
      body: VacationState;
    }) => void;
    const previousRequest = new Promise<{
      status: number;
      body: VacationState;
    }>(resolve => {
      resolvePrevious = resolve;
    });
    mocks.status
      .mockReturnValueOnce(previousRequest)
      .mockResolvedValueOnce({ status: 200, body: activeState });

    const previousLoad = useVacationStore.getState().loadStatus();
    mocks.authListener?.({ token: 'new-token' }, { token: 'old-token' });
    const currentLoad = useVacationStore.getState().loadStatus();

    resolvePrevious({
      status: 200,
      body: { ...activeState, runId: 'run-old' },
    });
    await currentLoad;
    await previousLoad;

    expect(useVacationStore.getState().status).toEqual(activeState);
  });
});
