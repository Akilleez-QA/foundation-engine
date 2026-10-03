// core/app.ts: the composition root's engine. Boot phases (STD-MOD-13):
//   discover → register → patch → freeze → validate → install → start
// D5/D5a/D6, ADR 0003, 0036, 0043, 0063. The game boots through it from app/main.ts.
import { createEventBus, eventArea, KERNEL_EVENT_AREAS, type BootPhase, type EventBus, type EventBusDebug, type EventKey, type EngineEvents } from './events';
import { adminOf, defineRegistry, isLazy, type Registries, type Registry, type RegistryProblem, type RegistryOptions, type Lazy } from './registry';
import type { OwnedPatch, PatchReport } from './patch';
import { compareModuleIds, layerRank, LAYER_PREFIXES, moduleBudgetFor, type EngineModule, type Disposable } from './module';
import { satisfies, splitDep } from './version';
import { KERNEL_SERVICE_KEYS, type AppInfo, type Availability, type AvailabilityResult, type BoundSet, type Logger, type ModuleAvailability, type Services } from './services';
import { createProbes, type ProbeReader } from './probe';
import type { QualityPreset } from './tiers';
import type { AppMode, Binding, BindRecord, BootReport, ModuleReport } from './types';

export type { BindRecord, BootReport } from './types';

export interface AppOptions {
  mode: AppMode;
  build?: AppInfo['build'];
  /** Resolves 'flag:<id>' terms in patch needs (settings spec A6). */
  flag?: (id: string) => boolean;
  now?: () => number;
  /** Which budget column applies (ADR 0017 preset); 'reference' unless the quality service says otherwise. */
  preset?: QualityPreset;
  /** Whether probes record. Default: on outside 'prod'; a production build with the test API turns it on. */
  probes?: boolean;
  log?: (level: 'info' | 'warn' | 'error', source: string, msg: string, data?: unknown) => void;
  /** The bus to boot on. The game passes its app-wide bus (core/app-events.ts) so kernel events and the code that
   *  still emits on that bus directly share one bus; default a new bus. */
  events?: EventBus & EventBusDebug;
  /** Where the module at `index` in the list came from (its manifest or list file), named when two modules share an id. */
  sourceOf?: (m: EngineModule, index: number) => string | undefined;
}

export interface App {
  boot(): Promise<BootReport>;
  dispose(): void;
  readonly events: EventBus & EventBusDebug;
  readonly registries: Registries;
  /** The kernel-level view of services (app/ composition and dev/test-api only). */
  readonly services: Services;
  /** The read side of `Services.probes`: the test API's `engine.probe()` and the dev console read through it. */
  readonly probes: ProbeReader;
}

export class BootValidationError extends Error {
  constructor(readonly problems: RegistryProblem[]) {
    super(`${problems.length} registry problem(s):\n` + problems.map(p => `  ${p.registry}${p.id ? `[${p.id}]` : ''}${p.source ? ` (from ${p.source})` : ''}: ${p.problem}`).join('\n'));
    this.name = 'BootValidationError';
  }
}

/**
 * The kernel keeps registries in a runtime table keyed by name; `Registries` is the declaration-merged view every
 * module augments. Which names exist is checked at run time (an unknown name throws in the register view).
 */
function registriesView(table: Record<string, Registry<{ id: string }>>): Registries {
  // lint:allow-unknown-cast a runtime table (or its Proxy) presented as the module-augmented Registries interface.
  return table as unknown as Registries;
}
/** A Proxy that resolves kernel members and provided services by key, presented as the module-augmented `Services`. */
function servicesView(view: object): Services {
  // lint:allow-unknown-cast a Proxy over kernel members and provided services; keys are checked at run time.
  return view as unknown as Services;
}

