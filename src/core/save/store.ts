import { monotonicNow } from '../clock';
/**
 * core/save/store.ts: the SaveStore (ADR 0007). One owner of every persisted byte.
 *
 * Storage layout (localStorage unless the section says session), for a store `namespace` <ns> (default 'game'):
 *   <ns>|p:<player>|<section>   player scope      envelope {v, by, lh?, data}
 *   <ns>|profile|<section>     profile scope
 *   <ns>|device|<section>      device scope
 *   <ns>-q|<original key>[|n]  quarantine: unreadable raw bytes, never overwritten, cleared only by reset
 *   <ns>-bak|<key>|v<n>        one copy of a record before a migration rewrote it
 * Keys written before a game adopted the store are read through a section's LegacyBinding and never modified in
 * 'import' mode, except that a `mirror` binding writes them back when their value really changes (never to reformat,
 * never over bytes that do not decode).
 *
 * Each section is its own physical envelope, written by its own `set`. A flush of several sections is several
 * writes; the store does not promise that they land together (ADR 0052, STD-SAV-16). `batch` only groups flush
 * scheduling.
 */
import type { StoragePort } from './storage-port';
import type {
  FlushReport, ImportReport, LegacyBinding, PlayerId, ProfileFileV2, QuarantineEntry, SaveSection, SaveStore,
  SectionHandle, SectionStatus, StoreUsage,
} from './section';

import { DEFAULT_SAVE_NAMESPACE, savePrefixes } from './prefixes';
export { DEFAULT_SAVE_NAMESPACE, savePrefixes };   // reset clears exactly these prefixes; home: ./prefixes.ts
export const MAX_FILE_CHARS = 2_000_000;
const DEFAULT_MAX_CHARS = 262_144;
const PLAYER_ID = /^[a-z0-9-]{1,24}$/;

/** The debounce seam. `now` is monotonic milliseconds; it only measures the wait, never gameplay time. */
export interface Timers { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void; now(): number }

/**
 * Browser timers: a `setTimeout` for the debounce, then the flush itself in `requestIdleCallback` (200 ms timeout)
 * when the browser has it. Never `requestAnimationFrame`: no storage API runs inside a frame (STD-SAV-13).
 */
export function browserTimers(): Timers {
  type Idle = (fn: () => void, o: { timeout: number }) => number;
  const g = globalThis as typeof globalThis & { requestIdleCallback?: Idle; cancelIdleCallback?: (h: number) => void };
  return {
    set(fn, ms) {
      const h: { t?: ReturnType<typeof setTimeout>; idle?: number } = {};
      h.t = setTimeout(() => { h.t = undefined; if (g.requestIdleCallback) h.idle = g.requestIdleCallback(fn, { timeout: 200 }); else fn(); }, ms);
      return h;
    },
    clear(handle) {
      const h = handle as { t?: ReturnType<typeof setTimeout>; idle?: number };
      if (h.t !== undefined) clearTimeout(h.t);
      if (h.idle !== undefined) g.cancelIdleCallback?.(h.idle);
    },
    now: monotonicNow,
  };
}

/** The contract's `legacyKeys` shorthand, spelled out as a binding. */
function legacyKeysBinding(keys: readonly string[]): LegacyBinding {
  return { keys: () => [...keys], fromVersion: 1, decode: raws => JSON.parse(raws.find(r => r !== null) ?? 'null') };
}
const normalised = new WeakMap<SaveSection<unknown>, SaveSection<unknown>>();
/** One stable object per definition, with `legacyKeys` turned into `legacy`, so identity checks keep working. */
function normalise<T>(def: SaveSection<T>): SaveSection<T> {
  if (def.legacy || !def.legacyKeys?.length) return def;
  let n = normalised.get(def);
  if (!n) normalised.set(def, n = { ...def, legacy: legacyKeysBinding(def.legacyKeys) });
  return n as SaveSection<T>;
}
export interface LegacyFileAdapter {
  name: string;
  test(value: unknown): boolean;
  /** Returns section data keyed by section id, at the version given. Throws on invalid files. */
  convert(value: unknown, text: string): Record<string, { v: number; data: unknown }>;
}
export interface SaveStoreOptions {
  local: StoragePort;
  session: StoragePort;
  build: string;                         // '<game>@<version>', written into every envelope
  /** Key namespace: every key this store writes starts with it (default 'game'). One namespace per game. */
  namespace?: string;
  /** Extra prefixes `resetAll` also clears: keys a game wrote before it adopted the store (read via LegacyBinding). */
  legacyPrefixes?: readonly string[];
  /** Keys matching this are listed by `quarantine()` as set aside by an older build. */
  legacyQuarantine?: RegExp;
  timers?: Timers;
  idleMs?: number;                       // debounce: write this long after the last change (default 1000)
  maxWaitMs?: number;                    // but never later than this after the first change (default 5000)
  legacyFiles?: LegacyFileAdapter[];
  roster?: SaveSection<Roster>;          // defaults to playersSection
  /** The frozen `saveSections` registry (boot phase 4). Export, import and reset must know sections nobody has opened yet. */
  sections?: readonly SaveSection<unknown>[];
}

