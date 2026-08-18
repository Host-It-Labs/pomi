import clsx from 'clsx';
import { FaBullseye, FaListUl } from 'react-icons/fa';
import { TaskMode } from '../stores/uiStore';
import { KeyboardShortcut } from './ui/KeyboardShortcut';
import { useI18n } from '../i18n';

interface TaskModeToggleProps {
  mode: TaskMode;
  onModeChange: (mode: TaskMode) => void;
  showShortcuts?: boolean;
  isIntentionDisabled?: boolean;
  compact?: boolean;
}

export function TaskModeToggle({
  mode,
  onModeChange,
  showShortcuts = false,
  isIntentionDisabled = false,
  compact = false,
}: TaskModeToggleProps) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <div
        className={clsx(
          'grid rounded-md border border-slate-700/55 bg-slate-950/45 p-0.5',
          compact ? 'grid-cols-[auto_auto]' : 'grid-cols-2'
        )}
        data-testid="task-mode-toggle"
      >
        <button
          type="button"
          aria-label={t('navigation.allTasks')}
          title={t('navigation.allTasks')}
          aria-pressed={mode === 'general'}
          onClick={() => onModeChange('general')}
          className={clsx(
            'relative flex h-8 w-8 items-center justify-center rounded text-[11px] font-medium transition',
            mode === 'general'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-400 hover:text-slate-100'
          )}
        >
          <FaListUl size={11} />
          <span className="sr-only">{t('navigation.allTasks')}</span>
          {showShortcuts && <KeyboardShortcut text="G" showModIcon />}
        </button>
        <button
          type="button"
          aria-label={t('navigation.currentIntentions')}
          title={t('navigation.currentIntentions')}
          aria-pressed={mode === 'intention'}
          disabled={isIntentionDisabled}
          onClick={() => onModeChange('intention')}
          className={clsx(
            'relative flex h-8 w-8 items-center justify-center rounded text-[11px] font-medium transition',
            isIntentionDisabled
              ? 'cursor-not-allowed text-slate-600'
              : mode === 'intention'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-100'
          )}
        >
          <FaBullseye size={11} />
          <span className="sr-only">{t('navigation.currentIntentions')}</span>
          {showShortcuts && <KeyboardShortcut text="I" showModIcon />}
        </button>
      </div>
    </div>
  );
}
