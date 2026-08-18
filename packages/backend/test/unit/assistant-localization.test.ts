import { describe, expect, it } from 'vitest';
import { APP_LANGUAGE_VALUES, type AppLanguage } from '@pomi/shared';
import {
  ASSISTANT_KEYS,
  ASSISTANT_TRANSLATIONS,
  translateAssistant,
} from '../../src/i18n/assistant-localization';

describe('assistant localization', () => {
  it('contains every assistant key for every supported language', () => {
    expect(Object.keys(ASSISTANT_TRANSLATIONS).sort()).toEqual(
      [...APP_LANGUAGE_VALUES].sort()
    );
    for (const language of APP_LANGUAGE_VALUES) {
      const translations = ASSISTANT_TRANSLATIONS[language as AppLanguage];
      for (const key of ASSISTANT_KEYS) {
        const template = translations[key];
        expect(template).toBeDefined();
        const rendered =
          typeof template === 'function'
            ? template({ count: 2, title: 'Task' })
            : template;
        expect(rendered.trim()).not.toBe('');
      }
    }
  });

  it('uses the account language for generated task and timer responses', () => {
    expect(
      translateAssistant('fr-FR', 'taskCreated', {
        title: 'Préparer le rapport',
      })
    ).toBe('Tâche créée : Préparer le rapport');
    expect(translateAssistant('zh-Hans', 'timerPaused')).toBe('计时器已暂停。');
  });
});
