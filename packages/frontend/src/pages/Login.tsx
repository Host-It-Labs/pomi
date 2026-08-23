import type { User } from '@pomi/shared';
import { useState } from 'react';
import { FaApple, FaGoogle, FaServer } from 'react-icons/fa6';
import { AppLogo } from '../components/brand/AppLogo';
import { useToast } from '../components/toast/ToastContext';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { Input } from '../components/ui/Input';
import { useAuthStore } from '../stores/authStore';
import { useSystemStore } from '../stores/systemStore';
import { useUiStore } from '../stores/uiStore';
import { apiClient, baseUrl } from '../utils/apiClient';
import { getApiErrorMessage } from '../utils/apiError';
import { normalizeLanguage, SUPPORTED_LANGUAGES, useI18n } from '../i18n';
import {
  clearStoredBackendUrl,
  setStoredBackendUrl,
} from '../utils/backendUrlStorage';
import { isIos, isMac, isTauri } from '../utils/osUtils';

type SessionResult = {
  status: number;
  body: unknown;
};

export type SessionData = {
  user: User;
  token: string;
  isNewUser: boolean;
  language?: string | null;
};

interface LoginProps {
  mode?: 'hosted' | 'self-hosted';
  selfHostedUrl?: string;
  onSession?: (data: SessionData) => Promise<void> | void;
  onSelfHostRequested?: () => void;
}

function isResponseValidationError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === 'ZodError' || error.name === 'ResponseValidationError')
  );
}

function isLanguageRejectionResponse(response: SessionResult) {
  if (response.status !== 400 || !response.body) return false;
  const bodyText = JSON.stringify(response.body).toLowerCase();
  return (
    bodyText.includes('language') &&
    (bodyText.includes('should not exist') ||
      bodyText.includes('not allowed') ||
      bodyText.includes('unknown') ||
      bodyText.includes('whitelist') ||
      bodyText.includes('forbid'))
  );
}

