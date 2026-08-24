import { LogicalSize, Window } from '@tauri-apps/api/window';
import { create } from 'zustand';
import {
  COLLAPSED_HEIGHT,
  EXPANDED_HEIGHT,
  WINDOW_WIDTH,
} from '../constants/window';
import { Tab } from '../types/uiTypes';
import { isLinux } from '../utils/osUtils';
import { createSelectors } from './createSelectors';

export type TaskMode = 'intention' | 'general';
export type HistorySource = 'timer' | 'task';
export type HistoryActionId = string;

type HistoryMarker = {
  id: HistoryActionId;
  source: HistorySource;
};

interface UiState {
  expanded: boolean;
  setExpanded: (expanded?: boolean) => void;
  activeTab: Tab;
  setActiveTab: (activeTab: Tab) => void;
  taskMode: TaskMode;
  setTaskMode: (taskMode: TaskMode) => void;
  latestUndoSource: HistorySource | null;
  latestRedoSource: HistorySource | null;
  undoHistorySources: HistoryMarker[];
  redoHistorySources: HistoryMarker[];
  recordHistoryAction: (source: HistorySource) => HistoryActionId;
  recordHistoryUndo: (source: HistorySource, id?: HistoryActionId) => void;
  recordHistoryRedo: (source: HistorySource, id?: HistoryActionId) => void;
  discardHistoryAction: (source: HistorySource, id?: HistoryActionId) => void;
  clearHistorySource: (source: HistorySource) => void;
  taskCreateRequested: boolean;
  taskCreateInitialTitle: string;
  requestTaskCreate: (initialTitle?: string) => void;
  clearTaskCreateRequest: () => void;
  taskEditRequestedId: string | null;
  requestTaskEdit: (taskId: string) => void;
  clearTaskEditRequest: () => void;
  taskRevealRequestedId: string | null;
  requestTaskReveal: (taskId: string) => void;
  clearTaskRevealRequest: () => void;
  intentionCreateRequested: boolean;
  requestIntentionCreate: () => void;
  clearIntentionCreateRequest: () => void;
  intentionPickerOpenRequest: number;
  requestIntentionPickerOpen: () => void;
  taskSearchFocusRequest: number;
  requestTaskSearchFocus: () => void;
  taskQuickCreateFocusRequest: number;
  requestTaskQuickCreateFocus: () => void;
  advancedSkipModalOpen: boolean;
  setAdvancedSkipModalOpen: (advancedSkipModalOpen: boolean) => void;
  timerExtensionModalOpen: boolean;
  setTimerExtensionModalOpen: (timerExtensionModalOpen: boolean) => void;
  advancedSkipStartPending: boolean;
  setAdvancedSkipStartPending: (advancedSkipStartPending: boolean) => void;
  appWindow: Window | null;
  setAppWindow: (appWindow: Window | null) => void;
  hasLoggedIn: boolean;
  setHasLoggedIn: (hasLoggedIn: boolean) => void;
}

let historyMarkerCounter = 0;

