import { ReactNode, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FaTimes } from 'react-icons/fa';
import { useOpenModalRegistration } from '../../utils/modalRegistry';
import { useI18n } from '../../i18n';

let scrollLockCount = 0;
let originalBodyOverflow = '';
let originalDocumentOverflow = '';
let lockedScrollX = 0;
let lockedScrollY = 0;

function restoreDocumentScroll() {
  const scrollingElement = document.scrollingElement as HTMLElement | null;
  if (scrollingElement) {
    scrollingElement.scrollLeft = lockedScrollX;
    scrollingElement.scrollTop = lockedScrollY;
  } else {
    document.documentElement.scrollLeft = lockedScrollX;
    document.documentElement.scrollTop = lockedScrollY;
    document.body.scrollLeft = lockedScrollX;
    document.body.scrollTop = lockedScrollY;
  }
  if (!navigator.userAgent.includes('jsdom')) {
    window.scrollTo({
      left: lockedScrollX,
      top: lockedScrollY,
      behavior: 'auto',
    });
  }
}

function lockDocumentScroll(initialPosition?: { x: number; y: number }) {
  if (scrollLockCount === 0) {
    lockedScrollX = initialPosition?.x ?? window.scrollX;
    lockedScrollY = initialPosition?.y ?? window.scrollY;
    originalBodyOverflow = document.body.style.overflow;
    originalDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    restoreDocumentScroll();
    window.requestAnimationFrame(restoreDocumentScroll);
  }
  scrollLockCount += 1;

  return () => {
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount === 0) {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalDocumentOverflow;
      restoreDocumentScroll();
      window.requestAnimationFrame(restoreDocumentScroll);
    }
  };
}

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  ariaLabel?: string;
  showCloseButton?: boolean;
  headerActions?: ReactNode;
  closeOnBackdropClick: boolean;
  closeOnEscape: boolean;
  className?: string;
  children: ReactNode;
}

export function Modal({
  isOpen,
  onClose,
  title,
  ariaLabel,
  showCloseButton,
  headerActions,
  closeOnBackdropClick,
  closeOnEscape,
  className,
  children,
}: ModalProps) {
  const { t } = useI18n();
  const resolvedShowCloseButton = showCloseButton ?? true;
  const titleLabel = typeof title === 'string' ? title : undefined;
  const openingScrollPositionRef = useRef<{ x: number; y: number } | null>(
    null
  );
  if (isOpen && !openingScrollPositionRef.current) {
    openingScrollPositionRef.current = { x: window.scrollX, y: window.scrollY };
  } else if (!isOpen) {
    openingScrollPositionRef.current = null;
  }

  useOpenModalRegistration(isOpen, onClose, closeOnEscape);

  useLayoutEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    return lockDocumentScroll(openingScrollPositionRef.current ?? undefined);
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-6"
      onClick={closeOnBackdropClick ? onClose : undefined}
      role="presentation"
    >
      <div
        data-testid="modal-panel"
        className={`relative z-[1001] flex max-h-[calc(100dvh-3rem)] w-full max-w-md flex-col overflow-hidden rounded-xl bg-slate-900 p-6 shadow-xl ${
          className || ''
        }`.trim()}
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? titleLabel ?? t('common.modal')}
      >
        {title || headerActions || resolvedShowCloseButton ? (
          <div className="mb-4 flex shrink-0 items-center justify-between">
            {title ? (
              <h2 className="text-lg font-semibold text-white">{title}</h2>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-1">
              {headerActions}
              {resolvedShowCloseButton ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="relative cursor-pointer rounded-full p-2 text-slate-400 transition-colors hover:text-white"
                  aria-label={t('common.close')}
                  title={t('common.close')}
                >
                  <FaTimes />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div
          data-testid="modal-scroll-body"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