async function createLegacySession(
  username: string,
  password: string
): Promise<SessionResult> {
  const response = await fetch(`${baseUrl().replace(/\/+$/, '')}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = { message: response.statusText };
  }
  return { status: response.status, body };
}

export function Login({
  mode = 'hosted',
  selfHostedUrl,
  onSession,
  onSelfHostRequested,
}: LoginProps) {
  const { language, setLanguage, t } = useI18n();
  const setUser = useAuthStore.use.setUser();
  const setToken = useAuthStore.use.setToken();
  const isAuthenticated = useAuthStore.use.isAuthenticated();
  const setActiveTab = useUiStore.use.setActiveTab();
  const setHasLoggedIn = useUiStore.use.setHasLoggedIn();
  const systemInfo = useSystemStore.use.systemInfo();
  const { showToast } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCredentials, setShowCredentials] = useState(
    mode === 'self-hosted' || !isTauri
  );
  const [socialProvider, setSocialProvider] = useState<
    'google' | 'apple' | null
  >(null);
  const isHosted = mode === 'hosted';
  const isApplePlatform = isIos || isMac;

  const completeSession = async (data: SessionData) => {
    const accountLanguage = normalizeLanguage(data.language);
    if (accountLanguage) {
      setLanguage(accountLanguage, { persist: true });
    } else if (data.isNewUser) {
      setLanguage(language, { persist: true });
    }
    setToken(data.token);
    try {
      await onSession?.(data);
    } catch (error) {
      setToken(null);
      showToast(
        error instanceof Error ? error.message : t('billing.claimFailed'),
        'error'
      );
      return;
    }
    setHasLoggedIn(true);
    setUser(data.user);
    setActiveTab('timer');
    showToast(
      data.isNewUser ? t('login.accountCreated') : t('login.success'),
      'success'
    );
  };

  const handleSocialSignIn = async (provider: 'google' | 'apple') => {
    try {
      setSocialProvider(provider);
      clearStoredBackendUrl();
      const socialAuth = await import('../utils/socialAuth');
      const response =
        provider === 'google'
          ? await socialAuth.signInWithGoogle(language)
          : await socialAuth.signInWithApple(language);
      if (response.status !== 200) {
        throw new Error(
          getApiErrorMessage(response.body, t('login.authFailed'))
        );
      }
      await completeSession(response.body as SessionData);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t('login.authFailed'),
        'error'
      );
    } finally {
      setSocialProvider(null);
    }
  };

  const handleAuthenticate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password.trim()) {
      showToast(t('login.credentialsRequired'), 'error');
      return;
    }

    if (isHosted) clearStoredBackendUrl();
    if (!isHosted && selfHostedUrl) setStoredBackendUrl(selfHostedUrl);

    try {
      setIsLoading(true);
      let response: SessionResult;
      try {
        response = (await apiClient.sessions.create({
          body: { username, password, language } as Parameters<
            typeof apiClient.sessions.create
          >[0]['body'],
        })) as SessionResult;
      } catch (error) {
        if (!isResponseValidationError(error)) throw error;
        response = await createLegacySession(username, password);
      }
      if (isLanguageRejectionResponse(response)) {
        response = await createLegacySession(username, password);
      }
      if (response.status === 200) {
        await completeSession(response.body as SessionData);
        return;
      }
      showToast(
        getApiErrorMessage(response.body, t('login.authError')),
        'error'
      );
    } catch (error: any) {
      console.error('Authentication error:', error);
      showToast(
        getApiErrorMessage(error.response?.data, '') ||
          error.message ||
          t('login.authFailed'),
        'error'
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (isAuthenticated) return null;

  return (
    <div className="flex flex-1 flex-col justify-center py-7">
      <div className="mb-7 text-center">
        <AppLogo className="mx-auto mb-4 h-14 w-14 rounded-[18px] shadow-[0_0_45px_rgba(59,130,246,.18)]" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-300">
          {isHosted ? t('access.hostedAccount') : t('access.selfHostedAccount')}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {isHosted ? t('access.login.title') : t('access.selfHost.loginTitle')}
        </h1>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-slate-400">
          {isHosted
            ? t('access.login.subtitle')
            : t('access.selfHost.loginSubtitle', { url: selfHostedUrl ?? '' })}
        </p>
      </div>

      <div className="mb-5 flex items-center justify-center gap-2 text-xs text-slate-500">
        <label htmlFor="login-language">{t('common.language')}</label>
        <select
          id="login-language"
          aria-label={t('common.language')}
          value={language}
          onChange={event => setLanguage(event.target.value, { persist: true })}
          className="rounded-lg border border-slate-800 bg-slate-900/80 px-2 py-1 text-xs text-slate-300 outline-none focus:border-indigo-400"
        >
          {SUPPORTED_LANGUAGES.map(option => (
            <option key={option.code} value={option.code}>
              {option.nativeName}
            </option>
          ))}
        </select>
      </div>

      {!showCredentials && isHosted && isTauri ? (
        <div className="space-y-3">
          <Button
            size="lg"
            variant="secondary"
            disabled={systemInfo?.authProviders.google !== true}
            isLoading={socialProvider === 'google'}
            loadingText={t('login.connectingGoogle')}
            onClick={() => void handleSocialSignIn('google')}
            className="w-full rounded-2xl border-slate-700/60 bg-white py-3.5 text-slate-950 hover:bg-slate-100"
          >
            <FaGoogle className="mr-2" /> {t('login.continueGoogle')}
          </Button>
          {isApplePlatform ? (
            <Button
              size="lg"
              variant="secondary"
              disabled={systemInfo?.authProviders.apple !== true}
              isLoading={socialProvider === 'apple'}
              loadingText={t('login.connectingApple')}
              onClick={() => void handleSocialSignIn('apple')}
              className="w-full rounded-2xl border-slate-700/70 bg-slate-900 py-3.5 text-white hover:bg-slate-800"
            >
              <FaApple className="mr-2 text-lg" />
              {t('login.continueApple')}
            </Button>
          ) : null}
          {systemInfo &&
          !systemInfo.authProviders.google &&
          (!isApplePlatform || !systemInfo.authProviders.apple) ? (
            <p className="rounded-xl border border-amber-300/10 bg-amber-300/5 px-3 py-2 text-center text-[11px] leading-5 text-amber-100/70">
              {t('access.login.socialUnavailable')}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => setShowCredentials(true)}
            className="w-full py-2 text-xs text-slate-500 hover:text-slate-300"
          >
            {t('login.usePassword')}
          </button>
        </div>
      ) : (
        <form onSubmit={handleAuthenticate} className="space-y-4">
          <FormField label={t('login.username')} htmlFor="username">
            <Input
              id="username"
              type="text"
              autoCapitalize="none"
              autoComplete="username"
              placeholder={t('login.usernamePlaceholder')}
              value={username}
              onChange={event => setUsername(event.target.value)}
              className="rounded-xl border-slate-800 bg-slate-900/70 p-3"
              required
            />
          </FormField>
          <FormField label={t('login.password')} htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete={isHosted ? 'current-password' : 'password'}
              placeholder={t('login.passwordPlaceholder')}
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="rounded-xl border-slate-800 bg-slate-900/70 p-3"
              required
            />
          </FormField>
          <Button
            type="submit"
            size="lg"
            isLoading={isLoading}
            loadingText={t('login.authenticating')}
            className="mt-2 w-full rounded-2xl py-3.5"
          >
            {t('login.continue')}
          </Button>
        </form>
      )}

      {showCredentials ? (
        <div className="mt-4 text-center text-[11px] leading-5 text-slate-600">
          <p>{t('login.newUsers')}</p>
          <p>{t('login.existingUsers')}</p>
        </div>
      ) : null}

      {isHosted && onSelfHostRequested ? (
        <button
          type="button"
          onClick={onSelfHostRequested}
          className="mx-auto mt-6 inline-flex items-center gap-1.5 py-1 text-[11px] text-slate-600 hover:text-slate-300"
        >
          <FaServer className="text-[9px]" /> {t('access.selfHost')}
        </button>
      ) : null}
    </div>
  );
}
