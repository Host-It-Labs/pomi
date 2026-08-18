import { TIMER_STATUSES } from './constants';
import type { WatchStatus, WatchTimerAction } from './types';

export type WatchFaceSlot = 'top' | 'center' | 'right' | 'bottom' | 'left';
export type WatchVoiceEntryMode = 'openAppAndStartRecording';

export interface WatchFaceActionModel {
  id: 'assistant' | 'tasks' | 'timer';
  slot: WatchFaceSlot;
  label: string;
  visualPriority: number;
  enabled: boolean;
}

export interface WatchFaceSurfaceModel {
  clock: {
    slot: 'top';
  };
  timer: WatchFaceActionModel & {
    slot: 'center';
    action: WatchTimerAction | null;
    remainingTime: number | null;
    progress: number;
  };
  assistant: WatchFaceActionModel & {
    slot: 'right';
    entryMode: WatchVoiceEntryMode;
    canRecord: boolean;
  };
  tasks: WatchFaceActionModel & {
    slot: 'left';
    visibleCount: number;
    activeCount: number;
  };
}

export function buildWatchFaceSurfaceModel(
  status: WatchStatus
): WatchFaceSurfaceModel {
  const timerAction = getTimerAction(status);
  const canRecordAssistant = status.assistant.assistantEnabled;

  return {
    clock: {
      slot: 'top',
    },
    timer: {
      id: 'timer',
      slot: 'center',
      label: status.timer ? 'Timer' : 'Start Timer',
      visualPriority: 3,
      enabled: timerAction !== null,
      action: timerAction,
      remainingTime: status.timer?.remainingTime ?? null,
      progress: status.timer?.progress ?? 0,
    },
    assistant: {
      id: 'assistant',
      slot: 'right',
      label: 'Assistant',
      visualPriority: 2,
      enabled: canRecordAssistant,
      entryMode: 'openAppAndStartRecording',
      canRecord: canRecordAssistant,
    },
    tasks: {
      id: 'tasks',
      slot: 'left',
      label: 'Tasks',
      visualPriority: 1,
      enabled: status.totalActiveTasks > 0 || status.tasks.length > 0,
      visibleCount: status.tasks.length,
      activeCount: status.totalActiveTasks,
    },
  };
}

function getTimerAction(status: WatchStatus): WatchTimerAction | null {
  if (status.timer?.status === TIMER_STATUSES.RUNNING) {
    return status.timerControls.canPause ? 'pause' : null;
  }

  return status.timerControls.canStartOrResume ? 'startOrResume' : null;
}
