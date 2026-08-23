import { User } from '@pomi/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PUSH_TOKEN_STORAGE_KEY } from '../constants/pushNotifications';
import { apiClient } from '../utils/apiClient';
import { platformName } from '../utils/osUtils';
import { createSelectors } from './createSelectors';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasExplicitlySignedOut: boolean;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  expireSession: () => void;
  signOut: () => Promise<void>;
}

let isSigningOut = false;

const useAuthStoreBase = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      hasExplicitlySignedOut: false,

      setUser: user =>
        set(state => ({
          user,
          isAuthenticated: !!user,
          hasExplicitlySignedOut: user ? false : state.hasExplicitlySignedOut,
        })),

      setToken: token => set({ token }),

      expireSession: () =>
        set({ user: null, token: null, isAuthenticated: false }),

      signOut: async () => {
        if (isSigningOut) return;
        isSigningOut = true;
        const { token } = get();

        try {
          if (token) {
            try {
              const resolvedPlatform =
                platformName === 'android' ||
                platformName === 'ios' ||
                platformName === 'web' ||
                platformName === 'macos' ||
                platformName === 'windows' ||
                platformName === 'linux'
                  ? platformName
                  : 'web';
              await apiClient.sessions.deleteCurrent({
                query: {
                  platform: resolvedPlatform,
                  token:
                    localStorage.getItem(PUSH_TOKEN_STORAGE_KEY) ?? undefined,
                },
              });
            } catch (error) {
              console.error('Failed to notify server about logout:', error);
            }
          }
        } finally {
          localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
          set({
            user: null,
            token: null,
            isAuthenticated: false,
            hasExplicitlySignedOut: true,
          });
          isSigningOut = false;
        }
      },
    }),
    {
      name: 'pomi-auth-storage',
    }
  )
);

export const useAuthStore = createSelectors(useAuthStoreBase);
export { useAuthStoreBase };
