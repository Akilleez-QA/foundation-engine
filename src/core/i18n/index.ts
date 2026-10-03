/** core/i18n public surface (ADR 0021). The game instance is app-i18n.ts. Key types live in the generated keys.gen.ts. */
export {
  createI18n,
  localeChain,
  MAX_LOCALE_CHAIN,
  DETAILED_SUFFIX,
  type Catalog,
  type I18n,
  type I18nOptions,
  type ReadingLevel,
  type TArgs,
  type TOptions,
} from './i18n';
export {parseMessage, renderMessage, messageVars, MESSAGE_LIMITS, type Part, type Vars} from './format';
export {
  expandNarrationFamily,
  narrationFamilyProblems,
  narrationFamilyGaps,
  narrationFamilyHoles,
  narrationFamilyShape,
  narrationKey,
  narrationCatalogKey,
  fillNarrationPattern,
  raggedNarrationFamily,
  type NarrationFamilyDef,
  type NarrationDomainValue,
  type NarrationKey,
  type NarrationVars,
} from './narration-families';
export {createCatalogLoader, type CatalogLoader} from './catalog-loader';
