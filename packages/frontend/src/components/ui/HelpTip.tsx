import { ReactNode } from 'react';
import { FaEyeSlash, FaQuestionCircle } from 'react-icons/fa';
import { useI18n } from '../../i18n';

interface HelpTipProps {
  label: string;
  children: ReactNode;
  isDismissed?: boolean;
  onDismiss?: () => void;
}

export function HelpTip({
  label,
  children,
  isDismissed,
  onDismiss,
}: HelpTipProps) {
  const { t } = useI18n();
  if (isDismissed) {
    return null;
  }

  return (
    <div className="group relative inline-flex">
      <button
        type="button"
        aria-label={label}
        title={label}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-700/50 bg-slate-900/85 text-slate-400 transition hover:text-slate-100"
      >
        <FaQuestionCircle size={13} />
      </button>
      <div className="pointer-events-none absolute bottom-8 right-0 z-50 hidden w-56 rounded-lg border border-slate-700/50 bg-slate-950/95 p-2 text-xs text-slate-300 shadow-lg shadow-slate-950/40 backdrop-blur-sm group-hover:block">
        <div>{children}</div>
        {onDismiss && (
          <button
            type="button"
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              onDismiss();
            }}
            className="pointer-events-auto mt-2 inline-flex items-center gap-1 rounded-md border border-slate-700/50 bg-slate-900 px-2 py-1 text-[10px] font-medium text-slate-300 transition hover:border-indigo-500/50 hover:text-ink"
          >
            <FaEyeSlash size={10} />
            {t('common.dontShow')}
          </button>
        )}
      </div>
    </div>
  );
}
