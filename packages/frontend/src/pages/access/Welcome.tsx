import { FaArrowRight, FaServer } from 'react-icons/fa6';
import { AppLogo } from '../../components/brand/AppLogo';
import { PomiProductScene } from '../../components/brand/PomiProductScene';
import { Button } from '../../components/ui/Button';
import { SUPPORTED_LANGUAGES, useI18n } from '../../i18n';
import { AccessShell } from './AccessShell';

interface WelcomeProps {
  onLogin: () => void;
  onGetStarted: () => void;
  onSelfHost: () => void;
}

export function Welcome({ onLogin, onGetStarted, onSelfHost }: WelcomeProps) {
  const { language, setLanguage, t } = useI18n();

  return (
    <AccessShell hideBrand>
      <PomiProductScene
        scene="welcome"
        className="pointer-events-none h-[300px] [@media(max-height:720px)]:h-[240px]"
      />

      <div
        data-testid="welcome-content"
        className="relative pb-1 pt-5 [@media(max-height:720px)]:pt-3"
      >
        <div className="mb-5 flex items-center gap-2.5 [@media(max-height:720px)]:mb-3">
          <AppLogo priority className="h-10 w-10 rounded-xl" />
          <span className="text-lg font-semibold tracking-tight text-white">
            Pomi
          </span>
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-indigo-300">
          {t('access.welcome.eyebrow')}
        </p>
        <h1 className="mt-2 max-w-sm text-3xl font-semibold tracking-[-0.035em] text-white [@media(max-height:720px)]:text-2xl">
          {t('access.welcome.title')}
        </h1>
        <p className="mt-3 max-w-sm text-sm leading-6 text-slate-300 [@media(max-height:720px)]:leading-5">
          {t('access.welcome.subtitle')}
        </p>

        <div className="mt-6 space-y-3 [@media(max-height:720px)]:mt-4 [@media(max-height:720px)]:space-y-2">
          <Button
            size="lg"
            onClick={onGetStarted}
            className="group w-full rounded-xl border-indigo-400/35 bg-indigo-600 py-3.5 text-white hover:bg-indigo-500"
          >
            {t('access.getStarted')}
            <FaArrowRight className="ml-2 text-xs transition-transform group-hover:translate-x-0.5" />
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={onLogin}
            className="w-full rounded-xl border-slate-700 bg-slate-900 py-3.5 text-white hover:bg-slate-800"
          >
            {t('access.logIn')}
          </Button>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={onSelfHost}
              className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] text-slate-500 transition hover:text-slate-300"
            >
              <FaServer className="text-[9px]" />
              {t('access.selfHost')}
            </button>
            <label className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <span className="sr-only">{t('common.language')}</span>
              <select
                aria-label={t('common.language')}
                value={language}
                onChange={event =>
                  setLanguage(event.target.value, { persist: true })
                }
                className="border-0 bg-transparent py-1 text-right text-[10px] text-slate-500 outline-none focus:text-slate-300"
              >
                {SUPPORTED_LANGUAGES.map(option => (
                  <option key={option.code} value={option.code}>
                    {option.nativeName}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>
    </AccessShell>
  );
}
