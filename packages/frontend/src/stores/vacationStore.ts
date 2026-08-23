import type { VacationState } from '@pomi/shared';
import { create } from 'zustand';
import { apiClient } from '../utils/apiClient';
import { useAuthStoreBase } from './authStore';
import { createSelectors } from './createSelectors';

type VacationStore = {
  status: VacationState;
  loadStatus: () => Promise<void>;
};

const initialStatus: VacationState = {
  active: false,
  runId: null,
  startedOn: null,
  endsOn: null,
};

let loadStatusPromise: Promise<void> | null = null;
let authGeneration = 0;

const useVacationStoreBase = create<VacationStore>(set => ({
  status: initialStatus,
  loadStatus: async () => {
    if (loadStatusPromise) return loadStatusPromise;

    const requestGeneration = authGeneration;
    const requestPromise = (async () => {
      try {
        const response = await apiClient.vacation.status();
        if (requestGeneration === authGeneration && response.status === 200) {
          set({ status: response.body });
        }
      } catch {
        return;
      } finally {
        if (requestGeneration === authGeneration) loadStatusPromise = null;
      }
    })();
    loadStatusPromise = requestPromise;

    return loadStatusPromise;
  },
}));

export const useVacationStore = createSelectors(useVacationStoreBase);

useAuthStoreBase.subscribe((state, previousState) => {
  if (state.token === previousState.token) return;
  authGeneration += 1;
  loadStatusPromise = null;
  useVacationStoreBase.setState({ status: initialStatus });
});
