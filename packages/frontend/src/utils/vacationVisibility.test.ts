import { describe, expect, it } from 'vitest';
import { shouldHideVacationCoveredTasks } from './vacationVisibility';

describe('Vacation Task visibility', () => {
  it('stops filtering covered Tasks when the extension is disabled', () => {
    expect(shouldHideVacationCoveredTasks(false, false, true)).toBe(false);
  });

  it('filters covered Tasks only for an active enabled Vacation', () => {
    expect(shouldHideVacationCoveredTasks(true, false, true)).toBe(true);
    expect(shouldHideVacationCoveredTasks(true, false, false)).toBe(false);
    expect(shouldHideVacationCoveredTasks(true, true, true)).toBe(false);
  });
});
