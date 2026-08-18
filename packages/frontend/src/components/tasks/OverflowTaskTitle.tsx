import clsx from 'clsx';
import { useEffect, useId, useRef, useState } from 'react';

export function OverflowTaskTitle({
  title,
  className,
  testId,
  nativeOnly = false,
  maxLines = 1,
}: {
  title: string;
  className?: string;
  testId?: string;
  nativeOnly?: boolean;
  maxLines?: 1 | 2;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchInteraction = useRef(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const tooltipId = `task-title-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () =>
      setIsOverflowing(
        element.scrollWidth > element.clientWidth + 1 ||
          element.scrollHeight > element.clientHeight + 1
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [title]);

  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
    []
  );

  const showAfterDelay = () => {
    if (
      nativeOnly ||
      !isOverflowing ||
      !window.matchMedia('(hover: hover) and (pointer: fine)').matches
    ) {
      return;
    }
    hoverTimer.current = setTimeout(() => setIsVisible(true), 500);
  };
  const hide = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setIsVisible(false);
  };

  return (
    <div
      className="relative min-w-0"
      onPointerDown={event => {
        touchInteraction.current = event.pointerType === 'touch';
      }}
      onMouseEnter={showAfterDelay}
      onMouseLeave={hide}
      onFocus={() =>
        isOverflowing && !touchInteraction.current && setIsVisible(true)
      }
      onBlur={() => {
        touchInteraction.current = false;
        hide();
      }}
    >
      <div
        ref={ref}
        tabIndex={isOverflowing && !nativeOnly ? 0 : undefined}
        title={nativeOnly && isOverflowing ? title : undefined}
        aria-describedby={isVisible ? tooltipId : undefined}
        data-testid={testId}
        className={clsx(
          'outline-none',
          maxLines === 1 ? 'truncate' : 'line-clamp-2 whitespace-normal',
          className
        )}
      >
        {title}
      </div>
      {!nativeOnly && isOverflowing && isVisible && (
        <div
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-0 z-50 mb-1 max-w-72 whitespace-normal rounded-md bg-slate-950 px-2 py-1.5 text-[11px] font-medium leading-4 text-slate-100 shadow-xl ring-1 ring-slate-700/80"
        >
          {title}
        </div>
      )}
    </div>
  );
}
