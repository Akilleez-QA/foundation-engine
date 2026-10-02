/**
 * core/save/chunk-port.ts: the only code in the engine that touches IndexedDB (lint:arch rule `indexed-db`).
 *
 * A chunk port stores keyed binary records for large worlds, beside the save store's Web Storage port. It knows keys,
 * opaque values and atomic transactions; the record format, limits and recovery live in `chunk-store.ts`.
 * `update` reads every named key, calls a synchronous `decide`, and applies its plan in the same transaction, so a
 * read-compare-write is atomic even against other tabs (IndexedDB serializes overlapping readwrite transactions).
 */

export type ChunkDurability = 'durable' | 'session';
export interface ChunkEntry { readonly meta: unknown; readonly record: unknown }
export interface ChunkPlan {
  /** Each put writes a meta row and a record row for one key. */
  readonly put?: readonly { readonly key: string; readonly meta: unknown; readonly record: unknown }[];
  readonly remove?: readonly string[];
  /** Copies kept aside (unreadable bytes); appended with generated ids. */
  readonly quarantine?: readonly unknown[];
  /** Clears every quarantine row. */
  readonly clearQuarantine?: boolean;
}
export type ChunkDecision<R> = { readonly result: R; readonly plan?: ChunkPlan };
export type ChunkPortFailure = 'quota' | 'unavailable';
/** The one error a port rejects with. `quota`: the browser refused the space; `unavailable`: anything else. */
export class ChunkPortError extends Error {
  override readonly name = 'ChunkPortError';
  constructor(readonly reason: ChunkPortFailure, detail: string) { super(`chunk port ${reason}: ${detail}`); }
}

export interface ChunkPort {
  readonly durability: ChunkDurability;
  /** Every meta row (small), for totals and eviction order at open. */
  listMeta(): Promise<[string, unknown][]>;
  quarantineCount(): Promise<number>;
  quarantineRows(limit: number): Promise<unknown[]>;
  /** Reads `keys` (meta and record), decides synchronously, applies the plan atomically, resolves after commit. */
  update<R>(keys: readonly string[], decide: (current: ReadonlyMap<string, ChunkEntry | undefined>, quarantined: number) => ChunkDecision<R>): Promise<R>;
  close(): void;
}

// ------------------------------------------------------------------ memory port (fallback and tests)

/** One shared in-memory "database"; several ports over it behave like several tabs of one origin. */
export class MemoryChunkDatabase {
  readonly meta = new Map<string, unknown>();
  readonly records = new Map<string, unknown>();
  readonly quarantine: unknown[] = [];
  /** Failure injection: return a failure to make that transaction abort with no change. */
  fail: (keys: readonly string[]) => ChunkPortFailure | null = () => null;
  /** Total stored record bytes allowed before `quota` (counts Uint8Array `data` fields). */
  quotaBytes = Infinity;
  commits = 0;
  bytes(): number { let n = 0; for (const r of this.records.values()) n += (r as { data?: Uint8Array })?.data?.byteLength ?? 0; return n; }
}

/** Values are structured-cloned on the way in and out, as IndexedDB does, so callers never share storage. */
export function memoryChunkPort(db = new MemoryChunkDatabase(), durability: ChunkDurability = 'session'): ChunkPort {
  let closed = false;
  const live = () => { if (closed) throw new ChunkPortError('unavailable', 'closed'); };
  return {
    durability,
    async listMeta() { live(); return [...db.meta].map(([k, v]) => [k, structuredClone(v)] as [string, unknown]); },
    async quarantineCount() { live(); return db.quarantine.length; },
    async quarantineRows(limit) { live(); return db.quarantine.slice(0, limit).map(v => structuredClone(v)); },
    async update(keys, decide) {
      live();
      const current = new Map<string, ChunkEntry | undefined>();
      for (const k of keys) current.set(k, db.meta.has(k) || db.records.has(k) ? { meta: structuredClone(db.meta.get(k)), record: structuredClone(db.records.get(k)) } : undefined);
      const { result, plan } = decide(current, db.quarantine.length);
      if (!plan) return result;
      const failure = db.fail(keys);
      if (failure) throw new ChunkPortError(failure, 'injected');
      const removed = new Set(plan.remove ?? []);
      let after = 0;
      for (const [k, r] of db.records) if (!removed.has(k) && !plan.put?.some(p => p.key === k)) after += (r as { data?: Uint8Array })?.data?.byteLength ?? 0;
      for (const p of plan.put ?? []) after += (p.record as { data?: Uint8Array })?.data?.byteLength ?? 0;
      if (after > db.quotaBytes) throw new ChunkPortError('quota', 'memory quota');
      if (plan.clearQuarantine) db.quarantine.length = 0;
      for (const q of plan.quarantine ?? []) db.quarantine.push(structuredClone(q));
      for (const k of removed) { db.meta.delete(k); db.records.delete(k); }
      for (const p of plan.put ?? []) { db.meta.set(p.key, structuredClone(p.meta)); db.records.set(p.key, structuredClone(p.record)); }
      db.commits++;
      return result;
    },
    close() { closed = true; },
  };
}

// ------------------------------------------------------------------ IndexedDB port

