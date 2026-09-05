import type { User } from '@pomi/shared';
import { useState } from 'react';
import { useToast } from '../components/toast/ToastContext';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { isDevAutoLoginEnabled } from '../config/environmentVariables';
import { normalizeLanguage, SUPPORTED_LANGUAGES, useI18n } from '../i18n';
import { useAuthStore } from '../stores/authStore';
import { useSystemStore } from '../stores/systemStore';
import { useUiStore } from '../stores/uiStore';
import { apiClient, baseUrl } from '../utils/apiClient';
import { getApiErrorMessage } from '../utils/apiError';
import {
  BackendOriginError,
  clearStoredBackendUrl,
  getBackendUrlQuarantine,
  getStoredBackendUrl,
  parseBackendOrigin,
  setStoredBackendUrl,
} from '../utils/backendUrlStorage';
import { sessionPlatform } from '../utils/sessionPlatform';

type SessionResult = {
  status: number;
  body: unknown;
};

type SessionData = {
  user: User;
  token: string;
  isNewUser: boolean;
  language?: string | null;
};

function isResponseValidationError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === 'ZodError' || error.name === 'ResponseValidationError')
  );
}

function isLanguageRejectionResponse(response: SessionResult) {
  if (response.status !== 400 || !response.body) {
    return false;
  }

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
    credentials: 'include',
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

export function Login() {
  const { language, setLanguage, t } = useI18n();
  const acceptSession = useAuthStore.use.acceptSession();
  const isAuthenticated = useAuthStore.use.isAuthenticated();
  const setActiveTab = useUiStore.use.setActiveTab();
  const setHasLoggedIn = useUiStore.use.setHasLoggedIn();
  const loadSystemInfo = useSystemStore.use.loadSystemInfo();
  const systemInfo = useSystemStore.use.systemInfo();
  const { showToast } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [customBackendUrl, setCustomBackendUrl] = useState(() =>
    isDevAutoLoginEnabled ? '' : getStoredBackendUrl() || ''
  );
  const [selfHostInput, setSelfHostInput] = useState('');
  const [showSelfHostPrompt, setShowSelfHostPrompt] = useState(false);
  const [backendQuarantine, setBackendQuarantine] = useState(() =>
    getBackendUrlQuarantine()
  );

  const openSelfHostingPrompt = () => {
    setSelfHostInput(customBackendUrl);
    setShowSelfHostPrompt(true);
  };

  const handleSaveSelfHosting = () => {
    let backendOrigin: string;
    try {
      backendOrigin = parseBackendOrigin(selfHostInput);
    } catch (error) {
      showToast(
        error instanceof BackendOriginError &&
          error.reason === 'insecure-remote'
          ? t('login.httpsRequired')
          : t('login.invalidUrl'),
        'error'
      );
      return;
    }

    setStoredBackendUrl(backendOrigin);
    setCustomBackendUrl(backendOrigin);
    setBackendQuarantine(null);
    setShowSelfHostPrompt(false);
    loadSystemInfo();
    showToast(t('login.urlSaved'), 'success');
  };

  const handleUseHostedService = () => {
    clearStoredBackendUrl();
    setCustomBackendUrl('');
    setBackendQuarantine(null);
    loadSystemInfo();
    showToast(t('login.hostedUrlSaved'), 'success');
  };

  const handleAuthenticate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim() || !password.trim()) {
      showToast(t('login.credentialsRequired'), 'error');
      return;
    }

    if (!customBackendUrl) {
      clearStoredBackendUrl();
    }

    try {
      setIsLoading(true);

      let response: SessionResult;
      try {
        response = (await apiClient.sessions.create({
          body: {
            username,
            password,
            language,
            platform: sessionPlatform,
            ...(systemInfo?.requiresAdminBootstrapToken
              ? { bootstrapToken }
              : {}),
          } as Parameters<typeof apiClient.sessions.create>[0]['body'],
        })) as SessionResult;
      } catch (error) {
        if (!isResponseValidationError(error)) {
          throw error;
        }

        // Older self-hosted servers reject the new language field or return a
        // legacy session shape without it. Retry once without that field and
        // consume the legacy response without the current contract parser.
        response = await createLegacySession(username, password);
      }

      if (isLanguageRejectionResponse(response)) {
        response = await createLegacySession(username, password);
      }

      if (response.status === 200) {
        const data = response.body as SessionData;
        const accountLanguage = normalizeLanguage(data.language);
        if (accountLanguage) {
          setLanguage(accountLanguage, { persist: true });
        } else if (data.isNewUser) {
          setLanguage(language, { persist: true });
        }
        setHasLoggedIn(true);
        await acceptSession(data);
        setActiveTab('timer');
        void loadSystemInfo();

        if (data.isNewUser) {
          showToast(t('login.accountCreated'), 'success');
        } else {
          showToast(t('login.success'), 'success');
        }
        return;
      }

      showToast(
        getApiErrorMessage(response.body, t('login.authError')),
        'error'
      );
    } catch (error: any) {
      console.error('Authentication error:', error);
      const errorMessage =
        getApiErrorMessage(error.response?.data, '') ||
        error.message ||
        t('login.authFailed');
      showToast(errorMessage, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  if (isAuthenticated) {
    return null;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh bg-slate-950 p-6">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-ink">{t('login.title')}</h1>
        <p className="mt-2 text-slate-400 text-sm">{t('login.subtitle')}</p>
      </div>

      <div className="mb-5 flex items-center gap-2 text-xs text-slate-400">
        <label htmlFor="login-language">{t('common.language')}</label>
        <select
          id="login-language"
          aria-label={t('common.language')}
          value={language}
          onChange={event => setLanguage(event.target.value, { persist: true })}
          className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-indigo-400"
        >
          {SUPPORTED_LANGUAGES.map(option => (
            <option key={option.code} value={option.code}>
              {option.nativeName}
            </option>
          ))}
        </select>
      </div>

      <form onSubmit={handleAuthenticate} className="space-y-4">
        {backendQuarantine ? (
          <div
            role="alert"
            className="rounded-lg bg-amber-950 p-3 text-xs text-amber-100"
          >
            {t('login.backendQuarantined')}
          </div>
        ) : null}
        <FormField label={t('login.username')} htmlFor="username">
          <Input
            id="username"
            type="text"
            placeholder={t('login.usernamePlaceholder')}
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="rounded-lg p-3"
            required
          />
        </FormField>
        <FormField label={t('login.password')} htmlFor="password">
          <Input
            id="password"
            type="password"
            placeholder={t('login.passwordPlaceholder')}
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="rounded-lg p-3"
            required
          />
        </FormField>
        {systemInfo?.requiresAdminBootstrapToken ? (
          <FormField
            label={t('login.bootstrapToken')}
            htmlFor="bootstrap-token"
          >
            <Input
              id="bootstrap-token"
              type="password"
              placeholder={t('login.bootstrapTokenPlaceholder')}
              value={bootstrapToken}
              onChange={event => setBootstrapToken(event.target.value)}
              className="rounded-lg p-3"
              required
            />
          </FormField>
        ) : null}
        <Button
          type="submit"
          isLoading={isLoading}
          loadingText={t('login.authenticating')}
          className="w-full mt-2"
        >
          {t('login.continue')}
        </Button>
      </form>
      <div className="mt-6 text-slate-400 text-xs text-center">
        <p>{t('login.newUsers')}</p>
        <p>{t('login.existingUsers')}</p>
      </div>
      <div className="mt-6 flex flex-col items-center gap-2 text-xs text-slate-400">
        <Button type="button" variant="link" onClick={openSelfHostingPrompt}>
          {t('login.selfHosting')}
        </Button>
        {customBackendUrl ? (
          <>
            <div className="text-center">
              {t('login.usingSelfHosted', { url: customBackendUrl })}
            </div>
            <Button
              type="button"
              variant="link"
              onClick={handleUseHostedService}
            >
              {t('login.hostedInstead')}
            </Button>
          </>
        ) : null}
      </div>
      {showSelfHostPrompt ? (
        <Modal
          isOpen={showSelfHostPrompt}
          onClose={() => setShowSelfHostPrompt(false)}
          title={t('login.setSelfHostedUrl')}
          closeOnBackdropClick={true}
          closeOnEscape={true}
        >
          <p className="text-xs text-slate-400">
            {t('login.selfHostedDescription')}
          </p>
          <div className="mt-4">
            <Input
              type="text"
              placeholder={t('login.urlPlaceholder')}
              value={selfHostInput}
              onChange={e => setSelfHostInput(e.target.value)}
              className="rounded-lg p-3"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setShowSelfHostPrompt(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSaveSelfHosting}>{t('common.save')}</Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
