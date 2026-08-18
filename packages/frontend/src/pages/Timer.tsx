import type { TimerExtensionResolutionAction } from '@pomi/shared';
import { TIMER_STATUSES, TIMER_TYPES } from '@pomi/shared/src/constants';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  FaCoffee,
  FaCog,
  FaExpandAlt,
  FaPlus,
  FaRedo,
  FaTasks,
  FaTimes,
  FaUndo,
} from 'react-icons/fa';
import { IoStatsChart } from 'react-icons/io5';
import { SessionIndicator } from '../components/SessionIndicator';
import { TimerExtensionModal } from '../components/TimerExtensionModal';
import { MinimizedTaskView } from '../components/MinimizedTaskView';
import { TaskImportModal } from '../components/tasks/TaskImportModal';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { IntentionEmojiPair } from '../components/ui/IntentionEmojiPair';
import { KeyboardShortcut } from '../components/ui/KeyboardShortcut';
import { Modal } from '../components/ui/Modal';
import { useAssistantStore } from '../stores/assistantStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useTasksStore } from '../stores/tasksStore';
import { useTimerStore } from '../stores/timerStore';
import { type HistorySource, useUiStore } from '../stores/uiStore';
import { isDesktop, isIos, isLinux } from '../utils/osUtils';
import { apiClient } from '../utils/apiClient';
import { getDisplayedSessionPosition } from '../utils/sessionDisplay';
import { shouldShowIntentionsPicker } from '../utils/intentionsPickerVisibility';
import { getAdditionalSelectedIntentionsCount } from '../utils/timerIntentions';
import { getLongBreakSwitchAction } from '../utils/longBreakSwitch';
import { ExpandedIntentionsPicker } from './timer/ExpandedIntentionsPicker';
import { TimeRemainingCircle } from './timer/TimeRemainingCircle';
import { MOBILE_TASK_ROW_HEIGHT } from '../constants/mobileTaskLayout';
import { useI18n } from '../i18n';

interface TimerProps {
  useTallSafeAreaFallback: boolean;
}

const MOBILE_PICKER_NAV_GAP = 2;
const MOBILE_TIMER_PICKER_GAP = 15;
const MOBILE_TIMER_TASK_GAP = 4;
const MOBILE_TIMER_VISUAL_UPWARD_BIAS = 8;
const MOBILE_MAX_TASK_ROWS = 5;
const MOBILE_MIN_TASK_ROWS = 3;
const DEFAULT_TASK_ROWS = 3;

