import clsx from 'clsx';
import type { ReactNode } from 'react';
import { FaCheck, FaPowerOff } from 'react-icons/fa';
import { useI18n } from '../../i18n';

export function SettingsStickyNav({
  isDesktop,
  isIos,
  children,
}: {
  isDesktop: boolean;
  isIos: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-settings-navigation
      className={clsx(
        'sticky z-20 -mx-4 border-y border-slate-800/80 bg-slate-950/95 px-4 shadow-lg shadow-slate-950/40 backdrop-blur supports-backdrop-filter:bg-slate-950/85',
        isDesktop ? 'top-5' : isIos ? 'top-[env(safe-area-inset-top)]' : 'top-0'
      )}
    >
      {children}
    </div>
  );
}

type FeatureControl = {
  enabled: boolean;
  onToggle: () => void;
  unavailable?: boolean;
};

export function SettingsSectionFrame({
  title,
  icon,
  children,
  feature,
  accentClassName,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  feature?: FeatureControl;
  accentClassName?: string;
}) {
  const { t } = useI18n();
  const isFeatureEnabled = feature?.enabled ?? true;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/45">
      <header className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={clsx(
              'grid size-9 shrink-0 place-items-center rounded-xl bg-current/10',
              accentClassName ?? 'text-indigo-300'
            )}
          >
            {icon}
          </span>
          <h2 className="truncate text-base font-semibold text-white">
            {title}
          </h2>
        </div>
        {feature ? (
          <button
            type="button"
            disabled={feature.unavailable}
            aria-label={`${feature.enabled ? t('common.disable') : t('common.enable')} ${title}`}
            onClick={feature.onToggle}
            className={clsx(
              'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-45',
              feature.enabled
                ? 'border-slate-700 text-slate-300 hover:text-rose-300'
                : 'border-emerald-400/35 bg-emerald-400/10 text-emerald-300'
            )}
          >
            {feature.enabled ? <FaCheck size={10} /> : <FaPowerOff size={10} />}
            {feature.enabled ? t('common.on') : t('common.turnOn')}
          </button>
        ) : null}
      </header>
      {isFeatureEnabled ? (
        <div className="border-t border-slate-800/70 p-4 sm:p-5">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function SettingsControlGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-800/70 bg-slate-950/20 p-4">
      <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {title}
      </h3>
      <div className="space-y-5">{children}</div>
    </section>
  );
}
