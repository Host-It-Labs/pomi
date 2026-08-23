import { SystemInfo } from '@pomi/shared';
import { create } from 'zustand';
import { apiClient } from '../utils/apiClient';
import { createSelectors } from './createSelectors';

type SystemState = {
  systemInfo: SystemInfo | null;
  loadSystemInfo: () => Promise<void>;
  clearSystemInfo: () => void;
};

type SystemApi = Pick<typeof apiClient, 'system'>;

export const createSystemStore = (systemApi: SystemApi) => {
  let loadPromise: Promise<void> | null = null;
  let generation = 0;

  return create<SystemState>(set => ({
    systemInfo: null,
    clearSystemInfo: () => {
      generation += 1;
      loadPromise = null;
      set({ systemInfo: null });
    },
    loadSystemInfo: () => {
      if (loadPromise) return loadPromise;

      const requestGeneration = generation;
      let request!: Promise<void>;
      request = (async () => {
        try {
          const response = await systemApi.system.get();
          if (response.status === 200 && requestGeneration === generation) {
            set({ systemInfo: response.body });
          }
        } catch (error) {
          console.error('Failed to load system info:', error);
        } finally {
          if (loadPromise === request) loadPromise = null;
        }
      })();
      loadPromise = request;

      return request;
    },
  }));
};

const useSystemStoreBase = createSystemStore(apiClient);
export const useSystemStore = createSelectors(useSystemStoreBase);
export { useSystemStoreBase };
