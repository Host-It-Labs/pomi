import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import {
  DEFAULT_LANGUAGE,
  detectBrowserLanguage,
  getIntlLocale,
  getLanguageDefinition,
  isRightToLeft,
  LANGUAGE_STORAGE_KEY,
  normalizeLanguage,
  SUPPORTED_LANGUAGES,
  type AppLanguage,
} from './languages';
import {
  getTranslationCatalog,
  isTranslationCatalogLoaded,
  loadTranslationCatalog,
  type TranslationValues,
} from './resources';

type LanguageListener = () => void;
export type SetLanguageOptions = { persist: boolean };
export type TranslateFunction = (
  key: string,
  values?: TranslationValues
) => string;

let currentLanguage: AppLanguage =
  getStoredLanguage() ?? detectBrowserLanguage();
let requestedLanguage = currentLanguage;
const listeners = new Set<LanguageListener>();

function getStoredLanguage() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function notifyLanguageChanged() {
  listeners.forEach(listener => listener());
}

export function applyDocumentLanguage(language: AppLanguage) {
  if (typeof document === 'undefined') {
    return;
  }

  const definition = getLanguageDefinition(language);
  document.documentElement.lang = definition.locale;
  document.documentElement.dir = definition.direction;
}

applyDocumentLanguage(currentLanguage);

export function getLanguage(): AppLanguage {
  return currentLanguage;
}

export async function initializeI18n() {
  try {
    await loadTranslationCatalog(currentLanguage);
  } catch {
    currentLanguage = DEFAULT_LANGUAGE;
    requestedLanguage = DEFAULT_LANGUAGE;
  }
  applyDocumentLanguage(currentLanguage);
  const preload = () => {
    void Promise.allSettled(
      SUPPORTED_LANGUAGES.map(({ code }) => loadTranslationCatalog(code))
    );
  };
  if (typeof navigator === 'undefined' || navigator.onLine) {
    preload();
  } else if (typeof window !== 'undefined') {
    window.addEventListener('online', preload, { once: true });
  }
}

function commitLanguage(language: AppLanguage) {
  currentLanguage = language;
  applyDocumentLanguage(language);
  notifyLanguageChanged();
}

export function setLanguage(
  language: string | null | undefined,
  options: SetLanguageOptions
) {
  const normalized = normalizeLanguage(language) ?? DEFAULT_LANGUAGE;
  requestedLanguage = normalized;

  if (options.persist && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
    } catch {
      // Private browsing and restricted webviews can reject local storage.
    }
  }

  if (currentLanguage === normalized) {
    applyDocumentLanguage(normalized);
    return normalized;
  }

  if (isTranslationCatalogLoaded(normalized)) {
    commitLanguage(normalized);
    return normalized;
  }

  void loadTranslationCatalog(normalized)
    .then(() => {
      if (requestedLanguage === normalized) commitLanguage(normalized);
    })
    .catch(() => {
      if (
        requestedLanguage === normalized &&
        options.persist &&
        typeof window !== 'undefined'
      ) {
        try {
          window.localStorage.setItem(LANGUAGE_STORAGE_KEY, currentLanguage);
        } catch {
          // Keep the loaded catalog even when persistence is unavailable.
        }
      }
    });
  return normalized;
}

export function subscribeLanguage(listener: LanguageListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function translate(
  key: string,
  values: TranslationValues | undefined,
  language: AppLanguage
) {
  const catalog = getTranslationCatalog(language);
  const template =
    catalog[key] ?? getTranslationCatalog(DEFAULT_LANGUAGE)[key] ?? key;

  if (!values) {
    return template;
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(values[name] ?? `{{${name}}}`)
  );
}

export function translateCurrent(key: string, values?: TranslationValues) {
  return translate(key, values, getLanguage());
}

type I18nContextValue = {
  language: AppLanguage;
  locale: string;
  direction: 'ltr' | 'rtl';
  setLanguage: typeof setLanguage;
  t: TranslateFunction;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function getServerLanguage() {
  return currentLanguage;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const language = useSyncExternalStore(
    subscribeLanguage,
    getLanguage,
    getServerLanguage
  );

  useEffect(() => {
    applyDocumentLanguage(language);
  }, [language]);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      locale: getIntlLocale(language),
      direction: isRightToLeft(language) ? 'rtl' : 'ltr',
      setLanguage,
      t: (key, values) => translate(key, values, language),
    }),
    [language]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  const language = useSyncExternalStore(
    subscribeLanguage,
    getLanguage,
    getServerLanguage
  );

  const fallback = useMemo<I18nContextValue>(
    () => ({
      language,
      locale: getIntlLocale(language),
      direction: isRightToLeft(language) ? 'rtl' : 'ltr',
      setLanguage,
      t: (key, values) => translate(key, values, language),
    }),
    [language]
  );

  // Standalone component tests and small embedded surfaces may not mount the
  // application provider. They still receive the same reactive runtime.
  return context ?? fallback;
}

export function formatDate(
  date: Date | number | string,
  language: AppLanguage,
  options?: Intl.DateTimeFormatOptions
) {
  return new Intl.DateTimeFormat(getIntlLocale(language), options).format(
    new Date(date)
  );
}

export function formatNumber(
  value: number,
  language: AppLanguage,
  options?: Intl.NumberFormatOptions
) {
  return new Intl.NumberFormat(getIntlLocale(language), options).format(value);
}