const FOUNDATIONAL = 'core.';
const AREA = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function createApp(input: readonly EngineModule[], opts: AppOptions): App {
  const now = opts.now ?? (() => performance.now());
  const sink = opts.log ?? ((level, source, msg, data) => console[level](`[${source}] ${msg}`, data ?? ''));
  const events = opts.events ?? createEventBus({ onListenerError: (k, e) => sink('error', 'core.events', `listener for ${k} threw`, e) });
  const registries: Record<string, Registry<{ id: string }>> = {};
  const typedRegistries = registriesView(registries);
  const provided = new Map<string, { impl: unknown; by: string }>();
  const serviceClaims = new Map<string, string>();
  const areaClaims = new Map<string, string>(KERNEL_EVENT_AREAS.map(a => [a, 'core'] as const));
  const disposers: { id: string; d: Disposable; ctl: AbortController }[] = [];
  const reports = new Map<string, ModuleReport>();
  const warnings: string[] = [];
  const phases: BootPhase[] = [];
  const bindings = new Map<string, BindRecord>();
  const appCtl = new AbortController();
  const pendingInstalls = new Set<{ ctl: AbortController; revoke(): void }>();
  const disposeResult = (id: string, d: Disposable) => {
    try { d.dispose(); }
    catch (error) { try { sink('error', id, 'dispose threw', error); } catch { /* Cleanup must continue even if diagnostics fail. */ } }
  };
  const probes = createProbes(opts.probes ?? opts.mode !== 'prod');
  let order: string[] = [];
  let problems: RegistryProblem[] = [];
  let patches: PatchReport = { applied: [], skipped: [], errors: [] };
  let recovery: BootReport['recovery'];
  let started = 0, finished = 0, booted = false;

  const byId = new Map<string, EngineModule>();
  /** Every discovered module in the deterministic order: layer prefix, then id. */
  let ranked: EngineModule[] = [];

  const report = (): BootReport => ({
    mode: opts.mode, phases: [...phases], order: [...order], modules: [...reports.values()].map(r => ({ ...r })),
    registries: Object.values(registries).map(r => ({ name: r.name, owner: adminOf(r).owner, count: r.all().length })),
    problems, patches, warnings, bindings: [...bindings.values()], ...(recovery ? { recovery } : {}),
    ms: (finished || now()) - started,
  });

  const status = (id: string) => reports.get(id)?.status;
  /** Eligible for the rest of boot: discovered and not disabled or failed (ADR 0063's candidate set). */
  const alive = (id: string) => { const s = status(id); return s === 'candidate' || s === 'installed'; };
  const installed = (id: string) => status(id) === 'installed';
  /** The module that answers a dependency id: itself if alive, else a live module that `provides` it. */
  const provider = (dep: string): EngineModule | undefined => {
    const direct = byId.get(dep);
    if (direct && alive(direct.id)) return direct;
    return ranked.find(m => alive(m.id) && m.provides?.includes(dep)) ?? direct;
  };
  const hasInstalled = (id: string) => installed(id) || ranked.some(m => installed(m.id) && m.provides?.includes(id));
  const hasCandidate = (id: string) => alive(id) || ranked.some(m => alive(m.id) && m.provides?.includes(id));

  const appInfo: AppInfo = {
    mode: opts.mode, build: opts.build ?? { commit: 'dev', builtAt: '', version: '0.0.0' },
    report, has: hasInstalled,
  };

  const fail = (m: EngineModule, phase: NonNullable<ModuleReport['phase']>, reason: string, next: 'disabled' | 'failed' = 'failed') => {
    const r = reports.get(m.id)!; r.status = next; r.phase = phase; r.reason = reason;
    sink(next === 'failed' ? 'error' : 'warn', m.id, `${next} in ${phase}: ${reason}`);
    if (next === 'failed') events.emit('app.module-failed', { id: m.id, phase, error: reason });
  };
  /** Disable every live module that hard-requires a module that is no longer alive (fixed point). */
  const cascade = (phase: NonNullable<ModuleReport['phase']>) => {
    for (let changed = true; changed;) {
      changed = false;
      for (const m of ranked) if (alive(m.id)) for (const dep of m.requires ?? []) {
        const { id, range } = splitDep(dep), p = provider(id);
        if (!p || !alive(p.id)) { fail(m, phase, `requires ${id}, which is ${p ? status(p.id) : 'missing'}`, 'disabled'); changed = true; break; }
        if (range && !satisfies(p.version, range)) { fail(m, phase, `requires ${dep}, found ${p.id}@${p.version}`, 'disabled'); changed = true; break; }
      }
    }
  };
  /** Module ids a module may lean on: itself plus its transitive requires/optional closure. */
  const closure = (m: EngineModule, seen = new Set<string>()): Set<string> => {
    if (seen.has(m.id)) return seen; seen.add(m.id);
    for (const dep of [...(m.requires ?? []), ...(m.optional ?? [])]) { const p = provider(splitDep(dep).id); if (p) closure(p, seen); }
    return seen;
  };
  const resolved = (m: EngineModule, deps: readonly string[] | undefined) =>
    (deps ?? []).map(d => provider(splitDep(d).id)?.id).filter((x): x is string => !!x && x !== m.id && alive(x));

  // ---- phase 1: discover ----
  function discover() {
    // A module id names one module (STD-MOD-12, STD-REG-4). Two modules with one id are a composition-root defect that no
    // mode may paper over: keeping either copy silently drops the other's rows and services (STD-PRI-11 forbids a silent
    // substitute). It is not a dependency problem that STD-MOD-15 disables, and not one bad row that STD-MOD-17 lets
    // production drop, because there is no row to drop, only a choice of which module is real. So boot fails in every
    // mode, before anything registers or installs (saved data is untouched, STD-MOD-21), and names both sources.
    const where = (m: EngineModule, i: number) => `${opts.sourceOf?.(m, i) ?? 'module list'} #${i}`;
    const first = new Map<string, number>(), duplicates: RegistryProblem[] = [];
    input.forEach((m, i) => {
      const had = first.get(m.id);
      if (had !== undefined) {
        // `had` is an index this forEach recorded for an earlier element of `input`.
        duplicates.push({ registry: 'modules', id: m.id, problem: `module id declared twice, by ${where(input[had]!, had)} and by ${where(m, i)}; boot stops` });
        return;
      }
      first.set(m.id, i);
      byId.set(m.id, m); reports.set(m.id, { id: m.id, version: m.version, status: 'candidate', ms: 0 });
      if (layerRank(m.id) === LAYER_PREFIXES.length) warnings.push(`${m.id} has no layer prefix (${LAYER_PREFIXES.join(' ')}); it boots after every layer`);
    });
    // The composition root logs the thrown error (app/main.ts), in production too.
    if (duplicates.length) throw new BootValidationError(problems = duplicates);
    ranked = [...byId.values()].sort((a, b) => compareModuleIds(a.id, b.id));
    const rank = new Map(ranked.map((m, i) => [m.id, i]));
    for (const m of ranked) for (const c of m.conflicts ?? []) {
      const other = provider(splitDep(c).id);
      if (other && other !== m && alive(other.id) && alive(m.id)) {
        const later = rank.get(m.id)! > rank.get(other.id)! ? m : other;
        fail(later, 'discover', `conflicts with ${later === m ? other.id : m.id}`, 'disabled');
      }
    }
    cascade('discover');
    order = sortByDependencies();
    claims();
    order = order.filter(alive);
  }

  /** Kahn's algorithm with the layer/id tie-break. Members of a `requires` cycle are disabled (their dependants
   *  cascade); a loop closed only by `optional` edges drops those edges from ordering, with a warning. */
  function sortByDependencies(): string[] {
    const ignored = new Set<string>();
    for (;;) {
      const live = ranked.filter(m => alive(m.id));
      const deps = new Map(live.map(m => [m.id, new Set([...resolved(m, m.requires), ...resolved(m, m.optional).filter(d => !ignored.has(`${m.id}>${d}`))])]));
      const out: string[] = [], done = new Set<string>();
      for (;;) {
        const next = live.find(m => !done.has(m.id) && [...deps.get(m.id)!].every(d => done.has(d)));
        if (!next) break;
        out.push(next.id); done.add(next.id);
      }
      if (out.length === live.length) return out;
      const stuck = live.filter(m => !done.has(m.id));
      const stuckIds = new Set(stuck.map(m => m.id));
      const cycles = stronglyConnected(stuck.map(m => m.id), id => resolved(byId.get(id)!, byId.get(id)!.requires).filter(d => stuckIds.has(d)))
        .filter(c => c.length > 1);
      if (cycles.length) {
        for (const c of cycles) for (const id of c) fail(byId.get(id)!, 'discover', `dependency cycle among ${[...c].sort(compareModuleIds).join(', ')}`, 'disabled');
        cascade('discover');
        continue;
      }
      for (const m of stuck) for (const d of resolved(m, m.optional)) if (stuckIds.has(d) && !ignored.has(`${m.id}>${d}`)) {
        ignored.add(`${m.id}>${d}`);
        warnings.push(`optional dependency ${m.id} -> ${d} closes a cycle; it does not order boot`);
      }
    }
  }

  /** ADR 0063: exclusive `serviceKeys` and `eventAreas` claims, checked before anything registers or installs. */
  function claims() {
    const reserved = new Set<string>(KERNEL_SERVICE_KEYS);
    for (const id of order) {
      const m = byId.get(id)!; if (!alive(id)) continue;
      let problem: string | undefined;
      for (const key of m.serviceKeys ?? []) {
        const k = String(key);
        if (reserved.has(k)) problem = `claims service '${k}', which is reserved by the kernel`;
        else if (serviceClaims.has(k)) problem = `claims service '${k}', already claimed by ${serviceClaims.get(k)}`;
        if (problem) break;
      }
      if (!problem) for (const area of m.eventAreas ?? []) {
        if (!AREA.test(area)) problem = `claims event area '${area}', which is not one lowercase kebab-case segment`;
        else if (areaClaims.get(area) === 'core') problem = `claims event area '${area}', which is reserved by the kernel`;
        else if (areaClaims.has(area)) problem = `claims event area '${area}', already claimed by ${areaClaims.get(area)}`;
        if (problem) break;
      }
      if (problem) { fail(m, 'discover', problem, 'disabled'); continue; }
      for (const key of m.serviceKeys ?? []) serviceClaims.set(String(key), id);
      for (const area of m.eventAreas ?? []) areaClaims.set(area, id);
    }
    cascade('discover');
  }

  // ---- phase 2: register ----
  function registerPhase() {
    // Registries first, so a module may add to a registry whatever its position in the order (its owner is required).
    for (const id of order) {
      const m = byId.get(id)!;
      for (const [name, o] of Object.entries(m.defines ?? {}) as [string, RegistryOptions<{ id: string }>][]) {
        if (registries[name]) { fail(m, 'register', `defines registry '${name}', already defined by ${adminOf(registries[name]).owner}`); continue; }
        registries[name] = defineRegistry(name, o, m.id);
      }
    }
    for (const id of order) {
      const m = byId.get(id)!; if (!alive(id) || !m.register) continue;
      const allowed = closure(m), t0 = now();
      const view = registriesView(new Proxy(registries, { get(t, k) {
        if (typeof k !== 'string') return undefined;
        const r = t[k];
        if (!r) throw new Error(`registry '${k}' does not exist (is its owner installed and required?)`);
        const owner = adminOf(r).owner;
        if (!allowed.has(owner) && owner !== 'core') warnings.push(`${id} uses registry '${k}' owned by ${owner} without requiring it`);
        return r;
      } }));
      try { m.register(view); }
      catch (e) {
        for (const r of Object.values(registries)) adminOf(r).rollback(id);
        fail(m, 'register', (e as Error).message);
      }
      reports.get(id)!.ms += now() - t0;
    }
    cascade('register');
    dropDead();
  }
  /** Before freeze: entries from modules that are out are rolled back; registries whose owner is out go away. */
  function dropDead() {
    for (const [id, r] of reports) if (r.status === 'disabled' || r.status === 'failed') for (const reg of Object.values(registries)) if (!adminOf(reg).frozen) adminOf(reg).rollback(id);
    for (const [name, reg] of Object.entries(registries)) if (!adminOf(reg).frozen && !alive(adminOf(reg).owner)) delete registries[name];
    order = order.filter(alive);
  }

  // ---- phase 3: patch ----
  function patchPhase(): Promise<void> | void {
    const all: OwnedPatch[] = [];
    for (const id of order) (byId.get(id)!.patches ?? []).forEach((patch, index) => all.push({ owner: id, index, patch }));
    // The patch engine loads only when a module brings patches (a pack), so it never weighs on the first-load bundle.
    if (!all.length) return;
    return import('./patch').then(({ applyPatches }) => {
      // Patch eligibility uses the candidate set: nothing has installed yet (ADR 0063).
      const has = (term: string) => term.startsWith('flag:') ? !!opts.flag?.(term.slice(5)) : hasCandidate(term);
      patches = applyPatches(registries, all, order, has);
      for (const e of patches.errors) warnings.push(`patch ${e.patch}${e.target ? ` on ${e.target}` : ''}: ${e.error}`);
    });
  }

  // ---- phase 5: validate ----
  function validatePhase() {
    const packOf = (p: RegistryProblem) => [p.source, p.patchedBy].find(s => !!s && s.startsWith('pack.') && alive(s));
    const packProblems: RegistryProblem[] = [];
    // ADR 0043: a pack's problems disable that pack (and its dependants), roll back its rows, and never throw.
    let last: RegistryProblem[] = [];
    for (;;) {
      const found = last = Object.values(registries).flatMap(r => adminOf(r).check('report'));
      const packs = new Set(found.map(packOf).filter((s): s is string => !!s));
      if (!packs.size) break;
      for (const p of found) if (packOf(p)) packProblems.push({ ...p, resolution: 'pack-disabled' });
      const before = new Set([...reports.values()].filter(r => !alive(r.id)).map(r => r.id));
      for (const pack of packs) fail(byId.get(pack)!, 'validate', found.filter(p => packOf(p) === pack).map(p => `${p.registry}${p.id ? `[${p.id}]` : ''}: ${p.problem}`).join('; '), 'disabled');
      cascade('validate');
      const out = new Set([...reports.values()].filter(r => !alive(r.id) && !before.has(r.id)).map(r => r.id));
      for (const reg of Object.values(registries)) adminOf(reg).rollback(out, { afterFreeze: true });
      order = order.filter(alive);
    }
    const rest = opts.mode === 'prod' ? Object.values(registries).flatMap(r => adminOf(r).check('drop')) : last;
    problems = [...packProblems, ...rest];
    for (const p of packProblems) sink('warn', 'core.validate', `${p.registry}${p.id ? `[${p.id}]` : ''}: ${p.problem} (pack disabled)`);
    if (opts.mode !== 'prod' && rest.length) throw new BootValidationError(rest);
    for (const p of rest) sink('warn', 'core.validate', `${p.registry}${p.id ? `[${p.id}]` : ''}: ${p.problem}${p.id ? ' (dropped)' : ''}`);
  }

  // ---- phase 6: install ----
  /** Installs from position `from` in the order. An install that returns a promise is awaited; synchronous installs run
   *  back to back with no microtask between them, as the statements of the boot they replace did. */
  function installPhase(from = 0): Promise<void> | void {
    for (let i = from; i < order.length; i++) {
      appCtl.signal.throwIfAborted();
      const id = order[i]!; // i < order.length
      const m = byId.get(id)!; if (!alive(id)) continue;
      const ctl = new AbortController(), allowed = closure(m), t0 = now();
      const claimedKeys = new Set((m.serviceKeys ?? []).map(String)), claimedAreas = new Set(m.eventAreas ?? []);
      const log: Logger = { info: (s, d) => sink('info', id, s, d), warn: (s, d) => sink('warn', id, s, d), error: (s, d) => sink('error', id, s, d) };
      // Every subscription a module makes dies with the module (its install failed, or the app was disposed).
      const scopedEvents: EventBus = {
        on: (k, fn, signal) => events.on(k, fn, signal ? AbortSignal.any([signal, ctl.signal]) : ctl.signal),
        emit: (k, p) => {
          appCtl.signal.throwIfAborted(); ctl.signal.throwIfAborted();
          const area = eventArea(k);
          if (!claimedAreas.has(area)) throw new Error(`${id} emitted '${k}' but does not claim event area '${area}'${areaClaims.has(area) ? ` (owned by ${areaClaims.get(area)})` : ''}`);
          events.emit(k, p);
        },
      };
      const mine: string[] = [];
      const pending = { ctl, revoke: () => { for (const key of mine) if (provided.get(key)?.by === id) provided.delete(key); } };
      pendingInstalls.add(pending);
      const base = {
        events: scopedEvents, registries: typedRegistries, log, app: appInfo, probes, signal: ctl.signal, availability,
        provide(key: string, impl: unknown) {
          appCtl.signal.throwIfAborted(); ctl.signal.throwIfAborted();
          if (!claimedKeys.has(key)) throw new Error(`${id} provided service '${key}' without claiming it in serviceKeys${serviceClaims.has(key) ? ` (claimed by ${serviceClaims.get(key)})` : ''}`);
          const had = provided.get(key); if (had) throw new Error(`service '${key}' is already provided by ${had.by}`);
          provided.set(key, { impl, by: id }); mine.push(key);
        },
        bind: (registry: string, ids: readonly string[], signal: AbortSignal) => bind(id, registry, ids, signal),
      };
      const s = servicesView(new Proxy(base, { get(t, k) {
        if (typeof k !== 'string') return undefined;
        if (k in t) return (t as Record<string, unknown>)[k];
        const p = provided.get(k);
        if (!p) throw new Error(`service '${k}' is not provided (is its owner installed, and does ${id} require it?)`);
        if (!allowed.has(p.by)) warnings.push(`${id} uses service '${k}' from ${p.by} without requiring it`);
        return p.impl;
      } }));
      const installedAs = (d: void | Disposable) => {
        pendingInstalls.delete(pending);
        if (appCtl.signal.aborted || ctl.signal.aborted) {
          pending.revoke();
          ctl.abort(appCtl.signal.reason);
          if (d) disposeResult(id, d);
          return;
        }
        disposers.push({ id, d: d ?? { dispose() {} }, ctl });
        reports.get(id)!.status = 'installed';
      };
      const failed = (e: unknown) => {
        pendingInstalls.delete(pending);
        ctl.abort(e); pending.revoke();
        if (appCtl.signal.aborted) return;
        fail(m, 'install', e instanceof Error ? e.message : String(e));
        // Required failure cascades before any dependant installs (ADR 0063).
        cascade('install');
      };
      const timed = () => {
        const r = reports.get(id)!; r.ms += now() - t0;
        const limit = moduleBudgetFor(m.budget, 'bootMs', opts.preset ?? 'reference');
        if (limit !== undefined && r.ms > limit) { r.overBudget = true; warnings.push(`${id} took ${r.ms.toFixed(1)} ms, ${opts.preset ?? 'reference'} budget ${limit} ms`); }
      };
      let result: ReturnType<NonNullable<EngineModule['install']>>;
      try { result = m.install?.(s); } catch (e) { failed(e); timed(); continue; }
      if (result instanceof Promise) return result.then(installedAs, failed).then(() => { timed(); return installPhase(i + 1); });
      installedAs(result); timed();
    }
    order = order.filter(installed);
  }

  // ---- availability (ADR 0063) ----
  let published = false;
  let snapshot: readonly ModuleAvailability[] = [];
  const entryCache = new Map<string, AvailabilityResult>();
  const moduleResult = (id: string): AvailabilityResult => {
    if (hasInstalled(id)) return { available: true };
    const m = provider(id), r = m && reports.get(m.id);
    return { available: false, reason: r ? `${r.id} is ${r.status}${r.reason ? `: ${r.reason}` : ''}` : `${id} is not part of this build` };
  };
  const requirePublished = () => { if (!published) throw new Error('availability is published when install settles; read it at an execution boundary, after app.started'); };
  const entryResult = (registry: string, id: string, visiting: Set<string>): AvailabilityResult => {
    const key = `${registry}\u0000${id}`;
    const hit = entryCache.get(key); if (hit) return hit;
    if (visiting.has(key)) return { available: true };   // a reference cycle is judged by its other edges
    visiting.add(key);
    const result = ((): AvailabilityResult => {
      const reg = registries[registry];
      if (!reg) return { available: false, reason: `registry '${registry}' does not exist` };
      const admin = adminOf(reg), row = reg.find(id);
      if (!row) return { available: false, reason: `no '${id}' in ${registry}` };
      const gate = (who: string, what: string): AvailabilityResult | undefined => {
        if (who === 'core') return undefined;
        const r = moduleResult(who);
        return r.available ? undefined : { available: false, reason: `${what}: ${r.reason}` };
      };
      const owner = gate(admin.owner, `${registry} is owned by ${admin.owner}`); if (owner) return owner;
      const src = admin.sourceOf(id);
      if (src) { const g = gate(src, `${registry}[${row.id}] was added by ${src}`); if (g) return g; }
      for (const ex of admin.options.executors?.(row) ?? []) { const g = gate(ex, `${registry}[${row.id}] runs in ${ex}`); if (g) return g; }
      for (const ref of admin.options.requiresRows?.(row) ?? []) {
        const r = entryResult(ref.registry, ref.id, visiting);
        if (!r.available) return { available: false, reason: `${registry}[${row.id}] requires ${ref.registry}[${ref.id}]: ${r.reason}` };
      }
      return { available: true };
    })();
    visiting.delete(key);
    entryCache.set(key, Object.freeze(result));
    return result;
  };
  const availability: Availability = {
    forEntry(registry, id) { requirePublished(); return entryResult(registry, id, new Set()); },
    forModule(id) { requirePublished(); return moduleResult(id); },
    modules() { requirePublished(); return snapshot; },
    get published() { return published; },
  };
  function publishAvailability() {
    snapshot = Object.freeze(ranked.map(m => { const r = reports.get(m.id)!; return Object.freeze({ id: m.id, status: r.status, ...(r.reason ? { reason: r.reason } : {}) }); }));
    published = true;
    const down = ranked.filter(m => m.id.startsWith(FOUNDATIONAL) && !installed(m.id)).map(m => m.id);
    if (down.length) {
      recovery = { modules: down, reason: down.map(id => `${id}: ${reports.get(id)!.reason ?? reports.get(id)!.status}`).join('; ') };
      sink('error', 'core', `foundational module(s) did not install; the shell must open recovery: ${recovery.reason}`);
    }
  }

  // ---- lazy behaviour binding (ADR 0043) ----
  async function bind(by: string, registry: string, ids: readonly string[], signal: AbortSignal): Promise<BoundSet<unknown>> {
    signal.throwIfAborted();
    requirePublished();
    let onAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    aborted.catch(() => {});
    const one = async (id: string): Promise<Binding<unknown>> => {
      const placeholder = (reason: string): Binding<unknown> => ({ id, status: 'placeholder', valid: false, reason });
      const reg = registries[registry];
      const row = reg?.find(id) as { id: string; impl?: unknown } | undefined;
      if (!reg) return placeholder(`registry '${registry}' does not exist`);
      if (!row) return placeholder(`no '${id}' in ${registry}: its helper isn't installed`);
      const a = entryResult(registry, id, new Set());
      if (!a.available) return placeholder(a.reason);
      if (!isLazy(row.impl)) return placeholder(`${registry}[${row.id}] has no lazy impl`);
      try { return { id, status: 'bound', valid: true, impl: await Promise.race([(row.impl as Lazy<unknown>).load(), aborted]) }; }
      catch (e) { if (signal.aborted) throw signal.reason; return { id, status: 'failed', valid: false, reason: e instanceof Error ? e.message : String(e) }; }
    };
    try {
      const unique = [...new Set(ids)];
      const list = await Promise.all(unique.map(one));
      signal.throwIfAborted();
      for (const b of list) bindings.set(`${by}\u0000${registry}\u0000${b.id}`, { module: by, registry, id: b.id, status: b.status, ...(b.valid ? {} : { reason: b.reason }) });
      const map = new Map(list.map(b => [b.id, b]));
      return Object.freeze({
        get: (id: string) => map.get(id) ?? { id, status: 'placeholder' as const, valid: false as const, reason: `'${id}' was not bound; bind it at an async boundary first` },
        bindings: Object.freeze(list),
        valid: list.every(b => b.valid),
      });
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  const kernel = {
    events: events as EventBus, registries: typedRegistries, app: appInfo, probes, signal: appCtl.signal, availability,
    log: { info: (s: string) => sink('info', 'core', s), warn: (s: string) => sink('warn', 'core', s), error: (s: string) => sink('error', 'core', s) },
    provide() { throw new Error('the kernel view cannot provide services'); },
    bind: (registry: string, ids: readonly string[], signal: AbortSignal) => bind('core', registry, ids, signal),
  };
  return {
    events, registries: typedRegistries, probes,
    services: servicesView(new Proxy(kernel, { get: (t, k) => typeof k !== 'string' ? undefined : k in t ? (t as Record<string, unknown>)[k] : provided.get(k)?.impl })),
    async boot() {
      if (booted) throw new Error('an app boots once; create a new app to boot again');
      booted = true;
      appCtl.signal.throwIfAborted();
      started = now();
      phases.push('discover'); discover();
      phases.push('register'); registerPhase();
      phases.push('patch'); { const patching = patchPhase(); if (patching) await patching; }
      appCtl.signal.throwIfAborted();
      phases.push('freeze'); for (const r of Object.values(registries)) adminOf(r).freeze();
      phases.push('validate'); validatePhase();
      phases.push('install'); { const installing = installPhase(); if (installing) await installing; }
      appCtl.signal.throwIfAborted();
      publishAvailability();
      appCtl.signal.throwIfAborted();
      phases.push('start');
      finished = now();
      events.emit('app.started', { ms: finished - started });
      return report();
    },
    dispose() {
      if (appCtl.signal.aborted) return;
      appCtl.abort();
      const pending = [...pendingInstalls];
      pendingInstalls.clear();
      for (const item of pending) { item.revoke(); item.ctl.abort(appCtl.signal.reason); }
      const retired = disposers.splice(0).reverse();
      for (const { id, d, ctl } of retired) { disposeResult(id, d); ctl.abort(); }
    },
  };
}

/** Test/dev helper: a typed wait on the bus. */
export function nextEvent<K extends EventKey>(bus: EventBus, k: K, pred?: (p: EngineEvents[K]) => boolean): Promise<EngineEvents[K]> {
  return new Promise(res => { const off = bus.on(k, p => { if (!pred || pred(p)) { off(); res(p); } }); });
}

/** Stable Tarjan SCC over string ids. */
function stronglyConnected(ids: readonly string[], edges: (id: string) => readonly string[]): string[][] {
  let index = 0;
  const idx = new Map<string, number>(), low = new Map<string, number>(), on = new Set<string>(), stack: string[] = [], out: string[][] = [];
  const visit = (v: string) => {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); on.add(v);
    for (const w of edges(v)) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const c: string[] = [];
      for (let w: string; (w = stack.pop()!) !== v;) { on.delete(w); c.push(w); }
      on.delete(v); c.push(v); out.push(c);
    }
  };
  for (const v of ids) if (!idx.has(v)) visit(v);
  return out;
}
