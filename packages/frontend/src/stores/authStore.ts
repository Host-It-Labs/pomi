import type { User } from '@pomi/shared';
import { create } from 'zustand';
import { getBackendOrigin } from '../utils/backendUrl';
import {
  deleteNativeRefreshToken,
  readNativeRefreshToken,
  writeNativeRefreshToken,
} from '../utils/refreshCredentialStore';
import {
  sessionPlatform,
  usesNativeRefreshVault,
} from '../utils/sessionPlatform';
import { createSelectors } from './createSelectors';

type SessionData = {
  user: User;
  token: string;
  refreshToken?: string;
  isNewUser: boolean;
  language?: string | null;
};

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasExplicitlySignedOut: boolean;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  acceptSession: (session: SessionData) => Promise<void>;
  initializeSession: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
  expireSession: () => void;
  signOut: () => Promise<void>;
}

let isSigningOut = false;
let refreshInFlight: Promise<boolean> | null = null;
let initializationInFlight: Promise<void> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const EXPLICIT_SIGN_OUT_KEY = 'pomi-session-explicitly-signed-out';

const readExplicitSignOut = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(EXPLICIT_SIGN_OUT_KEY) === 'true';
  } catch {
    return false;
  }
};

const writeExplicitSignOut = (signedOut: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    if (signedOut) localStorage.setItem(EXPLICIT_SIGN_OUT_KEY, 'true');
    else localStorage.removeItem(EXPLICIT_SIGN_OUT_KEY);
  } catch {
    // Storage can be unavailable in hardened webviews.
  }
};

const readLegacyAccessToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const serialized = localStorage.getItem('pomi-auth-storage');
    localStorage.removeItem('pomi-auth-storage');
    if (!serialized) return null;
    const parsed = JSON.parse(serialized) as { state?: { token?: unknown } };
    return typeof parsed.state?.token === 'string' ? parsed.state.token : null;
  } catch {
    try {
      localStorage.removeItem('pomi-auth-storage');
    } catch {
      // Storage can be unavailable in hardened webviews.
    }
    return null;
  }
};

const decodeAccessExpiry = (token: string): number | null => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(normalized)) as { exp?: unknown };
    return typeof decoded.exp === 'number' ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
};

const scheduleRefresh = (token: string, refresh: () => Promise<boolean>) => {
  if (refreshTimer) clearTimeout(refreshTimer);
  const expiresAt = decodeAccessExpiry(token);
  if (!expiresAt) return;
  const delay = Math.max(1_000, expiresAt - Date.now() - 60_000);
  refreshTimer = setTimeout(() => void refresh(), delay);
};

const sessionFetch = async (
  path: string,
  body: Record<string, unknown>,
  accessToken: string | null
): Promise<Response> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(`${getBackendOrigin()}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(body),
  });
};

const parseSession = async (
  response: Response
): Promise<SessionData | null> => {
  if (!response.ok) return null;
  const body = (await response.json()) as Partial<SessionData>;
  if (!body.user || typeof body.token !== 'string') return null;
  return body as SessionData;
};

const useAuthStoreBase = create<AuthState>()((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  hasExplicitlySignedOut: readExplicitSignOut(),

  setUser: user =>
    set(state => ({
      user,
      isAuthenticated: !!user,
      hasExplicitlySignedOut: user ? false : state.hasExplicitlySignedOut,
    })),

  setToken: token => {
    set({ token });
    if (token) scheduleRefresh(token, get().refreshSession);
    else if (refreshTimer) clearTimeout(refreshTimer);
  },

  acceptSession: async session => {
    const backendOrigin = getBackendOrigin();
    await writeNativeRefreshToken(backendOrigin, session.refreshToken);
    writeExplicitSignOut(false);
    set({
      user: session.user,
      token: session.token,
      isAuthenticated: true,
      isLoading: false,
      hasExplicitlySignedOut: false,
    });
    scheduleRefresh(session.token, get().refreshSession);
  },

  initializeSession: async () => {
    if (initializationInFlight) return initializationInFlight;
    initializationInFlight = (async () => {
      const legacyToken = readLegacyAccessToken();
      try {
        if (get().hasExplicitlySignedOut) return;

        if (legacyToken) {
          const migrated = await sessionFetch(
            '/sessions/migrate',
            { platform: sessionPlatform },
            legacyToken
          );
          const migratedSession = await parseSession(migrated);
          if (migratedSession) {
            await get().acceptSession(migratedSession);
            return;
          }
        }

        await get().refreshSession();
      } catch (error) {
        console.warn('Session restoration failed:', error);
      } finally {
        set({ isLoading: false });
        initializationInFlight = null;
      }
    })();
    return initializationInFlight;
  },

  refreshSession: async () => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const backendOrigin = getBackendOrigin();
      try {
        const refreshToken = usesNativeRefreshVault
          ? await readNativeRefreshToken(backendOrigin)
          : null;
        if (usesNativeRefreshVault && !refreshToken) return false;

        const response = await sessionFetch(
          '/sessions/refresh',
          {
            platform: sessionPlatform,
            ...(refreshToken ? { refreshToken } : {}),
          },
          null
        );
        const session = await parseSession(response);
        if (session) {
          await get().acceptSession(session);
          return true;
        }

        if (response.status === 401) {
          await deleteNativeRefreshToken(backendOrigin).catch(() => undefined);
          get().expireSession();
        }
        return false;
      } catch (error) {
        console.warn('Session refresh failed:', error);
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  },

  expireSession: () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    set({ user: null, token: null, isAuthenticated: false, isLoading: false });
  },

  signOut: async () => {
    if (isSigningOut) return;
    isSigningOut = true;
    const { token } = get();
    const backendOrigin = getBackendOrigin();

    try {
      if (token) {
        try {
          await fetch(
            `${backendOrigin}/sessions/current?platform=${encodeURIComponent(sessionPlatform)}`,
            {
              method: 'DELETE',
              credentials: 'include',
              headers: { Authorization: `Bearer ${token}` },
            }
          );
        } catch (error) {
          console.error('Failed to notify server about logout:', error);
        }
      }
      await deleteNativeRefreshToken(backendOrigin).catch(() => undefined);
    } finally {
      if (refreshTimer) clearTimeout(refreshTimer);
      writeExplicitSignOut(true);
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
        hasExplicitlySignedOut: true,
      });
      isSigningOut = false;
    }
  },
}));

export const useAuthStore = createSelectors(useAuthStoreBase);
export { useAuthStoreBase };
