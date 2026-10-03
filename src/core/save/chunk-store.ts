/**
 * core/save/chunk-store.ts: a bounded, versioned store of keyed binary records for large worlds.
 *
 * Save sections hold JSON in Web Storage and are capped (262,144 characters each). A world with many edited regions
 * stores each region's bytes here instead, one record per key, through a `ChunkPort` (IndexedDB, or memory when
 * IndexedDB is unavailable). The owner is the object returned by `createChunkStore`/`openChunkStore`; it serializes
 * its operations, bounds what it admits and stores, and never deletes or overwrites bytes it could not read without
 * first copying them to the quarantine in the same transaction.
 *
 * Contract summary (details in docs/recipes/store-large-world-records.md):
 * - Writes are atomic per call: every record in one `write` call commits in one transaction or none does.
 * - Each record has a revision; a write must be strictly newer than what is stored (`stale` otherwise), compared
 *   inside the transaction, so two tabs cannot silently overwrite each other's newer data.
 * - Records carry the creator's schema number and the store's envelope format. Older schemas are returned for the
 *   creator to migrate; a newer schema or envelope format is `newer`: never overwritten, removed or evicted here.
 * - Unreadable records (bad envelope, length or CRC-32) are `quarantined`; a write, removal or eviction first copies
 *   them aside in the same transaction, or refuses when the quarantine is full.
 * - Limits on key length, record bytes, record count, total bytes, batch size, pending operations and quarantine rows
 *   are checked before storage work. Over a limit, the creator's `evictable` predicate may release records it marks
 *   as regenerable, least recently used in this session first; without it the write is refused (`full`).
 * - Results are values. Caller mistakes reject with `ChunkStoreError`; an unexpected error (a throwing `evictable`)
 *   resolves `{status: 'failed', error}` for that operation only, and later operations keep running.
 */
import { ChunkPortError, memoryChunkPort, openIndexedDbChunkPort, type ChunkDurability, type ChunkEntry, type ChunkPort } from './chunk-port';

export interface ChunkStoreLimits {
  /** UTF-16 code units per key. 1..1024. */
  readonly maxKeyLength: number;
  /** Bytes per record. 1..64 MiB. */
  readonly maxRecordBytes: number;
  readonly maxRecords: number;
  readonly maxTotalBytes: number;
  /** Records per `write` call. 1..1024. */
  readonly maxBatch: number;
  /** Queued operations; more return `busy`. */
  readonly maxPending: number;
  /**
   * Quarantine rows kept. A row holds the unreadable entry as found (meta plus record), so its size is that of the
   * corrupted record, which storage bounded when it was written: roughly maxQuarantine × maxRecordBytes at most.
   */
  readonly maxQuarantine: number;
}
export const CHUNK_STORE_DEFAULT_LIMITS: ChunkStoreLimits = Object.freeze({
  maxKeyLength: 256, maxRecordBytes: 1 << 20, maxRecords: 65536, maxTotalBytes: 256 << 20, maxBatch: 64, maxPending: 64, maxQuarantine: 32,
});
const HARD = { maxKeyLength: 1024, maxRecordBytes: 64 << 20, maxRecords: 1 << 24, maxTotalBytes: Number.MAX_SAFE_INTEGER, maxBatch: 1024, maxPending: 1 << 16, maxQuarantine: 4096 };
/** Extra eviction candidates read beyond the cached estimate, in case some turn out newer or already gone. */
const EVICTION_SLACK = 8;

export interface ChunkStoreOptions {
  /** The creator's record schema number (≥ 0). Stored with every record. */
  readonly schema: number;
  readonly limits?: Partial<ChunkStoreLimits>;
  /** Records the store may evict, least recently used in this session first, when a write would exceed a limit. */
  readonly evictable?: (key: string) => boolean;
}

