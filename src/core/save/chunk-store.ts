/**
 * core/save/chunk-store.ts: a bounded, versioned store of keyed binary records for large worlds.
 *
 * Save sections hold JSON in Web Storage and are capped (262,144 characters each). A world with many edited regions
 * stores each region's bytes here instead, one record per key, through a `ChunkPort` (IndexedDB, or memory when
 * IndexedDB is unavailable). The owner is the object returned by `createChunkStore`/`openChunkStore`; it serializes
 * its operations, bounds what it admits and stores, and never overwrites bytes it could not read.
 *
 * Contract summary (details in docs/recipes/store-large-world-records.md):
 * - Writes are atomic per call: every record in one `write` call commits in one transaction or none does.
 * - Each record has a revision; a write must be strictly newer than what is stored (`stale` otherwise), which is
 *   compared inside the transaction, so two tabs cannot silently overwrite each other's newer data.
 * - Records carry the creator's schema number. Older schemas are returned for the creator to migrate; newer ones are
 *   read-only (`newer`). Unreadable records (bad envelope, length or CRC-32) are `quarantined`: a write or removal
 *   first copies the unreadable bytes aside in the same transaction, or refuses when the quarantine is full.
 * - Limits on key length, record bytes, record count, total bytes, batch size, pending operations and quarantine rows
 *   are checked before any storage work. Over a limit, the creator's `evictable` predicate may release least recently
 *   used records it marks as regenerable; without it the write is refused (`full`) and nothing is discarded.
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
  /** Quarantine rows kept; a write over an unreadable record needs one free row. */
  readonly maxQuarantine: number;
}
export const CHUNK_STORE_DEFAULT_LIMITS: ChunkStoreLimits = Object.freeze({
  maxKeyLength: 256, maxRecordBytes: 1 << 20, maxRecords: 65536, maxTotalBytes: 256 << 20, maxBatch: 64, maxPending: 64, maxQuarantine: 32,
});
const HARD = { maxKeyLength: 1024, maxRecordBytes: 64 << 20, maxRecords: 1 << 24, maxTotalBytes: Number.MAX_SAFE_INTEGER, maxBatch: 1024, maxPending: 1 << 16, maxQuarantine: 4096 };

export interface ChunkStoreOptions {
  /** The creator's record schema number (≥ 0). Stored with every record. */
  readonly schema: number;
  readonly limits?: Partial<ChunkStoreLimits>;
  /** Records the store may evict, least recently used first, when a write would exceed a limit. Default: none. */
  readonly evictable?: (key: string) => boolean;
}

export type ChunkReadResult =
  | { readonly status: 'found'; readonly schema: number; readonly revision: number; readonly data: Uint8Array }
  | { readonly status: 'missing' | 'quarantined' | 'busy' | 'closed' | 'unavailable' }
  | { readonly status: 'newer'; readonly schema: number; readonly revision: number };
export interface ChunkWrite { readonly key: string; readonly revision: number; readonly data: Uint8Array }
export type ChunkWriteResult =
  | { readonly status: 'saved'; readonly evicted: readonly string[] }
  | { readonly status: 'stale' | 'newer' | 'quarantine-full'; readonly key: string }
  | { readonly status: 'full' | 'quota' | 'busy' | 'closed' | 'unavailable' };
export type ChunkRemoveResult = { readonly status: 'removed' | 'missing' | 'quarantine-full' | 'busy' | 'closed' | 'quota' | 'unavailable' };
export interface ChunkStoreStats {
  readonly durability: ChunkDurability;
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
  quarantine(limit?: number): Promise<ChunkQuarantineRow[] | { readonly status: 'busy' | 'closed' | 'unavailable' }>;
  /** Deletes every quarantine row (explicit, after the creator has offered export). */
  clearQuarantine(): Promise<{ readonly status: 'cleared' | 'busy' | 'closed' | 'unavailable' }>;
  stats(): ChunkStoreStats;
  /** Queued operations resolve `closed`; an operation already in a transaction completes. Idempotent. */
  close(): void;
}

/** Thrown synchronously-in-promise for caller errors (bad key, revision, data type, oversize). */
export class ChunkStoreError extends Error { override readonly name = 'ChunkStoreError'; }

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

/** Validates one stored entry; returns why it is unreadable, or null. */
function unreadable(key: string, entry: ChunkEntry): string | null {
  const m = entry.meta as Partial<Meta> | undefined, r = entry.record as Partial<StoredRecord> | undefined;
  if (!m || typeof m !== 'object' || m.format !== 1) return 'meta envelope';
  if (!r || typeof r !== 'object' || r.format !== 1 || r.key !== key) return 'record envelope';
  if (!int(m.schema, 0, Number.MAX_SAFE_INTEGER) || !int(m.revision, 0, Number.MAX_SAFE_INTEGER) || !int(m.bytes, 0, HARD.maxRecordBytes) || !int(m.crc, 0, 0xffffffff) || !int(m.sequence, 0, Number.MAX_SAFE_INTEGER)) return 'meta fields';
  if (r.schema !== m.schema || r.revision !== m.revision || r.crc !== m.crc) return 'meta/record mismatch';
  if (!(r.data instanceof Uint8Array) || r.data.byteLength !== m.bytes) return 'length';
  if (crc32(r.data) !== m.crc) return 'checksum';
  return null;
}

