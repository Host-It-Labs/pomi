import * as Sentry from '@sentry/react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider, useI18n } from './i18n';
import { isWindows } from './utils/osUtils';
import { initFrontendSentryLogging } from './utils/sentry';

function SentryFallback() {
  const { t } = useI18n();
  return (
    <div className="h-screen bg-slate-950 text-ink flex items-center justify-center p-3">
      <div className="w-full max-w-sm rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-center">
        <h1 className="text-sm font-semibold">
          {t('common.somethingWentWrong')}
        </h1>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 inline-flex items-center justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-ink hover:bg-indigo-500"
        >
          {t('common.reloadApp')}
        </button>
      </div>
    </div>
  );
}

initFrontendSentryLogging();

if (isWindows) {
  document.documentElement.classList.add('windows-platform');
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <Sentry.ErrorBoundary fallback={<SentryFallback />}>
        <App />
      </Sentry.ErrorBoundary>
    </I18nProvider>
  </React.StrictMode>
);