export type ChunkFailed = { readonly status: 'failed'; readonly error: unknown };
export type ChunkReadResult =
  | { readonly status: 'found'; readonly schema: number; readonly revision: number; readonly data: Uint8Array }
  | { readonly status: 'missing' | 'quarantined' | 'busy' | 'closed' | 'unavailable' }
  /** Written by a newer schema or envelope format; `schema`/`revision` when readable. Read-only here. */
  | { readonly status: 'newer'; readonly schema: number | null; readonly revision: number | null }
  | ChunkFailed;
export interface ChunkWrite { readonly key: string; readonly revision: number; readonly data: Uint8Array }
export type ChunkWriteResult =
  | { readonly status: 'saved'; readonly evicted: readonly string[] }
  | { readonly status: 'stale' | 'newer' | 'quarantine-full'; readonly key: string }
  | { readonly status: 'full' | 'quota' | 'busy' | 'closed' | 'unavailable' }
  | ChunkFailed;
export type ChunkRemoveResult = { readonly status: 'removed' | 'missing' | 'newer' | 'quarantine-full' | 'busy' | 'closed' | 'quota' | 'unavailable' } | ChunkFailed;
export type ChunkStatus = { readonly status: 'busy' | 'closed' | 'unavailable' } | ChunkFailed;
export interface ChunkStoreStats {
  readonly durability: ChunkDurability;
  /** False once closed, or after another tab's upgrade closed the connection: nothing more will be stored. */
  readonly available: boolean;
  readonly records: number;
  readonly bytes: number;
  readonly pending: number;
  readonly quarantined: number;
  readonly limits: ChunkStoreLimits;
}
export interface ChunkQuarantineRow { readonly key: string; readonly reason: string; readonly value: unknown }

export interface ChunkStore {
  read(key: string): Promise<ChunkReadResult>;
  /** Atomic: all entries commit together or none does. Data is copied when the call is made. */
  write(entries: readonly ChunkWrite[]): Promise<ChunkWriteResult>;
  remove(key: string): Promise<ChunkRemoveResult>;
  /** At most `limit` (≤ maxQuarantine) quarantined rows, for support export. */
  quarantine(limit?: number): Promise<ChunkQuarantineRow[] | ChunkStatus>;
  /** Deletes every quarantine row (explicit, after the creator has offered export). */
  clearQuarantine(): Promise<{ readonly status: 'cleared' } | ChunkStatus>;
  /**
   * Deletes every record and quarantine row in one transaction (a world reset), including newer and unreadable
   * ones: this is the creator's explicit decision, not a recovery path.
   */
  clear(): Promise<{ readonly status: 'cleared' } | ChunkStatus>;
  /** Closes the store, then deletes its whole database. `blocked`: another tab still has it open. */
  destroy(): Promise<{ readonly status: 'destroyed' | 'blocked' } | ChunkStatus>;
  stats(): ChunkStoreStats;
  /** Queued operations resolve `closed` and never run; an operation already in a transaction completes. */
  close(): void;
}

/** Rejected for caller errors (bad key, revision, data type, oversize). `reason` is set for open refusals. */
export class ChunkStoreError extends Error {
  override readonly name = 'ChunkStoreError';
  constructor(message: string, readonly reason?: 'newer-format' | 'deleting' | 'blocked') { super(message); }
}

