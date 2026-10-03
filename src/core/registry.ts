// core/registry.ts: typed content registries (KSP GameDatabase + PartLoader, ContractConfigurator per-entry validation,
// a per-kind registryProblems() generalised). ADR 0005, 0043, 0063.
// A module that owns a kind of content declares it (EngineModule.defines) and types it by augmentation:
//   declare module '../../core/registry' { interface Registries { tools: Registry<ToolDef> } }
// Every other module adds entries in register(r), and reads them through r / s.registries.
// Rows are eager and data-only; heavy payloads and behaviour are `Lazy<T>` fields (ADR 0036, 0043).

export interface Registry<T extends { id: string }> {
  readonly name: string;
  /** source = the module id that adds the entry (provenance, error messages, rollback of a failed module). */
  add(def: T, source: string): void;
  /** Throws on an unknown id. Aliases resolve to their current id (ids are never renamed; aliases handle renames). */
  get(id: string): T;
  find(id: string): T | undefined;
  all(): readonly T[];
  where(pred: (t: T) => boolean): readonly T[];
}

/** A reference from one row to another row that it needs in order to execute (ADR 0063). */
export interface RowRef { registry: string; id: string }

/** A cross-entry problem attributed to one row, so it can be traced to the module (or pack) that added it. */
export interface EntryProblem { id: string; problem: string }

export interface RegistryOptions<T extends { id: string }> {
  /** Per-entry problems. An entry with problems is dropped in production and throws at boot in DEV. */
  validate?: (t: T) => string[];
  /** Cross-entry problems: broken references, clashing positions, missing required entries. Return an
   *  `EntryProblem` when the problem belongs to one row, so a pack's bad row disables only that pack (ADR 0043). */
  problems?: (all: readonly T[]) => readonly (string | EntryProblem)[];
  /** The id form, when it is not lowercase kebab-case: only for ids that are already save data and keep their stored
   *  form (STD-REG-12: some ids are UPPER-KEBAB). */
  idForm?: RegExp;
  /** Old ids that still resolve to this entry (a renamed item in a saved look, an old route). */
  aliases?: (t: T) => readonly string[];
  /** ADR 0063: module ids (or provided ids), besides the row's source and the registry owner, whose successful
   *  installation the row needs in order to execute, e.g. a panel row names the module that runs its activity. */
  executors?: (t: T) => readonly string[];
  /** ADR 0063: other rows this row needs in order to execute. An unavailable reference makes this row unavailable.
   *  Optional references are not listed here; they keep their declared placeholder contract. */
  requiresRows?: (t: T) => readonly RowRef[];
}

/** Registries is augmented per module (declaration merging). The kernel owns none. */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Registries {}

export type RegistryName = keyof Registries & string;
export type EntryOf<K extends RegistryName> = Registries[K] extends Registry<infer T> ? T : never;

// ---- lazy payloads (ADR 0005 amendment, ADR 0043) ----

/** A heavy payload or behaviour implementation that loads with its scene's chunk. Memoised. */
export interface Lazy<T> { readonly load: () => Promise<T> }

const LAZY: unique symbol = Symbol('engine.lazy');

/** Wrap a dynamic import: `impl: lazy(() => import('./body'))`. A module namespace (or any object with its own
 *  `default` key) is unwrapped to its default export, so a `T` that itself has a `default` field must be wrapped.
 *  A successful load is memoised; a failed load is not, so Retry can load again. */
export function lazy<T>(load: () => Promise<T | { default: T }>): Lazy<T> {
  let pending: Promise<T> | null = null;
  const unwrap = (v: T | { default: T }): T =>
    v !== null && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'default') ? (v as { default: T }).default : v as T;
  return Object.freeze({
    [LAZY]: true,
    load: () => pending ??= new Promise<T | { default: T }>(res => res(load())).then(unwrap, e => { pending = null; throw e; }),
  }) as Lazy<T>;
}

/** True for values made by `lazy()` (and any object with a `load` function, for hand-written test doubles). */
export function isLazy(v: unknown): v is Lazy<unknown> {
  return !!v && typeof v === 'object' && (LAZY in v || typeof (v as { load?: unknown }).load === 'function');
}

/** The implementation type of a behaviour registry (rows with `impl: Lazy<I>`). */
export type ImplOf<K extends RegistryName> = EntryOf<K> extends { impl: Lazy<infer I> } ? I : never;
/** Registries whose rows carry `impl: Lazy<…>`: the ones `Services.bind` accepts. */
export type BehaviourRegistryName = { [K in RegistryName]: EntryOf<K> extends { impl: Lazy<unknown> } ? K : never }[RegistryName];

