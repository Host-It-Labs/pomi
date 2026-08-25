import type { AssistantStatus } from '@pomi/shared';
import { create } from 'zustand';
import { apiClient } from '../utils/apiClient';
import { translateCurrent } from '../i18n';
import { useAuthStoreBase } from './authStore';
import { createSelectors } from './createSelectors';

type AssistantStore = {
  status: AssistantStatus | null;
  isLoading: boolean;
  error: string | null;
  loadStatus: () => Promise<void>;
  clearStatus: () => void;
};

const initialState = {
  status: null,
  isLoading: false,
  error: null,
};

const useAssistantStoreBase = create<AssistantStore>((set, get) => ({
  ...initialState,
  loadStatus: async () => {
    if (get().isLoading) return;
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.assistant.status();
      if (response.status === 200) {
        set({ status: response.body, isLoading: false, error: null });
        return;
      }
      set({
        isLoading: false,
        error: translateCurrent('assistant.statusLoadFailed'),
      });
    } catch (error) {
      console.error('Failed to load Assistant status:', error);
      set({
        isLoading: false,
        error: translateCurrent('assistant.statusLoadFailed'),
      });
    }
  },
  clearStatus: () => set(initialState),
}));

export const useAssistantStore = createSelectors(useAssistantStoreBase);

useAuthStoreBase.subscribe((state, prevState) => {
  if (state.token === prevState.token) {
    return;
  }

  useAssistantStoreBase.setState(initialState);
});
