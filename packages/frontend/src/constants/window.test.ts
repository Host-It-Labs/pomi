import { describe, expect, it } from 'vitest';
import {
  COLLAPSED_HEIGHT,
  getMinimizedWindowHeight,
  MINIMIZED_TASKS_CONTENT_HEIGHT,
  MINIMIZED_TASKS_HEIGHT,
  MINIMIZED_TASKS_ROW_CLEARANCE,
} from './window';

describe('minimized window geometry', () => {
  it('keeps the compact height when the mini Task view is hidden', () => {
    expect(getMinimizedWindowHeight(false)).toBe(COLLAPSED_HEIGHT);
  });

  it('adds only the accepted Task-row clearance when the mini Task view is shown', () => {
    expect(MINIMIZED_TASKS_ROW_CLEARANCE).toBe(10);
    expect(MINIMIZED_TASKS_HEIGHT).toBe(
      MINIMIZED_TASKS_CONTENT_HEIGHT + MINIMIZED_TASKS_ROW_CLEARANCE
    );
    expect(getMinimizedWindowHeight(true)).toBe(MINIMIZED_TASKS_HEIGHT);
  });
});
