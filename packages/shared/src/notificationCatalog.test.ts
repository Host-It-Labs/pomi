import { describe, expect, it } from 'vitest';
import { APP_LANGUAGE_VALUES, NOTIFICATION_KEY_VALUES } from './constants';
import {
  NOTIFICATION_TRANSLATIONS,
  translateNotificationCatalog,
} from './notificationCatalog';

describe('shared notification catalog', () => {
  it('translates common parameterized notifications', () => {
    expect(
      translateNotificationCatalog('fr-FR', 'minutesLeft', { minutes: 5 })
    ).toBe('Encore 5 minutes');
    expect(
      translateNotificationCatalog('zh-Hans', 'workTimersDone', {
        position: 2,
        total: 3,
      })
    ).toBe('已完成 3 个工作计时中的第 2 个。');
  });

  it('falls back to English for unsupported locales', () => {
    expect(translateNotificationCatalog('xx-XX', 'breakTime')).toBe(
      'Time for a break.'
    );
  });

  it('contains every common key for every supported language', () => {
    for (const language of APP_LANGUAGE_VALUES) {
      for (const key of NOTIFICATION_KEY_VALUES) {
        const template = NOTIFICATION_TRANSLATIONS[language][key];
        expect(template).toBeDefined();
        const rendered =
          typeof template === 'function'
            ? template({ minutes: 5, position: 2, total: 3 })
            : template;
        expect(rendered.trim()).not.toBe('');
      }
    }
  });
});
