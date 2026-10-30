/**
 * core/i18n catalogue loading (ADR 0021, ADR 0043). A catalogue that is not bundled
 * (the narration text, later other locales and feature namespaces) is fetched once and added to an `I18n` with
 * `addCatalog`. `load()` is memoised while it is pending or has succeeded; a failure clears the memo, so the next call
 * tries again (a player who presses Listen again after a network blip gets the words).
 *
 * Pure apart from the injected `fetchCatalog`: no DOM, no globals.
 */
import type {Catalog, I18n} from './i18n';

export interface CatalogLoader {
  /** Resolves once the catalogue is in the i18n instance. Rejects when this attempt failed. */
  load(): Promise<void>;
  /** True once a load has succeeded: lookups are then synchronous and final. */
  loaded(): boolean;
}

export function createCatalogLoader<P>(
  i18n: I18n<P>,
  locale: string,
  fetchCatalog: () => Promise<Catalog>,
): CatalogLoader {
  let pending: Promise<void> | null = null,
    done = false;
  return {
    load() {
      pending ??= (async () => {
        const catalog = await fetchCatalog();
        if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog))
          throw new Error(`The ${locale} catalogue is not an object of key → text`);
        i18n.addCatalog(locale, catalog);
        done = true;
      })().catch(error => {
        pending = null;
        throw error;
      });
      return pending;
    },
    loaded: () => done,
  };
}
