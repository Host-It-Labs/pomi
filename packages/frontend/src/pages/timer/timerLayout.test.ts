import { describe, expect, it } from 'vitest';
import {
  getTimerStagePanelReservation,
  shouldShowExpandedTaskView,
} from './timerLayout';

describe('Timer stage loading geometry', () => {
  it('reserves both optional surfaces while the expanded Timer bootstraps', () => {
    expect(
      getTimerStagePanelReservation({
        isExpanded: true,
        isLoading: true,
        hasTopPanel: false,
        hasBottomPanel: false,
      })
    ).toEqual({ hasTopPanel: true, hasBottomPanel: true });
  });

  it('preserves the loaded surface contract', () => {
    expect(
      getTimerStagePanelReservation({
        isExpanded: true,
        isLoading: false,
        hasTopPanel: false,
        hasBottomPanel: true,
      })
    ).toEqual({ hasTopPanel: false, hasBottomPanel: true });
  });

  it('does not reserve expanded-only geometry in a minimized surface', () => {
    expect(
      getTimerStagePanelReservation({
        isExpanded: false,
        isLoading: true,
        hasTopPanel: false,
        hasBottomPanel: false,
      })
    ).toEqual({ hasTopPanel: false, hasBottomPanel: false });
  });
});

describe('expanded Timer Task surface', () => {
  it('keeps Tasks visible during Work and configured Break extensions', () => {
    expect(
      shouldShowExpandedTaskView({
        isExpanded: true,
        tasksExtension: true,
        timerType: 'work',
        tasksDuringBreaks: false,
      })
    ).toBe(true);
    expect(
      shouldShowExpandedTaskView({
        isExpanded: true,
        tasksExtension: true,
        timerType: 'break',
        tasksDuringBreaks: true,
      })
    ).toBe(true);
    expect(
      shouldShowExpandedTaskView({
        isExpanded: true,
        tasksExtension: true,
        timerType: 'longBreak',
        tasksDuringBreaks: true,
      })
    ).toBe(true);
  });

  it('does not show Tasks when the feature or Break setting is disabled', () => {
    expect(
      shouldShowExpandedTaskView({
        isExpanded: true,
        tasksExtension: false,
        timerType: 'work',
        tasksDuringBreaks: true,
      })
    ).toBe(false);
    expect(
      shouldShowExpandedTaskView({
        isExpanded: true,
        tasksExtension: true,
        timerType: 'break',
        tasksDuringBreaks: false,
      })
    ).toBe(false);
  });
});
