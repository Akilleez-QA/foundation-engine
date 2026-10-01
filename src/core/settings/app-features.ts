/** The running flag service. Legacy callers share the same rows and device overrides as Services.features. */
import { DEV, TEST_API } from '../env';
import { appSaveStore } from '../save/app-store';
import { createFeatures, featureOverridesSection, type FeatureDef, type Features } from './features';

// ADR 0034: one WebGL2 render path. Do not add a flag for a second render path.
export const coreFeatures: readonly FeatureDef[] = [
  { id: 'dev.silent', stage: 'dev', default: false, description: 'Start without audio during verification (tests and benches)' },
  { id: 'dev.test-api', stage: 'dev', default: true, description: 'Verification API and inspection hooks' },
  { id: 'dev.hud', stage: 'dev', default: DEV, description: 'Development render statistics' },
];

/** `?silent-test` is the verifiers' short alias for `?flags=dev.silent`; explicit flags win. Never persist URL choices. */
export function featureUrl(url: string): string {
  const parsed = new URL(url, 'http://localhost');
  const flags = parsed.searchParams.get('flags') ?? '';
  if (parsed.searchParams.has('silent-test')) parsed.searchParams.set('flags', `dev.silent,${flags}`);
  return parsed.href;
}

let definitions: () => readonly FeatureDef[] = () => coreFeatures;
/** Bound before boot so patch needs see registered flags, and install sees the frozen registry. */
export function bindAppFeatures(read: (() => readonly FeatureDef[]) | null): void {
  definitions = read ?? (() => coreFeatures);
  cached = undefined;
}
let cached: { defs: readonly FeatureDef[]; overrides: Readonly<Record<string, boolean>>; url: string; service: Features } | undefined;
function current(): Features {
  const defs = definitions();
  const overrides = appSaveStore().section(featureOverridesSection).get();
  const url = typeof location === 'undefined' ? 'http://localhost' : location.href;
  if (!cached || cached.defs !== defs || cached.overrides !== overrides || cached.url !== url) {
    cached = { defs, overrides, url, service: createFeatures(defs, { dev: TEST_API, url: featureUrl(url), overrides }) };
  }
  return cached.service;
}
const service: Features = { enabled: id => current().enabled(id), explain: () => current().explain() };
export const appFeatures = (): Features => service;
