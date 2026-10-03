// core/module.ts: the module contract (KSPAddon startup scenes, MechJeb LoadComputerModules with per-assembly
// isolation, kOS AddonManager, CKAN .ckan metadata, KSP-AVC .version). ADR 0003, 0036, 0043, 0063.
import type { Registries, RegistryName, RegistryOptions, EntryOf } from './registry';
import type { Services } from './services';
import type { Patch } from './patch';
import type { PortPreset, QualityPreset } from './tiers';

export type { ModuleReport, ModuleStatus } from './types';

export { satisfies, splitDep } from './version';

export interface Disposable { dispose(): void }

/** ADR 0017/0029 presets. The reference preset is primary; the others are later ports. `core/tiers.ts` owns it. */
export type ModulePreset = QualityPreset;
export interface ModuleBudgetValues {
  /** Wall time of register + install, ms. Checked in the boot report and by bench-perf. */
  bootMs?: number;
  /** Size of the module's lazy chunk after gzip, KiB (checked by the build, not at runtime). */
  chunkKiB?: number;
  /** Heap the module keeps while none of its scenes is open, MiB (measured through the test API). */
  idleHeapMiB?: number;
}
/** `ModuleBudget`: flat fields are reference values; `ports` override them for lighter presets
 *  (the `Ported<T>` pattern, ADR 0030). The boot report warns on an overrun and never fails. */
export interface ModuleBudget extends ModuleBudgetValues {
  ports?: Partial<Record<PortPreset, ModuleBudgetValues>>;
}

/** The value of one budget field for a preset, falling back upward: low → medium → high → reference. */
export function moduleBudgetFor<K extends keyof ModuleBudgetValues>(b: ModuleBudget | undefined, key: K, preset: ModulePreset): ModuleBudgetValues[K] | undefined {
  if (!b) return undefined;
  const chain: ModulePreset[] = ['low', 'medium', 'high'];
  for (let i = chain.indexOf(preset); i >= 0 && i < chain.length; i++) {
    const v = b.ports?.[chain[i] as PortPreset]?.[key];
    if (v !== undefined) return v;
  }
  return b[key];
}

export interface EngineModule {
  /** 'core.save', 'platform.render', 'domain.progression', 'feature.workshop', 'pack.seasonal-shop'. Never renamed. */
  id: string;
  /** Semver of the module's own content and save sections. */
  version: string;
  /** Hard dependencies: 'domain.progression' or with a range 'domain.progression@^2'. Missing, out of range, or failed →
   *  this module is disabled (not the app), and so is everything that hard-requires it. */
  requires?: string[];
  /** Soft dependencies: installed first when present; absent or failed is fine. Check `s.app.has(id)` before use. */
  optional?: string[];
  /** Modules that must not run together; the later one in boot order is disabled (CKAN conflicts). */
  conflicts?: string[];
  /** Virtual module ids this module satisfies for requires/needs (CKAN provides). Not service claims. */
  provides?: string[];
  /** Exclusive service claims: the only keys this module may `provide`. Checked before install (ADR 0063). */
  serviceKeys?: (keyof Services)[];
  /** Exclusive event areas: the only areas this module may `emit` in ('progression' covers 'progression.*'). ADR 0063. */
  eventAreas?: string[];
  owner?: string;  // free-form maintainer label; the kernel never reads it (ADR 0061)
  budget?: ModuleBudget;
  /** Registries this module owns. The kernel creates them per app so tests boot in isolation. */
  defines?: { [K in RegistryName]?: RegistryOptions<EntryOf<K>> };
  /** Phase 2: add definitions. Nothing runs, no DOM, no services. */
  register?(r: Registries): void;
  /** Phase 3: ordered edits to other modules' entries (ModuleManager semantics, see core/patch.ts). */
  patches?: readonly Patch[];
  /** Phase 6: wire behaviour, provide services, contribute UI. A throw fails this module and disables its dependants.
   *  Anything acquired must be tied to `s.signal` as it is acquired: a disposable returned after a throw never arrives. */
  install?: ((s: Services) => void | Disposable | Promise<void | Disposable>) | undefined;
}

/** Identity helper: gives module literals full type checking (excess-property checks on defines/patches). */
export function defineModule<M extends EngineModule>(m: M): M { return m; }

/** Layer prefixes in boot tie-break order. */
export const LAYER_PREFIXES: readonly string[] = Object.freeze(['core.', 'platform.', 'domain.', 'kits.', 'feature.', 'pack.']);

/** Rank of a module id's layer; ids without a known prefix sort after every layer. */
export function layerRank(id: string): number {
  const i = LAYER_PREFIXES.findIndex(p => id.startsWith(p));
  return i < 0 ? LAYER_PREFIXES.length : i;
}

/** The deterministic tie-break: layer prefix, then module id (never list position). */
export function compareModuleIds(a: string, b: string): number {
  return layerRank(a) - layerRank(b) || (a < b ? -1 : a > b ? 1 : 0);
}
