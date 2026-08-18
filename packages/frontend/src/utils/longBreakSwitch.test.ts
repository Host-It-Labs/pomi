import { TIMER_TYPES } from '@pomi/shared/src/constants';
import { describe, expect, it } from 'vitest';
import { getLongBreakSwitchAction } from './longBreakSwitch';

const preferences = {
  sessionHasLongBreak: true,
  sessionShowLongBreakButton: true,
  longBreakToBreakEnabled: true,
};

describe('Long break switch action', () => {
  it('uses the normal start action during Work and short Break timers', () => {
    expect(getLongBreakSwitchAction(TIMER_TYPES.WORK, preferences)).toBe(
      'startLongBreak'
    );
    expect(getLongBreakSwitchAction(TIMER_TYPES.BREAK, preferences)).toBe(
      'startLongBreak'
    );
  });

  it('uses the highlighted switch action only during a Long break', () => {
    expect(getLongBreakSwitchAction(TIMER_TYPES.LONG_BREAK, preferences)).toBe(
      'switchToShortBreak'
    );
  });
});
