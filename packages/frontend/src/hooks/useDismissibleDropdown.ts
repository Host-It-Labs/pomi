import { useEffect, useRef } from 'react';
import { hasOpenModal } from '../utils/modalRegistry';

export function useDismissibleDropdown(
  isOpen: boolean,
  onOpenChange: (open: boolean) => void
) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || hasOpenModal())
        return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      rootRef.current?.querySelector('button')?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isOpen, onOpenChange]);
  return rootRef;
}
