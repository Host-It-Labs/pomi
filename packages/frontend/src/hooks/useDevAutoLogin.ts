import { useEffect, useRef, useState } from 'react';
import type { User } from '@pomi/shared';
import { environmentVariables } from '../config/environmentVariables';
import { useAuthStore } from '../stores/authStore';
import { useUiStore } from '../stores/uiStore';
import { apiClient } from '../utils/apiClient';
import { clearStoredBackendUrl } from '../utils/backendUrlStorage';
import { sessionPlatform } from '../utils/sessionPlatform';

let devAutoLoginInFlight = false;

const isMobileSimulatorFrame = () =>
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('__pomi_mobile_simulator') ===
    '1';

export function useDevAutoLogin() {
  const isAuthenticated = useAuthStore.use.isAuthenticated();
  const isAuthLoading = useAuthStore.use.isLoading();
  const token = useAuthStore.use.token();
  const hasExplicitlySignedOut = useAuthStore.use.hasExplicitlySignedOut();
  const acceptSession = useAuthStore.use.acceptSession();
  const setUser = useAuthStore.use.setUser();
  const setToken = useAuthStore.use.setToken();
  const setActiveTab = useUiStore.use.setActiveTab();
  const setHasLoggedIn = useUiStore.use.setHasLoggedIn();
  const attemptedForUserRef = useRef<string | null>(null);
  const successfulTokenRef = useRef<string | null>(null);
  const shouldSkipDevAutoLogin = isMobileSimulatorFrame();
  const username = shouldSkipDevAutoLogin
    ? ''
    : environmentVariables.DEV_AUTO_LOGIN_USERNAME.trim();
  const password = shouldSkipDevAutoLogin
    ? ''
    : environmentVariables.DEV_AUTO_LOGIN_PASSWORD;
  const [isPending, setIsPending] = useState(() => !!username && !!password);

  useEffect(() => {
    if (!username || !password) {
      setIsPending(false);
      return;
    }

    if (isAuthLoading) return;

    clearStoredBackendUrl();

    if (hasExplicitlySignedOut) {
      setIsPending(false);
      return;
    }

    if (isAuthenticated && token && successfulTokenRef.current === token) {
      attemptedForUserRef.current = null;
      setIsPending(false);
      return;
    }

    if (devAutoLoginInFlight || attemptedForUserRef.current === username) {
      return;
    }

    attemptedForUserRef.current = username;
    devAutoLoginInFlight = true;
    setIsPending(true);
    setToken(null);
    setUser(null);
    setHasLoggedIn(false);

    apiClient.sessions
      .create({
        body: {
          username,
          password,
          platform: sessionPlatform,
        },
      })
      .then(async response => {
        if (response.status !== 200) {
          console.error('Dev auto-login failed:', response.status);
          setActiveTab('login');
          return;
        }

        const data = response.body as {
          user: User;
          token: string;
          isNewUser: boolean;
        };
        successfulTokenRef.current = data.token;
        attemptedForUserRef.current = null;
        await acceptSession(data);
        setHasLoggedIn(true);
        setActiveTab('timer');
      })
      .catch(error => {
        console.error('Dev auto-login failed:', error);
        setActiveTab('login');
      })
      .finally(() => {
        devAutoLoginInFlight = false;
        setIsPending(false);
      });
  }, [
    acceptSession,
    isAuthLoading,
    isAuthenticated,
    hasExplicitlySignedOut,
    password,
    setActiveTab,
    setHasLoggedIn,
    setToken,
    setUser,
    token,
    username,
  ]);

  return isPending;
}