// ---- provenance and problems ----

/** One record per entry change, shown by the dev console ("which pack touched this?"). */
export interface Provenance { source: string; action: 'add' | 'patch' | 'remove' | 'drop' | 'restore'; note?: string }

export interface RegistryProblem {
  registry: string;
  id?: string;
  /** The module that added the row. */
  source?: string;
  /** The latest module that patched the row, when that is not its source. */
  patchedBy?: string;
  problem: string;
  /** What boot did about it (set by the kernel's validate phase). */
  resolution?: 'dropped' | 'pack-disabled';
}

/** Kernel-only surface. Reached through REGISTRY_ADMIN so feature code cannot freeze or roll back a registry. */
export interface RegistryAdmin<T extends { id: string }> {
  readonly owner: string;
  readonly frozen: boolean;
  readonly options: Readonly<RegistryOptions<T>>;
  freeze(): void;
  /** Removes every entry a module added and undoes its patches (its register() threw, it was disabled, or a pack's
   *  validation failed). Before freeze only, unless `afterFreeze` (the validate phase's pack rollback). Several
   *  sources roll back together, newest edit first, so layered patches from modules that all went out unwind. */
  rollback(source: string | ReadonlySet<string>, opts?: { afterFreeze?: boolean }): number;
  /** Patch phase only: replace or remove an entry and record why. */
  replace(id: string, next: T, source: string, note?: string): void;
  remove(id: string, source: string, note?: string): boolean;
  provenance(id: string): readonly Provenance[];
  /** The module that added the row (after alias resolution). */
  sourceOf(id: string): string | undefined;
  /** Runs validate() on every entry and problems() across all of them. mode 'drop' removes invalid entries. */
  check(mode: 'report' | 'drop'): RegistryProblem[];
  sources(): ReadonlyMap<string, string>;
}

export const REGISTRY_ADMIN: unique symbol = Symbol('engine.registry.admin');
export type AdminRegistry<T extends { id: string }> = Registry<T> & { readonly [REGISTRY_ADMIN]: RegistryAdmin<T> };

const ID = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

/** One patch-phase change, kept so a disabled pack's edits can be undone after freeze. */
interface JournalEntry<T> { id: string; source: string; prev: T | undefined; prevSource: string | undefined; next: T | undefined; undone?: boolean }

