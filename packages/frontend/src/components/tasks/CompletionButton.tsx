import clsx from 'clsx';
import { FaUndo } from 'react-icons/fa';
import { useI18n } from '../../i18n';
import { useNativePresence } from '../ui/useNativePresence';

export function CompletionButton({
  label,
  isCompleted,
  isCompleting,
  disabled,
  onClick,
  compact,
}: {
  label: string;
  isCompleted: boolean;
  isCompleting?: boolean;
  disabled?: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const isUndo = isCompleted || isCompleting === true;
  const isCompact = compact === true;
  const actionLabel = isUndo ? t('common.undo') : t('common.complete');
  const iconPresence = useNativePresence(isUndo ? true : null, 200);
  return (
    <button
      type="button"
      aria-label={`${actionLabel} ${label}`}
      title={actionLabel}
      aria-pressed={isUndo}
      disabled={disabled === true}
      onClick={onClick}
      className={clsx(
        'relative inline-flex shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors after:absolute after:-inset-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/45 disabled:cursor-not-allowed disabled:opacity-55',
        isCompact ? 'h-5 w-5' : 'h-[22px] w-[22px]',
        isUndo && 'native-completion-pop',
        isUndo
          ? 'border-emerald-400 bg-emerald-400 text-slate-950'
          : 'border-slate-500 bg-transparent text-transparent hover:border-emerald-400 hover:bg-emerald-400/10'
      )}
    >
      {iconPresence.shouldRender ? (
        <span
          className="native-fade-scale"
          data-presence={iconPresence.phase}
          onAnimationEnd={iconPresence.finish}
          aria-hidden={iconPresence.isExiting || undefined}
        >
          <FaUndo size={isCompact ? 8 : 10} />
        </span>
      ) : null}
    </button>
  );
}
