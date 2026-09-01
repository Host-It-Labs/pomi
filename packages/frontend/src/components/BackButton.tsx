import { useCallback } from 'react';
import { FaArrowLeft } from 'react-icons/fa';
import { useBackNavigation } from '../hooks/useBackNavigation';
import { useUiStore } from '../stores/uiStore';
import { useI18n } from '../i18n';

interface BackButtonProps {
  targetTab: 'timer' | 'settings';
  className?: string;
  wrapperClassName?: string;
  isModalOpen?: boolean;
  onModalClose?: () => void;
}

export function BackButton({
  targetTab,
  className,
  wrapperClassName,
  isModalOpen,
  onModalClose,
}: BackButtonProps) {
  const setActiveTab = useUiStore.use.setActiveTab();
  const { t } = useI18n();
  const destination =
    targetTab === 'timer'
      ? t('common.backToTimer')
      : t('common.backToSettings');

  const handleBack = useCallback(() => {
    setActiveTab(targetTab);
  }, [setActiveTab, targetTab]);

  useBackNavigation({ onBack: handleBack, isModalOpen, onModalClose });

  return (
    <div
      className={`${wrapperClassName || 'mb-4 shrink-0'} flex items-center gap-5`}
    >
      <button
        onClick={handleBack}
        aria-label={destination}
        data-testid="back-button"
        className={
          className ||
          'flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors cursor-pointer'
        }
      >
        <FaArrowLeft size={12} />
        <span>{t('common.back')}</span>
      </button>
      <div id="assistant-session-slot-page" className="shrink-0" />
      <div id="feedback-session-slot-page" className="shrink-0" />
    </div>
  );
}
