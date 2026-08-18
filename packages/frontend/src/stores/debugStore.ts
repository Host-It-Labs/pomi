import { create } from 'zustand';
import { environmentVariables } from '../config/environmentVariables';
import { createSelectors } from './createSelectors';

interface DebugState {
  lagMs: number;
  setLagMs: (ms: number) => void;
}

const useDebugStoreBase = create<DebugState>(set => ({
  lagMs: 0,
  setLagMs: (ms: number) => set({ lagMs: ms }),
}));

export const useDebugStore = createSelectors(useDebugStoreBase);

export const getDebugLag = (): number => {
  if (!environmentVariables.DEBUG_PANEL_ENABLED) return 0;
  return useDebugStoreBase.getState().lagMs;
};
