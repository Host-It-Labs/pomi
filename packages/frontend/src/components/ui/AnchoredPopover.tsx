import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export function AnchoredPopover({
  isOpen,
  onOpenChange,
  trigger,
  children,
  className,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  className: string;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });

  useLayoutEffect(() => {
    if (!isOpen) return;
    const updatePosition = () => {
      const anchor = rootRef.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;
      const anchorRect = anchor.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const edge = 8;
      const gap = 6;
      const opensUp =
        window.innerHeight - anchorRect.bottom < popoverRect.height + gap &&
        anchorRect.top >= popoverRect.height + gap;
      const top = opensUp
        ? anchorRect.top - popoverRect.height - gap
        : anchorRect.bottom + gap;
      setPosition({
        left: Math.max(
          edge,
          Math.min(
            anchorRect.right - popoverRect.width,
            window.innerWidth - popoverRect.width - edge
          )
        ),
        top: Math.max(
          edge,
          Math.min(top, window.innerHeight - popoverRect.height - edge)
        ),
      });
    };
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        onOpenChange(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
    };
    const closeOnScroll = () => onOpenChange(false);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape, true);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape, true);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [isOpen, onOpenChange]);

  return (
    <span ref={rootRef} className="inline-flex">
      {trigger}
      {isOpen
        ? createPortal(
            <div
              ref={popoverRef}
              role="menu"
              className={`fixed z-[1200] ${className}`}
              style={position}
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}