const useUiStoreBase = create<UiState>((set, state) => ({
  expanded: true,
  setExpanded: (expanded?: boolean) => {
    // linux should never be collapsed, ignore any request to toggle
    if (isLinux) {
      set({ expanded: true });
      state().appWindow?.setSize(
        new LogicalSize(WINDOW_WIDTH, EXPANDED_HEIGHT)
      );
      return;
    }

    expanded = expanded === undefined ? !state().expanded : expanded;
    set({ expanded });
    if (expanded)
      state().appWindow?.setSize(
        new LogicalSize(WINDOW_WIDTH, EXPANDED_HEIGHT)
      );
    else
      state().appWindow?.setSize(
        new LogicalSize(WINDOW_WIDTH, COLLAPSED_HEIGHT)
      );
  },
  activeTab: 'timer',
  setActiveTab: (activeTab: Tab) => set({ activeTab }),
  taskMode: 'general',
  setTaskMode: (taskMode: TaskMode) => set({ taskMode }),
  latestUndoSource: null,
  latestRedoSource: null,
  undoHistorySources: [],
  redoHistorySources: [],
  recordHistoryAction: source => {
    const marker = createHistoryMarker(source);
    set(state => {
      const undoHistorySources = [...state.undoHistorySources, marker];
      return {
        undoHistorySources,
        redoHistorySources: [],
        latestUndoSource: lastHistorySource(undoHistorySources),
        latestRedoSource: null,
      };
    });
    return marker.id;
  },
  recordHistoryUndo: (source, id) =>
    set(state => {
      const removed = removeHistoryMarker(state.undoHistorySources, source, id);
      const redoHistorySources = [
        ...state.redoHistorySources,
        removed.marker ?? createHistoryMarker(source),
      ];
      return {
        undoHistorySources: removed.historyMarkers,
        redoHistorySources,
        latestUndoSource: lastHistorySource(removed.historyMarkers),
        latestRedoSource: lastHistorySource(redoHistorySources),
      };
    }),
  recordHistoryRedo: (source, id) =>
    set(state => {
      const removed = removeHistoryMarker(state.redoHistorySources, source, id);
      const undoHistorySources = [
        ...state.undoHistorySources,
        removed.marker ?? createHistoryMarker(source),
      ];
      return {
        undoHistorySources,
        redoHistorySources: removed.historyMarkers,
        latestUndoSource: lastHistorySource(undoHistorySources),
        latestRedoSource: lastHistorySource(removed.historyMarkers),
      };
    }),
  discardHistoryAction: (source, id) =>
    set(state => {
      const removed = removeHistoryMarker(state.undoHistorySources, source, id);
      return {
        undoHistorySources: removed.historyMarkers,
        latestUndoSource: lastHistorySource(removed.historyMarkers),
      };
    }),
  clearHistorySource: source =>
    set(state => {
      const undoHistorySources = state.undoHistorySources.filter(
        historyMarker => historyMarker.source !== source
      );
      const redoHistorySources = state.redoHistorySources.filter(
        historyMarker => historyMarker.source !== source
      );
      return {
        undoHistorySources,
        redoHistorySources,
        latestUndoSource: lastHistorySource(undoHistorySources),
        latestRedoSource: lastHistorySource(redoHistorySources),
      };
    }),
  taskCreateRequested: false,
  taskCreateInitialTitle: '',
  requestTaskCreate: (initialTitle?: string) =>
    set({
      taskCreateRequested: true,
      taskCreateInitialTitle: initialTitle?.trim() ?? '',
    }),
  clearTaskCreateRequest: () =>
    set({ taskCreateRequested: false, taskCreateInitialTitle: '' }),
  taskEditRequestedId: null,
  requestTaskEdit: (taskId: string) => set({ taskEditRequestedId: taskId }),
  clearTaskEditRequest: () => set({ taskEditRequestedId: null }),
  taskRevealRequestedId: null,
  requestTaskReveal: (taskId: string) => set({ taskRevealRequestedId: taskId }),
  clearTaskRevealRequest: () => set({ taskRevealRequestedId: null }),
  intentionCreateRequested: false,
  requestIntentionCreate: () => set({ intentionCreateRequested: true }),
  clearIntentionCreateRequest: () => set({ intentionCreateRequested: false }),
  intentionPickerOpenRequest: 0,
  requestIntentionPickerOpen: () =>
    set(state => ({
      intentionPickerOpenRequest: state.intentionPickerOpenRequest + 1,
    })),
  taskSearchFocusRequest: 0,
  requestTaskSearchFocus: () =>
    set(state => ({
      taskSearchFocusRequest: state.taskSearchFocusRequest + 1,
    })),
  taskQuickCreateFocusRequest: 0,
  requestTaskQuickCreateFocus: () =>
    set(state => ({
      taskQuickCreateFocusRequest: state.taskQuickCreateFocusRequest + 1,
    })),
  advancedSkipModalOpen: false,
  setAdvancedSkipModalOpen: advancedSkipModalOpen =>
    set({ advancedSkipModalOpen }),
  timerExtensionModalOpen: false,
  setTimerExtensionModalOpen: timerExtensionModalOpen =>
    set({ timerExtensionModalOpen }),
  advancedSkipStartPending: false,
  setAdvancedSkipStartPending: advancedSkipStartPending =>
    set({ advancedSkipStartPending }),
  appWindow: null,
  setAppWindow: (appWindow: Window | null) => set({ appWindow }),
  hasLoggedIn: false,
  setHasLoggedIn: (hasLoggedIn: boolean) => set({ hasLoggedIn }),
}));

export const useUiStore = createSelectors(useUiStoreBase);

function lastHistorySource(
  historyMarkers: HistoryMarker[]
): HistorySource | null {
  return historyMarkers[historyMarkers.length - 1]?.source ?? null;
}

function createHistoryMarker(source: HistorySource): HistoryMarker {
  historyMarkerCounter += 1;
  return { id: `${source}-${historyMarkerCounter}`, source };
}

function removeHistoryMarker(
  historyMarkers: HistoryMarker[],
  source: HistorySource,
  id?: HistoryActionId
): { historyMarkers: HistoryMarker[]; marker: HistoryMarker | null } {
  const nextHistoryMarkers = [...historyMarkers];
  const index =
    id === undefined
      ? findLastHistoryMarkerIndex(nextHistoryMarkers, source)
      : nextHistoryMarkers.findIndex(
          marker => marker.source === source && marker.id === id
        );
  if (index >= 0) {
    const [marker] = nextHistoryMarkers.splice(index, 1);
    return { historyMarkers: nextHistoryMarkers, marker };
  }
  return { historyMarkers: nextHistoryMarkers, marker: null };
}

function findLastHistoryMarkerIndex(
  historyMarkers: HistoryMarker[],
  source: HistorySource
) {
  for (let index = historyMarkers.length - 1; index >= 0; index -= 1) {
    if (historyMarkers[index].source === source) {
      return index;
    }
  }
  return -1;
}