const FORMAT = 1;
interface Meta { format: 1; schema: number; revision: number; bytes: number; crc: number; sequence: number }
interface StoredRecord { format: 1; key: string; schema: number; revision: number; crc: number; data: Uint8Array }

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
/** CRC-32 (IEEE 802.3), as in zip/PNG. Detects accidental corruption, not tampering. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const int = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;

type Classified = { kind: 'ok'; meta: Meta; record: StoredRecord } | { kind: 'newer'; schema: number | null; revision: number | null } | { kind: 'unreadable'; why: string };
/** Validates one stored entry against this build's envelope format and schema. */
function classify(key: string, entry: ChunkEntry, schema: number): Classified {
  const m = entry.meta as Partial<Meta> | undefined, r = entry.record as Partial<StoredRecord> | undefined;
  const newerFormat = (x: { format?: unknown } | undefined) => !!x && typeof x === 'object' && int(x.format, FORMAT + 1, Number.MAX_SAFE_INTEGER);
  if (newerFormat(m) || newerFormat(r)) return { kind: 'newer', schema: null, revision: null };
  if (!m || typeof m !== 'object' || m.format !== FORMAT) return { kind: 'unreadable', why: 'meta envelope' };
  if (!r || typeof r !== 'object' || r.format !== FORMAT || r.key !== key) return { kind: 'unreadable', why: 'record envelope' };
  if (!int(m.schema, 0, Number.MAX_SAFE_INTEGER) || !int(m.revision, 0, Number.MAX_SAFE_INTEGER) || !int(m.bytes, 0, HARD.maxRecordBytes) || !int(m.crc, 0, 0xffffffff) || !int(m.sequence, 0, Number.MAX_SAFE_INTEGER)) return { kind: 'unreadable', why: 'meta fields' };
  if (r.schema !== m.schema || r.revision !== m.revision || r.crc !== m.crc) return { kind: 'unreadable', why: 'meta/record mismatch' };
  if (!(r.data instanceof Uint8Array) || r.data.byteLength !== m.bytes) return { kind: 'unreadable', why: 'length' };
  if (crc32(r.data) !== m.crc) return { kind: 'unreadable', why: 'checksum' };
  if (m.schema > schema) return { kind: 'newer', schema: m.schema, revision: m.revision };
  return { kind: 'ok', meta: m as Meta, record: r as StoredRecord };
}

