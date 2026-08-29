// central location for window sizing constants used by the desktop app

// widths are constant across expanded/collapsed modes
export const WINDOW_WIDTH = 440;

// heights vary depending on whether the UI is expanded or collapsed
export const EXPANDED_HEIGHT = 700;
export const COLLAPSED_HEIGHT = 95;
export const MINIMIZED_TASKS_CONTENT_HEIGHT = 270;
export const MINIMIZED_TASKS_ROW_CLEARANCE = 10;
export const MINIMIZED_TASKS_HEIGHT =
  MINIMIZED_TASKS_CONTENT_HEIGHT + MINIMIZED_TASKS_ROW_CLEARANCE;

export function getMinimizedWindowHeight(showMinimizedTaskView: boolean) {
  return showMinimizedTaskView ? MINIMIZED_TASKS_HEIGHT : COLLAPSED_HEIGHT;
}
