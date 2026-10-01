/**
 * core/settings: one settings schema, typed values, sparse storage, body-class projection (STD-SET-1, STD-SET-2).
 * Values are stored sparsely in the device section 'settings.values'. Graphics are NOT here: they are the knob
 * registry and the 'graphics.settings' section in platform/render/quality.ts. Feature flags are in ./features.ts.
 * The running game reads and writes settings through `appSettings()` (./app-settings.ts).
 *
 * A game adds its own settings by augmenting `SettingValues` and appending definitions to the list it hands to
 * `createSettings` (the app settings service takes `coreSettings` plus the game's rows).
 */
import type { EventBus } from '../events';
import type { SaveSection, SectionHandle } from '../save/section';

declare module '../events' {
  interface EngineEvents {
    /** Area `settings`, owner core.settings: one per effective value change. */
    'settings.changed': { id: SettingId; value: unknown };
  }
}

/** The panel section a setting appears in: the core ones, or any game-defined kebab-case name. */
export type SettingSection = 'sound' | 'comfort' | 'controls' | 'graphics' | 'dev' | (string & {});
export type I18nKey = string;

/** Typed values, augmented per module (like EngineEvents). */
export interface SettingValues {
  'sound.muted': boolean; 'sound.music': number; 'sound.effects': number; 'sound.voice': number; 'sound.captions': boolean;
  'comfort.calm': boolean; 'comfort.large-type': boolean;
}
export type SettingId = keyof SettingValues;

interface Base<K extends SettingId> {
  id: K; section: SettingSection; label: I18nKey; help?: I18nKey; order?: number;
  scope: 'device' | 'player';
  /** A function when the default comes from the platform (calm ← prefers-reduced-motion). */
  default: SettingValues[K] | ((env: SettingEnv) => SettingValues[K]);
  /** Mirror into the DOM for CSS: `body.still-mode`, `body.large-type`. */
  bodyClass?: string;
  /** Hidden from the generated panel (device preferences remembered by a feature where it is chosen). */
  hidden?: boolean;
  /** Where it came from, for the migration record (a pre-store key, for example). */
  legacy?: string;
  /**
   * Stored even when it equals the default: for a value another record carries whenever it is stored.
   */
  keepDefault?: boolean;
}
export type SettingDef<K extends SettingId = SettingId> =
  | (Base<K> & { type: 'bool' })
  | (Base<K> & { type: 'range'; range: { min: number; max: number; step: number } })
  | (Base<K> & { type: 'choice'; choices: readonly SettingValues[K][] });
export interface SettingEnv { prefersReducedMotion: boolean; coarsePointer: boolean }

export interface Settings {
  get<K extends SettingId>(id: K): SettingValues[K];
  set<K extends SettingId>(id: K, value: SettingValues[K]): void;       // validates against the def; emits 'settings.changed'
  reset(section?: SettingSection): void;
  subscribe<K extends SettingId>(id: K, fn: (v: SettingValues[K]) => void, signal?: AbortSignal): () => void;
  defs(section?: SettingSection): readonly SettingDef[];
}

/** The engine's own settings, as data. A game appends its rows. */
export const coreSettings: SettingDef[] = [
  { id: 'sound.muted', section: 'sound', type: 'bool', label: 'settings.sound.muted', scope: 'device', default: false },
  { id: 'sound.music', section: 'sound', type: 'range', range: { min: 0, max: 1, step: 0.01 }, label: 'settings.sound.music', scope: 'device', default: 0.24 },
  { id: 'sound.effects', section: 'sound', type: 'range', range: { min: 0, max: 1, step: 0.01 }, label: 'settings.sound.effects', scope: 'device', default: 0.36 },
  { id: 'sound.voice', section: 'sound', type: 'range', range: { min: 0, max: 1, step: 0.01 }, label: 'settings.sound.voice', scope: 'device', default: 0.8 },
  { id: 'sound.captions', section: 'sound', type: 'bool', label: 'settings.sound.captions', scope: 'device', default: true },
  { id: 'comfort.calm', section: 'comfort', type: 'bool', label: 'settings.comfort.calm', help: 'settings.comfort.calm.help', order: 2, scope: 'device', default: env => env.prefersReducedMotion, bodyClass: 'still-mode' },
  { id: 'comfort.large-type', section: 'comfort', type: 'bool', label: 'settings.comfort.large-type', order: 1, scope: 'device', default: false, bodyClass: 'large-type' },
];

/** What is stored: only values that differ from their default. */
export type StoredSettings = Record<string, boolean | number | string>;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The device section that holds every setting a player changed. Unknown ids are kept (a newer build's setting survives
 * an older build); wrongly typed values for known ids fall back to the default at read time, in `createSettings`.
 * Device scope: never exported. A game that had settings before it adopted the store adds a `legacy` binding here
 * through `settingsValuesSectionWith(binding)`.
 */
export const settingsValuesSection: SaveSection<StoredSettings> = {
  id: 'settings.values', scope: 'device', version: 1,
  initial: () => ({}),
  parse: raw => {
    if (!isObject(raw)) throw Error('Invalid settings');
    const out: StoredSettings = {};
    for (const [k, v] of Object.entries(raw)) if (/^[a-z][a-z0-9.-]{0,63}$/.test(k) && ['boolean', 'number', 'string'].includes(typeof v) && !(typeof v === 'number' && !Number.isFinite(v))) out[k] = v as boolean | number | string;
    return out;
  },
  merge: (a, b) => ({ ...a, ...b }),
};
/** The same section with a game's legacy import (identity matters to the store: build it once, at boot). */
export const settingsValuesSectionWith = (legacy: NonNullable<SaveSection<StoredSettings>['legacy']>): SaveSection<StoredSettings> => ({ ...settingsValuesSection, legacy });