export type Roster = { players: { id: PlayerId; name?: string }[]; active: PlayerId };
/** Profile-scope roster. Player '1' always exists; `addPlayer` appends more. */
export const playersSection: SaveSection<Roster> = {
  id: 'profile.players', scope: 'profile', version: 1,
  initial: () => ({ players: [{ id: '1' }], active: '1' }),
  parse(raw) {
    const r = raw as Roster;
    if (!r || !Array.isArray(r.players) || r.players.length < 1 || r.players.length > 64) throw Error('Invalid player roster');
    const players = r.players.map(p => {
      if (!p || typeof p.id !== 'string' || !PLAYER_ID.test(p.id) || (p.name !== undefined && (typeof p.name !== 'string' || p.name.length > 40))) throw Error('Invalid player');
      return p.name === undefined ? { id: p.id } : { id: p.id, name: p.name };
    });
    if (new Set(players.map(p => p.id)).size !== players.length) throw Error('Duplicate player');
    return { players, active: players.some(p => p.id === r.active) ? r.active : players[0].id };
  },
  merge: (stored, incoming) => {
    const byId = new Map(stored.players.map(p => [p.id, { ...p }]));
    for (const p of incoming.players) byId.set(p.id, { ...byId.get(p.id), ...p });
    return { players: [...byId.values()], active: incoming.active };
  },
  export: false,
};

interface Envelope { v: number; by: string; lh?: string; data: unknown }
class NewerError extends Error { constructor(readonly raw: string, readonly v: number) { super('Saved by a newer build (v' + v + ')'); } }

interface Cell {
  def: SaveSection<unknown>;
  player: PlayerId;                 // '' for profile and device scope
  key: string;
  port: StoragePort;
  value: unknown;
  status: SectionStatus;
  dirty: boolean;
  seen: boolean;                  // a read of `key` succeeded at least once
  lastRaw: string | null;         // what storage held when we last read or wrote it
  lh?: string;                    // hash of the legacy raws this value already includes
  imported?: boolean;             // dirty only because the legacy keys were just imported: nothing local to keep yet
  folded?: boolean;               // dirty only because another tab's legacy write was folded in: nothing local to keep
  pendingQuarantine?: { raw: string; from: string; reason: string };
  pendingBackup?: { raw: string; key: string };
  subs: Set<(v: unknown) => void>;
}

const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };
const hashRaws = (raws: (string | null)[]) => fnv(JSON.stringify(raws));
/** A per-key binding keeps one hash per legacy key, joined by '.', so drift can tell which record changed. */
const perKeyHash = (raws: (string | null)[]) => raws.map(r => fnv(JSON.stringify(r))).join('.');
const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
const freeze = <T>(v: T): T => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) freeze((v as Record<string, unknown>)[k]); }
  return v;
};

