import {observeTileReadiness,type TileReadiness} from './tile-readiness';
/**
 * One tile scheduler: global per-kind residency and a bounded fetch/decode/upload queue.
 * Source adapters retain geometry, imagery selection and material construction. The shared queue owns pending
 * work and decoded values, cancels stale/hidden/covered requests and disposes late decode results. Every globe
 * and HiPS adapter now uses this queue; source adapters default to the shared app scheduler.
 * Noun-free: keys and values only, no DOM or three.
 */

export type TileKind = 'globe' | 'sky';

/** One kind's limits for the running tier (`QualityProfile.tiles`). */
export interface TileCaps {
  /** Tiles kept resident (uploaded) across every stream of the kind. */
  resident: number;
  /** Fetches in flight per stream. */
  concurrency: number;
  /** New tiles uploaded per frame per stream. */
  uploadsPerFrame: number;
  /** Decoded bitmaps allowed in flight or waiting for upload per stream (fetching + ready ≤ this). */
  decodedBitmapCap: number;
}

/** How a source names its tiles. */
export interface TileSchemeDef<K> {
  id: string;
  key(tile: K): string;
}

export interface TileStream<K> {
  readonly kind: TileKind;
  /** Read live: a Graphics change applies at the next admit. */
  readonly caps: TileCaps;
  readonly paused: boolean;
  /** Tiles this stream holds. */
  readonly resident: number;
  /** Room for one more resident tile of this kind (all streams counted). The caller evicts an idle tile when false. */
  canAdmit(): boolean;
  /** Counts `tile` as resident. False, and not counted, when the kind is full. */
  admit(tile: K): boolean;
  release(tile: K): void;
  has(tile: K): boolean;
  /** Runs when the scheduler un-pauses. Returns the unsubscribe. */
  onResume(fn: () => void): () => void;
  onPause(fn: () => void): () => void;
  onClose(fn: () => void): () => void;
  onAvailable(fn: () => void): () => void;
  /** Releases every tile of this stream (also on the owner's abort). */
  close(): void;
}

export interface TileScheduler {
  open<K>(scheme: TileSchemeDef<K>, kind: TileKind, signal: AbortSignal): TileStream<K>;
  pause(paused: boolean): void;
  readonly paused: boolean;
  /** Resident tiles of `kind` over every open stream. */
  resident(kind: TileKind): number;
  caps(kind: TileKind): TileCaps;
}

/** `caps` is read on every question, so a live knob change needs no reopen. */
export function createTileScheduler(caps: (kind: TileKind) => TileCaps): TileScheduler {
  const counts: Record<TileKind, number> = { globe: 0, sky: 0 };
  const resumes = new Set<() => void>();
  const pauses = new Set<() => void>();
  const available = {globe:new Set<() => void>(),sky:new Set<() => void>()};
  let paused = false;
  const scheduler: TileScheduler = {
    get paused() { return paused; },
    pause(next) {
      if (next === paused) return;
      paused = next;
      for (const fn of [...(paused ? pauses : resumes)]) fn();
    },
    resident: kind => counts[kind],
    caps,
    open<K>(scheme: TileSchemeDef<K>, kind: TileKind, signal: AbortSignal): TileStream<K> {
      const held = new Set<string>();
      const mine = new Set<() => void>();
      const minePauses = new Set<() => void>();
      const closes = new Set<() => void>();
      const mineAvailable = new Set<() => void>();
      let closed = false;
      const stream: TileStream<K> = {
        kind,
        get caps() { return caps(kind); },
        get paused() { return paused || closed; },
        get resident() { return held.size; },
        canAdmit: () => !closed && counts[kind] < caps(kind).resident,
        admit(tile) {
          const k = scheme.key(tile);
          if (held.has(k)) return true;
          if (!stream.canAdmit()) return false;
          held.add(k); counts[kind]++;
          return true;
        },
        release(tile) { if (held.delete(scheme.key(tile))) { counts[kind]--; for (const fn of [...available[kind]]) fn(); } },
        has: tile => held.has(scheme.key(tile)),
        onPause(fn) { if (closed) return () => {}; pauses.add(fn); minePauses.add(fn); return () => { pauses.delete(fn); minePauses.delete(fn); }; },
        onAvailable(fn) { if (closed) return () => {}; available[kind].add(fn); mineAvailable.add(fn); return () => { available[kind].delete(fn); mineAvailable.delete(fn); }; },
        onClose(fn) { if (closed) return () => {}; closes.add(fn); return () => { closes.delete(fn); }; },
        onResume(fn) { if (closed) return () => {}; resumes.add(fn); mine.add(fn); return () => { resumes.delete(fn); mine.delete(fn); }; },
        close() {
          if (closed) return;
          closed = true;
          counts[kind] -= held.size; held.clear();
          for (const fn of mine) resumes.delete(fn);
          mine.clear();
          for (const fn of minePauses) pauses.delete(fn); minePauses.clear();
          for (const fn of [...closes]) fn(); closes.clear();
          signal.removeEventListener('abort', onAbort);
          for (const fn of mineAvailable) available[kind].delete(fn); mineAvailable.clear();
          for (const fn of [...available[kind]]) fn();
        },
      };
      const onAbort = () => stream.close();
      if (signal.aborted) stream.close();
      else signal.addEventListener('abort', onAbort, { once: true });
      return stream;
    },
  };
  return scheduler;
}