/** The slice of the 'settings.values' save handle that settings use: `store.section(settingsValuesSection)` fits. */
export type SettingsStore = Pick<SectionHandle<StoredSettings>, 'get' | 'update' | 'subscribe'>;
/** Where settings report `settings.changed`: the core event bus (or the module's scoped view of it). */
export type SettingsEvents = Pick<EventBus, 'emit'>;
export interface SettingsOptions {
  /** Projects `bodyClass` settings onto <body>. The settings service is the ONE writer of `still-mode` and `large-type`. */
  dom?: { toggleClass(c: string, on: boolean): void };
  events?: SettingsEvents;
  /**
   * Called once with a re-check: the owner of `env` calls it after an environment value changed (the OS reduced-motion
   * preference), so a setting that follows its platform default notifies its subscribers and the body class.
   */
  watchEnv?(recheck: () => void): void;
}

/** Problems in a set of definitions (the registry's validation): unique ids, legal ranges and choices, valid defaults. */
export function settingProblems(defs: readonly SettingDef[], env: SettingEnv): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const d of defs) {
    if (seen.has(d.id)) out.push(`${d.id}: duplicate id`);
    seen.add(d.id);
    if (!d.id.startsWith(d.section + '.')) out.push(`${d.id}: id must start with its section '${d.section}.'`);
    if (d.type === 'range' && !(d.range.min < d.range.max && d.range.step > 0)) out.push(`${d.id}: bad range`);
    if (d.type === 'choice' && d.choices.length < 1) out.push(`${d.id}: no choices`);
    if (!validSetting(d, defaultOf(d, env))) out.push(`${d.id}: default is not a legal value`);
  }
  return out;
}
function validSetting(d: SettingDef, v: unknown): boolean {
  return d.type === 'bool' ? typeof v === 'boolean'
    : d.type === 'range' ? typeof v === 'number' && Number.isFinite(v) && v >= d.range.min && v <= d.range.max
      : (d.choices as readonly unknown[]).includes(v);
}
const defaultOf = (d: SettingDef, env: SettingEnv): unknown => (typeof d.default === 'function' ? (d.default as (e: SettingEnv) => unknown)(env) : d.default);

export function createSettings(defs: readonly SettingDef[], store: SettingsStore, env: SettingEnv, opts: SettingsOptions = {}): Settings {
  const dom = opts.dom;
  const byId = new Map(defs.map(d => [d.id, d] as [SettingId, SettingDef]));
  const listeners = new Map<SettingId, Set<(v: never) => void>>();
  const valid = validSetting;
  const fallback = (d: SettingDef) => defaultOf(d, env);
  const read = (id: SettingId): unknown => { const d = byId.get(id); if (!d) throw Error('Unknown setting ' + id); const v = store.get()[id]; return valid(d, v) ? v : fallback(d); };
  const last = new Map<SettingId, unknown>(defs.map(d => [d.id, read(d.id)]));
  const project = () => { for (const d of defs) if (d.bodyClass) dom?.toggleClass(d.bodyClass, read(d.id) === true); };
  project();
  // Bounded by registered setting IDs; versions invalidate only same-setting nested deliveries.
  const versions = new Map<SettingId, number>();
  let version = 0;
  const check = () => {
    const errors: unknown[] = [];
    const attempt = (fn: () => void) => { try { fn(); } catch (error) { errors.push(error); } };
    for (const d of defs) {
      const v = read(d.id);
      if (v === last.get(d.id)) continue;
      last.set(d.id, v);
      const current = ++version;
      versions.set(d.id, current);
      const subscribers = [...(listeners.get(d.id) ?? [])];
      attempt(() => { opts.events?.emit('settings.changed', { id: d.id, value: v }); });
      for (const fn of subscribers) {
        // A nested change delivered the replacement value; do not follow it with stale outer data.
        if (versions.get(d.id) !== current) break;
        if (listeners.get(d.id)?.has(fn)) attempt(() => { (fn as (x: unknown) => void)(v); });
      }
    }
    // Read again after callbacks: preferences may have changed reentrantly.
    for (const d of defs) if (d.bodyClass) attempt(() => { dom?.toggleClass(d.bodyClass!, read(d.id) === true); });
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, 'Settings observers failed');
  };
  store.subscribe(check);   // one path for local sets, other tabs and imports
  opts.watchEnv?.(check);
  return {
    get: <K extends SettingId>(id: K) => read(id) as SettingValues[K],
    set(id, value) {
      const d = byId.get(id); if (!d) throw Error('Unknown setting ' + id);
      if (!valid(d, value)) throw Error(`Invalid value for ${id}`);
      const drop = value === fallback(d) && !d.keepDefault, held = store.get()[id];   // sparse: defaults are not stored
      if (drop ? held === undefined : held === value) return;                            // unchanged: nothing to write
      store.update(s => { if (drop) delete s[id]; else s[id] = value; });
    },
    reset(section) { store.update(s => { for (const d of defs) if (!section || d.section === section) delete s[d.id]; }); },
    subscribe(id, fn, signal) {
      let set = listeners.get(id); if (!set) listeners.set(id, set = new Set());
      set.add(fn as (v: never) => void); const off = () => { set!.delete(fn as (v: never) => void); };
      if (signal?.aborted) off(); else signal?.addEventListener('abort', off, { once: true });
      return off;
    },
    defs: section => defs.filter(d => !section || d.section === section).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  };
}