export function Timer({ useTallSafeAreaFallback }: TimerProps) {
  const { t } = useI18n();
  const setActiveTab = useUiStore.use.setActiveTab();
  const setExpanded = useUiStore.use.setExpanded();
  const requestTaskCreate = useUiStore.use.requestTaskCreate();
  const expanded = useUiStore.use.expanded();
  const preferences = usePreferencesStore.use.preferences();
  const assistantStatus = useAssistantStore.use.status();
  const loadAssistantStatus = useAssistantStore.use.loadStatus();
  const updatePreferenceWithResult =
    usePreferencesStore.use.updatePreferenceWithResult();
  const timer = useTimerStore.use.timer();
  const startLongBreakTimer = useTimerStore.use.startLongBreakTimer();
  const convertLongBreakToBreak = useTimerStore.use.convertLongBreakToBreak();
  const undoVisible = useTimerStore.use.undoVisible();
  const redoVisible = useTimerStore.use.redoVisible();
  const undoLastTimerAction = useTimerStore.use.undoLastTimerAction();
  const redoLastTimerAction = useTimerStore.use.redoLastTimerAction();
  const canUndoTask = useTasksStore.use.canUndo();
  const canRedoTask = useTasksStore.use.canRedo();
  const undoTaskAction = useTasksStore.use.undoTaskAction();
  const redoTaskAction = useTasksStore.use.redoTaskAction();
  const latestUndoSource = useUiStore.use.latestUndoSource();
  const latestRedoSource = useUiStore.use.latestRedoSource();
  const connectionStatus = useTimerStore.use.connectionStatus();
  const extensionState = useTimerStore.use.extensionState();
  const resolveTimerExtension = useTimerStore.use.resolveTimerExtension();
  const timerExtensionModalOpen = useUiStore.use.timerExtensionModalOpen();
  const setTimerExtensionModalOpen =
    useUiStore.use.setTimerExtensionModalOpen();
  const [intentionsSetupModalOpen, setIntentionsSetupModalOpen] =
    useState(false);
  const [isEnablingIntentions, setIsEnablingIntentions] = useState(false);
  const [tasksSetupPromptClosed, setTasksSetupPromptClosed] = useState(false);
  const [isEnablingTasks, setIsEnablingTasks] = useState(false);
  const [taskStartChoiceOpen, setTaskStartChoiceOpen] = useState(false);
  const [taskImportOpen, setTaskImportOpen] = useState(false);
  const [mobilePickerTop, setMobilePickerTop] = useState(64);
  const [mobileTaskRowLimit, setMobileTaskRowLimit] =
    useState(MOBILE_MAX_TASK_ROWS);
  const [mobileTimerStageBounds, setMobileTimerStageBounds] = useState<{
    top: number;
    bottom: number;
  } | null>(null);
  const [mobileTimerVisualOffset, setMobileTimerVisualOffset] = useState(0);
  const topNavigationRef = useRef<HTMLDivElement | null>(null);
  const expandedPickerRef = useRef<HTMLDivElement | null>(null);
  const expandedTasksRef = useRef<HTMLDivElement | null>(null);
  const additionalIntentionsCount = getAdditionalSelectedIntentionsCount(timer);
  const displayedSessionPosition = getDisplayedSessionPosition(timer);
  const activeIntentionLabel =
    timer?.subIntentionTitle ?? timer?.intentionTitle ?? timer?.intention;
  const undoActionSource = getHistorySource(
    latestUndoSource,
    undoVisible,
    canUndoTask,
    'timer'
  );
  const redoActionSource = getHistorySource(
    latestRedoSource,
    redoVisible,
    canRedoTask,
    'timer'
  );
  const canUndoAction = undoActionSource !== null;
  const canRedoAction = redoActionSource !== null;

  const isDisconnected =
    !connectionStatus.isConnected || connectionStatus.isReconnecting;

  const handleStartLongBreak = () => {
    if (isDisconnected) return;
    startLongBreakTimer();
  };

  const handleConvertLongBreak = () => {
    if (isDisconnected) return;
    void convertLongBreakToBreak(t('timer.shortenLongBreak'));
  };

  const handleTimerExtensionSelect = (
    action: TimerExtensionResolutionAction
  ) => {
    if (isDisconnected) return;
    setTimerExtensionModalOpen(false);
    resolveTimerExtension(action);
  };

  const handleSetupIntentions = async () => {
    setIsEnablingIntentions(true);
    try {
      const didEnableIntentions = await updatePreferenceWithResult(
        'intentionExtension',
        true
      );
      if (!didEnableIntentions) return;

      setIntentionsSetupModalOpen(false);
      setActiveTab('intentions');
    } finally {
      setIsEnablingIntentions(false);
    }
  };

  const handleSetupTasks = async () => {
    setIsEnablingTasks(true);
    try {
      const didEnableTasks = await updatePreferenceWithResult(
        'tasksExtension',
        true
      );
      if (!didEnableTasks) return;

      setTasksSetupPromptClosed(false);
      const tasksResponse = await apiClient.tasks.list({
        query: { status: 'active' },
      });
      if (tasksResponse.status === 200 && tasksResponse.body.length === 0) {
        setTaskStartChoiceOpen(true);
        return;
      }

      setActiveTab('tasks');
    } finally {
      setIsEnablingTasks(false);
    }
  };

  const handleCreateFirstTask = () => {
    setTaskStartChoiceOpen(false);
    requestTaskCreate();
    setActiveTab('tasks');
  };

  const handleImportFirstTasks = () => {
    setTaskStartChoiceOpen(false);
    setTaskImportOpen(true);
  };

  const hasSessionProgress =
    preferences?.sessionsExtension &&
    displayedSessionPosition &&
    timer?.sessionTotal;
  const showMinimizedSessionIndicator =
    hasSessionProgress &&
    timer?.type === TIMER_TYPES.WORK &&
    timer.status !== TIMER_STATUSES.PAUSED;
  const longBreakSwitchAction = getLongBreakSwitchAction(
    timer?.type,
    preferences
  );
  const showLongBreakAction = longBreakSwitchAction === 'startLongBreak';
  const showLongBreakConversion =
    longBreakSwitchAction === 'switchToShortBreak';
  const showAssistantAction = assistantStatus?.assistantEnabled === true;
  const showBreakActionGroup =
    showLongBreakAction || showLongBreakConversion || showAssistantAction;
  const showExpandAction = isDesktop && !isLinux;

  const showIntentionsPicker = shouldShowIntentionsPicker({
    preferences,
    timer,
  });
  const showExpandedTaskView =
    expanded &&
    preferences?.tasksExtension &&
    (timer?.type === TIMER_TYPES.WORK ||
      ((timer?.type === TIMER_TYPES.BREAK ||
        timer?.type === TIMER_TYPES.LONG_BREAK) &&
        preferences.tasksDuringBreaks)) &&
    !timer?.isExtension;
  const showExpandedIntentionsPicker =
    showIntentionsPicker && !timer?.isExtension;
  const showDisabledIntentionsSkeleton =
    isDesktop &&
    expanded &&
    preferences?.intentionExtension === false &&
    !timer?.isExtension;
  const showTasksSetupPlaceholder =
    expanded &&
    preferences?.tasksExtension === false &&
    timer?.type === TIMER_TYPES.WORK &&
    preferences?.tasksShowSetupPrompts !== false &&
    !tasksSetupPromptClosed &&
    !timer?.isExtension;
  const showBottomPanel =
    (showExpandedIntentionsPicker && !showExpandedTaskView) ||
    showDisabledIntentionsSkeleton ||
    showExpandedTaskView;
  const showTopTaskPanel = showExpandedTaskView || showTasksSetupPlaceholder;
  const showTopIntentionsPicker =
    showExpandedIntentionsPicker && showExpandedTaskView;

  const measureMobileTimerLayout = useCallback(() => {
    if (isDesktop || (!showExpandedIntentionsPicker && !showExpandedTaskView)) {
      setMobileTimerStageBounds(null);
      setMobileTimerVisualOffset(0);
      setMobileTaskRowLimit(DEFAULT_TASK_ROWS);
      return;
    }

    const navigationBounds = topNavigationRef.current?.getBoundingClientRect();
    if (navigationBounds) {
      setMobilePickerTop(
        Math.round(navigationBounds.bottom + MOBILE_PICKER_NAV_GAP)
      );
    }

    const pickerBounds = expandedPickerRef.current?.getBoundingClientRect();
    const taskBounds = expandedTasksRef.current?.getBoundingClientRect();
    const timerVisualElements = Array.from(
      document.querySelectorAll<SVGGraphicsElement | HTMLElement>(
        '[data-testid="timer-circle-content"], [data-testid="session-progress-eta"]'
      )
    );
    const timerVisualBounds = timerVisualElements.map(element =>
      element.getBoundingClientRect()
    );
    const timerCircleBounds = document
      .querySelector<HTMLElement>('[data-testid="time-remaining-circle"]')
      ?.getBoundingClientRect();
    const taskGridBounds = expandedTasksRef.current
      ?.querySelector<HTMLElement>('[data-testid="minimized-task-grid"]')
      ?.getBoundingClientRect();
    if (
      !navigationBounds ||
      !timerCircleBounds ||
      timerVisualBounds.length === 0 ||
      (showExpandedIntentionsPicker && !pickerBounds) ||
      (showExpandedTaskView && (!taskBounds || !taskGridBounds))
    ) {
      return;
    }

    const timerVisualHeight =
      Math.max(...timerVisualBounds.map(bounds => bounds.bottom)) -
      Math.min(...timerVisualBounds.map(bounds => bounds.top));
    const timerVisualCenter =
      (Math.max(...timerVisualBounds.map(bounds => bounds.bottom)) +
        Math.min(...timerVisualBounds.map(bounds => bounds.top))) /
      2;
    const timerCircleCenter =
      timerCircleBounds.top + timerCircleBounds.height / 2;

    const topSurfaceBottom = showTopIntentionsPicker
      ? navigationBounds.bottom + MOBILE_PICKER_NAV_GAP + pickerBounds!.height
      : navigationBounds.bottom;
    const bottomSurfaceTop = showExpandedTaskView
      ? taskBounds!.top
      : pickerBounds?.top;
    if (bottomSurfaceTop === undefined) return;

    if (showExpandedTaskView) {
      const bottomInset = Math.max(0, window.innerHeight - taskBounds!.bottom);
      const taskChromeHeight = Math.max(
        0,
        taskBounds!.height - taskGridBounds!.height
      );
      const availableTaskHeight = Math.max(
        0,
        window.innerHeight -
          topSurfaceBottom -
          timerVisualHeight -
          MOBILE_TIMER_PICKER_GAP -
          MOBILE_TIMER_TASK_GAP -
          bottomInset
      );
      let nextTaskRowLimit = MOBILE_MIN_TASK_ROWS;
      for (let rowCount = MOBILE_MAX_TASK_ROWS; rowCount >= 1; rowCount -= 1) {
        if (
          taskChromeHeight + rowCount * MOBILE_TASK_ROW_HEIGHT <=
          availableTaskHeight
        ) {
          nextTaskRowLimit = Math.max(MOBILE_MIN_TASK_ROWS, rowCount);
          break;
        }
      }
      setMobileTaskRowLimit(nextTaskRowLimit);
    }

    setMobileTimerStageBounds({
      top: topSurfaceBottom + MOBILE_TIMER_PICKER_GAP,
      bottom: window.innerHeight - bottomSurfaceTop + MOBILE_TIMER_TASK_GAP,
    });
    setMobileTimerVisualOffset(
      timerCircleCenter - timerVisualCenter - MOBILE_TIMER_VISUAL_UPWARD_BIAS
    );
  }, [
    showExpandedIntentionsPicker,
    showExpandedTaskView,
    showTopIntentionsPicker,
  ]);

  useLayoutEffect(() => {
    if (isDesktop) return;

    const frame = window.requestAnimationFrame(measureMobileTimerLayout);
    const observer = new ResizeObserver(measureMobileTimerLayout);
    const timerCircle = document.querySelector<HTMLElement>(
      '[data-testid="time-remaining-circle"]'
    );
    const timerMutationObserver = new MutationObserver(
      measureMobileTimerLayout
    );
    [
      topNavigationRef.current,
      expandedPickerRef.current,
      expandedTasksRef.current,
      timerCircle,
    ].forEach(element => {
      if (element) observer.observe(element);
    });
    if (timerCircle) {
      timerMutationObserver.observe(timerCircle, {
        childList: true,
        subtree: true,
      });
    }
    window.addEventListener('resize', measureMobileTimerLayout);
    window.addEventListener('orientationchange', measureMobileTimerLayout);
    window.visualViewport?.addEventListener('resize', measureMobileTimerLayout);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      timerMutationObserver.disconnect();
      window.removeEventListener('resize', measureMobileTimerLayout);
      window.removeEventListener('orientationchange', measureMobileTimerLayout);
      window.visualViewport?.removeEventListener(
        'resize',
        measureMobileTimerLayout
      );
    };
  }, [measureMobileTimerLayout]);

  useEffect(() => {
    void loadAssistantStatus();
  }, [loadAssistantStatus]);

  useEffect(() => {
    if (isDesktop) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;

    const resetScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    resetScroll();
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const timeout = window.setTimeout(resetScroll, 50);

    return () => {
      window.clearTimeout(timeout);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, []);

  useEffect(() => {
    if (!extensionState && timerExtensionModalOpen) {
      setTimerExtensionModalOpen(false);
    }
  }, [extensionState, setTimerExtensionModalOpen, timerExtensionModalOpen]);

  return (
    <div className="flex flex-col items-center h-full relative text-gray-100 overflow-hidden">
      <div
        ref={topNavigationRef}
        data-testid="timer-top-navigation"
        className={clsx(
          'absolute right-2 z-20 flex items-center px-2 pb-2',
          isDesktop
            ? 'top-2 gap-2 pt-4'
            : 'top-[calc(env(safe-area-inset-top)+0.25rem)] gap-1.5 pt-2'
        )}
      >
        <div id="feedback-session-slot-timer" />

        {showBreakActionGroup && (
          <div
            data-testid="timer-nav-break-group"
            className="flex items-center gap-2"
          >
            {showLongBreakAction && (
              <IconButton
                label={t('timer.startLongBreak')}
                onClick={handleStartLongBreak}
                variant="secondary"
                size="md"
                disabled={isDisconnected}
              >
                <FaCoffee />
                <KeyboardShortcut text="L" showModIcon={false} />
              </IconButton>
            )}
            {showLongBreakConversion && (
              <IconButton
                label={t('timer.switchShortBreak')}
                onClick={handleConvertLongBreak}
                variant="success"
                size="md"
                disabled={isDisconnected}
              >
                <FaCoffee />
                <KeyboardShortcut text="L" showModIcon={false} />
              </IconButton>
            )}
            {showAssistantAction && <div id="assistant-session-slot-timer" />}
          </div>
        )}

        {showBreakActionGroup && (
          <div
            aria-hidden="true"
            data-testid="timer-nav-break-separator"
            className="mx-0.5 h-7 w-px shrink-0 bg-slate-700/70"
          />
        )}

        <div
          data-testid="timer-nav-utility-group"
          className="flex items-center gap-2"
        >
          {expanded && preferences?.tasksExtension && (
            <IconButton
              label={t('timer.openTasks')}
              onClick={() => setActiveTab('tasks')}
              variant="secondary"
              size="md"
            >
              <FaTasks />
              <KeyboardShortcut text="T" showModIcon={false} />
            </IconButton>
          )}
          <IconButton
            label={t('timer.statistics')}
            onClick={() => setActiveTab('statistics')}
            variant="secondary"
            size="md"
          >
            <IoStatsChart />
            <KeyboardShortcut text="O" showModIcon={false} />
          </IconButton>
          <IconButton
            label={t('timer.settings')}
            onClick={() => setActiveTab('settings')}
            variant="secondary"
            size="md"
          >
            <FaCog />
          </IconButton>
        </div>

        {showExpandAction && (
          <div
            aria-hidden="true"
            data-testid="timer-nav-expand-separator"
            className="mx-0.5 h-7 w-px shrink-0 bg-slate-700/70"
          />
        )}

        {showExpandAction && (
          <IconButton
            onClick={() => setExpanded()}
            label={t('timer.expandApplication')}
            variant="secondary"
          >
            <FaExpandAlt />
            <KeyboardShortcut text="E" showModIcon={false} />
          </IconButton>
        )}
      </div>

      {expanded && (
        <div
          className={clsx(
            'absolute left-3 z-20 flex items-center gap-3 px-2 pb-2',
            isDesktop
              ? 'top-2 translate-y-1 pt-4'
              : 'top-[calc(env(safe-area-inset-top)+0.25rem)] translate-y-2 pt-2'
          )}
        >
          <IconButton
            onClick={() => {
              if (undoActionSource === 'timer') {
                undoLastTimerAction();
                return;
              }
              if (undoActionSource === 'task') {
                void undoTaskAction();
              }
            }}
            label={
              undoActionSource === 'task'
                ? t('timer.undoTaskAction')
                : t('common.undo')
            }
            variant="secondary"
            size="sm"
            disabled={
              !canUndoAction || (undoActionSource === 'timer' && isDisconnected)
            }
          >
            <FaUndo />
            <KeyboardShortcut text="Z" showModIcon={false} />
          </IconButton>
          <IconButton
            onClick={() => {
              if (redoActionSource === 'timer') {
                redoLastTimerAction();
                return;
              }
              if (redoActionSource === 'task') {
                void redoTaskAction();
              }
            }}
            label={
              redoActionSource === 'task'
                ? t('timer.redoTaskAction')
                : t('common.redo')
            }
            variant="secondary"
            size="sm"
            disabled={
              !canRedoAction || (redoActionSource === 'timer' && isDisconnected)
            }
          >
            <FaRedo />
            <KeyboardShortcut text="⇧Z" showModIcon={false} />
          </IconButton>
        </div>
      )}

      <div className="absolute inset-0 z-0 pointer-events-none">
        <div
          data-testid="timer-circle-stage"
          data-mobile-task-row-limit={
            !isDesktop && showExpandedTaskView ? mobileTaskRowLimit : undefined
          }
          className={clsx(
            'flex w-full items-center justify-center pointer-events-auto',
            isDesktop &&
              expanded &&
              showTopIntentionsPicker &&
              '-translate-y-[20px]',
            isDesktop
              ? [
                  'absolute left-0 right-0',
                  showTopIntentionsPicker
                    ? 'top-[236px]'
                    : showTopTaskPanel
                      ? 'top-[210px]'
                      : 'top-[64px]',
                  showBottomPanel
                    ? showTopIntentionsPicker
                      ? 'bottom-[176px]'
                      : 'bottom-[204px]'
                    : 'bottom-0',
                ]
              : mobileTimerStageBounds
                ? 'absolute left-0 right-0'
                : 'h-full'
          )}
          style={
            !isDesktop && mobileTimerStageBounds
              ? {
                  top: mobileTimerStageBounds.top,
                  bottom: mobileTimerStageBounds.bottom,
                }
              : undefined
          }
        >
          <div
            data-testid="timer-visual-positioner"
            data-mobile-visual-offset={
              !isDesktop ? mobileTimerVisualOffset.toFixed(2) : undefined
            }
            className="flex w-full items-center justify-center"
            style={
              !isDesktop
                ? { transform: `translateY(${mobileTimerVisualOffset}px)` }
                : undefined
            }
          >
            <TimeRemainingCircle
              showSessionIndicator={!!hasSessionProgress}
              sessionPosition={displayedSessionPosition}
              sessionTotal={timer?.sessionTotal}
              isExpanded={expanded}
            />
          </div>
        </div>
      </div>

      {/* Session indicator for minimized view - positioned below timer */}
      <AnimatePresence>
        {showMinimizedSessionIndicator &&
          !expanded &&
          displayedSessionPosition &&
          timer?.sessionTotal && (
            <motion.div
              className={clsx(
                'absolute',
                isDesktop ? 'bottom-[35%]' : 'bottom-[33%]'
              )}
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

      {showExpandedIntentionsPicker && (
        <div
          ref={expandedPickerRef}
          data-testid="expanded-intentions-surface"
          className={clsx(
            'left-0 right-0 w-full z-10',
            showTopIntentionsPicker
              ? isDesktop
                ? 'absolute top-[78px]'
                : 'fixed'
              : isDesktop
                ? 'absolute bottom-0'
                : 'fixed bottom-0'
          )}
          style={
            !isDesktop && showTopIntentionsPicker
              ? { top: mobilePickerTop }
              : undefined
          }
        >
          <ExpandedIntentionsPicker
            useTallSafeAreaFallback={useTallSafeAreaFallback}
            placement={showTopIntentionsPicker ? 'top' : 'bottom'}
          />
        </div>
      )}

      {showExpandedTaskView && (
        <div
          ref={expandedTasksRef}
          data-testid="minimized-tasks-surface"
          className={clsx(
            'left-0 right-0 w-full z-10 px-2',
            isDesktop
              ? 'absolute bottom-2'
              : [
                  'fixed bottom-[calc(env(safe-area-inset-bottom)+0.25rem)]',
                  isIos ? 'translate-y-2' : 'translate-y-3',
                ]
          )}
        >
          <MinimizedTaskView
            visibleRowLimit={isDesktop ? DEFAULT_TASK_ROWS : mobileTaskRowLimit}
          />
        </div>
      )}

      {showDisabledIntentionsSkeleton && (
        <div
          data-testid="disabled-intentions-picker-skeleton"
          className={clsx(
            'absolute left-0 right-0 z-10 w-full px-2',
            showExpandedTaskView
              ? 'top-[64px] pt-2 pb-3 bg-linear-to-b from-slate-900 to-transparent'
              : 'bottom-0 pt-4 pb-3 bg-linear-to-t from-slate-900 to-transparent'
          )}
        >
          <div
            className="pointer-events-none flex flex-col gap-2"
            aria-hidden="true"
          >
            {Array.from({ length: 3 }).map((_, rowIndex) => (
              <div
                key={`disabled-intentions-skeleton-row-${rowIndex}`}
                className="flex justify-center gap-2"
              >
                {Array.from({ length: 3 }).map((__, itemIndex) => (
                  <div
                    key={`disabled-intentions-skeleton-${rowIndex}-${itemIndex}`}
                    className="h-11 w-[30%] max-w-40 rounded-md border border-slate-700/25 bg-slate-800/25"
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <Button
              onClick={() => setIntentionsSetupModalOpen(true)}
              className="gap-2 rounded-lg shadow-lg shadow-slate-950/30"
              data-testid="setup-intentions-button"
            >
              <FaPlus size={12} />
              <span>{t('timer.addIntention')}</span>
            </Button>
          </div>
        </div>
      )}

      {showTasksSetupPlaceholder && (
        <div
          data-testid="tasks-setup-placeholder"
          className={clsx(
            'left-0 right-0 z-10 w-full px-2 pt-4 pb-2',
            isDesktop
              ? 'absolute top-[68px]'
              : 'fixed top-[calc(env(safe-area-inset-top)+0.25rem)] bg-linear-to-b from-slate-900 to-transparent'
          )}
        >
          <div className="relative mx-auto max-w-md rounded-lg border border-slate-700/45 bg-slate-900/70 px-4 py-3 opacity-80 shadow-lg shadow-slate-950/30">
            <button
              type="button"
              aria-label={t('timer.setupTasks')}
              title={t('timer.setupTasks')}
              onClick={() => setTasksSetupPromptClosed(true)}
              className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md border border-slate-700/50 bg-slate-950/70 text-slate-400 transition hover:text-slate-100"
            >
              <FaTimes size={11} />
            </button>
            <div className="grid min-h-[108px] grid-rows-3 gap-1">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={`tasks-setup-skeleton-${index}`}
                  className="grid min-h-8 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-slate-800/60 bg-slate-950/30 px-2"
                >
                  <div className="h-7 w-7 rounded-md border border-slate-700/40 bg-slate-900/60" />
                  <div className="space-y-1.5">
                    <div className="h-2.5 w-3/4 rounded bg-slate-700/40" />
                    <div className="h-2 w-1/3 rounded bg-slate-800/50" />
                  </div>
                  <div className="flex gap-1">
                    <div className="h-7 w-7 rounded-md border border-slate-700/40 bg-slate-900/60" />
                    <div className="h-7 w-7 rounded-md border border-slate-700/40 bg-slate-900/60" />
                  </div>
                </div>
              ))}
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <Button
                onClick={handleSetupTasks}
                isLoading={isEnablingTasks}
                loadingText={t('timer.settingUp')}
                className="gap-2 shadow-lg shadow-slate-950/30"
                data-testid="setup-tasks-button"
              >
                <FaPlus size={12} />
                {t('task.add')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {expanded && timer?.isExtension && timer.intention && (
        <div className="absolute bottom-0 left-0 right-0 w-full z-10 flex justify-center pb-6">
          <div className="flex items-center gap-2 rounded-full bg-slate-800/60 border border-slate-700/50 px-4 py-2">
            {(timer.intentionEmoji || timer.subIntentionEmoji) && (
              <IntentionEmojiPair
                parentEmoji={timer.intentionEmoji}
                subEmoji={timer.subIntentionEmoji}
                size="sm"
              />
            )}
            <span className="text-xs text-slate-300 font-medium">
              {activeIntentionLabel}
              {additionalIntentionsCount > 0
                ? ` +${additionalIntentionsCount}`
                : ''}
            </span>
          </div>
        </div>
      )}

      <Modal
        isOpen={intentionsSetupModalOpen}
        onClose={() => setIntentionsSetupModalOpen(false)}
        title={t('timer.setupIntentions')}
        closeOnBackdropClick={!isEnablingIntentions}
        closeOnEscape={!isEnablingIntentions}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            {t('timer.intentionsDescription')}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setIntentionsSetupModalOpen(false)}
              disabled={isEnablingIntentions}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSetupIntentions}
              isLoading={isEnablingIntentions}
              loadingText={t('timer.settingUpEllipsis')}
            >
              {t('common.setUp')}
            </Button>
          </div>
        </div>
      </Modal>

      <TimerExtensionModal
        isOpen={timerExtensionModalOpen}
        extensionState={extensionState}
        onCancel={() => setTimerExtensionModalOpen(false)}
        onSelect={handleTimerExtensionSelect}
      />

      <Modal
        isOpen={taskStartChoiceOpen}
        onClose={() => setTaskStartChoiceOpen(false)}
        title={t('timer.startTasks')}
        closeOnBackdropClick
        closeOnEscape
      >
        <div className="space-y-3">
          <Button onClick={handleCreateFirstTask} className="w-full">
            {t('timer.createFirstTask')}
          </Button>
          <Button
            variant="secondary"
            onClick={handleImportFirstTasks}
            className="w-full"
          >
            {t('timer.importFromApp')}
          </Button>
        </div>
      </Modal>

      <TaskImportModal
        isOpen={taskImportOpen}
        onClose={() => setTaskImportOpen(false)}
      />
    </div>
  );
}

function getHistorySource(
  preferredSource: HistorySource | null,
  canUseTimer: boolean,
  canUseTask: boolean,
  fallbackSource: HistorySource
): HistorySource | null {
  if (preferredSource === 'timer' && canUseTimer) {
    return 'timer';
  }
  if (preferredSource === 'task' && canUseTask) {
    return 'task';
  }
  if (fallbackSource === 'timer') {
    return canUseTimer ? 'timer' : canUseTask ? 'task' : null;
  }
  return canUseTask ? 'task' : canUseTimer ? 'timer' : null;
}
