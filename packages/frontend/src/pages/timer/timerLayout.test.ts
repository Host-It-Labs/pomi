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
      })
    ).toBe(true);
    expect(
      shouldShowExpandedTaskView({
        isExpanded: true,
        tasksExtension: true,
        timerType: 'break',
      })
    ).toBe(true);
    expect(
      shouldShowExpandedTaskView({
        isExpanded: true,
        tasksExtension: true,
        timerType: 'longBreak',
      })
    ).toBe(true);
  });

  it('shows enabled Tasks during breaks and hides the disabled feature', () => {
    expect(
      shouldShowExpandedTaskView({
        isExpanded: true,
        tasksExtension: false,
        timerType: 'work',
      })
    ).toBe(false);
    expect(
      shouldShowExpandedTaskView({
        isExpanded: true,
        tasksExtension: true,
        timerType: 'break',
      })
    ).toBe(true);
  });
});
