import { Timer, TimerSkipLogMode } from '@pomi/shared';
import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import {
  getAdvancedSkipElapsedMs,
  getAdvancedSkipFullMs,
} from '../utils/advancedSkip';
import { shouldIgnoreModalLocalShortcut } from '../utils/shortcutUtils';
import { formatTimeWithUnit } from '../utils/timeUtils';
import { KeyboardShortcut } from './ui/KeyboardShortcut';

type AdvancedSkipInlineStripProps = {
  timer: Timer;
  onSelect: (mode: TimerSkipLogMode) => void;
  onCancel: () => void;
};

export function AdvancedSkipInlineStrip({
  timer,
  onSelect,
  onCancel,
}: AdvancedSkipInlineStripProps) {
  const elapsedDuration = getAdvancedSkipElapsedMs(timer);
  const fullDuration = getAdvancedSkipFullMs(timer);
  const { t } = useI18n();
  const onSelectRef = useRef(onSelect);
  const onCancelRef = useRef(onCancel);
  onSelectRef.current = onSelect;
  onCancelRef.current = onCancel;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreModalLocalShortcut(event)) {
        return;
      }

      switch (event.code) {
        case 'Digit1':
        case 'Numpad1':
          event.preventDefault();
          onSelectRef.current('elapsed');
          break;
        case 'Digit2':
        case 'Numpad2':
          event.preventDefault();
          onSelectRef.current('full');
          break;
        case 'Digit0':
        case 'Numpad0':
          event.preventDefault();
          onSelectRef.current('none');
          break;
        case 'Escape':
          event.preventDefault();
          onCancelRef.current();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onSelect('elapsed')}
        className="relative cursor-pointer rounded-md bg-slate-800/90 px-2 py-1.5 text-center transition-colors hover:bg-slate-700"
      >
        <div className="text-[9px] font-medium uppercase tracking-wider text-slate-400">
          {t('timer.elapsed')}
        </div>
        <div className="text-xs font-bold tabular-nums text-ink">
          {formatTimeWithUnit(elapsedDuration)}
        </div>
        <KeyboardShortcut
          text="1"
          showModIcon={false}
          alwaysShow
          position="topRight"
        />
      </button>
      <button
        type="button"
        onClick={() => onSelect('full')}
        className="relative cursor-pointer rounded-md bg-slate-800/90 px-2 py-1.5 text-center transition-colors hover:bg-slate-700"
      >
        <div className="text-[9px] font-medium uppercase tracking-wider text-slate-400">
          {t('timer.full')}
        </div>
        <div className="text-xs font-bold tabular-nums text-ink">
          {formatTimeWithUnit(fullDuration)}
        </div>
        <KeyboardShortcut
          text="2"
          showModIcon={false}
          alwaysShow
          position="topRight"
        />
      </button>
      <button
        type="button"
        onClick={() => onSelect('none')}
        className="relative cursor-pointer rounded-md bg-slate-800/50 px-2 py-1.5 text-center transition-colors hover:bg-slate-700/60"
      >
        <div className="text-[9px] font-medium uppercase tracking-wider text-slate-500">
          {t('timer.skip')}
        </div>
        <div className="text-xs font-bold text-slate-400">
          {t('timer.noLog')}
        </div>
        <KeyboardShortcut
          text="0"
          showModIcon={false}
          alwaysShow
          position="topRight"
        />
      </button>
      <div className="mx-0.5 h-6 w-px bg-slate-700" />
      <button
        type="button"
        onClick={onCancel}
        className="cursor-pointer rounded-md px-1.5 py-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300"
        aria-label={t('common.cancel')}
        title={t('common.cancel')}
      >
        ✕
      </button>
    </div>
  );
}
