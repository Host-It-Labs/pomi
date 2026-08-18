import { TIMER_TYPES } from '@pomi/shared/src/constants';
import { describe, expect, it } from 'vitest';
import { isTaskInTimerTypeSearchScope } from './taskSearchScope';

describe('full Tasks search scope', () => {
  it('ignores the selected Timer type while search is active', () => {
    expect(
      isTaskInTimerTypeSearchScope(
        TIMER_TYPES.LONG_BREAK,
        TIMER_TYPES.WORK,
        true
      )
    ).toBe(true);
  });

  it('keeps the Timer type filter outside search', () => {
    expect(
      isTaskInTimerTypeSearchScope(
        TIMER_TYPES.LONG_BREAK,
        TIMER_TYPES.WORK,
        false
      )
    ).toBe(false);
  });
});