/** Creates the owner over an open port. Reads every meta row once (small) for totals and eviction order. */
export async function createChunkStore(port: ChunkPort, options: ChunkStoreOptions): Promise<ChunkStore> {
  const { schema, evictable } = options;
  if (!int(schema, 0, Number.MAX_SAFE_INTEGER)) throw new ChunkStoreError('chunk store: schema must be a nonnegative safe integer');
  if (evictable !== undefined && typeof evictable !== 'function') throw new ChunkStoreError('chunk store: evictable must be a function');
  const merged = { ...CHUNK_STORE_DEFAULT_LIMITS, ...options.limits };
  for (const k of Object.keys(CHUNK_STORE_DEFAULT_LIMITS) as (keyof ChunkStoreLimits)[]) if (!int(merged[k], 1, HARD[k])) throw new ChunkStoreError(`chunk store: invalid limit ${k}`);
  const limits: ChunkStoreLimits = Object.freeze({ ...merged });

  // In-memory index: bytes and last access per key. Recency of reads is session-only (not persisted); at open the
  // order is the persisted write sequence. Totals are corrected from in-transaction rows of the keys a write touches.
  const index = new Map<string, { bytes: number; access: number }>();
  let total = 0, tick = 0, quarantined = await port.quarantineCount();
  for (const [key, raw] of await port.listMeta()) {
    const m = raw as Partial<Meta>;
    const bytes = int(m?.bytes, 0, HARD.maxRecordBytes) ? m.bytes : 0, seq = int(m?.sequence, 0, Number.MAX_SAFE_INTEGER) ? m.sequence : 0;
    index.set(key, { bytes, access: seq }); total += bytes; tick = Math.max(tick, seq);
  }
  const touch = (key: string) => { const e = index.get(key); if (e) e.access = ++tick; };
  const setIndex = (key: string, bytes: number) => { const old = index.get(key); total += bytes - (old?.bytes ?? 0); index.set(key, { bytes, access: ++tick }); };
  const dropIndex = (key: string) => { const old = index.get(key); if (old) { total -= old.bytes; index.delete(key); } };
  const refreshQuarantine = async () => { quarantined = await port.quarantineCount().catch(() => quarantined); };

  let closed = false, pending = 0, chain: Promise<void> = Promise.resolve();
  const queued = new Set<() => void>();
  /**
   * FIFO, one operation at a time, at most maxPending queued. Every outcome resolves: port failures map to statuses,
   * anything else to `failed`. The internal chain never rejects, so one failure cannot stall later operations.
   */
  function enqueue<T>(work: () => Promise<T>, busy: T, closedResult: T, portFailure: (r: 'quota' | 'unavailable') => T): Promise<T> {
    if (closed) return Promise.resolve(closedResult);
    if (pending >= limits.maxPending) return Promise.resolve(busy);
    pending++;
    return new Promise<T>(resolve => {
      const cancel = () => { if (queued.delete(cancel)) { pending--; resolve(closedResult); } };
      queued.add(cancel);
      chain = chain.then(async () => {
        if (!queued.delete(cancel)) return; // closed while queued: already resolved
        try { resolve(await work()); }
        catch (error) {
          if (error instanceof ChunkPortError) resolve(portFailure(error.reason === 'quota' ? 'quota' : 'unavailable'));
          else resolve({ status: 'failed', error } as T);
        }
        finally { pending--; }
      }).catch(() => { /* resolve/finally cannot throw; keep the chain usable regardless */ });
    });
  }
  const unavailable = () => ({ status: 'unavailable' as const });
  const checkKey = (key: unknown): string => {
    if (typeof key !== 'string' || key.length < 1 || key.length > limits.maxKeyLength) throw new ChunkStoreError('chunk store: invalid key');
    return key;
  };
  const quarantineRow = (key: string, why: string, entry: ChunkEntry) => ({ key, reason: why, value: entry });

  return {
    read(rawKey) {
      let key: string; try { key = checkKey(rawKey); } catch (e) { return Promise.reject(e); }
      return enqueue<ChunkReadResult>(() => port.update<ChunkReadResult>([key], current => {
        const entry = current.get(key);
        if (!entry) { dropIndex(key); return { result: { status: 'missing' } }; }
        const c = classify(key, entry, schema);
        if (c.kind === 'unreadable') return { result: { status: 'quarantined' } };
        touch(key);
        if (c.kind === 'newer') return { result: { status: 'newer', schema: c.schema, revision: c.revision } };
        return { result: { status: 'found', schema: c.meta.schema, revision: c.meta.revision, data: c.record.data.slice() } };
      }), { status: 'busy' }, { status: 'closed' }, unavailable);
    },

    write(entries) {
      let batch: { key: string; revision: number; data: Uint8Array }[];
      try {
        if (!Array.isArray(entries) || entries.length < 1 || entries.length > limits.maxBatch) throw new ChunkStoreError('chunk store: batch size');
        const seen = new Set<string>();
        batch = entries.map(e => {
          const key = checkKey(e?.key);
          if (seen.has(key)) throw new ChunkStoreError('chunk store: duplicate key in batch');
          seen.add(key);
          if (!int(e.revision, 0, Number.MAX_SAFE_INTEGER)) throw new ChunkStoreError('chunk store: invalid revision');
          if (!(e.data instanceof Uint8Array)) throw new ChunkStoreError('chunk store: data must be a Uint8Array');
          if (e.data.byteLength > limits.maxRecordBytes) throw new ChunkStoreError('chunk store: record too large');
          return { key, revision: e.revision, data: e.data.slice() };
        });
      } catch (e) { return Promise.reject(e); }
      return enqueue<ChunkWriteResult>(async () => {
        const keys = batch.map(b => b.key), inBatch = new Set(keys);
        // Projected totals from the cache, then eviction candidates (the creator callback runs here, outside any
        // transaction; if it throws, the operation resolves `failed` and nothing is stored).
        let bytes = total, records = index.size;
        for (const b of batch) { const known = index.get(b.key); if (known) { bytes -= known.bytes; records--; } bytes += b.data.byteLength; records++; }
        const candidates: string[] = [];
        if ((bytes > limits.maxTotalBytes || records > limits.maxRecords) && evictable) {
          let b2 = bytes, r2 = records, extra = 0;
          for (const [k, e] of [...index].sort((x, y) => x[1].access - y[1].access)) {
            if (inBatch.has(k) || !evictable(k)) continue;
            if (b2 <= limits.maxTotalBytes && r2 <= limits.maxRecords && ++extra > EVICTION_SLACK) break;
            candidates.push(k); b2 -= e.bytes; r2--;
          }
        }
        let committed: { evicted: string[]; gone: string[] } | null = null;
        const result = await port.update<ChunkWriteResult>([...keys, ...candidates], (current, quarantineRows) => {
          const copies: unknown[] = [];
          for (const b of batch) {
            const entry = current.get(b.key);
            if (!entry) continue;
            const c = classify(b.key, entry, schema);
            if (c.kind === 'unreadable') { copies.push(quarantineRow(b.key, c.why, entry)); continue; }
            if (c.kind === 'newer') return { result: { status: 'newer', key: b.key } };
            if (b.revision <= c.meta.revision) return { result: { status: 'stale', key: b.key } };
          }
          let projectedBytes = bytes, projectedRecords = records;
          const evicted: string[] = [], gone: string[] = [];
          for (const k of candidates) {
            if (projectedBytes <= limits.maxTotalBytes && projectedRecords <= limits.maxRecords) break;
            const entry = current.get(k), cached = index.get(k)?.bytes ?? 0;
            if (!entry) { gone.push(k); projectedBytes -= cached; projectedRecords--; continue; } // removed elsewhere
            const c = classify(k, entry, schema);
            if (c.kind === 'newer') continue; // never evict data this build cannot read
            if (c.kind === 'unreadable') copies.push(quarantineRow(k, c.why, entry));
            evicted.push(k); projectedBytes -= cached; projectedRecords--;
          }
          if (projectedBytes > limits.maxTotalBytes || projectedRecords > limits.maxRecords) return { result: { status: 'full' } };
          if (copies.length && quarantineRows + copies.length > limits.maxQuarantine) return { result: { status: 'quarantine-full', key: (copies[0] as { key: string }).key } };
          const put = batch.map(b => {
            const crc = crc32(b.data), sequence = ++tick;
            return { key: b.key, meta: { format: FORMAT, schema, revision: b.revision, bytes: b.data.byteLength, crc, sequence } satisfies Meta, record: { format: FORMAT, key: b.key, schema, revision: b.revision, crc, data: b.data } satisfies StoredRecord };
          });
          committed = { evicted, gone };
          return { result: { status: 'saved', evicted }, plan: { put, remove: evicted, quarantine: copies } };
        });
        if (result.status === 'saved' && committed) {
          const c = committed as { evicted: string[]; gone: string[] };
          for (const k of [...c.evicted, ...c.gone]) dropIndex(k);
          for (const b of batch) setIndex(b.key, b.data.byteLength);
          await refreshQuarantine();
        }
        return result;
      }, { status: 'busy' }, { status: 'closed' }, r => ({ status: r }));
    },

    remove(rawKey) {
      let key: string; try { key = checkKey(rawKey); } catch (e) { return Promise.reject(e); }
      return enqueue<ChunkRemoveResult>(async () => {
        const result = await port.update<ChunkRemoveResult>([key], (current, quarantineRows) => {
          const entry = current.get(key);
          if (!entry) return { result: { status: 'missing' } };
          const c = classify(key, entry, schema);
          if (c.kind === 'newer') return { result: { status: 'newer' } };
          if (c.kind === 'unreadable' && quarantineRows + 1 > limits.maxQuarantine) return { result: { status: 'quarantine-full' } };
          return { result: { status: 'removed' }, plan: { remove: [key], quarantine: c.kind === 'unreadable' ? [quarantineRow(key, c.why, entry)] : [] } };
        });
        if (result.status === 'removed' || result.status === 'missing') dropIndex(key);
        if (result.status === 'removed') await refreshQuarantine();
        return result;
      }, { status: 'busy' }, { status: 'closed' }, r => ({ status: r }));
    },

    quarantine(limit = limits.maxQuarantine) {
      const n = Math.min(int(limit, 0, HARD.maxQuarantine) ? limit : 0, limits.maxQuarantine);
      return enqueue<ChunkQuarantineRow[] | ChunkStatus>(async () => (await port.quarantineRows(n)) as ChunkQuarantineRow[], { status: 'busy' }, { status: 'closed' }, unavailable);
    },

    clearQuarantine() {
      return enqueue<{ status: 'cleared' } | ChunkStatus>(async () => {
        const r = await port.update<{ status: 'cleared' }>([], () => ({ result: { status: 'cleared' }, plan: { clearQuarantine: true } }));
        quarantined = 0; return r;
      }, { status: 'busy' }, { status: 'closed' }, unavailable);
    },

    clear() {
      return enqueue<{ status: 'cleared' } | ChunkStatus>(async () => {
        const r = await port.update<{ status: 'cleared' }>([], () => ({ result: { status: 'cleared' }, plan: { clearAll: true } }));
        index.clear(); total = 0; quarantined = 0; return r;
      }, { status: 'busy' }, { status: 'closed' }, unavailable);
    },

    destroy() {
      const done = enqueue<{ status: 'destroyed' | 'blocked' } | ChunkStatus>(async () => {
        closed = true;
        for (const cancel of [...queued]) cancel();
        const r = await port.destroy();
        index.clear(); total = 0; quarantined = 0;
        return { status: r };
      }, { status: 'busy' }, { status: 'closed' }, unavailable);
      return done;
    },

    stats: () => Object.freeze({ durability: port.durability, available: !closed && port.available(), records: index.size, bytes: total, pending, quarantined, limits }),

    close() {
      if (closed) return;
      closed = true;
      for (const cancel of [...queued]) cancel();
      void chain.then(() => port.close(), () => port.close());
    },
  };
}

