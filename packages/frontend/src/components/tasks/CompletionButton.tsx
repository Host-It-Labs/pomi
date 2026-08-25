import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { FaUndo } from 'react-icons/fa';
import { useI18n } from '../../i18n';

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
  return (
    <motion.button
      type="button"
      aria-label={`${actionLabel} ${label}`}
      title={actionLabel}
      aria-pressed={isUndo}
      disabled={disabled === true}
      onClick={onClick}
      animate={isUndo ? { scale: [1, 1.16, 1] } : { scale: 1 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className={clsx(
        'relative inline-flex shrink-0 items-center justify-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400/45 disabled:cursor-not-allowed disabled:opacity-55',
        isCompact ? 'h-6 w-6' : 'h-8 w-8',
        isUndo
          ? 'border-emerald-400 bg-emerald-400 text-slate-950 shadow-sm shadow-emerald-500/30'
          : 'border-slate-600 bg-slate-950/60 text-transparent hover:border-emerald-400 hover:bg-emerald-500/10'
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isUndo ? (
          <motion.span
            key="undo"
            initial={{ opacity: 0, scale: 0.2, rotate: -35 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.2 }}
            transition={{ duration: 0.2 }}
          >
            <FaUndo size={isCompact ? 8 : 10} />
          </motion.span>
        ) : null}
      </AnimatePresence>
    </motion.button>
  );
}
