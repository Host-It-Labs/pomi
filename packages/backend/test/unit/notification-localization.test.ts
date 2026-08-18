import { describe, expect, it } from 'vitest';
import { translateNotification } from '../../src/i18n/notification-localization';

describe('notification localization', () => {
  it('renders timer warnings in the saved account language', () => {
    expect(translateNotification('fr', 'minutesLeft', 5)).toBe(
      'Encore 5 minutes'
    );
    expect(translateNotification('fr', 'timerEnding', 5)).toContain(
      '5 minutes'
    );
  });

  it('keeps session position and total in translated completion messages', () => {
    expect(translateNotification('zh-Hans', 'workTimersDone', 2, 3)).toBe(
      '已完成 3 个工作计时中的第 2 个。'
    );
  });
});
