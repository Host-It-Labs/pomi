import { create } from 'zustand';
import { createSelectors } from './createSelectors';

export type ConnectionStatusTone = 'warning' | 'offline';

interface ConnectionStatusUiState {
  /** The compact spinner replaces the page Back slot after the toast is closed. */
  isCollapsed: boolean;
  tone: ConnectionStatusTone;
  dismiss: (tone: ConnectionStatusTone) => void;
  reset: () => void;
  setTone: (tone: ConnectionStatusTone) => void;
}

const useConnectionStatusUiBase = create<ConnectionStatusUiState>(set => ({
  isCollapsed: false,
  tone: 'warning',
  dismiss: tone => set({ isCollapsed: true, tone }),
  reset: () => set({ isCollapsed: false, tone: 'warning' }),
  setTone: tone => set({ tone }),
}));

export const useConnectionStatusUi = createSelectors(useConnectionStatusUiBase);

export { useConnectionStatusUiBase };