export interface OpenChunkStoreOptions extends ChunkStoreOptions {
  /** World or save-slot name (1–200 code units); the IndexedDB database is `fe-chunks:<name>`. */
  readonly name: string;
  /** Test seam; defaults to `globalThis.indexedDB`. `null` forces the memory fallback. */
  readonly factory?: IDBFactory | null;
  /** How long to wait for the browser to open the database before rejecting `blocked`. 1..60000, default 5000. */
  readonly openTimeoutMs?: number;
}

/**
 * Opens a durable IndexedDB-backed store, or a session-only memory store when IndexedDB is missing or refuses to
 * open (some private modes). Check `stats().durability`: `session` data is lost when the store closes or the page
 * unloads, so tell the player instead of claiming the world is saved. A database written by a newer build rejects
 * with `ChunkStoreError` reason `newer-format` instead of falling back, so newer data is never hidden or replaced.
 * Likewise `deleting` (this tab's deletion of `name` is still pending: it completes once other connections close) and
 * `blocked` (the browser did not open it within `openTimeoutMs`) reject instead of returning an empty session store.
 */
export async function openChunkStore(options: OpenChunkStoreOptions): Promise<ChunkStore> {
  if (typeof options.name !== 'string' || options.name.length < 1 || options.name.length > 200) throw new ChunkStoreError('chunk store: invalid database name');
  const timeout = options.openTimeoutMs ?? 5000;
  if (!int(timeout, 1, 60000)) throw new ChunkStoreError('chunk store: invalid openTimeoutMs');
  let port: ChunkPort;
  try { port = options.factory === null ? memoryChunkPort() : await openIndexedDbChunkPort(options.name, options.factory, timeout); }
  catch (e) {
    if (e instanceof ChunkPortError && e.reason === 'newer-format') throw new ChunkStoreError('chunk store: database written by a newer build', 'newer-format');
    if (e instanceof ChunkPortError && e.reason === 'deleting') throw new ChunkStoreError('chunk store: a deletion of this database is pending; it completes when other connections close', 'deleting');
    if (e instanceof ChunkPortError && e.reason === 'blocked') throw new ChunkStoreError('chunk store: the browser did not open the database in time (another tab may be deleting or upgrading it)', 'blocked');
    if (e instanceof ChunkPortError) port = memoryChunkPort(); else throw e;
  }
  try { return await createChunkStore(port, options); }
  catch (e) {
    port.close();
    if (!(e instanceof ChunkPortError)) throw e;
    return createChunkStore(memoryChunkPort(), options);
  }
}
