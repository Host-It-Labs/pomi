import { TimerSkipLogMode } from '@pomi/shared';
import { TIMER_STATUSES, TIMER_TYPES } from '@pomi/shared/src/constants';
import { AnimatePresence, motion } from 'framer-motion';
import { PointerEvent, useEffect, useRef } from 'react';
import {
  FaExpandAlt,
  FaForward,
  FaPause,
  FaPlay,
  FaPlusCircle,
} from 'react-icons/fa';
import { FaRepeat } from 'react-icons/fa6';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';
import { shouldOpenAdvancedSkipModal } from '../utils/advancedSkip';
import { AdvancedSkipModal } from './AdvancedSkipModal';
import { AdvancedSkipInlineStrip } from './AdvancedSkipInlineStrip';
import { isLinux } from '../utils/osUtils';
import { IconButton } from './ui/IconButton';
import { IntentionEmojiPair } from './ui/IntentionEmojiPair';
import { KeyboardShortcut } from './ui/KeyboardShortcut';
import { useI18n } from '../i18n';
import { canStackSessionTimer } from '../utils/sessionStacking';

type TimerActionButtonsProps = {
  size?: 'sm' | 'md' | 'lg';
  isDisconnected?: boolean;
  hideSkipButton?: boolean;
  compactMinimizedControls?: boolean;
};

