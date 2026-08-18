import { describe, expect, it } from 'vitest';
import {
  APP_LANGUAGE_INFO,
  APP_LANGUAGE_VALUES,
  APP_LANGUAGES,
  DEFAULT_APP_LANGUAGE,
  getAppLanguageDirection,
  isAppLanguage,
  normalizeAppLanguage,
} from './constants';

describe('supported app languages', () => {
  it('keeps the launch catalog stable and complete', () => {
    expect(APP_LANGUAGE_VALUES).toHaveLength(10);
    expect(APP_LANGUAGE_VALUES).toContain(DEFAULT_APP_LANGUAGE);
    expect(Object.keys(APP_LANGUAGE_INFO)).toHaveLength(10);
  });

  it('normalizes common device locale variants', () => {
    expect(normalizeAppLanguage('fr-CH')).toBe(APP_LANGUAGES.FRENCH);
    expect(normalizeAppLanguage('zh_CN')).toBe(
      APP_LANGUAGES.CHINESE_SIMPLIFIED
    );
    expect(normalizeAppLanguage('pt-PT')).toBe(APP_LANGUAGES.PORTUGUESE_BRAZIL);
    expect(normalizeAppLanguage('de-DE')).toBeNull();
  });

  it('identifies canonical values and direction', () => {
    expect(isAppLanguage(APP_LANGUAGES.ENGLISH)).toBe(true);
    expect(isAppLanguage('en-US')).toBe(false);
    expect(getAppLanguageDirection(APP_LANGUAGES.ARABIC)).toBe('rtl');
    expect(getAppLanguageDirection(APP_LANGUAGES.URDU)).toBe('rtl');
    expect(getAppLanguageDirection(APP_LANGUAGES.SPANISH)).toBe('ltr');
  });
});
