import { useCallback, useEffect, useRef } from 'react';
import { closeTopmostModal, hasOpenModal } from '../utils/modalRegistry';
import { isDesktop } from '../utils/osUtils';

/**
 * Centralized mobile back-stack handler.
 * Pushes one synthetic history entry per mounted page/overlay.
 * On popstate (mobile swipe-back): calls onBack.
 * On Escape (desktop): calls onBack.
 * Optional isModalOpen/onModalClose for handling modal state before page-level back.
 */
export function useBackNavigation({
  onBack,
  isModalOpen,
  onModalClose,
}: {
  onBack: () => void;
  isModalOpen?: boolean;
  onModalClose?: () => void;
}) {
  const isModalOpenRef = useRef(isModalOpen);
  isModalOpenRef.current = isModalOpen;

  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  const onModalCloseRef = useRef(onModalClose);
  onModalCloseRef.current = onModalClose;

  const handleBack = useCallback(() => {
    if (isModalOpenRef.current && onModalCloseRef.current) {
      onModalCloseRef.current();
    } else {
      onBackRef.current();
    }
  }, []);

  useEffect(() => {
    if (!isDesktop) {
      window.history.pushState({ page: 'detail' }, '');

      const handlePopState = (event: PopStateEvent) => {
        event.preventDefault();
        if (!closeTopmostModal()) handleBack();
        // Re-push so subsequent swipe-backs still work
        window.history.pushState({ page: 'detail' }, '');
      };

      window.addEventListener('popstate', handlePopState);
      return () => {
        window.removeEventListener('popstate', handlePopState);
      };
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (hasOpenModal()) {
        return;
      }

      if (event.key === 'Escape') {
        handleBack();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleBack]);
}
