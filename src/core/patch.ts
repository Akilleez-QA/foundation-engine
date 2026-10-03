// core/patch.ts: ordered, typed patches over registry entries (ModuleManager, adapted). ADR 0006, 0043.
// MM → engine:  @NODE[name] → edit/merge · !NODE → remove · &NODE (create if absent) → add{ifAbsent} · +NODE → copy
//             :FIRST → pass 'first' · (no pass, LEGACY) and :FOR[owner] → the owner's slot · :BEFORE[m]/:AFTER[m] → {before|after}
//             :FINAL → 'final' (pack.* modules only, a boot check) · :NEEDS[A&B|!C] → needs, same grammar
//             :HAS[...] → target predicate · wildcards * ? → target glob
// Deliberate differences: module slots follow dependency order, not alphabetical names (no 'zzz' sort keys); there
// is no :LAST; a skipped or unmatched patch is reported, never silent; a throwing patch leaves its entry untouched.
import { adminOf, isLazy, type EntryOf, type Registry, type RegistryName } from './registry';

export type PatchPass = 'first' | 'default' | 'final' | { before: string } | { after: string };

export type DeepPartial<T> = T extends (...a: never[]) => unknown ? T
  : T extends readonly unknown[] ? T
  : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

export type PatchOp<T> =
  | { kind: 'edit'; edit: (draft: T) => T | void }
  | { kind: 'merge'; merge: DeepPartial<T> }
  | { kind: 'remove' }
  | { kind: 'add'; def: T; ifAbsent?: boolean }
  | { kind: 'copy'; as: string; edit?: (draft: T) => T | void };

export interface PatchOf<K extends RegistryName> {
  /** Unique within the owning module: 'halloween-prices'. Reported as '<module>/<id>'. */
  id: string;
  registry: K;
  /** An id, a glob ('set.*', 'hat-?'), a list, or a predicate (MM :HAS). Ignored by 'add'. */
  target?: string | readonly string[] | ((def: EntryOf<K>) => boolean);
  pass?: PatchPass;
  /** MM grammar: ',' and '&' are AND, '|' is OR and binds tighter, '!' negates one term. Terms are module ids,
   *  provided ids, or 'flag:<setting-id>'. */
  needs?: string;
  op: PatchOp<EntryOf<K>>;
}

/** A patch for any registry (a distributive union, so `registry` narrows `op`). */
export type Patch = { [K in RegistryName]: PatchOf<K> }[RegistryName];
/** ADR 0006's name for the same thing. */
export type ContentPatch = Patch;
/** The registry-agnostic shape every `Patch` satisfies (what the kernel orders and applies). */
export interface AnyPatch {
  id: string;
  registry: string;
  target?: string | readonly string[] | ((def: never) => boolean);
  pass?: PatchPass;
  needs?: string;
  op: { kind: PatchOp<{ id: string }>['kind'] };
}

/** Typed constructor: patch('shopSets', { id: 'x', target: 'set.*', op: { kind: 'merge', merge: { price: 3 } } }). */
export function patch<K extends RegistryName>(registry: K, p: Omit<PatchOf<K>, 'registry'>): Patch {
  return { ...p, registry } as Patch;
}

export interface PatchRecord { patch: string; owner: string; pass: string; targets: string[] }
export interface PatchReport {
  applied: PatchRecord[];
  skipped: { patch: string; owner: string; reason: string }[];
  errors: { patch: string; owner: string; target?: string; error: string }[];
}

// ---- needs ----
export function evaluateNeeds(expr: string | undefined, has: (term: string) => boolean): boolean {
  if (!expr || !expr.trim()) return true;
  return expr.split(/[,&]/).every(and => {
    const ors = and.split('|').map(t => t.trim());
    if (ors.some(t => !t || t === '!')) throw new Error(`empty term in needs '${expr}'`);
    return ors.some(t => t.startsWith('!') ? !has(t.slice(1).trim()) : has(t));
  });
}

