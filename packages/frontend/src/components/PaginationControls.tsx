import clsx from 'clsx';
import type { ReactNode } from 'react';
import {
  FaChevronDown,
  FaChevronLeft,
  FaChevronRight,
  FaChevronUp,
} from 'react-icons/fa';
import { KeyboardShortcut } from './ui/KeyboardShortcut';

type PaginationDirection = 'horizontal' | 'vertical';

interface PaginationControlsProps {
  pageIndex: number;
  pageCount: number;
  onPrevious: () => void;
  onNext: () => void;
  direction?: PaginationDirection;
  previousLabel: string;
  nextLabel: string;
  showShortcuts?: boolean;
  alwaysShowShortcuts?: boolean;
  previousBadge?: ReactNode;
  nextBadge?: ReactNode;
  children?: ReactNode;
  className?: string;
  buttonSizeClassName?: string;
  buttonClassName?: string;
  countClassName?: string;
  iconSize?: number;
  reserveSpace?: boolean;
  showSinglePageControls?: boolean;
}

export function PaginationControls({
  pageIndex,
  pageCount,
  onPrevious,
  onNext,
  direction = 'horizontal',
  previousLabel,
  nextLabel,
  showShortcuts = true,
  alwaysShowShortcuts = false,
  previousBadge,
  nextBadge,
  children,
  className,
  buttonSizeClassName = 'h-7 w-7',
  buttonClassName,
  countClassName,
  iconSize = 16,
  reserveSpace = false,
  showSinglePageControls = false,
}: PaginationControlsProps) {
  if (pageCount <= 1 && !showSinglePageControls) {
    if (reserveSpace) {
      return (
        <div
          aria-hidden="true"
          className={clsx(
            'invisible flex items-center justify-center gap-4',
            className
          )}
        >
          <span
            className={clsx(buttonSizeClassName, 'rounded-md', buttonClassName)}
          />
          {children ?? (
            <span
              className={clsx(
                'min-w-8 text-center text-xs text-slate-400',
                countClassName
              )}
            >
              1/1
            </span>
          )}
          <span
            className={clsx(buttonSizeClassName, 'rounded-md', buttonClassName)}
          />
        </div>
      );
    }

    return null;
  }

  const isVertical = direction === 'vertical';
  const normalizedPageCount = Math.max(1, pageCount);
  const normalizedPageIndex = Math.min(
    Math.max(0, pageIndex),
    normalizedPageCount - 1
  );
  const previousDisabled = normalizedPageIndex <= 0;
  const nextDisabled = normalizedPageIndex >= normalizedPageCount - 1;
  const PreviousIcon = isVertical ? FaChevronUp : FaChevronLeft;
  const NextIcon = isVertical ? FaChevronDown : FaChevronRight;
  const previousShortcut = isVertical ? '↑' : '←';
  const nextShortcut = isVertical ? '↓' : '→';

  const buttonClasses = clsx(
    'relative flex items-center justify-center rounded-md transition-colors',
    buttonSizeClassName,
    buttonClassName
  );

  return (
    <div className={clsx('flex items-center justify-center gap-4', className)}>
      <button
        type="button"
        aria-label={previousLabel}
        title={previousLabel}
        onClick={onPrevious}
        disabled={previousDisabled}
        className={clsx(
          buttonClasses,
          previousDisabled
            ? 'text-slate-500'
            : 'text-slate-300 hover:bg-slate-800/50 hover:text-ink'
        )}
      >
        <PreviousIcon size={iconSize} />
        {showShortcuts && (
          <KeyboardShortcut
            text={previousShortcut}
            position="topRight"
            showModIcon={false}
            alwaysShow={alwaysShowShortcuts}
          />
        )}
        {previousBadge}
      </button>
      {children ?? (
        <span
          className={clsx(
            'min-w-8 text-center text-xs text-slate-400',
            countClassName
          )}
        >
          {normalizedPageIndex + 1}/{normalizedPageCount}
        </span>
      )}
      <button
        type="button"
        aria-label={nextLabel}
        title={nextLabel}
        onClick={onNext}
        disabled={nextDisabled}
        className={clsx(
          buttonClasses,
          nextDisabled
            ? 'text-slate-500'
            : 'text-slate-300 hover:bg-slate-800/50 hover:text-ink'
        )}
      >
        <NextIcon size={iconSize} />
        {showShortcuts && (
          <KeyboardShortcut
            text={nextShortcut}
            position="topRight"
            showModIcon={false}
            alwaysShow={alwaysShowShortcuts}
          />
        )}
        {nextBadge}
      </button>
    </div>
  );
}
