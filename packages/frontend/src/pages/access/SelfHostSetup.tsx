import { useState } from 'react';
import { FaArrowRight, FaServer } from 'react-icons/fa6';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/toast/ToastContext';
import { useSystemStore, useSystemStoreBase } from '../../stores/systemStore';
import {
  clearStoredBackendUrl,
  getStoredBackendUrl,
  sanitizeBackendUrl,
  setStoredBackendUrl,
} from '../../utils/backendUrlStorage';
import { useI18n } from '../../i18n';

interface SelfHostSetupProps {
  onReady: (url: string) => void;
}

export function SelfHostSetup({ onReady }: SelfHostSetupProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const loadSystemInfo = useSystemStore.use.loadSystemInfo();
  const clearSystemInfo = useSystemStore.use.clearSystemInfo();
  const [url, setUrl] = useState(() => getStoredBackendUrl() ?? '');
  const [isConnecting, setIsConnecting] = useState(false);

  const continueToLogin = async () => {
    const normalized = sanitizeBackendUrl(url);
    if (!normalized || !/^https?:\/\//i.test(normalized)) {
      showToast(t('login.invalidUrl'), 'error');
      return;
    }
    setStoredBackendUrl(normalized);
    clearSystemInfo();
    setIsConnecting(true);
    await loadSystemInfo();
    setIsConnecting(false);
    const systemInfo = useSystemStoreBase.getState().systemInfo;
    if (!systemInfo) {
      clearStoredBackendUrl();
      showToast(t('access.selfHost.unreachable'), 'error');
      return;
    }
    if (!systemInfo.selfHosted) {
      clearStoredBackendUrl();
      showToast(t('access.selfHost.hostedServer'), 'error');
      return;
    }
    onReady(normalized);
  };

  return (
    <div className="flex flex-1 flex-col justify-center py-8">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] border border-indigo-300/15 bg-indigo-500/10 text-xl text-indigo-200 shadow-[0_0_45px_rgba(99,102,241,.14)]">
        <FaServer />
      </div>
      <div className="mt-6 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-300">
          {t('access.selfHost.eyebrow')}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
          {t('access.selfHost.title')}
        </h1>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-slate-400">
          {t('access.selfHost.subtitle')}
        </p>
      </div>

      <div className="mt-8">
        <label
          htmlFor="self-host-url"
          className="mb-2 block text-xs font-medium text-slate-300"
        >
          {t('access.selfHost.serverUrl')}
        </label>
        <Input
          id="self-host-url"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          placeholder={t('login.urlPlaceholder')}
          value={url}
          onChange={event => setUrl(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') void continueToLogin();
          }}
          className="rounded-xl border-slate-800 bg-slate-900/75 p-3"
        />
        <p className="mt-2 text-[11px] leading-5 text-slate-600">
          {t('access.selfHost.note')}
        </p>
      </div>

      <Button
        size="lg"
        isLoading={isConnecting}
        loadingText={t('access.selfHost.connecting')}
        onClick={() => void continueToLogin()}
        className="group mt-7 w-full rounded-2xl py-3.5"
      >
        {t('access.selfHost.continue')}
        <FaArrowRight className="ml-2 text-xs transition-transform group-hover:translate-x-0.5" />
      </Button>
    </div>
  );
}
