import type { ReactNode } from 'react';
import { FaChevronLeft } from 'react-icons/fa6';
import { AppLogo } from '../../components/brand/AppLogo';

interface AccessShellProps {
  children: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  badge?: string;
  hideBrand?: boolean;
}

export function AccessShell({
  children,
  onBack,
  backLabel = 'Back',
  badge,
  hideBrand = false,
}: AccessShellProps) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-slate-950 px-5 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+22px)] text-white">
      <header className="relative z-10 mx-auto flex w-full max-w-md items-center justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-800/80 bg-slate-900/70 text-xs text-slate-300 transition hover:border-slate-700 hover:text-white"
          >
            <FaChevronLeft />
          </button>
        ) : hideBrand ? (
          <span />
        ) : (
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight text-slate-200">
            <AppLogo priority className="h-8 w-8 rounded-[10px]" />
            Pomi
          </div>
        )}
        {badge ? (
          <span className="rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.15em] text-slate-400">
            {badge}
          </span>
        ) : null}
      </header>
      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col">
        {children}
      </div>
    </div>
  );
}
