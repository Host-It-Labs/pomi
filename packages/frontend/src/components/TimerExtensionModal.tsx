import type {
  TimerExtensionResolutionAction,
  TimerExtensionState,
} from '@pomi/shared';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { usePreferencesStore } from '../stores/preferencesStore';
import { isDesktop } from '../utils/osUtils';
import { shouldIgnoreModalLocalShortcut } from '../utils/shortcutUtils';
import { formatTimeWithUnit } from '../utils/timeUtils';
import { IntentionEmojiPair } from './ui/IntentionEmojiPair';
import { Modal } from './ui/Modal';

type TimerExtensionModalProps = {
  isOpen: boolean;
  extensionState: TimerExtensionState | null;
  onCancel: () => void;
  onSelect: (action: TimerExtensionResolutionAction) => void;
};

function getExtensionElapsedMs(
  extensionState: TimerExtensionState,
  now = Date.now()
) {
  const elapsed = now - extensionState.startTime;
  return Math.max(0, elapsed);
}

export function TimerExtensionModal({
  isOpen,
  extensionState,
  onCancel,
  onSelect,
}: TimerExtensionModalProps) {
  const preferences = usePreferencesStore.use.preferences();
  const showKeyHints = isDesktop && preferences?.keyboardShortcuts;
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isOpen || !extensionState) {
      return undefined;
    }

    const updateDurations = () => setNow(Date.now());

    updateDurations();
    const interval = window.setInterval(updateDurations, 1000);
    return () => window.clearInterval(interval);
  }, [extensionState, isOpen]);

  useEffect(() => {
    if (!isOpen || !extensionState) {
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
          onSelect('logElapsed');
          break;
        case 'Digit2':
        case 'Numpad2':
          event.preventDefault();
          onSelect('addFiveMinutes');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [extensionState, isOpen, onSelect]);

  if (!extensionState || typeof document === 'undefined') {
    return null;
  }

  const elapsedDuration = getExtensionElapsedMs(extensionState, now);
  const totalDuration = extensionState.originalDuration + elapsedDuration;
  const modalTitle =
    extensionState.intentionEmoji || extensionState.subIntentionEmoji ? (
      <span className="inline-flex items-center gap-2">
        <IntentionEmojiPair
          parentEmoji={extensionState.intentionEmoji}
          subEmoji={extensionState.subIntentionEmoji}
          size="sm"
        />
        <span>{t('timer.extend')}</span>
      </span>
    ) : (
      t('timer.extend')
    );

  return createPortal(
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={modalTitle}
      ariaLabel={t('timer.extend')}
      closeOnBackdropClick={true}
      closeOnEscape={true}
    >
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => onSelect('logElapsed')}
          className="flex-1 cursor-pointer rounded-lg border border-slate-700/60 bg-slate-800/80 px-3 py-2.5 text-center transition-colors hover:border-indigo-500/60 hover:bg-slate-700/80"
        >
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            {t('timer.logTotal')}
          </div>
          <div className="mt-0.5 text-base font-bold tabular-nums text-ink">
            {formatTimeWithUnit(totalDuration)}
          </div>
          {showKeyHints && (
            <div className="mt-1 text-[10px] text-slate-500">
              {t('common.pressKey', { key: '1' })}
            </div>
          )}
        </button>
        <button
          type="button"
          onClick={() => onSelect('addFiveMinutes')}
          className="flex-1 cursor-pointer rounded-lg border border-slate-700/60 bg-slate-800/80 px-3 py-2.5 text-center transition-colors hover:border-indigo-500/60 hover:bg-slate-700/80"
        >
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            {t('timer.addFiveMinutes')}
          </div>
          <div className="mt-0.5 text-base font-bold tabular-nums text-ink">
            {formatTimeWithUnit(totalDuration)} + 5m
          </div>
          {showKeyHints && (
            <div className="mt-1 text-[10px] text-slate-500">
              {t('common.pressKey', { key: '2' })}
            </div>
          )}
        </button>
      </div>
    </Modal>,
    document.body
  );
}