export interface SavePending { dirty: number; eagerDirty: number; lazyDirty: number; scheduled: boolean; batching: boolean }
export function createSaveStore(opts: SaveStoreOptions): SaveStore & { usage(): StoreUsage; pending(): SavePending } {
  const timers: Timers = opts.timers ?? browserTimers();
  const idleMs = opts.idleMs ?? 1000, maxWaitMs = opts.maxWaitMs ?? 5000;
  const defs = new Map<string, SaveSection<unknown>>();
  const aliases = new Map<string, string>();
  const cells = new Map<string, Cell>();          // by storage key
  // legacy key → the import-mode cells that read it (drift from old tabs). Several sections may read one key, so every
  // reader hears the change.
  const legacyWatch = new Map<string, Set<Cell>>();
  const activeSubs = new Set<{ def: SaveSection<unknown>; fn: (v: unknown) => void }>();
  const playerListeners = new Set<(id: PlayerId, prev: PlayerId) => void>();
  const legacyUnreadable: QuarantineEntry[] = [];
  let disposed = false;
  const requireOpen = () => { if (disposed) throw Error('SaveStore is disposed'); };
  let timer: unknown, firstDirty = 0, resetting = false, batching = 0, batchedSchedule = false;
  const roster = opts.roster ?? playersSection;
  const prefixes = savePrefixes(opts.namespace ?? DEFAULT_SAVE_NAMESPACE, opts.legacyPrefixes);
  const ENVELOPE_PREFIX = prefixes.envelope, QUARANTINE_PREFIX = prefixes.quarantine, BACKUP_PREFIX = prefixes.backup, SAVE_PREFIXES = prefixes.reset;

  const unsubs = [opts.local, opts.session].map(p => p.subscribe?.(key => external(key,p)) ?? (() => {}));

  // ------------------------------------------------------------------ keys and codecs
  const tag = (def: SaveSection<unknown>, player: PlayerId) => (def.scope === 'player' ? 'p:' + player : def.scope);
  const envKey = (def: SaveSection<unknown>, player: PlayerId, id = def.id) => ENVELOPE_PREFIX + tag(def, player) + '|' + id;
  const live = (def: SaveSection<unknown>) => def.legacy?.mode === 'live';
  /** The registered player section that reads `name` as a local-storage alias, if any. */
  const playerAlias = (name: string): SaveSection<unknown> | undefined => {
    const def = defs.get(aliases.get(name) ?? '');
    return def && def.scope === 'player' && !live(def) && portFor(def) === opts.local ? def : undefined;
  };
  const portFor = (def: SaveSection<unknown>) => ((def.storage === 'session' || (live(def) && def.legacy?.session)) ? opts.session : opts.local);
  const legacyPort = (def: SaveSection<unknown>) => (def.legacy?.session ? opts.session : opts.local);

  function upgrade(def: SaveSection<unknown>, data: unknown, from: number): unknown {
    if (!Number.isInteger(from) || from < 1) throw Error(def.id + ': bad version ' + from);
    let d = clone(data);
    for (let v = from; v < def.version; v++) {
      const step = def.migrations?.[v];
      if (!step) throw Error(`${def.id}: no migration from v${v} to v${v + 1}`);
      d = step(d);
    }
    return def.parse(d);
  }
  function decodeStored(cell: Cell, raw: string): { value: unknown; from: number; lh?: string } {
    const def = cell.def;
    if (live(def)) return { value: upgrade(def, def.legacy!.decode([raw]), def.legacy!.fromVersion), from: def.version };
    const env = JSON.parse(raw) as Envelope;
    if (!env || typeof env !== 'object' || !Number.isInteger(env.v) || !('data' in env)) throw Error('Not a save envelope');
    if (env.v > def.version) throw new NewerError(raw, env.v);
    return { value: upgrade(def, env.data, env.v), from: env.v, lh: typeof env.lh === 'string' ? env.lh : undefined };
  }
  function encode(cell: Cell): string | null {
    if (live(cell.def)) return cell.def.legacy!.encode!(cell.value)[0] ?? null;
    const env: Envelope = { v: cell.def.version, by: opts.build, ...(cell.lh ? { lh: cell.lh } : {}), data: cell.value };
    return JSON.stringify(env);
  }

  // ------------------------------------------------------------------ quarantine and backups
  function quarantineRaw(cell: Cell, raw: string, from: string, reason: string): boolean {
    cell.status = 'quarantined';
    const base = QUARANTINE_PREFIX + from;
    for (let n = 0; n < 5; n++) {
      const k = n ? base + '|' + n : base;
      let existing: string | null;
      try { existing = opts.local.get(k); } catch { cell.pendingQuarantine = { raw, from, reason }; return false; }
      if (existing === raw) { cell.pendingQuarantine = undefined; return true; }
      if (existing === null) {
        try { opts.local.set(k, raw); cell.pendingQuarantine = undefined; return true; }
        catch { cell.pendingQuarantine = { raw, from, reason }; return false; }
      }
    }
    cell.pendingQuarantine = { raw, from, reason };   // five different unreadable copies already: keep them all, write nothing
    return false;
  }
  function backup(cell: Cell, raw: string, from: number): boolean {
    const k = BACKUP_PREFIX + cell.key + '|v' + from;
    try { if (opts.local.get(k) === null) opts.local.set(k, raw); cell.pendingBackup = undefined; return true; }
    catch { cell.pendingBackup = { raw, key: k }; return false; }
  }

  // ------------------------------------------------------------------ loading
  function cellFor(def: SaveSection<unknown>, player: PlayerId): Cell {
    const owner = def.scope === 'player' ? player : '';
    const key = live(def) ? def.legacy!.keys(owner)[0] : envKey(def, owner);
    const port=portFor(def),identity=port.kind+':'+key;
    let cell = cells.get(identity);
    if (!cell) {
      cell = { def, player: owner, key, port: portFor(def), value: undefined, status: 'saved', dirty: false, seen: false, lastRaw: null, subs: new Set() };
      cells.set(identity, cell);
      if (def.legacy && !live(def)) for (const k of def.legacy.keys(owner)) { let w = legacyWatch.get(k); if (!w) legacyWatch.set(k, w = new Set()); w.add(cell); }
      load(cell);
    }
    return cell;
  }
  function load(cell: Cell) {
    const def = cell.def;
    let raw: string | null;
    try { raw = cell.port.get(cell.key); }
    catch { cell.status = 'unavailable'; cell.seen = false; cell.value = def.initial(); return; }
    cell.seen = true; cell.lastRaw = raw; cell.status = 'saved';
    if (raw !== null) return loadRaw(cell, raw);
    for (const alias of live(def) ? [] : def.aliases ?? []) {
      let r: string | null = null;
      try { r = cell.port.get(envKey(def, cell.player, alias)); } catch { /* treat as absent */ }
      if (r !== null) { loadRaw(cell, r); cell.lastRaw = null; if (cell.status === 'saved') markDirty(cell); return; }
    }
    if (def.legacy && !live(def)) return importLegacy(cell);
    cell.value = def.initial();
  }
  function loadRaw(cell: Cell, raw: string) {
    const def = cell.def;
    try {
      const { value, from, lh } = decodeStored(cell, raw);
      cell.value = value; cell.lh = lh;
      if (!live(def) && from < def.version) { backup(cell, raw, from); markDirty(cell); }
      if (!live(def) && def.legacy) checkDrift(cell);
    } catch (e) {
      cell.value = def.initial();
      if (e instanceof NewerError) { cell.status = 'newer'; return; }
      quarantineRaw(cell, raw, cell.key, String((e as Error).message ?? e));
    }
  }
  const legacyHash = (cell: Cell, raws: (string | null)[]) => (cell.def.legacy?.perKey ? perKeyHash(raws) : hashRaws(raws));
  function readLegacy(cell: Cell): { raws: (string | null)[] } | 'unavailable' {
    const b = cell.def.legacy!, port = legacyPort(cell.def);
    try { return { raws: b.keys(cell.player).map(k => port.get(k)) }; } catch { return 'unavailable'; }
  }
  function importLegacy(cell: Cell) {
    const def = cell.def, b = def.legacy!;
    const read = readLegacy(cell);
    if (read === 'unavailable') { cell.status = 'unavailable'; cell.seen = false; cell.value = def.initial(); return; }
    cell.lh = legacyHash(cell, read.raws);   // also for 'nothing there', so a later write by an old-build tab is noticed
    if (read.raws.every(r => r === null)) { cell.value = def.initial(); return; }
    try { cell.value = upgrade(def, b.decode(read.raws), b.fromVersion); markDirty(cell); cell.imported = true; }
    catch (e) {
      cell.value = def.initial(); cell.status = 'quarantined';   // legacy keys are left untouched, so they are the quarantine
      legacyUnreadable.push({ key: b.keys(cell.player).join(','), from: 'legacy', reason: String((e as Error).message ?? e) });
    }
  }
  /** An old tab (or a rollback) wrote a legacy key after we imported it. Fold the change in, never drop it. */
  function checkDrift(cell: Cell): boolean {
    const def = cell.def, read = readLegacy(cell);
    if (read === 'unavailable' || read.raws.every(r => r === null)) return false;
    const h = legacyHash(cell, read.raws);
    if (cell.lh === undefined || h === cell.lh) return false;
    let raws = read.raws;
    if (def.legacy!.perKey && def.merge) {
      // Only the keys whose hash changed are decoded; an unknown earlier hash (another format) counts as changed.
      const was = cell.lh.split('.'), now = h.split('.');
      raws = raws.map((r, i) => (was.length === now.length && was[i] === now[i] ? null : r));
      if (raws.every(r => r === null)) { cell.lh = h; markDirty(cell); return false; }   // a key was removed: nothing to add
    }
    cell.lh = h;
    try {
      const theirs = upgrade(def, def.legacy!.decode(raws), def.legacy!.fromVersion);
      if (def.merge) cell.value = def.merge(cell.value, theirs);
      else { if (cell.lastRaw !== null) quarantineRaw(cell, cell.lastRaw, cell.key + '|drift', 'replaced by a newer legacy write'); cell.value = theirs; cell.status = 'saved'; }
      markDirty(cell); return true;
    } catch (e) { legacyUnreadable.push({ key: def.legacy!.keys(cell.player).join(','), from: 'legacy-drift', reason: String(e) }); return false; }
  }
  /**
   * Before a mirror write: an old-build writer changed the legacy keys since we last read or wrote them, and no event
   * told us (same tab, or no storage event). Merge theirs under our pending value, so the mirror never drops it.
   */
  function foldLegacyWrite(cell: Cell) {
    const def = cell.def, read = readLegacy(cell);
    if (read === 'unavailable' || read.raws.every(r => r === null)) return;
    const h = legacyHash(cell, read.raws);
    if (cell.lh === undefined || h === cell.lh) return;
    try {
      const theirs = upgrade(def, def.legacy!.decode(read.raws), def.legacy!.fromVersion);
      // Nothing was changed here since the import: their write is simply the newer value.
      cell.value = cell.imported ? theirs : def.merge!(theirs, cell.value); cell.lh = h;
    }
    catch { /* unreadable legacy bytes: mirrorPlan leaves them alone */ }
  }
  /**
   * The raw strings a mirrored binding should write now, or undefined to leave the legacy keys exactly as they are:
   * when they already hold this value (whatever their formatting, so an import never reformats them), when they
   * cannot be read, or when they hold bytes that do not decode (their own quarantine).
   * `lh` always ends as the hash of what the legacy keys hold after this flush.
   */
  function mirrorPlan(cell: Cell): (string | null)[] | undefined {
    const def = cell.def, b = def.legacy!, read = readLegacy(cell);
    if (read === 'unavailable') return undefined;
    // A key the binding only reads (encode gives undefined for it) keeps what it holds.
    const fill = (w: (string | null | undefined)[]) => w.map((r, i) => (r === undefined ? read.raws[i] : r));
    const want = fill(b.encode!(cell.value));
    const keep = () => { cell.lh = legacyHash(cell, read.raws); return undefined; };
    let plan = want;
    if (read.raws.every(r => r === null)) { if (want.every(r => r === null)) return keep(); }
    else {
      let held: (string | null)[];
      try { held = fill(b.encode!(upgrade(def, b.decode(read.raws), b.fromVersion))); }
      catch { return keep(); }
      // Key by key: an old key whose own value did not change keeps its bytes, so a multi-key binding (the five
      // settings stores) never reformats one key because another one changed.
      plan = want.map((w, i) => (w === held[i] ? read.raws[i] : w));
      if (plan.every((p, i) => p === read.raws[i])) return keep();
    }
    cell.lh = legacyHash(cell, plan);
    return plan;
  }

  // ------------------------------------------------------------------ writing
  function markDirty(cell: Cell) {
    cell.dirty = true;
    if (cell.status !== 'newer' && cell.status !== 'quarantined') cell.status = 'dirty';
    if (cell.def.flush !== 'lazy') schedule();
  }
  function schedule() {
    if (resetting || disposed) return;
    if (batching) { batchedSchedule = true; return; }
    const now = timers.now();
    if (timer === undefined) firstDirty = now; else timers.clear(timer);
    const wait = Math.max(0, Math.min(idleMs, firstDirty + maxWaitMs - now));
    timer = timers.set(() => { timer = undefined; if (!disposed) flush('debounce'); }, wait);
  }
  function flushCell(cell: Cell, final = false): 'written' | 'failed' | 'skipped' {
    const def = cell.def;
    const owned = () => (!disposed || final) && cells.get(cell.port.kind + ':' + cell.key) === cell;
    if (!owned()) return 'skipped';
    if (!cell.dirty || cell.status === 'newer') return 'skipped';
    if (cell.pendingQuarantine && !quarantineRaw(cell, cell.pendingQuarantine.raw, cell.pendingQuarantine.from, cell.pendingQuarantine.reason)) return 'failed';
    if (cell.pendingBackup) { try { if (opts.local.get(cell.pendingBackup.key) === null) opts.local.set(cell.pendingBackup.key, cell.pendingBackup.raw); cell.pendingBackup = undefined; } catch { cell.status = 'session'; return 'failed'; } }
    let current: string | null;
    try { current = cell.port.get(cell.key); } catch { cell.status = 'session'; return 'failed'; }  // never write over bytes we could not see
    const before = cell.value;
    if (!cell.seen || current !== cell.lastRaw) {
      // First successful read after an outage, or another tab wrote since we last looked.
      if (current !== null) {
        try {
          const theirs = decodeStored(cell, current).value;
          if (!owned()) return 'skipped';
          if (def.merge) cell.value = def.merge(theirs, cell.value);
          else if (!cell.seen && !quarantineRaw(cell, current, cell.key + '|unseen', 'overwritten after a storage outage')) return 'failed';
        } catch (e) {
          if (!owned()) return 'skipped';
          if (e instanceof NewerError) { cell.status = 'newer'; return 'skipped'; }
          if (!quarantineRaw(cell, current, cell.key, String(e))) return 'failed';
        }
      } else if (!cell.seen && def.legacy && !live(def)) {
        const read = readLegacy(cell);
        if (read === 'unavailable') { cell.status = 'session'; return 'failed'; }
        if (!read.raws.every(r => r === null)) {
          cell.lh = legacyHash(cell, read.raws);
          try {
            const theirs = upgrade(def, def.legacy.decode(read.raws), def.legacy.fromVersion);
            if (!owned()) return 'skipped';
            if (def.merge) cell.value = def.merge(theirs, cell.value);
          }
          catch (e) { legacyUnreadable.push({ key: def.legacy.keys(cell.player).join(','), from: 'legacy', reason: String(e) }); }
        }
      }
      if (!owned()) return 'skipped';
      cell.seen = true;
    }
    let mirror: (string | null)[] | undefined;
    if (def.legacy?.mirror && def.legacy.encode && !live(def)) {
      if (def.merge || cell.imported) foldLegacyWrite(cell);
      if (!owned()) return 'skipped';
      mirror = mirrorPlan(cell);
    }
    if (!owned()) return 'skipped';
    let raw = encode(cell);
    if (!owned()) return 'skipped';
    if (raw !== null && raw.length > (def.maxChars ?? DEFAULT_MAX_CHARS)) { cell.status = 'session'; return 'failed'; }
    if (mirror) {
      // The mirror goes first and is best effort. If a legacy write fails, the envelope records what the legacy keys
      // really hold (`lh`), so the next load never mistakes the stale legacy value for a newer old-build write.
      let missed = false;
      const keys = def.legacy!.keys(cell.player);
      for (let i = 0; i < keys.length; i++) {
        if (!owned()) return 'skipped';
        try {
          const k = keys[i], value = mirror[i], port = legacyPort(def);
          const previous = port.get(k);
          if (!owned()) return 'skipped';
          if (value === null) { if (previous !== null) port.remove(k); }
          else if (previous !== value) port.set(k, value);
        } catch { missed = true; }
      }
      if (missed) { const read = readLegacy(cell); cell.lh = read === 'unavailable' ? undefined : legacyHash(cell, read.raws); raw = encode(cell); }
    }
    if (!owned()) return 'skipped';
    if (raw !== current) {
      try { if (raw === null) cell.port.remove(cell.key); else cell.port.set(cell.key, raw); }
      catch { cell.status = 'session'; return 'failed'; }
    }
    cell.lastRaw = raw; cell.dirty = false; cell.imported = false; cell.folded = false; cell.status = 'saved';
    if (cell.value !== before) notify(cell);
    return raw === current ? 'skipped' : 'written';
  }
  function flush(_reason = 'manual', final = false): FlushReport {
    if (!final) requireOpen();
    const report: FlushReport = { written: [], failed: [], skipped: [] };
    if (resetting) return report;
    if (timer !== undefined) { timers.clear(timer); timer = undefined; }
    for (const cell of cells.values()) report[flushCell(cell, final)].push(cell.key);
    if (report.failed.length) schedule();   // retry later; the tab keeps the data meanwhile ('session')
    return report;
  }

  // ------------------------------------------------------------------ change feed
  function notify(cell: Cell) {
    if (disposed) return;
    const v = freeze(cell.value);
    for (const fn of cell.subs) { if (disposed) return; fn(v); }
    if (disposed) return;
    if (cell.def.scope !== 'player' || cell.player === activePlayer()) for (const s of activeSubs) if (s.def === cell.def) s.fn(v);
  }
  function external(key: string | null,port:StoragePort) {
    if (disposed) return;
    const own = key === null ? [...cells.values()].filter(c=>c.port===port) : [cells.get(port.kind+':'+key)].filter((c): c is Cell => !!c);
    const watchers = key === null ? [] : [...legacyWatch.get(key) ?? []].filter(c=>legacyPort(c.def)===port);
    // Local changes are merged at the next flush (read-before-write). A cell that is dirty only because another tab's
    // legacy write was folded in holds nothing of its own, so it keeps following that tab.
    for (const cell of own) {
      if (cell.dirty && !cell.folded) continue;
      reload(cell); notify(cell);
    }
    // A dirty mirrored cell folds the old tab's write in at its flush (foldLegacyWrite). A section that only reads its
    // legacy keys and merges by union (the fact ledger over nine keys) folds it now: several keys may change in a row.
    for (const cell of watchers) {
      const clean = !cell.dirty || !!cell.folded;
      if (!clean && !(cell.def.merge && !cell.def.legacy?.mirror)) continue;
      if (clean) {
        // A new-build tab mirrors the legacy keys and then writes the envelope: when the envelope moved too, read it
        // (its `lh` already covers the legacy keys) rather than treat the mirror as an old build's write.
        let raw: string | null | undefined;
        try { raw = cell.port.get(cell.key); } catch { raw = undefined; }
        if (raw !== undefined && raw !== null && raw !== cell.lastRaw) { reload(cell); notify(cell); continue; }
      }
      if (checkDrift(cell)) { if (clean) cell.folded = true; notify(cell); }
    }
  }
  /** Reads a cell again from storage, dropping a fold that the stored envelope may already include. */
  function reload(cell: Cell) { cell.dirty = false; cell.folded = false; cell.imported = false; load(cell); }
  /**
   * An import value equal to what a clean, readable cell holds, with storage still holding what the cell last read.
   * Committing it would write nothing new (only when the bytes differ; STD-SAV-12), except an envelope
   * for a section still at `initial()` with no key, which a player who never used it must not get.
   * Envelope-only sections: a legacy binding's keys (live, or a mirror an import restores) are storage too.
   */
  function unchanged(cell: Cell, next: unknown): boolean {
    if ((cell.def.legacy && (live(cell.def) || cell.def.legacy.mirror)) || cell.dirty || cell.status !== 'saved' || !cell.seen) return false;
    try { if (cell.port.get(cell.key) !== cell.lastRaw) return false; } catch { return false; }
    return JSON.stringify(next) === JSON.stringify(cell.value);
  }

  // ------------------------------------------------------------------ players
  function rosterCell() { return cellFor(roster, ''); }
  function activePlayer(): PlayerId { requireOpen(); return (rosterCell().value as Roster).active; }
  function register(def: SaveSection<unknown>) {
    def = normalise(def);
    const known = defs.get(def.id);
    if (known && known !== def) throw Error('Two sections share the id ' + def.id);
    if (!known) { defs.set(def.id, def); for (const a of def.aliases ?? []) aliases.set(a, def.id); }
  }
  register(roster);
  for (const def of opts.sections ?? []) register(def);

  function handle<T>(original: SaveSection<T>, player?: PlayerId): SectionHandle<T> {
    requireOpen();
    const def = normalise(original);
    register(def);
    const cell = () => {
      requireOpen();
      const c = cellFor(def, def.scope === 'player' ? player ?? activePlayer() : '');
      // Storage could not be read last time: try again (unavailable is never "empty", and never permanent).
      if (c.status === 'unavailable' && !c.dirty) load(c);
      return c;
    };
    const isCurrent = (c: Cell) => cells.get(c.port.kind + ':' + c.key) === c;
    const requireCurrent = (c: Cell) => {
      requireOpen();
      if (!isCurrent(c)) throw Error('Save section ownership changed during update: ' + def.id);
    };
    const write = (c: Cell, next: T, now?: boolean): SectionStatus => {
      requireCurrent(c);
      c.value = next; c.imported = false; c.folded = false; markDirty(c); notify(c);
      if (now && !disposed && isCurrent(c)) flushCell(c);
      return c.status;
    };
    return {
      get: () => freeze(cell().value as T),
      update: (fn, o) => {
        const c = cell(), draft = clone(c.value) as T;
        const r = fn(draft);
        requireCurrent(c);
        return write(c, def.parse(r === undefined ? draft : r), o?.now);
      },
      replace: (v, o) => { const c = cell(); return write(c, def.parse(clone(v)), o?.now); },
      subscribe(fn) {
        requireOpen();
        // A cell's subscribers hear only that cell's section, whose values are this handle's T.
        const listener = fn as (v: unknown) => void;
        if (def.scope === 'player' && player === undefined) { const s = { def, fn: listener }; activeSubs.add(s); return () => { activeSubs.delete(s); }; }
        const c = cell(); c.subs.add(listener); return () => { c.subs.delete(listener); };
      },
      status: () => cell().status,
      of: id => handle(def, id),
    };
  }

  const store = {
    section: handle,
    players: () => { requireOpen(); return (rosterCell().value as Roster).players.map(p => p.id); },
    activePlayer,
    playerName: (id: PlayerId) => { requireOpen(); return (rosterCell().value as Roster).players.find(p => p.id === id)?.name; },
    setActivePlayer(id: PlayerId) {
      const prev = activePlayer();
      if (!store.players().includes(id)) throw Error('Unknown player ' + id);
      if (id === prev) return;
      flush('player-switch');
      requireOpen();
      // A lazy roster is written at the next flush point, not here.
      const c = rosterCell(); c.value = { ...(c.value as Roster), active: id }; markDirty(c); if (roster.flush !== 'lazy') flushCell(c);
      for (const s of activeSubs) { if (disposed) return; s.fn(freeze(cellFor(s.def, id).value)); }
      for (const fn of playerListeners) { if (disposed) return; fn(id, prev); }
    },
    addPlayer(name?: string): PlayerId {
      requireOpen();
      const c = rosterCell(), r = c.value as Roster;
      const id = String(Math.max(0, ...r.players.map(p => Number(p.id)).filter(Number.isFinite)) + 1);
      c.value = roster.parse({ ...r, players: [...r.players, name === undefined ? { id } : { id, name }] });
      markDirty(c); if (roster.flush !== 'lazy') flushCell(c);
      return id;
    },
    flush: (reason?: string) => flush(reason),
    // Observe loaded cells only: do not load, fold legacy writes, schedule, or flush.
    pending(): SavePending {
      let eagerDirty=0,lazyDirty=0;
      for(const cell of cells.values())if(cell.dirty){if(cell.def.flush==='lazy')lazyDirty++;else eagerDirty++;}
      return {dirty:eagerDirty+lazyDirty,eagerDirty,lazyDirty,scheduled:timer!==undefined,batching:batching>0||batchedSchedule};
    },
    batch(fn: () => void) {
      requireOpen();
      batching++;
      try { fn(); }
      finally { if (--batching === 0 && batchedSchedule) { batchedSchedule = false; schedule(); } }
    },
    exportPlayer(id: PlayerId = activePlayer()): ProfileFileV2 {
      requireOpen();
      flush('export');
      const file: ProfileFileV2 = { format: 'engine-profile', version: 2, exportedBy: opts.build, player: { id, ...(store.playerName(id) ? { name: store.playerName(id) } : {}) }, sections: {} };
      const orphans: Record<string, unknown> = {}, quarantine: Record<string, string> = {};
      for (const def of defs.values()) {
        if (def.scope !== 'player' || def.export === false || def.cache) continue;
        const c = cellFor(def, id);
        // A clean live cell is re-read: code that has not moved to the store yet may write these keys directly.
        if (live(def) && !c.dirty) load(c);
        // Likewise an imported section notices a legacy write no event announced (same tab, a rollback, a script).
        else if (def.legacy && !c.dirty && c.status !== 'newer') checkDrift(c);
        if (c.status === 'newer') {
          try {
            // load() falls back to an alias key when the canonical key is absent; export that payload under the canonical id.
            let raw = c.port.get(c.key);
            for (const a of live(def) ? [] : def.aliases ?? []) { if (raw !== null) break; raw = c.port.get(envKey(def, id, a)); }
            orphans[def.id] = JSON.parse(raw ?? 'null');
          } catch { /* unreadable now: stays on disk */ }
        }
        else file.sections[def.id] = { v: def.version, data: clone(c.value) };
      }
      const mine = ENVELOPE_PREFIX + 'p:' + id + '|';
      for (const k of opts.local.keys()) {
        // A key under a registered section's alias is that section's pre-rename copy (load() reads it but never
        // deletes it): the section above already exports the current value, so the stale copy is not an orphan.
        if (k.startsWith(mine) && !defs.has(k.slice(mine.length)) && !playerAlias(k.slice(mine.length))) { try { orphans[k.slice(mine.length)] = JSON.parse(opts.local.get(k) ?? 'null'); } catch { /* skip */ } }
        if (k.startsWith(QUARANTINE_PREFIX) && k.includes('p:' + id + '|')) { const raw = opts.local.get(k); if (raw !== null) quarantine[k] = raw; }
      }
      if (Object.keys(orphans).length) file.orphans = orphans;
      if (Object.keys(quarantine).length) file.quarantine = quarantine;
      if (JSON.stringify(file).length > MAX_FILE_CHARS) throw Error('Save file is too large.');
      return file;
    },
    importPlayer(text: string, into: PlayerId = activePlayer()): ImportReport {
      requireOpen();
      if (text.length > MAX_FILE_CHARS) throw Error('Save file is too large.');
      const value = JSON.parse(text) as Partial<ProfileFileV2>;
      let incoming: Record<string, { v: number; data: unknown }>, orphans: Record<string, unknown> = {}, format: ImportReport['format'];
      if (value?.format === 'engine-profile') {
        if (value.version !== 2 || !value.sections || typeof value.sections !== 'object') throw Error('Unsupported save file version.');
        incoming = value.sections; orphans = { ...(value.orphans ?? {}) }; format = 'engine-profile@2';
      } else {
        const adapter = (opts.legacyFiles ?? []).find(a => a.test(value));
        if (!adapter) throw Error('This is not a save file for this game.');
        incoming = adapter.convert(value, text); format = 'legacy';
      }
      // Phase 1: validate everything; any readable-but-invalid known section rejects the whole file.
      const staged: [SaveSection<unknown>, unknown][] = [], report: ImportReport = { format, sections: {} };
      const knownIncoming = new Set<string>();
      for (const [id, entry] of Object.entries(incoming)) {
        const def = defs.get(id) ?? defs.get(aliases.get(id) ?? '');
        if (!def || def.scope === 'profile') { orphans[id] = entry; continue; }
        knownIncoming.add(def.id);
        if (!entry || !Number.isInteger(entry.v)) throw Error('Invalid section ' + id);
        if (entry.v > def.version) { report.sections[def.id] = 'skipped-newer'; continue; }
        try { staged.push([def, upgrade(def, entry.data, entry.v)]); }
        catch (e) { throw Error(`${def.id}: ${(e as Error).message}`); }
      }
      // One report slot cannot acknowledge both a known section and an opaque orphan under the same id: reject
      // before publishing any staged values. An orphan under an *alias* of a section this file also supplies is
      // that section's pre-rename copy (older exports carried it); the section supersedes it, so it is reported,
      // not written and not a conflict. Engine exports after a rename must import again.
      const superseded = new Set<string>();
      for (const id of Object.keys(orphans)) {
        const def = defs.get(id);
        if (def && knownIncoming.has(def.id)) throw Error('Section also supplied as an orphan: ' + def.id);
        if (!def && knownIncoming.has(playerAlias(id)?.id ?? '')) superseded.add(id);
      }
      // Phase 2: commit (merge progress, replace the rest), then write once.
      const touched: Cell[] = [];
      for (const [def, parsed] of staged) {
        requireOpen();
        const c = cellFor(def, def.scope === 'player' ? into : '');
        const mode = def.importMode ?? (def.merge ? 'merge' : 'replace');
        const next = mode === 'merge' && def.merge && c.status !== 'quarantined' ? def.merge(c.value, parsed) : parsed;
        requireOpen();
        if (unchanged(c, next)) { report.sections[def.id] = 'saved'; continue; }   // nothing to write (D4)
        c.value = next;
        c.imported = false; c.folded = false; markDirty(c); notify(c); requireOpen(); touched.push(c);
      }
      // Complete known-owner callbacks/writes before issuing opaque retention receipts.
      flush('import');
      for (const c of touched) report.sections[c.def.id] = c.status === 'saved' ? 'saved' : 'session';
      for (const [id, entry] of Object.entries(orphans)) {
        requireOpen();
        if (superseded.has(id)) { report.sections[id] = 'orphan-superseded'; continue; }
        const k = ENVELOPE_PREFIX + 'p:' + into + '|' + id;
        try {
          const raw = JSON.stringify(entry), existing = opts.local.get(k);
          if (existing !== null && existing !== raw) report.sections[id] = 'orphan-conflict';
          else {
            if (existing === null) opts.local.set(k, raw);
            report.sections[id] = 'orphan-kept';
          }
        } catch { report.sections[id] = 'orphan-failed'; } // Retain the source file for retry/reconciliation.
      }
      return report;
    },
    resetAll() {
      requireOpen();
      resetting = true;
      if (timer !== undefined) { timers.clear(timer); timer = undefined; }
      let removed = 0; const failed: string[] = [];
      for (const port of [opts.local, opts.session]) {
        let keys: string[];
        try { keys = port.keys(); } catch { failed.push(port.kind + ':*'); continue; }
        for (const k of keys) if (SAVE_PREFIXES.some(p => k.startsWith(p))) { try { port.remove(k); removed++; } catch { failed.push(k); } }
      }
      cells.clear(); legacyWatch.clear();
      return { removed, failed };
    },
    quarantine(): QuarantineEntry[] {
      requireOpen();
      const out: QuarantineEntry[] = [...legacyUnreadable];
      try {
        for (const k of opts.local.keys()) {
          if (k.startsWith(QUARANTINE_PREFIX)) out.push({ key: k, from: k.slice(QUARANTINE_PREFIX.length), reason: 'unreadable' });
          else if (opts.legacyQuarantine?.test(k)) out.push({ key: k, from: 'legacy-backup', reason: 'set aside by an older build' });
        }
      } catch { /* storage blocked: nothing to list */ }
      return out;
    },
    onPlayerChanged(fn: (id: PlayerId, prev: PlayerId) => void) { requireOpen(); playerListeners.add(fn); return () => { playerListeners.delete(fn); }; },
    usage() {
      requireOpen();
      const sections: Record<string, number> = {}; let chars = 0;
      for (const port of [opts.local, opts.session]) {
        try { for (const k of port.keys()) if (SAVE_PREFIXES.some(p => k.startsWith(p))) { const n = k.length + (port.get(k)?.length ?? 0); chars += n; const id = cells.get(port.kind+':'+k)?.def.id ?? k.split('|')[2] ?? k; sections[id] = (sections[id] ?? 0) + n; } } catch { /* skip */ }
      }
      return { chars, sections };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      try { flush('dispose', true); } catch (error) { errors.push(error); }
      // A failed final write remains inspectable through pending(), but has no live retry owner.
      if (timer !== undefined) { try { timers.clear(timer); } catch (error) { errors.push(error); } timer = undefined; }
      for (const u of unsubs) { try { u(); } catch (error) { errors.push(error); } }
      batchedSchedule = false;
      activeSubs.clear(); playerListeners.clear();
      for (const cell of cells.values()) cell.subs.clear();
      if (errors.length) throw new AggregateError(errors, 'SaveStore disposal failed');
    },
  };
  return store;
}
