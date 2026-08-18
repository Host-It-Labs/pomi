/**
 * Languages currently supported by the Pomi interface.
 *
 * Keep these values as BCP-47 tags. They are persisted and sent to the API,
 * so the values must not be translated or changed for display purposes.
 */
import {
  APP_LANGUAGE_INFO,
  APP_LANGUAGES,
  APP_LANGUAGE_VALUES,
  DEFAULT_APP_LANGUAGE,
  normalizeAppLanguage,
  type AppLanguage,
} from '@pomi/shared/src/constants';

const ENGLISH_NAMES: Record<AppLanguage, string> = {
  [APP_LANGUAGES.ENGLISH]: 'English',
  [APP_LANGUAGES.CHINESE_SIMPLIFIED]: 'Simplified Chinese',
  [APP_LANGUAGES.HINDI]: 'Hindi',
  [APP_LANGUAGES.SPANISH]: 'Spanish',
  [APP_LANGUAGES.ARABIC]: 'Arabic',
  [APP_LANGUAGES.FRENCH]: 'French',
  [APP_LANGUAGES.BENGALI]: 'Bengali',
  [APP_LANGUAGES.PORTUGUESE_BRAZIL]: 'Portuguese (Brazil)',
  [APP_LANGUAGES.INDONESIAN]: 'Indonesian',
  [APP_LANGUAGES.URDU]: 'Urdu',
};

export const SUPPORTED_LANGUAGES = APP_LANGUAGE_VALUES.map(code => ({
  code,
  ...APP_LANGUAGE_INFO[code],
  englishName: ENGLISH_NAMES[code],
})) as ReadonlyArray<{
  code: AppLanguage;
  locale: string;
  nativeName: string;
  englishName: string;
  direction: 'ltr' | 'rtl';
}>;

export { type AppLanguage };

export const DEFAULT_LANGUAGE: AppLanguage = DEFAULT_APP_LANGUAGE;
export const LANGUAGE_STORAGE_KEY = 'pomi-locale';

export type LanguageDefinition = (typeof SUPPORTED_LANGUAGES)[number];

export function getLanguageDefinition(language: string | null | undefined) {
  const normalized = normalizeLanguage(language);
  return (
    SUPPORTED_LANGUAGES.find(item => item.code === normalized) ??
    SUPPORTED_LANGUAGES[0]
  );
}

export function normalizeLanguage(
  language: string | null | undefined
): AppLanguage | null {
  return normalizeAppLanguage(language);
}

export function getIntlLocale(language: string | null | undefined) {
  return getLanguageDefinition(language).locale;
}

export function isRightToLeft(language: string | null | undefined) {
  return getLanguageDefinition(language).direction === 'rtl';
}

export function detectLanguage(
  locales: readonly string[] | null | undefined
): AppLanguage {
  for (const locale of locales ?? []) {
    const detected = normalizeLanguage(locale);
    if (detected) {
      return detected;
    }
  }

  return DEFAULT_LANGUAGE;
}

export function detectBrowserLanguage(): AppLanguage {
  if (typeof navigator === 'undefined') {
    return DEFAULT_LANGUAGE;
  }

  const locales = [
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language,
  ].filter(Boolean);

  return detectLanguage(locales);
}