// ---- matching ----
const globRe = (g: string) => new RegExp('^' + g.replace(/[.+^${}()[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
type MatchTarget = string | readonly string[] | ((def: { id: string }) => boolean) | undefined;
function matchIds<T extends { id: string }>(all: readonly T[], target: MatchTarget): string[] {
  if (target === undefined) return [];
  if (typeof target === 'function') return all.filter(d => target(d)).map(d => d.id);
  const list = typeof target === 'string' ? [target] : target;
  const out = new Set<string>();
  for (const t of list) {
    if (/[*?]/.test(t)) { const re = globRe(t); for (const d of all) if (re.test(d.id)) out.add(d.id); }
    else if (all.some(d => d.id === t)) out.add(t);
  }
  return [...out];
}

/** Copies plain data deeply and keeps functions, class instances and lazy handles by reference. */
export function cloneData<T>(v: T): T {
  if (Array.isArray(v)) return v.map(cloneData) as T;
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype && !isLazy(v)) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = cloneData(x);
    return o as T;
  }
  return v;
}
function mergeInto(target: Record<string, unknown>, src: Record<string, unknown>) {
  for (const [k, v] of Object.entries(src)) {
    const cur = target[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      mergeInto(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else target[k] = cloneData(v);
  }
}

// ---- ordering ----
export interface OwnedPatch { owner: string; index: number; patch: AnyPatch }
const passName = (p: PatchPass | undefined) => typeof p === 'object' ? ('before' in p ? `before:${p.before}` : `after:${p.after}`) : (p ?? 'default');

export interface PatchOrderOptions {
  /** `final` is allowed only for `pack.*` modules. Defaults to that rule. */
  finalAllowed?: (owner: string) => boolean;
}
const packOnly = (owner: string) => owner.startsWith('pack.');

/** The full order. `order` is the discover-phase module order (dependencies first). */
export function orderPatches(all: readonly OwnedPatch[], order: readonly string[], o: PatchOrderOptions = {}):
  { run: OwnedPatch[]; orphaned: OwnedPatch[]; rejected: OwnedPatch[] } {
  const finalAllowed = o.finalAllowed ?? packOnly;
  const rank = new Map(order.map((id, i) => [id, i]));
  const byOwner = (a: OwnedPatch, b: OwnedPatch) => ((rank.get(a.owner) ?? Infinity) - (rank.get(b.owner) ?? Infinity)) || a.index - b.index;
  const rejected = all.filter(p => p.patch.pass === 'final' && !finalAllowed(p.owner));
  const eligible = all.filter(p => !rejected.includes(p));
  const run: OwnedPatch[] = [], orphaned: OwnedPatch[] = [];
  const pick = (f: (p: OwnedPatch) => boolean) => eligible.filter(f).sort(byOwner);
  run.push(...pick(p => p.patch.pass === 'first'));
  for (const m of order) {
    run.push(...pick(p => typeof p.patch.pass === 'object' && 'before' in p.patch.pass && p.patch.pass.before === m));
    run.push(...pick(p => p.owner === m && (p.patch.pass === undefined || p.patch.pass === 'default')));
    run.push(...pick(p => typeof p.patch.pass === 'object' && 'after' in p.patch.pass && p.patch.pass.after === m));
  }
  run.push(...pick(p => p.patch.pass === 'final'));
  for (const p of eligible) if (!run.includes(p)) orphaned.push(p);   // before/after a module that is absent or disabled
  return { run, orphaned, rejected };
}

// ---- application ----
export function applyPatches(registries: Readonly<Record<string, Registry<{ id: string }> | undefined>>, all: readonly OwnedPatch[], order: readonly string[], has: (term: string) => boolean, o: PatchOrderOptions = {}): PatchReport {
  const report: PatchReport = { applied: [], skipped: [], errors: [] };
  const { run, orphaned, rejected } = orderPatches(all, order, o);
  const name = (x: OwnedPatch) => `${x.owner}/${x.patch.id}`;
  for (const x of rejected) report.errors.push({ patch: name(x), owner: x.owner, error: `pass 'final' is reserved for pack.* modules (the patch rule)` });
  for (const x of orphaned) report.skipped.push({ patch: name(x), owner: x.owner, reason: `${passName(x.patch.pass)}: that module is not installed` });
  for (const x of run) {
    const p = x.patch;
    const reg = registries[p.registry];
    if (!reg) { report.errors.push({ patch: name(x), owner: x.owner, error: `unknown registry '${p.registry}'` }); continue; }
    let ok: boolean;
    try { ok = evaluateNeeds(p.needs, has); } catch (e) { report.errors.push({ patch: name(x), owner: x.owner, error: String((e as Error).message) }); continue; }
    if (!ok) { report.skipped.push({ patch: name(x), owner: x.owner, reason: `needs '${p.needs}' not met` }); continue; }
    const admin = adminOf(reg), op = p.op as PatchOp<{ id: string }>, touched: string[] = [];
    if (op.kind === 'add') {
      if (reg.find(op.def.id)) {
        if (op.ifAbsent) { report.skipped.push({ patch: name(x), owner: x.owner, reason: `'${op.def.id}' already exists` }); continue; }
        report.errors.push({ patch: name(x), owner: x.owner, target: op.def.id, error: 'add: id exists (use ifAbsent or edit)' }); continue;
      }
      try { reg.add(cloneData(op.def), x.owner); touched.push(op.def.id); }
      catch (e) { report.errors.push({ patch: name(x), owner: x.owner, target: op.def.id, error: (e as Error).message }); }
    } else {
      const ids = matchIds(reg.all(), p.target as MatchTarget);
      if (!ids.length) { report.skipped.push({ patch: name(x), owner: x.owner, reason: `no entry matches ${String(p.target)}` }); continue; }
      for (const id of ids) {
        try {
          if (op.kind === 'remove') { admin.remove(id, x.owner, name(x)); touched.push(id); continue; }
          const draft = cloneData(reg.get(id));
          if (op.kind === 'copy') {
            const copy = { ...draft, id: op.as }; const next = op.edit?.(copy) ?? copy;
            reg.add(next, x.owner); touched.push(op.as); continue;
          }
          const next = op.kind === 'merge' ? (mergeInto(draft, op.merge as Record<string, unknown>), draft) : (op.edit(draft) ?? draft);
          admin.replace(id, next, x.owner, name(x)); touched.push(id);
        } catch (e) { report.errors.push({ patch: name(x), owner: x.owner, target: id, error: (e as Error).message }); }
      }
    }
    if (touched.length) report.applied.push({ patch: name(x), owner: x.owner, pass: passName(p.pass), targets: touched });
  }
  return report;
}
