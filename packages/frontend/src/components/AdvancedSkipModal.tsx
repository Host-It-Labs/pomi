import { Timer, TimerSkipLogMode } from '@pomi/shared';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  getAdvancedSkipElapsedMs,
  getAdvancedSkipFullMs,
} from '../utils/advancedSkip';
import { formatTimeWithUnit } from '../utils/timeUtils';
import { usePreferencesStore } from '../stores/preferencesStore';
import { isDesktop } from '../utils/osUtils';
import { shouldIgnoreModalLocalShortcut } from '../utils/shortcutUtils';
import { getSelectedTimerIntentions } from '../utils/timerIntentions';
import { IntentionEmojiPair } from './ui/IntentionEmojiPair';
import { Modal } from './ui/Modal';
import { useI18n } from '../i18n';

type AdvancedSkipModalProps = {
  isOpen: boolean;
  timer: Timer | null;
  onCancel: () => void;
  onSelect: (mode: TimerSkipLogMode) => void;
};

export function AdvancedSkipModal({
  isOpen,
  timer,
  onCancel,
  onSelect,
}: AdvancedSkipModalProps) {
  const preferences = usePreferencesStore.use.preferences();
  const showKeyHints = isDesktop && preferences?.keyboardShortcuts;
  const { t } = useI18n();

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreModalLocalShortcut(event)) {
        return;
      }

      switch (event.code) {
        case 'Digit1':
        case 'Numpad1':
          event.preventDefault();
          onSelect('elapsed');
          break;
        case 'Digit2':
        case 'Numpad2':
          event.preventDefault();
          onSelect('full');
          break;
        case 'Digit0':
        case 'Numpad0':
          event.preventDefault();
          onSelect('none');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onSelect]);

  if (!timer) {
    return null;
  }

  const elapsedDuration = getAdvancedSkipElapsedMs(timer);
  const fullDuration = getAdvancedSkipFullMs(timer);
  const selectedIntentionEmojis = getSelectedTimerIntentions(timer)
    .map(slug => ({
      slug,
      parent:
        timer.intentionEmojis?.[slug] ??
        (slug === timer.intention ? timer.intentionEmoji : undefined),
      sub:
        timer.subIntentionEmojis?.[slug] ??
        (slug === timer.intention ? timer.subIntentionEmoji : undefined),
    }))
    .filter(item => item.parent || item.sub);

  const modalTitle =
    selectedIntentionEmojis.length > 0 ? (
      <span className="inline-flex items-center gap-2">
        <span className="inline-flex shrink-0 items-center gap-1">
          {selectedIntentionEmojis.map(item => (
            <IntentionEmojiPair
              key={item.slug}
              parentEmoji={item.parent}
              subEmoji={item.sub}
              size="sm"
            />
          ))}
        </span>
        <span>{t('timer.advancedSkip')}</span>
      </span>
    ) : (
      t('timer.advancedSkip')
    );

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={modalTitle}
      ariaLabel={t('timer.advancedSkip')}
      closeOnBackdropClick={true}
      closeOnEscape={true}
    >
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => onSelect('elapsed')}
          className="flex-1 cursor-pointer rounded-lg border border-slate-700/60 bg-slate-800/80 px-3 py-2.5 text-center transition-colors hover:border-indigo-500/60 hover:bg-slate-700/80"
        >
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            {t('timer.elapsed')}
          </div>
          <div className="mt-0.5 text-base font-bold tabular-nums text-white">
            {formatTimeWithUnit(elapsedDuration)}
          </div>
          {showKeyHints && (
            <div className="mt-1 text-[10px] text-slate-500">
              {t('common.pressKey', { key: '1' })}
            </div>
          )}
        </button>
        <button
          type="button"
          onClick={() => onSelect('full')}
          className="flex-1 cursor-pointer rounded-lg border border-slate-700/60 bg-slate-800/80 px-3 py-2.5 text-center transition-colors hover:border-indigo-500/60 hover:bg-slate-700/80"
        >
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            {t('timer.full')}
          </div>
          <div className="mt-0.5 text-base font-bold tabular-nums text-white">
            {formatTimeWithUnit(fullDuration)}
          </div>
          {showKeyHints && (
            <div className="mt-1 text-[10px] text-slate-500">
              {t('common.pressKey', { key: '2' })}
            </div>
          )}
        </button>
        <button
          type="button"
          onClick={() => onSelect('none')}
          className="flex-1 cursor-pointer rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-2.5 text-center transition-colors hover:border-slate-500/60 hover:bg-slate-700/50"
        >
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            {t('timer.noLog')}
          </div>
          <div className="mt-0.5 text-base font-bold text-slate-400">
            {t('timer.skip')}
          </div>
          {showKeyHints && (
            <div className="mt-1 text-[10px] text-slate-500">
              {t('common.pressKey', { key: '0' })}
            </div>
          )}
        </button>
      </div>
    </Modal>,
    document.body
  );
}
