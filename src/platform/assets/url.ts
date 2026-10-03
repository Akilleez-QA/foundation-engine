/**
 * platform/assets/url.ts: the URL of an asset row, for `<audio>`, `<img>` and CSS (`url(id, o)`).
 *
 * Streamed media (music, narration) is addressed through its `AssetDef` row, never a hand-written path (STD-REN-31): the
 * caller holds the def (a pack imported for its data) and asks for the variant that fits the voice or locale. This is the
 * synchronous half of `AssetLibrary.url(id, o)`; the library resolves the id to its def and then calls this. Pure.
 */
import type {AssetDef, AssetVariant} from '../../core/asset-def.ts';

/** The base locale: a variant with no `locale` belongs to it (today's `en` files keep their paths). */
export const BASE_LOCALE = 'en';

export interface AssetUrlOptions {
  /** Narration: the voice id (a game's narrator voices). */
  readonly voice?: string;
  readonly locale?: string;
}

/**
 * The variant `assetUrl(def, o)` serves: the first whose voice matches `o.voice` (missing: any) and whose locale is
 * `o.locale`, else the base locale's (per row, STD-STR-4). A missing `o.locale` matches any locale.
 */
export function urlVariant(def: AssetDef, o: AssetUrlOptions = {}): AssetVariant {
  const voiced = def.variants.filter(v => o.voice === undefined || v.voice === o.voice);
  const inLocale = (locale: string) => voiced.find(v => (v.locale ?? BASE_LOCALE) === locale);
  const variant = o.locale === undefined ? voiced[0] : (inLocale(o.locale) ?? inLocale(BASE_LOCALE));
  if (!variant) throw new Error(`${def.id}: no variant`);
  return variant;
}

/** The URL of `def`'s variant for `o`, under `base` (the `public/` root, `/` by default). */
export function assetUrl(def: AssetDef, o: AssetUrlOptions = {}, base = '/'): string {
  return base + urlVariant(def, o).path;
}
