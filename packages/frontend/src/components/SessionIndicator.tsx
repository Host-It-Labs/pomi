import clsx from 'clsx';
import { useState } from 'react';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useTimerStore } from '../stores/timerStore';
import { isDesktop, isMac } from '../utils/osUtils';
import { KeyboardShortcut } from './ui/KeyboardShortcut';

interface SessionIndicatorProps {
  currentPosition: number;
  totalPomodoros: number;
  isDisconnected: boolean;
  isExpanded?: boolean;
  stackedSessions?: number;
}

export function SessionIndicator({
  currentPosition,
  totalPomodoros,
  isDisconnected,
  isExpanded = true,
  stackedSessions,
}: SessionIndicatorProps) {
  const setSessionPosition = useTimerStore.use.setSessionPosition();
  const preferences = usePreferencesStore.use.preferences();
  const [hoveredDot, setHoveredDot] = useState<number | null>(null);

  const handleDotClick = (position: number) => {
    if (!isDisconnected && position !== currentPosition) {
      setSessionPosition(position);
    }
  };

  const isStacked = stackedSessions && stackedSessions > 1;

  return (
    <div
      className={clsx(
        'flex items-center justify-center',
        isExpanded ? 'gap-2 py-2' : 'gap-1.5 py-1'
      )}
      data-testid={isExpanded ? 'session-dots-expanded' : 'session-dots'}
    >
      {Array.from({ length: totalPomodoros }).map((_, index) => {
        const position = index + 1;
        const isActive = position === currentPosition;
        const isCompleted = position < currentPosition;
        const isHovered = hoveredDot === position;

        return (
          <div
            key={index}
            className={clsx(
              'flex items-center justify-center relative',
              isExpanded ? 'w-5 h-5' : 'w-3.5 h-3.5'
            )}
          >
            <button
              onClick={() => handleDotClick(position)}
              onMouseEnter={() => isDesktop && setHoveredDot(position)}
              onMouseLeave={() => isDesktop && setHoveredDot(null)}
              disabled={isDisconnected}
              data-active={isActive ? 'true' : 'false'}
              data-session-position={position}
              data-testid={isExpanded ? 'session-dot-expanded' : 'session-dot'}
              className={clsx(
                'rounded-full transition-all duration-200',
                isDisconnected
                  ? 'cursor-not-allowed opacity-50'
                  : isDesktop && 'cursor-pointer hover:scale-125',
                isExpanded
                  ? clsx(
                      isActive ? 'w-4 h-4' : 'w-3 h-3',
                      isActive && !isStacked && 'bg-indigo-600 animate-pulse',
                      isActive && isStacked && 'bg-amber-500 animate-pulse',
                      isCompleted && 'bg-indigo-400',
                      isHovered && !isActive && 'bg-indigo-500',
                      !isActive && !isCompleted && !isHovered && 'bg-gray-600'
                    )
                  : clsx(
                      isActive ? 'w-2.5 h-2.5' : 'w-1.5 h-1.5',
                      isActive && !isStacked && 'bg-indigo-600 animate-pulse',
                      isActive && isStacked && 'bg-amber-500 animate-pulse',
                      isCompleted && 'bg-indigo-400',
                      isHovered && !isActive && 'bg-indigo-500',
                      !isActive && !isCompleted && !isHovered && 'bg-gray-600'
                    )
              )}
              title={
                isActive && isStacked
                  ? `Stacked Pomi (${stackedSessions}x) - ${position} of ${totalPomodoros}`
                  : `Pomi ${position} of ${totalPomodoros}`
              }
            />
            {isActive && isStacked && isExpanded && (
              <span className="absolute -top-1 -right-1 text-[10px] font-bold text-amber-400">
                {stackedSessions}x
              </span>
            )}
            {isDesktop &&
              isExpanded &&
              preferences?.keyboardShortcuts &&
              position <= 9 && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10">
                  <KeyboardShortcut
                    text={`${isMac ? '⌥' : 'Alt+'}${position}`}
                    showModIcon={false}
                    position="indicator"
                  />
                </div>
              )}
          </div>
        );
      })}
    </div>
  );
}
