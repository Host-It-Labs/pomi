import {
  createContext,
  useContext,
  ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { FaTimes } from 'react-icons/fa';
import { useI18n } from '../../i18n';
import { useOpenModalRegistration } from '../../utils/modalRegistry';

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

export interface ModalProps {
  presentation?: 'dialog' | 'sheet';
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
  presentation,
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
  const panelRef = useRef<HTMLDivElement>(null);
  const [expandedSheet, setExpandedSheet] = useState(false);
  useLayoutEffect(() => {
    if (!isOpen) {
      setExpandedSheet(false);
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first =
      panel?.querySelector<HTMLElement>(
        '[autofocus], input:not([disabled]), textarea:not([disabled])'
      ) ?? panel?.querySelector<HTMLElement>('button:not([disabled])');
    if (presentation === 'sheet') first?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [isOpen, presentation]);

  const [sheetViewport, setSheetViewport] = useState<{
    height: number;
    top: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (!isOpen || presentation !== 'sheet') return;
    const update = () =>
      setSheetViewport({
        height: window.visualViewport?.height ?? window.innerHeight,
        top: window.visualViewport?.offsetTop ?? 0,
      });
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [isOpen, presentation]);

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
      className={`fixed inset-0 z-[1000] flex justify-center bg-black/30 ${presentation === 'sheet' ? 'items-end sheet-backdrop' : 'items-center p-6'}`}
      onClick={closeOnBackdropClick ? onClose : undefined}
      style={
        presentation === 'sheet' && sheetViewport
          ? {
              height: sheetViewport.height,
              top: sheetViewport.top,
              bottom: 'auto',
            }
          : undefined
      }
      role="presentation"
    >
      <div
        ref={panelRef}
        data-testid="modal-panel"
        data-presentation={presentation}
        style={
          presentation === 'sheet' && sheetViewport
            ? { maxHeight: sheetViewport.height - 12 }
            : undefined
        }
        data-expanded={expandedSheet}
        tabIndex={-1}
        onKeyDown={event => {
          if (event.key !== 'Tab') return;
          const focusable = Array.from(
            panelRef.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'
            ) ?? []
          ).filter(node => node.getClientRects().length > 0);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first) {
            event.preventDefault();
            panelRef.current?.focus();
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
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
              <h2 className="text-lg font-semibold text-ink">{title}</h2>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-1">
              {headerActions}
              {resolvedShowCloseButton ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="relative cursor-pointer rounded-full p-2 text-slate-400 transition-colors hover:text-ink"
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
          <SheetExpansionContext.Provider
            value={{
              expanded: expandedSheet,
              toggle: () => setExpandedSheet(value => !value),
            }}
          >
            {children}
          </SheetExpansionContext.Provider>
        </div>
      </div>
    </div>,
    document.body
  );
}

const SheetExpansionContext = createContext<{
  expanded: boolean;
  toggle: () => void;
} | null>(null);

export function SheetOptions() {
  const context = useContext(SheetExpansionContext);
  const { t } = useI18n();
  if (!context) return null;
  return (
    <button
      type="button"
      className="sheet-options"
      aria-expanded={context.expanded}
      onClick={context.toggle}
    >
      {context.expanded ? t('workspace.fewerOptions') : t('common.moreOptions')}
    </button>
  );
}