/** Shared fetch/decode queue. Rendering remains with the source adapter; ownership of every decoded value is
 * transferred to `upload` only when it returns true. Cancellation may race a decoder that ignores its signal,
 * so completions are checked by request identity and unwanted values are always disposed. */
export function createTileQueue<K, V>(stream: TileStream<K>, options: {
 key(tile: K): string;
 concurrency?: number;
 uploadsPerFrame?: number;
 load(tile: K, signal: AbortSignal): Promise<V>;
 dispose(value: V): void;
 upload(tile: K, value: V): boolean;
 has(tile: K): boolean;
 ready?(): void;
 changed?(): void;
 failed?(tile: K, error: unknown): void;
}) {
 const pending = new Map<string, { tile: K; controller: AbortController }>();
 const decoded = new Map<string, { tile: K; value: V }>();
 const failures = new Set<string>();
 let wanted = new Map<string, K>(), paused = false, closed = false;
 const blocked = () => closed || paused || stream.paused;
 function discard() { for (const entry of decoded.values()) options.dispose(entry.value); decoded.clear(); }
 function cancel() { for (const entry of pending.values()) entry.controller.abort(); discard(); }
 function pump() {
  if (blocked()) return;
  for (const [key, tile] of wanted) {
   const caps = stream.caps;
   if (pending.size >= Math.min(caps.concurrency, options.concurrency ?? caps.concurrency) || pending.size + decoded.size >= caps.decodedBitmapCap) break;
   if (options.has(tile) || pending.has(key) || decoded.has(key) || failures.has(key)) continue;
   const entry = { tile, controller: new AbortController() }; pending.set(key, entry);
   void Promise.resolve().then(() => {
    if (entry.controller.signal.aborted) throw entry.controller.signal.reason;
    return options.load(tile, entry.controller.signal);
   }).then(value => {
    if (closed || entry.controller.signal.aborted || !wanted.has(key)) options.dispose(value);
    else { decoded.set(key, { tile, value }); options.ready?.(); }
   }, error => {
    if (!closed && !entry.controller.signal.aborted && wanted.has(key)) { failures.add(key); options.failed?.(tile, error); }
   }).finally(() => { pending.delete(key); if (!closed) options.changed?.(); pump(); });
  }
 }
 const stopReadiness = observeTileReadiness(() => {
  const state:TileReadiness={wanted:0,pending:0,decoded:0,unresolved:0,failed:0};
  if(blocked())return state;
  for(const [key,tile] of wanted){
   state.wanted++;
   if(options.has(tile))continue;
   state.unresolved++;
   if(pending.has(key))state.pending++;
   if(decoded.has(key))state.decoded++;
   if(failures.has(key))state.failed++;
  }
  return state;
 });
 const stopPause = stream.onPause(cancel);
 const stopResume = stream.onResume(pump);
 const stopAvailable = stream.onAvailable(() => { if (!blocked() && decoded.size) options.ready?.(); });
 const stopClose = stream.onClose(() => api.close());
 const api = {
  setWanted(tiles: readonly K[]) {
   wanted = new Map(tiles.map(tile => [options.key(tile), tile]));
   for (const [key, entry] of pending) if (!wanted.has(key)) entry.controller.abort();
   for (const [key, entry] of decoded) if (!wanted.has(key)) { options.dispose(entry.value); decoded.delete(key); }
   pump();
  },
  pause(value: boolean) { if (paused === value) return; paused = value; if (value) cancel(); else pump(); },
  retry(eligible: (tile: K) => boolean = () => true) { for (const [key, tile] of wanted) if (eligible(tile)) failures.delete(key); pump(); },
  /** Call once per presented frame. A full residency cap retains bounded decoded work for the next frame. */
  update() {
   if (blocked()) return;
   let remaining = Math.min(stream.caps.uploadsPerFrame, options.uploadsPerFrame ?? stream.caps.uploadsPerFrame);
   for (const key of wanted.keys()) {
    const entry = decoded.get(key); if (!entry) continue;
    if (remaining-- <= 0) break;
    if (options.has(entry.tile)) options.dispose(entry.value);
    else if (!options.upload(entry.tile, entry.value)) continue;
    decoded.delete(key);
   }
   pump();
  },
  get pending() { return pending.size; },
  get ready() { return decoded.size; },
  close() { if (closed) return; closed = true; wanted.clear(); cancel(); stopReadiness(); stopPause(); stopResume(); stopClose(); stopAvailable(); },
 };
 return api;
}