export function defineRegistry<T extends { id: string }>(name: string, opts: RegistryOptions<T> = {}, owner = 'core'): AdminRegistry<T> {
  const entries = new Map<string, T>();
  const source = new Map<string, string>();
  const alias = new Map<string, string>();
  const history = new Map<string, Provenance[]>();
  const journal: JournalEntry<T>[] = [];
  let frozen = false;
  let cache: readonly T[] | null = null;
  const log = (id: string, p: Provenance) => { let h = history.get(id); if (!h) history.set(id, h = []); h.push(p); };
  const mutable = (what: string) => { if (frozen) throw new Error(`[registry ${name}] ${what} after freeze: registries are read-only once boot reaches 'freeze'`); };
  const resolve = (id: string) => entries.has(id) ? id : alias.get(id);
  const invalidate = () => { cache = frozen ? Object.freeze([...entries.values()]) : null; };
  const reindexAliases = () => {
    alias.clear();
    for (const def of entries.values()) for (const a of opts.aliases?.(def) ?? []) if (!entries.has(a) && !alias.has(a)) alias.set(a, def.id);
  };
  const indexAliases = (def: T) => { for (const a of opts.aliases?.(def) ?? []) {
    if (entries.has(a) || (alias.has(a) && alias.get(a) !== def.id)) throw new Error(`[registry ${name}] alias '${a}' of '${def.id}' clashes with an existing id or alias`);
    alias.set(a, def.id);
  } };
  const lastPatcher = (id: string) => {
    const h = history.get(id) ?? [];
    for (let i = h.length - 1; i >= 0; i--) { const e = h[i]!; if (e.action === 'patch') return e.source; } // 0 <= i < h.length
    return undefined;
  };
  const admin: RegistryAdmin<T> = {
    owner,
    get frozen() { return frozen; },
    options: opts,
    freeze() { frozen = true; invalidate(); },
    rollback(src, o) {
      if (!o?.afterFreeze) mutable('rollback');
      const out = typeof src === 'string' ? new Set([src]) : src;
      let n = 0;
      // Undo these sources' patches, newest first, where nobody else changed the entry since.
      for (let i = journal.length - 1; i >= 0; i--) {
        const j = journal[i]!; // 0 <= i < journal.length
        if (!out.has(j.source) || j.undone) continue;
        j.undone = true;
        const current = entries.get(j.id);
        if (current !== j.next) { log(j.id, { source: j.source, action: 'restore', note: `not rolled back: changed after ${j.source} patched it` }); continue; }
        if (j.prev === undefined) { entries.delete(j.id); source.delete(j.id); }
        else { entries.set(j.id, j.prev); if (j.prevSource) source.set(j.id, j.prevSource); }
        log(j.id, { source: j.source, action: 'restore', note: 'patch rolled back' }); n++;
      }
      for (const [id, s] of [...source]) if (out.has(s)) { entries.delete(id); source.delete(id); log(id, { source: s, action: 'remove', note: 'rolled back' }); n++; }
      reindexAliases(); invalidate(); return n;
    },
    replace(id, next, src, note) {
      mutable('patch');
      if (next.id !== id) throw new Error(`[registry ${name}] a patch may not change an id (${id} -> ${next.id}); add an alias instead`);
      const prev = entries.get(id);
      if (!prev) throw new Error(`[registry ${name}] patch target '${id}' does not exist`);
      entries.set(id, next);
      try { indexAliases(next); } catch (e) { entries.set(id, prev); reindexAliases(); throw e; }
      journal.push({ id, source: src, prev, prevSource: source.get(id), next });
      log(id, { source: src, action: 'patch', note }); invalidate();
    },
    remove(id, src, note) {
      mutable('remove'); const real = resolve(id); if (!real) return false;
      journal.push({ id: real, source: src, prev: entries.get(real), prevSource: source.get(real), next: undefined });
      entries.delete(real); source.delete(real); reindexAliases(); log(real, { source: src, action: 'remove', note }); invalidate(); return true;
    },
    provenance: id => history.get(resolve(id) ?? id) ?? [],
    sourceOf: id => { const real = resolve(id); return real === undefined ? undefined : source.get(real); },
    check(mode) {
      const out: RegistryProblem[] = [];
      const attribute = (id: string) => {
        const src = source.get(id), by = lastPatcher(id);
        return { source: src, ...(by && by !== src ? { patchedBy: by } : {}) };
      };
      let dropped = false;
      for (const def of [...entries.values()]) {
        const own = [...((opts.idForm ?? ID).test(def.id) ? [] : [opts.idForm ? `id '${def.id}' does not match ${opts.idForm}` : `id '${def.id}' is not lowercase kebab-case`]), ...(opts.validate?.(def) ?? [])];
        for (const problem of own) out.push({ registry: name, id: def.id, ...attribute(def.id), problem, ...(mode === 'drop' ? { resolution: 'dropped' as const } : {}) });
        if (own.length && mode === 'drop') {
          entries.delete(def.id); source.delete(def.id); dropped = true;
          log(def.id, { source: 'core.validate', action: 'drop', note: own.join('; ') });
        }
      }
      if (dropped) { reindexAliases(); invalidate(); }
      for (const p of opts.problems?.([...entries.values()]) ?? []) {
        if (typeof p === 'string') out.push({ registry: name, problem: p });
        else out.push({ registry: name, id: p.id, ...(entries.has(p.id) ? attribute(p.id) : {}), problem: p.problem });
      }
      return out;
    },
    sources: () => source,
  };
  const reg: AdminRegistry<T> = {
    name,
    add(def, src) {
      mutable(`add('${def?.id}') from ${src}`);
      if (!def || typeof def.id !== 'string') throw new Error(`[registry ${name}] ${src} added an entry without an id`);
      if (entries.has(def.id) || alias.has(def.id)) throw new Error(`[registry ${name}] duplicate id '${def.id}' from ${src} (first added by ${source.get(def.id) ?? source.get(alias.get(def.id)!)})`);
      entries.set(def.id, def); source.set(def.id, src);
      try { indexAliases(def); } catch (e) { entries.delete(def.id); source.delete(def.id); reindexAliases(); throw e; }
      log(def.id, { source: src, action: 'add' }); invalidate();
    },
    get(id) {
      const hit = reg.find(id);
      if (!hit) throw new Error(`[registry ${name}] unknown id '${id}'`);
      return hit;
    },
    find(id) { const real = resolve(id); return real === undefined ? undefined : entries.get(real); },
    all() { return cache ??= [...entries.values()]; },
    where(pred) { return reg.all().filter(pred); },
    [REGISTRY_ADMIN]: admin,
  };
  return reg;
}

export function adminOf<T extends { id: string }>(r: Registry<T>): RegistryAdmin<T> {
  const a = (r as Partial<AdminRegistry<T>>)[REGISTRY_ADMIN];
  if (!a) throw new Error(`[registry ${r.name}] was not created by defineRegistry`);
  return a;
}