export function TimerActionButtons({
  size = 'md',
  isDisconnected = false,
  hideSkipButton = false,
  compactMinimizedControls,
}: TimerActionButtonsProps) {
  const { t } = useI18n();
  const pauseTimer = useTimerStore.use.pauseTimer();
  const resetTimer = useTimerStore.use.resetTimer();
  const createOrResumeTimer = useTimerStore.use.createOrResumeTimer();
  const skipTimer = useTimerStore.use.skipTimer();
  const timer = useTimerStore.use.timer();
  const addFiveMinutesTimer = useTimerStore.use.addFiveMinutesTimer();
  const stackTimer = useTimerStore.use.stackTimer();
  const expanded = useUiStore.use.expanded();
  const setExpanded = useUiStore.use.setExpanded();
  const preferences = usePreferencesStore.use.preferences();
  const addLongPressTimer = useRef<NodeJS.Timeout | null>(null);
  const addLongPressTriggered = useRef(false);
  const advancedSkipModalOpen = useUiStore.use.advancedSkipModalOpen();
  const setAdvancedSkipModalOpen = useUiStore.use.setAdvancedSkipModalOpen();
  const advancedSkipStartPending = useUiStore.use.advancedSkipStartPending();
  const setAdvancedSkipStartPending =
    useUiStore.use.setAdvancedSkipStartPending();
  const extensionState = useTimerStore.use.extensionState();
  const setTimerExtensionModalOpen =
    useUiStore.use.setTimerExtensionModalOpen();

  const canStackTimer = canStackSessionTimer(timer, preferences);

  useEffect(() => {
    return () => {
      if (addLongPressTimer.current) {
        clearTimeout(addLongPressTimer.current);
      }

      setAdvancedSkipStartPending(false);
      setAdvancedSkipModalOpen(false);
    };
  }, [setAdvancedSkipModalOpen, setAdvancedSkipStartPending]);

  useEffect(() => {
    if (!advancedSkipModalOpen) {
      return;
    }

    if (!timer || !preferences?.advancedSkip) {
      setAdvancedSkipModalOpen(false);
    }
  }, [
    advancedSkipModalOpen,
    preferences?.advancedSkip,
    setAdvancedSkipModalOpen,
    timer,
  ]);

  useEffect(() => {
    if (!advancedSkipStartPending) {
      return;
    }

    if (!preferences?.advancedSkip || !timer) {
      setAdvancedSkipStartPending(false);
      return;
    }

    if (
      timer.status === TIMER_STATUSES.RUNNING ||
      timer.status === TIMER_STATUSES.COMPLETED
    ) {
      setAdvancedSkipStartPending(false);
    }
  }, [
    advancedSkipStartPending,
    preferences?.advancedSkip,
    setAdvancedSkipStartPending,
    timer,
  ]);

  // Handle start or resume button
  const handleStartResume = () => {
    if (isDisconnected) return;
    if (preferences?.advancedSkip) {
      setAdvancedSkipStartPending(true);
    }
    createOrResumeTimer();
  };

  const handleSkipTimer = (logMode?: TimerSkipLogMode) => {
    if (isDisconnected || !timer) return;
    const nextLogMode = logMode ?? 'none';
    setAdvancedSkipStartPending(false);
    setAdvancedSkipModalOpen(false);
    skipTimer(nextLogMode);
  };

  const handleAddFiveMinutesDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    if (isDisconnected) return;
    addLongPressTriggered.current = false;

    if (canStackTimer) {
      addLongPressTimer.current = setTimeout(() => {
        addLongPressTimer.current = null;
        addLongPressTriggered.current = true;
        stackTimer();
      }, 500);
    }
  };

  const handleAddFiveMinutesUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    if (addLongPressTimer.current) {
      clearTimeout(addLongPressTimer.current);
      addLongPressTimer.current = null;
    }

    if (!addLongPressTriggered.current && !isDisconnected) {
      addFiveMinutesTimer();
    }
  };

  const handleAddFiveMinutesLeave = () => {
    if (addLongPressTimer.current) {
      clearTimeout(addLongPressTimer.current);
      addLongPressTimer.current = null;
    }
  };

  const handleSkipClick = () => {
    if (isDisconnected || !timer) {
      return;
    }

    const shouldPromptOnSkipNow =
      shouldOpenAdvancedSkipModal(timer, preferences) ||
      (!!preferences?.advancedSkip &&
        useUiStore.getState().advancedSkipStartPending);

    if (shouldPromptOnSkipNow) {
      setAdvancedSkipModalOpen(true);
      return;
    }

    handleSkipTimer();
  };

  const handleResetTimer = () => {
    if (isDisconnected) return;
    setAdvancedSkipStartPending(false);
    resetTimer();
  };

  const handlePauseTimer = () => {
    if (isDisconnected) return;
    pauseTimer();
  };

  const handleOpenTimerExtension = () => {
    if (isDisconnected || !extensionState) return;
    setTimerExtensionModalOpen(true);
  };

  // Determine button states and labels
  const isTimerRunning = timer?.status === TIMER_STATUSES.RUNNING;
  const isExtensionTimer = !!timer?.isExtension;
  const showStartButton = !isTimerRunning;
  const showMinimizedExtensionButton =
    !expanded && !!extensionState && timer?.status === TIMER_STATUSES.PAUSED;
  const showLeftButtons =
    !compactMinimizedControls &&
    (preferences?.intentionExtension === false
      ? true
      : isTimerRunning && !expanded);

  // Determine button text based on context
  const getStartButtonText = () => {
    if (!timer || timer.status === TIMER_STATUSES.COMPLETED) {
      return t('timer.startWork');
    }
    if (timer.status === TIMER_STATUSES.PAUSED) {
      return timer.type === TIMER_TYPES.WORK
        ? t('timer.resumeWork')
        : t('timer.resumeBreak');
    }
    return t('timer.start');
  };

  // Size classes for spacing and icon sizes
  const sizeClasses = {
    sm: 'space-x-3',
    md: 'space-x-3',
    lg: 'space-x-4',
  };

  // When collapsed and skip modal is open, show inline strip instead
  const showInlineStrip = !expanded && advancedSkipModalOpen && !!timer;
  const minimizedTimerExtensionButton = showMinimizedExtensionButton ? (
    <IconButton
      onClick={handleOpenTimerExtension}
      label={t('timer.openExtensionOptions')}
      variant="secondary"
      disabled={isDisconnected}
      size={size}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-4 w-4 items-center justify-center text-base leading-none"
      >
        {extensionState?.intentionEmoji || extensionState?.subIntentionEmoji ? (
          <IntentionEmojiPair
            parentEmoji={extensionState?.intentionEmoji}
            subEmoji={extensionState?.subIntentionEmoji}
            size="sm"
          />
        ) : (
          '⏱️'
        )}
      </span>
      <KeyboardShortcut text="D" showModIcon={false} />
    </IconButton>
  ) : null;
  const minimizedPausedSkipButton =
    !expanded && !showLeftButtons && timer?.status === TIMER_STATUSES.PAUSED ? (
      <IconButton
        onClick={handleSkipClick}
        label={t('timer.skipTo', {
          target:
            timer.type === TIMER_TYPES.WORK
              ? t('common.break')
              : t('common.work'),
        })}
        variant="secondary"
        disabled={isDisconnected}
        size={size}
      >
        <FaForward />
        <KeyboardShortcut text="S" showModIcon={false} />
      </IconButton>
    ) : null;

  return (
    <>
      <div
        className={`flex items-center justify-end ${sizeClasses[size]} relative`}
      >
        {showInlineStrip && timer ? (
          <AdvancedSkipInlineStrip
            timer={timer}
            onSelect={handleSkipTimer}
            onCancel={() => setAdvancedSkipModalOpen(false)}
          />
        ) : (
          <>
            <AnimatePresence mode="wait">
              {!expanded && showLeftButtons && !isExtensionTimer && (
                <motion.div
                  className="flex items-center space-x-3"
                  initial={{ opacity: 0, width: 0, marginRight: 0 }}
                  animate={{
                    opacity: 1,
                    width: 'auto',
                    marginRight: '0.75rem',
                  }}
                  exit={{ opacity: 0, width: 0, marginRight: 0 }}
                  transition={{ duration: 0.4, ease: 'easeInOut' }}
                >
                  <IconButton
                    onClick={handleResetTimer}
                    label={t('timer.reset')}
                    variant="secondary"
                    size={size}
                    disabled={isDisconnected}
                  >
                    <FaRepeat />
                    <KeyboardShortcut text="R" showModIcon={false} />
                  </IconButton>

                  <IconButton
                    onPointerDown={handleAddFiveMinutesDown}
                    onPointerUp={handleAddFiveMinutesUp}
                    onPointerLeave={handleAddFiveMinutesLeave}
                    onPointerCancel={handleAddFiveMinutesLeave}
                    label={
                      canStackTimer
                        ? t('timer.addFiveMinutesHold')
                        : t('timer.addFiveMinutes')
                    }
                    variant="secondary"
                    size={size}
                    disabled={isDisconnected}
                  >
                    <FaPlusCircle />
                    <KeyboardShortcut text="A" showModIcon={false} />
                  </IconButton>
                  <IconButton
                    onClick={handleSkipClick}
                    label={t('timer.skipTo', {
                      target:
                        timer?.type === TIMER_TYPES.WORK
                          ? t('common.break')
                          : t('common.work'),
                    })}
                    variant="secondary"
                    disabled={!timer || isDisconnected}
                    size={size}
                  >
                    <FaForward />
                    <KeyboardShortcut text="S" showModIcon={false} />
                  </IconButton>
                  <div className="inline-block h-10 min-h-[0em] w-0.5 self-stretch bg-slate-700/60" />
                </motion.div>
              )}
              {!expanded && showLeftButtons && isExtensionTimer && (
                <motion.div
                  className="flex items-center space-x-3"
                  initial={{ opacity: 0, width: 0, marginRight: 0 }}
                  animate={{
                    opacity: 1,
                    width: 'auto',
                    marginRight: '0.75rem',
                  }}
                  exit={{ opacity: 0, width: 0, marginRight: 0 }}
                  transition={{ duration: 0.4, ease: 'easeInOut' }}
                >
                  <IconButton
                    onPointerDown={handleAddFiveMinutesDown}
                    onPointerUp={handleAddFiveMinutesUp}
                    onPointerLeave={handleAddFiveMinutesLeave}
                    onPointerCancel={handleAddFiveMinutesLeave}
                    label={t('timer.addFiveMinutes')}
                    variant="secondary"
                    size={size}
                    disabled={isDisconnected}
                  >
                    <FaPlusCircle />
                    <KeyboardShortcut text="A" showModIcon={false} />
                  </IconButton>
                  <IconButton
                    onClick={handleSkipClick}
                    label={t('timer.skipTo', { target: t('common.break') })}
                    variant="secondary"
                    disabled={!timer || isDisconnected}
                    size={size}
                  >
                    <FaForward />
                    <KeyboardShortcut text="S" showModIcon={false} />
                  </IconButton>
                  <div className="inline-block h-10 min-h-[1em] w-0.5 self-stretch bg-slate-700/60" />
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center space-x-3">
              {expanded && !isExtensionTimer && (
                <>
                  <IconButton
                    onClick={handleResetTimer}
                    label={t('timer.reset')}
                    variant="secondary"
                    size={size}
                    disabled={isDisconnected}
                  >
                    <FaRepeat />
                    <KeyboardShortcut text="R" showModIcon={false} />
                  </IconButton>

                  <IconButton
                    onPointerDown={handleAddFiveMinutesDown}
                    onPointerUp={handleAddFiveMinutesUp}
                    onPointerLeave={handleAddFiveMinutesLeave}
                    onPointerCancel={handleAddFiveMinutesLeave}
                    label={
                      canStackTimer
                        ? t('timer.addFiveMinutesHold')
                        : t('timer.addFiveMinutes')
                    }
                    variant="secondary"
                    size={size}
                    disabled={isDisconnected}
                  >
                    <FaPlusCircle />
                    <KeyboardShortcut
                      text={canStackTimer ? `(Shift)A` : 'A'}
                      showModIcon={false}
                    />
                  </IconButton>
                  {!hideSkipButton && (
                    <IconButton
                      onClick={handleSkipClick}
                      label={t('timer.skipTo', {
                        target:
                          timer?.type === TIMER_TYPES.WORK
                            ? t('common.break')
                            : t('common.work'),
                      })}
                      variant="secondary"
                      disabled={!timer || isDisconnected}
                      size={size}
                    >
                      <FaForward />
                      <KeyboardShortcut text="S" showModIcon={false} />
                    </IconButton>
                  )}
                </>
              )}

              {expanded && isExtensionTimer && (
                <>
                  <IconButton
                    onPointerDown={handleAddFiveMinutesDown}
                    onPointerUp={handleAddFiveMinutesUp}
                    onPointerLeave={handleAddFiveMinutesLeave}
                    onPointerCancel={handleAddFiveMinutesLeave}
                    label={t('timer.addFiveMinutes')}
                    variant="secondary"
                    size={size}
                    disabled={isDisconnected}
                  >
                    <FaPlusCircle />
                    <KeyboardShortcut text="A" showModIcon={false} />
                  </IconButton>
                  {!hideSkipButton && (
                    <IconButton
                      onClick={handleSkipClick}
                      label={t('timer.skipTo', { target: t('common.break') })}
                      variant="secondary"
                      disabled={!timer || isDisconnected}
                      size={size}
                    >
                      <FaForward />
                      <KeyboardShortcut text="S" showModIcon={false} />
                    </IconButton>
                  )}
                </>
              )}

              {minimizedTimerExtensionButton}
              {minimizedPausedSkipButton}

              {!expanded &&
                (showStartButton ? (
                  <IconButton
                    onClick={handleStartResume}
                    label={getStartButtonText()}
                    variant="primary"
                    size={size}
                    disabled={isDisconnected}
                  >
                    <FaPlay />
                  </IconButton>
                ) : (
                  <IconButton
                    onClick={handlePauseTimer}
                    label={t('timer.pause')}
                    variant="secondary"
                    size={size}
                    disabled={isDisconnected}
                  >
                    <FaPause />
                  </IconButton>
                ))}

              {!expanded && !isLinux && (
                <IconButton
                  onClick={() => setExpanded()}
                  label={t('timer.expand')}
                  variant="secondary"
                  size={size}
                >
                  <FaExpandAlt />
                  <KeyboardShortcut text="E" showModIcon={false} />
                </IconButton>
              )}
            </div>
          </>
        )}
      </div>

      <AdvancedSkipModal
        isOpen={advancedSkipModalOpen && expanded}
        timer={timer}
        onCancel={() => setAdvancedSkipModalOpen(false)}
        onSelect={handleSkipTimer}
      />
    </>
  );
}
