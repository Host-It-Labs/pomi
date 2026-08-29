import { TIMER_STATUSES, TIMER_TYPES } from '@pomi/shared/src/constants';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MinimizedIntentionsPicker } from '../components/MinimizedIntentionsPicker';
import { MinimizedTaskView } from '../components/MinimizedTaskView';
import { SessionIndicator } from '../components/SessionIndicator';
import { TimerActionButtons } from '../components/TimerActionButtons';
import { IntentionEmojiPair } from '../components/ui/IntentionEmojiPair';
import { KeyboardShortcut } from '../components/ui/KeyboardShortcut';
import { COLORS } from '../config/colors';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';
import { hasOpenModal } from '../utils/modalRegistry';
import { getDisplayedSessionPosition } from '../utils/sessionDisplay';
import { getSelectedTimerIntentions } from '../utils/timerIntentions';
import { formatTime } from '../utils/timeUtils';
import { areMinimizedPickerInsetsEqual } from '../utils/minimizedIntentionsLayout';

export function MinimizedTimer() {
  const timer = useTimerStore.use.timer();
  const extensionState = useTimerStore.use.extensionState();
  const connectionStatus = useTimerStore.use.connectionStatus();
  const toggleTimerAction = useTimerStore.use.toggleTimer();
  const preferences = usePreferencesStore.use.preferences();
  const advancedSkipModalOpen = useUiStore.use.advancedSkipModalOpen();
  const intentionPickerOpenRequest =
    useUiStore.use.intentionPickerOpenRequest();
  const [showEmoji, setShowEmoji] = useState(false);
  const [intentionsPickerOpen, setIntentionsPickerOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const timerSlotRef = useRef<HTMLDivElement | null>(null);
  const actionSlotRef = useRef<HTMLDivElement | null>(null);
  const lastIntentionPickerOpenRequestRef = useRef(intentionPickerOpenRequest);
  const [pickerInset, setPickerInset] = useState({ left: 0, right: 0 });
  const isDisconnected =
    !connectionStatus.isConnected || connectionStatus.isReconnecting;
  const displayedSessionPosition = getDisplayedSessionPosition(timer);
  const selectedIntentionEmojis = getSelectedTimerIntentions(timer)
    .map(slug => ({
      slug,
      parent:
        timer?.intentionEmojis?.[slug] ??
        (slug === timer?.intention ? timer?.intentionEmoji : undefined),
      sub:
        timer?.subIntentionEmojis?.[slug] ??
        (slug === timer?.intention ? timer?.subIntentionEmoji : undefined),
    }))
    .filter(item => item.parent || item.sub);

  const textColorClass =
    timer?.type === TIMER_TYPES.WORK
      ? COLORS.indigo.text
      : timer?.type === TIMER_TYPES.LONG_BREAK
        ? COLORS.purple.secondaryText
        : COLORS.green.secondaryText;

  const showSessionIndicator =
    preferences?.sessionsExtension &&
    displayedSessionPosition &&
    timer?.sessionTotal &&
    timer?.type === TIMER_TYPES.WORK &&
    timer?.status !== TIMER_STATUSES.PAUSED;

  const showIntentionsPicker =
    preferences?.intentionExtension &&
    (timer?.type === TIMER_TYPES.WORK ||
      (timer?.type === TIMER_TYPES.BREAK &&
        preferences?.intentionBreakIntentions) ||
      timer?.type === TIMER_TYPES.LONG_BREAK ||
      (timer?.status === TIMER_STATUSES.COMPLETED &&
        (timer?.type === TIMER_TYPES.BREAK ||
          timer?.type === TIMER_TYPES.LONG_BREAK)));
  const hideActionButtons = false;
  const showMinimizedTaskView =
    preferences?.tasksExtension &&
    preferences.tasksShowInMinimizedTimer &&
    (timer?.type === TIMER_TYPES.WORK ||
      ((timer?.type === TIMER_TYPES.BREAK ||
        timer?.type === TIMER_TYPES.LONG_BREAK) &&
        preferences.tasksDuringBreaks)) &&
    !timer?.isExtension;

  const toggleTimer = () => {
    if (isDisconnected) {
      return;
    }
    toggleTimerAction();
  };

  const openIntentionsPicker = () => {
    if (showIntentionsPicker && !advancedSkipModalOpen) {
      setIntentionsPickerOpen(true);
    }
  };

  // Add effect to handle fade-in animation when timer is running
  useEffect(() => {
    if (preferences?.intentionExtension === false) {
      setShowEmoji(false);
      return;
    }

    if (timer?.status === TIMER_STATUSES.RUNNING) {
      setShowEmoji(false);
      setTimeout(() => setShowEmoji(true), 100);
      return;
    }

    if (timer?.status === TIMER_STATUSES.PAUSED) {
      setShowEmoji(true);
      return;
    }

    setShowEmoji(false);
  }, [preferences?.intentionExtension, timer?.status]);

  useEffect(() => {
    if (!showIntentionsPicker || advancedSkipModalOpen) {
      setIntentionsPickerOpen(false);
    }
  }, [advancedSkipModalOpen, showIntentionsPicker]);

  useEffect(() => {
    if (
      intentionPickerOpenRequest === lastIntentionPickerOpenRequestRef.current
    ) {
      return;
    }
    lastIntentionPickerOpenRequestRef.current = intentionPickerOpenRequest;
    if (showIntentionsPicker && !advancedSkipModalOpen && !hasOpenModal()) {
      setIntentionsPickerOpen(true);
    }
  }, [advancedSkipModalOpen, intentionPickerOpenRequest, showIntentionsPicker]);

  useEffect(() => {
    if (!preferences?.keyboardShortcuts || !showIntentionsPicker) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        advancedSkipModalOpen ||
        hasOpenModal()
      ) {
        return;
      }

      const isModPressed = event.metaKey || event.ctrlKey;
      if (
        isModPressed &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === '0' || event.code === 'KeyI')
      ) {
        event.preventDefault();
        setIntentionsPickerOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    advancedSkipModalOpen,
    preferences?.keyboardShortcuts,
    showIntentionsPicker,
  ]);

  useLayoutEffect(() => {
    const updatePickerInset = () => {
      if (!rootRef.current || !timerSlotRef.current || !actionSlotRef.current) {
        setPickerInset({ left: 0, right: 0 });
        return;
      }

      const rootBox = rootRef.current.getBoundingClientRect();
      const timerBox = timerSlotRef.current.getBoundingClientRect();
      const actionBox = actionSlotRef.current.getBoundingClientRect();
      const protectedActionButtons = Array.from(
        actionSlotRef.current.querySelectorAll('button')
      ).filter(button => {
        const label = button.getAttribute('aria-label') ?? '';
        const style = window.getComputedStyle(button);
        return (
          style.opacity !== '0' &&
          (label === 'Open extension options' ||
            label === 'Pause Timer' ||
            label === 'Start Timer' ||
            label === 'Resume Work' ||
            label === 'Resume Break' ||
            label === 'Start Work Timer' ||
            label === 'Expand Application')
        );
      });
      const protectedActionLeft =
        protectedActionButtons.length > 0
          ? Math.min(
              ...protectedActionButtons.map(
                button => button.getBoundingClientRect().left
              )
            )
          : actionBox.left;

      const nextPickerInset = {
        left: Math.max(0, Math.ceil(timerBox.right - rootBox.left + 6)),
        right: Math.max(0, Math.ceil(rootBox.right - protectedActionLeft + 6)),
      };

      setPickerInset(currentInset =>
        areMinimizedPickerInsetsEqual(currentInset, nextPickerInset)
          ? currentInset
          : nextPickerInset
      );
    };

    updatePickerInset();
    let animationFrame: number | null = null;
    const schedulePickerInsetUpdate = () => {
      if (animationFrame !== null) {
        return;
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        updatePickerInset();
      });
    };
    window.addEventListener('resize', schedulePickerInsetUpdate);
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(schedulePickerInsetUpdate);
    [rootRef.current, timerSlotRef.current, actionSlotRef.current].forEach(
      element => element && resizeObserver?.observe(element)
    );
    const settleTimeout = window.setTimeout(updatePickerInset, 450);

    return () => {
      window.removeEventListener('resize', schedulePickerInsetUpdate);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      resizeObserver?.disconnect();
      window.clearTimeout(settleTimeout);
    };
  }, [
    advancedSkipModalOpen,
    intentionsPickerOpen,
    showIntentionsPicker,
    extensionState,
    timer?.isExtension,
    timer?.status,
  ]);

  return (
    <div
      ref={rootRef}
      className={clsx(
        'relative flex w-full h-full',
        showMinimizedTaskView
          ? 'items-start justify-between pt-[32px]'
          : 'items-center justify-between'
      )}
    >
      <div
        id="assistant-session-slot-compact"
        className="absolute right-2 top-1 z-40"
      />
      <div
        id="feedback-session-slot-compact"
        className="absolute right-12 top-1 z-40"
      />
      <div
        ref={timerSlotRef}
        className={clsx(
          'flex min-w-30 items-center',
          !showMinimizedTaskView && 'translate-y-[4px]'
        )}
      >
        <div className="ml-2.5 flex flex-col items-center justify-center relative">
          {timer?.status !== TIMER_STATUSES.COMPLETED &&
            selectedIntentionEmojis.length > 0 && (
              <div
                data-testid="minimized-selected-intentions"
                onClick={openIntentionsPicker}
                className={`absolute right-[-0.2rem] top-[-0.8rem] z-20 flex flex-row-reverse items-start gap-0.5 text-md cursor-pointer transition-all duration-500 ease-in-out
                ${showEmoji ? 'opacity-100' : 'opacity-0'}`}
              >
                <span className="flex flex-row-reverse items-center gap-0.5 leading-none">
                  {selectedIntentionEmojis.map(item => (
                    <IntentionEmojiPair
                      key={item.slug}
                      parentEmoji={item.parent}
                      subEmoji={item.sub}
                      size="sm"
                    />
                  ))}
                </span>
                <span className="relative mt-[-5px] inline-flex h-3.5 w-3.5">
                  <KeyboardShortcut
                    text="0"
                    position="topRight"
                    showModIcon={false}
                  />
                </span>
              </div>
            )}

          <h1
            aria-disabled={isDisconnected}
            className={`text-4xl font-mono font-bold select-none transition-all ${
              isDisconnected
                ? 'cursor-not-allowed opacity-50'
                : 'cursor-pointer hover:scale-110'
            } ${textColorClass}`}
            onClick={toggleTimer}
          >
            {timer ? formatTime(timer.remainingTime) : '00:00'}
          </h1>

          <AnimatePresence>
            {showSessionIndicator &&
              displayedSessionPosition &&
              timer?.sessionTotal && (
                <motion.div
                  className="absolute -bottom-4"
                  initial={{ opacity: 0, y: -30 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -30 }}
                  transition={{ duration: 0.4, ease: 'easeInOut' }}
                >
                  <SessionIndicator
                    currentPosition={displayedSessionPosition}
                    totalPomodoros={timer.sessionTotal}
                    isDisconnected={isDisconnected}
                    isExpanded={false}
                    stackedSessions={timer.stackedSessions}
                  />
                </motion.div>
              )}
          </AnimatePresence>
        </div>
      </div>

      <div
        className={clsx(
          'pointer-events-none absolute z-20 flex justify-center',
          showMinimizedTaskView
            ? 'top-[32px] h-8 items-start overflow-visible'
            : 'inset-y-0 translate-y-1.5 items-center'
        )}
        style={{ left: pickerInset.left, right: pickerInset.right }}
      >
        {showIntentionsPicker && !advancedSkipModalOpen && (
          <MinimizedIntentionsPicker
            isOpen={intentionsPickerOpen}
            onOpenChange={setIntentionsPickerOpen}
            compactForTasks={showMinimizedTaskView}
          />
        )}
      </div>

      {!hideActionButtons && (
        <div
          ref={actionSlotRef}
          className={clsx(
            'mr-2.5 flex justify-end',
            !showMinimizedTaskView && 'translate-y-[4px]'
          )}
        >
          <TimerActionButtons
            compactMinimizedControls={
              showIntentionsPicker &&
              !advancedSkipModalOpen &&
              intentionsPickerOpen
            }
          />
        </div>
      )}

      {showMinimizedTaskView && (
        <div className="absolute bottom-[6px] left-1.5 right-1.5">
          <MinimizedTaskView compact visibleRowLimit={3} />
        </div>
      )}
    </div>
  );
}
