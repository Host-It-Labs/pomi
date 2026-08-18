import { SystemInfo } from '@pomi/shared';
import { create } from 'zustand';
import { apiClient } from '../utils/apiClient';
import { createSelectors } from './createSelectors';

type SystemState = {
  systemInfo: SystemInfo | null;
  loadSystemInfo: () => Promise<void>;
};

type SystemApi = Pick<typeof apiClient, 'system'>;

export const createSystemStore = (systemApi: SystemApi) => {
  let loadPromise: Promise<void> | null = null;

  return create<SystemState>(set => ({
    systemInfo: null,
    loadSystemInfo: () => {
      if (loadPromise) return loadPromise;

      loadPromise = (async () => {
        try {
          const response = await systemApi.system.get();
          if (response.status === 200) {
            set({ systemInfo: response.body });
          }
        } catch (error) {
          console.error('Failed to load system info:', error);
        } finally {
          loadPromise = null;
        }
      })();

      return loadPromise;
    },
  }));
};

const useSystemStoreBase = createSystemStore(apiClient);
export const useSystemStore = createSelectors(useSystemStoreBase);
export { useSystemStoreBase };