const STORES = ['meta', 'records', 'quarantine'] as const;
const reason = (error: unknown): ChunkPortFailure => (error as { name?: string })?.name === 'QuotaExceededError' ? 'quota' : 'unavailable';

/**
 * Opens (or creates) database `name`. Rejects with `ChunkPortError('unavailable')` when IndexedDB is missing,
 * blocked (some private modes) or the open fails. A `versionchange` from another tab closes this port; later
 * operations reject as unavailable rather than blocking the other tab's upgrade.
 */
export function openIndexedDbChunkPort(name: string, factory: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB): Promise<ChunkPort> {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(new ChunkPortError('unavailable', 'IndexedDB is not available')); return; }
    let request: IDBOpenDBRequest;
    try { request = factory.open(name, 1); } catch (e) { reject(new ChunkPortError('unavailable', String((e as Error)?.message ?? e))); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, s === 'quarantine' ? { autoIncrement: true } : undefined);
    };
    request.onblocked = () => reject(new ChunkPortError('unavailable', 'open blocked by another tab'));
    request.onerror = () => reject(new ChunkPortError('unavailable', String(request.error?.message ?? 'open failed')));
    request.onsuccess = () => {
      const db = request.result;
      let closed = false;
      db.onversionchange = () => { closed = true; db.close(); };
      const txn = (mode: IDBTransactionMode, stores: readonly (typeof STORES[number])[] = STORES): IDBTransaction => {
        if (closed) throw new ChunkPortError('unavailable', 'closed');
        try { return db.transaction([...stores], mode); } catch (e) { throw new ChunkPortError('unavailable', String((e as Error)?.message ?? e)); }
      };
      const readAll = <T>(store: typeof STORES[number], map: (cursor: IDBCursorWithValue) => T, limit = Infinity) => new Promise<T[]>((ok, fail) => {
        let t: IDBTransaction; try { t = txn('readonly', [store]); } catch (e) { fail(e); return; }
        const out: T[] = [], cursor = t.objectStore(store).openCursor();
        cursor.onsuccess = () => { const c = cursor.result; if (c && out.length < limit) { out.push(map(c)); c.continue(); } };
        t.oncomplete = () => ok(out);
        t.onerror = t.onabort = () => fail(new ChunkPortError(reason(t.error), String(t.error?.message ?? 'read failed')));
      });
      resolve({
        durability: 'durable',
        listMeta: () => readAll('meta', c => [String(c.key), c.value] as [string, unknown]),
        quarantineCount: () => new Promise((ok, fail) => {
          let t: IDBTransaction; try { t = txn('readonly', ['quarantine']); } catch (e) { fail(e); return; }
          const r = t.objectStore('quarantine').count();
          t.oncomplete = () => ok(r.result);
          t.onerror = t.onabort = () => fail(new ChunkPortError(reason(t.error), String(t.error?.message ?? 'count failed')));
        }),
        quarantineRows: limit => readAll('quarantine', c => c.value, limit),
        update<R>(keys: readonly string[], decide: (current: ReadonlyMap<string, ChunkEntry | undefined>, quarantined: number) => ChunkDecision<R>) {
          return new Promise<R>((ok, fail) => {
            let t: IDBTransaction; try { t = txn('readwrite'); } catch (e) { fail(e); return; }
            const meta = t.objectStore('meta'), records = t.objectStore('records'), quarantine = t.objectStore('quarantine');
            const found = new Map<string, { meta?: unknown; record?: unknown; hasMeta: boolean; hasRecord: boolean }>();
            let pending = keys.length * 2 + 1, quarantined = 0, outcome: { value: R } | null = null, thrown: unknown = null;
            const ready = () => {
              if (--pending > 0) return;
              try {
                const current = new Map<string, ChunkEntry | undefined>();
                for (const k of keys) { const f = found.get(k)!; current.set(k, f.hasMeta || f.hasRecord ? { meta: f.meta, record: f.record } : undefined); }
                const { result, plan } = decide(current, quarantined);
                outcome = { value: result };
                if (plan?.clearQuarantine) quarantine.clear();
                for (const q of plan?.quarantine ?? []) quarantine.add(q);
                for (const k of plan?.remove ?? []) { meta.delete(k); records.delete(k); }
                for (const p of plan?.put ?? []) { meta.put(p.meta, p.key); records.put(p.record, p.key); }
              } catch (e) { thrown = e; t.abort(); }
            };
            for (const k of keys) {
              const f = { hasMeta: false, hasRecord: false } as { meta?: unknown; record?: unknown; hasMeta: boolean; hasRecord: boolean };
              found.set(k, f);
              const m = meta.get(k), r = records.get(k);
              m.onsuccess = () => { f.meta = m.result; f.hasMeta = m.result !== undefined; ready(); };
              r.onsuccess = () => { f.record = r.result; f.hasRecord = r.result !== undefined; ready(); };
            }
            const c = quarantine.count();
            c.onsuccess = () => { quarantined = c.result; ready(); };
            t.oncomplete = () => outcome ? ok(outcome.value) : fail(new ChunkPortError('unavailable', 'no decision'));
            t.onerror = t.onabort = () => thrown ? fail(thrown) : fail(new ChunkPortError(reason(t.error), String(t.error?.message ?? 'transaction aborted')));
          });
        },
        close() { closed = true; db.close(); },
      });
    };
  });
}
