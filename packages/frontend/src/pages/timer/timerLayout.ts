import type { TimerTypes } from '@pomi/shared';

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
};

export function shouldShowExpandedTaskView({
  isExpanded,
  tasksExtension,
  timerType,
}: ExpandedTaskViewInput) {
  return isExpanded && tasksExtension === true && timerType !== undefined;
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
