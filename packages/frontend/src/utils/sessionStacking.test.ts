import { TIMER_TYPES } from '@pomi/shared/src/constants';
import { describe, expect, it } from 'vitest';
import { canStackSessionTimer } from './sessionStacking';

const preferences = {
  sessionsExtension: true,
  sessionStackTimers: true,
};

describe('Session stacking availability', () => {
  it('allows extending the final configured Session position', () => {
    expect(
      canStackSessionTimer(
        {
          isExtension: false,
          type: TIMER_TYPES.WORK,
          sessionPosition: 4,
          sessionTotal: 4,
        },
        preferences
      )
    ).toBe(true);
  });

  it('rejects invalid positions and extension Timers', () => {
    expect(
      canStackSessionTimer(
        {
          isExtension: false,
          type: TIMER_TYPES.WORK,
          sessionPosition: 5,
          sessionTotal: 4,
        },
        preferences
      )
    ).toBe(false);
    expect(
      canStackSessionTimer(
        {
          isExtension: true,
          type: TIMER_TYPES.WORK,
          sessionPosition: 4,
          sessionTotal: 4,
        },
        preferences
      )
    ).toBe(false);
  });
});