/** Creates the owner over an open port. Reads every meta row once (small) for totals and eviction order. */
export async function createChunkStore(port: ChunkPort, options: ChunkStoreOptions): Promise<ChunkStore> {
  const { schema, evictable } = options;
  if (!int(schema, 0, Number.MAX_SAFE_INTEGER)) throw new ChunkStoreError('chunk store: schema must be a nonnegative safe integer');
  if (evictable !== undefined && typeof evictable !== 'function') throw new ChunkStoreError('chunk store: evictable must be a function');
  const merged = { ...CHUNK_STORE_DEFAULT_LIMITS, ...options.limits };
  for (const k of Object.keys(CHUNK_STORE_DEFAULT_LIMITS) as (keyof ChunkStoreLimits)[]) if (!int(merged[k], 1, HARD[k])) throw new ChunkStoreError(`chunk store: invalid limit ${k}`);
  const limits: ChunkStoreLimits = Object.freeze({ ...merged });

  // In-memory index: bytes and last access per key. Corrected from in-transaction rows on every write.
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

  let closed = false, pending = 0, chain: Promise<unknown> = Promise.resolve();
  const queued = new Set<() => void>();
  /** FIFO, one operation at a time; bounded by maxPending. */
  function enqueue<T>(work: () => Promise<T>, busy: T, closedResult: T): Promise<T> {
    if (closed) return Promise.resolve(closedResult);
    if (pending >= limits.maxPending) return Promise.resolve(busy);
    pending++;
    let cancel!: () => void;
    const run = new Promise<T>(resolve => {
      cancel = () => resolve(closedResult);
      queued.add(cancel);
      chain = chain.then(async () => {
        if (!queued.delete(cancel)) return;
        try { resolve(await work()); } finally { pending--; }
      });
    });
    return run.finally(() => { if (queued.delete(cancel)) pending--; });
  }
  const failure = <T>(e: unknown, map: (r: 'quota' | 'unavailable') => T): T => {
    if (e instanceof ChunkPortError) return map(e.reason);
    throw e;
  };
  const checkKey = (key: unknown): string => {
    if (typeof key !== 'string' || key.length < 1 || key.length > limits.maxKeyLength) throw new ChunkStoreError('chunk store: invalid key');
    return key;
  };

  return {
    read(rawKey) {
      let key: string; try { key = checkKey(rawKey); } catch (e) { return Promise.reject(e); }
      return enqueue<ChunkReadResult>(async () => {
        try {
          return await port.update<ChunkReadResult>([key], current => {
            const entry = current.get(key);
            if (!entry) { dropIndex(key); return { result: { status: 'missing' } }; }
            if (unreadable(key, entry)) return { result: { status: 'quarantined' } };
            const m = entry.meta as Meta, r = entry.record as StoredRecord;
            touch(key);
            if (m.schema > schema) return { result: { status: 'newer', schema: m.schema, revision: m.revision } };
            return { result: { status: 'found', schema: m.schema, revision: m.revision, data: r.data.slice() } };
          });
        } catch (e) { return failure(e, () => ({ status: 'unavailable' as const })); }
      }, { status: 'busy' }, { status: 'closed' });
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
        const keys = batch.map(b => b.key);
        let committed: { evicted: string[]; sizes: [string, number][] } | null = null;
        try {
          const result = await port.update<ChunkWriteResult>(keys, (current, quarantineRows) => {
            const copies: unknown[] = [];
            let bytes = total, records = index.size;
            for (const b of batch) {
              const entry = current.get(b.key);
              const known = index.get(b.key);
              if (known) { bytes -= known.bytes; records--; }
              if (!entry) continue;
              const why = unreadable(b.key, entry);
              if (why) { copies.push({ key: b.key, reason: why, value: entry }); continue; }
              const m = entry.meta as Meta;
              if (m.schema > schema) return { result: { status: 'newer', key: b.key } };
              if (b.revision <= m.revision) return { result: { status: 'stale', key: b.key } };
            }
            if (copies.length && quarantineRows + copies.length > limits.maxQuarantine) return { result: { status: 'quarantine-full', key: (copies[0] as { key: string }).key } };
            for (const b of batch) { bytes += b.data.byteLength; records++; }
            const evicted: string[] = [];
            if (bytes > limits.maxTotalBytes || records > limits.maxRecords) {
              if (!evictable) return { result: { status: 'full' } };
              const inBatch = new Set(keys);
              const order = [...index].filter(([k]) => !inBatch.has(k) && evictable(k)).sort((a, b) => a[1].access - b[1].access);
              for (const [k, e] of order) {
                if (bytes <= limits.maxTotalBytes && records <= limits.maxRecords) break;
                evicted.push(k); bytes -= e.bytes; records--;
              }
              if (bytes > limits.maxTotalBytes || records > limits.maxRecords) return { result: { status: 'full' } };
            }
            const put = batch.map(b => {
              const crc = crc32(b.data), sequence = ++tick;
              return { key: b.key, meta: { format: 1, schema, revision: b.revision, bytes: b.data.byteLength, crc, sequence } satisfies Meta, record: { format: 1, key: b.key, schema, revision: b.revision, crc, data: b.data } satisfies StoredRecord };
            });
            committed = { evicted, sizes: batch.map(b => [b.key, b.data.byteLength]) };
            return { result: { status: 'saved', evicted }, plan: { put, remove: evicted, quarantine: copies } };
          });
          if (result.status === 'saved' && committed) {
            const c = committed as { evicted: string[]; sizes: [string, number][] };
            for (const k of c.evicted) dropIndex(k);
            for (const [k, n] of c.sizes) setIndex(k, n);
            quarantined = await port.quarantineCount().catch(() => quarantined);
          }
          return result;
        } catch (e) { return failure(e, r => ({ status: r })); }
      }, { status: 'busy' }, { status: 'closed' });
    },

    remove(rawKey) {
      let key: string; try { key = checkKey(rawKey); } catch (e) { return Promise.reject(e); }
      return enqueue<ChunkRemoveResult>(async () => {
        try {
          const result = await port.update<ChunkRemoveResult>([key], (current, quarantineRows) => {
            const entry = current.get(key);
            if (!entry) return { result: { status: 'missing' } };
            const why = unreadable(key, entry);
            if (why && quarantineRows + 1 > limits.maxQuarantine) return { result: { status: 'quarantine-full' } };
            return { result: { status: 'removed' }, plan: { remove: [key], quarantine: why ? [{ key, reason: why, value: entry }] : [] } };
          });
          if (result.status === 'removed') { dropIndex(key); quarantined = await port.quarantineCount().catch(() => quarantined); }
          if (result.status === 'missing') dropIndex(key);
          return result;
        } catch (e) { return failure(e, r => ({ status: r })); }
      }, { status: 'busy' }, { status: 'closed' });
    },

    quarantine(limit = limits.maxQuarantine) {
      const n = Math.min(int(limit, 0, HARD.maxQuarantine) ? limit : 0, limits.maxQuarantine);
      return enqueue<ChunkQuarantineRow[] | { status: 'busy' | 'closed' | 'unavailable' }>(async () => {
        try { return (await port.quarantineRows(n)) as ChunkQuarantineRow[]; }
        catch (e) { return failure(e, () => ({ status: 'unavailable' as const })); }
      }, { status: 'busy' }, { status: 'closed' });
    },

    clearQuarantine() {
      return enqueue<{ status: 'cleared' | 'busy' | 'closed' | 'unavailable' }>(async () => {
        try {
          const r = await port.update<{ status: 'cleared' }>([], () => ({ result: { status: 'cleared' }, plan: { clearQuarantine: true } }));
          quarantined = 0; return r;
        } catch (e) { return failure(e, () => ({ status: 'unavailable' as const })); }
      }, { status: 'busy' }, { status: 'closed' });
    },

    stats: () => Object.freeze({ durability: port.durability, records: index.size, bytes: total, pending, quarantined, limits }),

    close() {
      if (closed) return;
      closed = true;
      for (const cancel of [...queued]) cancel();
      void chain.finally(() => port.close());
    },
  };
}

export interface OpenChunkStoreOptions extends ChunkStoreOptions {
  /** IndexedDB database name; one per world or save slot. */
  readonly name: string;
  /** Test seam; defaults to `globalThis.indexedDB`. `null` forces the memory fallback. */
  readonly factory?: IDBFactory | null;
}

/**
 * Opens a durable IndexedDB-backed store, or a session-only memory store when IndexedDB is missing or refuses to
 * open (some private modes). Check `stats().durability`: `session` data is lost when the page closes, so tell the
 * player instead of claiming the world is saved.
 */
export async function openChunkStore(options: OpenChunkStoreOptions): Promise<ChunkStore> {
  if (typeof options.name !== 'string' || options.name.length < 1 || options.name.length > 256) throw new ChunkStoreError('chunk store: invalid database name');
  let port: ChunkPort;
  try { port = options.factory === null ? memoryChunkPort() : await openIndexedDbChunkPort(options.name, options.factory); }
  catch (e) { if (e instanceof ChunkPortError) port = memoryChunkPort(); else throw e; }
  try { return await createChunkStore(port, options); }
  catch (e) {
    port.close();
    if (!(e instanceof ChunkPortError)) throw e;
    return createChunkStore(memoryChunkPort(), options);
  }
}
