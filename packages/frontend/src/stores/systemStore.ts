import { SystemInfo } from '@pomi/shared';
import { create } from 'zustand';
import { apiClient } from '../utils/apiClient';
import { getBackendOrigin } from '../utils/backendUrl';
import { createSelectors } from './createSelectors';

type SystemState = {
  systemInfo: SystemInfo | null;
  loadSystemInfo: () => Promise<void>;
};

type SystemApi = Pick<typeof apiClient, 'system'>;

export const createSystemStore = (
  systemApi: SystemApi,
  getRequestKey: () => string = getBackendOrigin
) => {
  let activeLoad: {
    id: number;
    key: string;
    promise: Promise<void>;
  } | null = null;
  let loadSequence = 0;
  let latestKey: string | null = null;

  return create<SystemState>(set => ({
    systemInfo: null,
    loadSystemInfo: () => {
      const key = getRequestKey();
      if (activeLoad?.key === key) return activeLoad.promise;
      if (latestKey !== key) set({ systemInfo: null });
      latestKey = key;
      const loadId = ++loadSequence;

      const promise = (async () => {
        try {
          const response = await systemApi.system.get();
          if (response.status === 200 && latestKey === key) {
            set({ systemInfo: response.body });
          }
        } catch (error) {
          console.error('Failed to load system info:', error);
        } finally {
          if (activeLoad?.id === loadId) activeLoad = null;
        }
      })();
      activeLoad = { id: loadId, key, promise };

      return promise;
    },
  }));
};

const useSystemStoreBase = createSystemStore(apiClient);
export const useSystemStore = createSelectors(useSystemStoreBase);
export { useSystemStoreBase };
