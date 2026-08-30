import type { TimerTypes } from '@pomi/shared';
import { TIMER_TYPES } from '@pomi/shared/src/constants';

type TimerStagePanelInput = {
  isExpanded: boolean;
  isLoading: boolean;
  hasTopPanel: boolean;
  hasBottomPanel: boolean;
};

type ExpandedTaskViewInput = {
  isExpanded: boolean;
  tasksExtension: boolean | undefined;
  timerType: TimerTypes | undefined;
  tasksDuringBreaks: boolean | undefined;
};

export function shouldShowExpandedTaskView({
  isExpanded,
  tasksExtension,
  timerType,
  tasksDuringBreaks,
}: ExpandedTaskViewInput) {
  return (
    isExpanded &&
    tasksExtension === true &&
    (timerType === TIMER_TYPES.WORK ||
      ((timerType === TIMER_TYPES.BREAK ||
        timerType === TIMER_TYPES.LONG_BREAK) &&
        tasksDuringBreaks === true))
  );
}

export function getTimerStagePanelReservation({
  isExpanded,
  isLoading,
  hasTopPanel,
  hasBottomPanel,
}: TimerStagePanelInput) {
  const reserveStartupGeometry = isExpanded && isLoading;

  return {
    hasTopPanel: hasTopPanel || reserveStartupGeometry,
    hasBottomPanel: hasBottomPanel || reserveStartupGeometry,
  };
}
