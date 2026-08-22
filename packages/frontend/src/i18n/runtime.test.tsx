import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  detectLanguage,
  getLanguageDefinition,
  normalizeLanguage,
  SUPPORTED_LANGUAGES,
} from './languages';
import { sourceTranslationCatalogs } from './resources';
import { I18nProvider, setLanguage, useI18n } from './runtime';

function LanguageProbe() {
  const { language, direction, t } = useI18n();
  return (
    <div data-testid="probe" data-direction={direction}>
      {language}:{t('login.title')}
    </div>
  );
}

afterEach(() => {
  setLanguage(DEFAULT_LANGUAGE, { persist: false });
  document.documentElement.lang = '';
  document.documentElement.dir = 'ltr';
});

describe('language catalog and detection', () => {
  it('normalizes regional browser tags to one of the supported languages', () => {
    expect(normalizeLanguage('pt-PT')).toBe('pt-BR');
    expect(normalizeLanguage('zh-TW')).toBe('zh-Hans');
    expect(normalizeLanguage('ar-EG')).toBe('ar');
    expect(normalizeLanguage('xx')).toBeNull();
  });

  it('uses the first supported browser language and falls back to English', () => {
    expect(detectLanguage(['de-DE', 'fr-CA'])).toBe('fr');
    expect(detectLanguage(['de-DE'])).toBe(DEFAULT_LANGUAGE);
  });

  it('keeps every supported source catalog aligned and non-empty', () => {
    const sourceKeys = Object.keys(sourceTranslationCatalogs.en).sort();
    for (const language of SUPPORTED_LANGUAGES) {
      const sourceCatalog = sourceTranslationCatalogs[language.code];
      expect(sourceCatalog).toBeDefined();
      expect(Object.keys(sourceCatalog ?? {}).sort()).toEqual(sourceKeys);
      for (const key of sourceKeys) {
        expect(sourceCatalog?.[key].trim()).not.toBe('');
      }
    }
  });

  it('translates representative copy in every non-English locale', () => {
    const representativeKeys = [
      'common.back',
      'common.save',
      'task.tasks',
      'timer.startLongBreak',
      'statistics.title',
      'assistant.title',
    ];
    const englishCatalog = sourceTranslationCatalogs.en;
    for (const language of SUPPORTED_LANGUAGES.filter(
      item => item.code !== 'en'
    )) {
      const catalog = sourceTranslationCatalogs[language.code];
      for (const key of representativeKeys) {
        expect(catalog[key]).not.toBe(englishCatalog[key]);
      }
    }
  });

  it('translates every calendar label in each supported locale', () => {
    const calendarKeys = [
      'common.calendar',
      'common.month',
      'common.year',
      'common.undated',
      'common.items',
      'task.calendar',
    ] as const;
    const englishCatalog = sourceTranslationCatalogs.en;

    for (const language of SUPPORTED_LANGUAGES.filter(
      item => item.code !== 'en'
    )) {
      const catalog = sourceTranslationCatalogs[language.code];
      for (const key of calendarKeys) {
        expect(catalog[key]).not.toBe(englishCatalog[key]);
      }
    }
    expect(sourceTranslationCatalogs.fr['common.item']).toBe('élément');
  });

  it('translates shared descriptions without dropping interpolation tokens', () => {
    const descriptionKeys = [
      'statistics.noLogsYet',
      'timer.intentionsDescription',
      'debug.notificationsDescription',
      'login.usingSelfHosted',
    ];
    const englishCatalog = sourceTranslationCatalogs.en;
    for (const language of SUPPORTED_LANGUAGES.filter(
      item => item.code !== 'en'
    )) {
      const catalog = sourceTranslationCatalogs[language.code];
      for (const key of descriptionKeys) {
        expect(catalog[key]).not.toBe(englishCatalog[key]);
      }
      expect(catalog['login.usingSelfHosted']).toContain('{{url}}');
    }
  });
});

describe('I18nProvider', () => {
  it('updates document language and direction when the locale changes', () => {
    setLanguage('ur', { persist: false });
    render(
      <I18nProvider>
        <LanguageProbe />
      </I18nProvider>
    );

    expect(screen.getByTestId('probe')).toHaveAttribute(
      'data-direction',
      'rtl'
    );
    expect(document.documentElement.lang).toBe(
      getLanguageDefinition('ur').locale
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByTestId('probe')).toHaveTextContent('ur:');
  });
});
