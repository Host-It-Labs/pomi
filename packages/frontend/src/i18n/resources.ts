import english from './catalogs/en.json';
import type { AppLanguage } from './languages';

export type TranslationValues = Record<string, string | number>;
export type TranslationCatalog = Record<string, string>;

const catalogs = new Map<AppLanguage, TranslationCatalog>([
  ['en', english as TranslationCatalog],
]);

const catalogLoaders: Record<
  Exclude<AppLanguage, 'en'>,
  () => Promise<{ default: TranslationCatalog }>
> = {
  'zh-Hans': () => import('./catalogs/zh-Hans.json'),
  hi: () => import('./catalogs/hi.json'),
  es: () => import('./catalogs/es.json'),
  ar: () => import('./catalogs/ar.json'),
  fr: () => import('./catalogs/fr.json'),
  bn: () => import('./catalogs/bn.json'),
  'pt-BR': () => import('./catalogs/pt-BR.json'),
  id: () => import('./catalogs/id.json'),
  ur: () => import('./catalogs/ur.json'),
};

const catalogLoads = new Map<AppLanguage, Promise<TranslationCatalog>>();

export function getTranslationCatalog(language: AppLanguage) {
  return catalogs.get(language) ?? catalogs.get('en')!;
}

export function isTranslationCatalogLoaded(language: AppLanguage) {
  return catalogs.has(language);
}

export function loadTranslationCatalog(
  language: AppLanguage
): Promise<TranslationCatalog> {
  const loaded = catalogs.get(language);
  if (loaded) return Promise.resolve(loaded);

  const pending = catalogLoads.get(language);
  if (pending) return pending;

  const load = catalogLoaders[language as Exclude<AppLanguage, 'en'>]()
    .then(module => {
      const catalog = module.default;
      catalogs.set(language, catalog);
      catalogLoads.delete(language);
      return catalog;
    })
    .catch(error => {
      catalogLoads.delete(language);
      throw error;
    });
  catalogLoads.set(language, load);
  return load;
}
