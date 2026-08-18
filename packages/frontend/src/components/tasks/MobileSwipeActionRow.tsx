import clsx from 'clsx';
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { FaArchive, FaCheck } from 'react-icons/fa';

const ACTION_THRESHOLD = 72;
const MAX_OFFSET = 112;
const DIRECTION_LOCK_DISTANCE = 8;

type GestureDirection = 'horizontal' | 'vertical' | null;

export function MobileSwipeActionRow({
  children,
  disabled,
  onComplete,
  onArchive,
  className,
}: {
  children: ReactNode;
  disabled: boolean;
  onComplete?: () => void | Promise<void>;
  onArchive: () => void;
  className?: string;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);
  const offsetRef = useRef(0);
  const suppressClickRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);
  const gestureRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    direction: GestureDirection;
  } | null>(null);

  const reset = () => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
    }
    const shouldAnimate = offsetRef.current !== 0;
    gestureRef.current = null;
    setDragging(false);
    setSettling(shouldAnimate);
    offsetRef.current = 0;
    setOffset(0);
    if (shouldAnimate) {
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        setSettling(false);
      }, 220);
    }
  };

  const finish = () => {
    if (!gestureRef.current) return;
    const finalOffset = offsetRef.current;
    const shouldComplete = finalOffset >= ACTION_THRESHOLD && onComplete;
    const shouldArchive = finalOffset <= -ACTION_THRESHOLD;
    gestureRef.current = null;
    setDragging(false);

    if (shouldComplete) {
      setSettling(true);
      offsetRef.current = MAX_OFFSET;
      setOffset(MAX_OFFSET);
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        void Promise.resolve(onComplete()).finally(reset);
      }, 130);
      return;
    }
    if (shouldArchive) {
      setSettling(true);
      offsetRef.current = -MAX_OFFSET;
      setOffset(-MAX_OFFSET);
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        onArchive();
        reset();
      }, 130);
      return;
    }
    reset();
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    suppressClickRef.current = false;
    if (disabled) return;
    const target = event.target as HTMLElement;
    const allowsSwipeStart = target.closest('[data-swipe-start]');
    if (
      !allowsSwipeStart &&
      target.closest(
        'button, input, select, textarea, a, [role="button"], [data-swipe-ignore]'
      )
    ) {
      return;
    }
    gestureRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      direction: null,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic accessibility tests may not register an active pointer.
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.x;
    const deltaY = event.clientY - gesture.y;
    if (!gesture.direction) {
      if (
        Math.abs(deltaX) < DIRECTION_LOCK_DISTANCE &&
        Math.abs(deltaY) < DIRECTION_LOCK_DISTANCE
      ) {
        return;
      }
      gesture.direction =
        Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
      if (gesture.direction === 'vertical') {
        gestureRef.current = null;
        return;
      }
      setDragging(true);
      suppressClickRef.current = true;
    }
    if (gesture.direction !== 'horizontal') return;
    const distance = Math.abs(deltaX);
    const resistedDistance =
      distance <= ACTION_THRESHOLD
        ? distance
        : ACTION_THRESHOLD + (distance - ACTION_THRESHOLD) * 0.35;
    const resisted = Math.sign(deltaX) * Math.min(MAX_OFFSET, resistedDistance);
    const nextOffset =
      onComplete || resisted < 0 ? resisted : Math.min(0, resisted);
    offsetRef.current = nextOffset;
    setOffset(nextOffset);
  };

  const progress = Math.min(1, Math.abs(offset) / ACTION_THRESHOLD);
  const showActionLayer = dragging || settling || offset !== 0;

  useEffect(() => {
    if (!dragging) return;
    const cancelHorizontalGesture = () => reset();
    window.addEventListener('scroll', cancelHorizontalGesture, true);
    return () =>
      window.removeEventListener('scroll', cancelHorizontalGesture, true);
  }, [dragging]);

  useEffect(
    () => () => {
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
    },
    []
  );

  return (
    <div
      className={clsx(
        'relative isolate overflow-hidden touch-pan-y [contain:paint]',
        className
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={reset}
      onClickCapture={event => {
        if (!suppressClickRef.current) return;
        suppressClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      data-testid="mobile-swipe-row"
    >
      {showActionLayer && (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-between"
          data-testid="mobile-swipe-actions"
        >
          <div className="flex h-full w-28 items-center gap-2 bg-emerald-600/90 pl-4 text-xs font-semibold text-white">
            <FaCheck
              style={{
                opacity: 0.35 + progress * 0.65,
                transform: `scale(${0.75 + progress * 0.25})`,
              }}
            />
            Complete
          </div>
          <div className="flex h-full w-28 items-center justify-end gap-2 bg-amber-600/90 pr-4 text-xs font-semibold text-white">
            Archive
            <FaArchive
              style={{
                opacity: 0.35 + progress * 0.65,
                transform: `scale(${0.75 + progress * 0.25})`,
              }}
            />
          </div>
        </div>
      )}
      <div
        className={clsx(
          'relative z-10 bg-slate-950',
          (dragging || settling) && 'will-change-transform',
          !dragging &&
            (settling ? 'transition-transform duration-200 ease-out' : '')
        )}
        style={{ transform: `translate3d(${offset}px, 0, 0)` }}
      >
        {children}
      </div>
    </div>
  );
}
