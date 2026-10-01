/**
 * platform/assets/lease-cache.ts: reference-counted leases over shared immutable resources
 * (ADR 0016, ADR 0023, ADR 0040; STD-REN-32, STD-REN-33, STD-REN-34).
 *
 * Two layers, both free of three.js so they run under `tsx --test`:
 *
 * - `LeaseCache<D, R>` is keyed by string. One entry per key (asset id and variant; a tile key for the tile stream),
 *   reference-counted through `Lease` objects. A load is split into `fetch` (network and decode, abortable, no GPU)
 *   and `upload` (the only step that touches the context). `upload` runs only while at least one requester is still
 *   waiting: a load whose requesters all left is aborted, and if its data arrives anyway it is `discard`ed, never
 *   uploaded. Released entries stay warm in an LRU bounded in bytes; eviction is the only path to `dispose`.
 * - `AssetLeases<D, R>` resolves an asset id plus on-screen size and quality tier to one variant of an `AssetDef`,
 *   and reuses an already-resident larger variant of the same asset rather than loading a second copy.
 *
 * A consumer never disposes a leased value: it calls `release()` (idempotent) or lets its owner signal abort, which
 * releases the lease. `owns(value)` lets tree-disposal helpers skip shared resources.
 *
 * One cache serves one GPU context. Fetch/decode dedup is not cross-context GPU dedup (ADR 0040).
 */
import type { AssetDef, AssetFormat, AssetVariant, QualityTier } from './manifest';
import { tierAtOrBelow } from './manifest';

// ───────────────────────────── leases and errors ─────────────────────────────

export interface Lease<R> {
  readonly value: R;
  /** The cache key, e.g. `asset.texture.stone-wall|textures/stone/wall-2048.jpg`. */
  readonly key: string;
  /** Returns the reference. Idempotent. The value must not be used afterwards. */
  release(): void;
}

export interface AssetLease<R> extends Lease<R> {
  readonly id: string;
  /** The variant actually held, which may be larger than the one asked for when a larger one was resident. */
  readonly variant: AssetVariant;
}

export class AbortError extends Error {
  constructor(message = 'aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

// ───────────────────────────── keyed cache ─────────────────────────────

/**
 * The seam to the rendering library. `fetch` produces CPU-side data (an ImageBitmap, a parsed glTF) and must stop
 * work when its signal aborts where it can; whatever it returns after an abort is passed to `discard`.
 * `upload` takes ownership of `decoded` at call entry, including failure cleanup if it throws.
 * Once it returns a resource, the cache owns retirement even if accounting or publication subsequently fails.
 */
export interface LeaseLoader<D, R extends object> {
  fetch(key: string, signal: AbortSignal): Promise<D>;
  upload(decoded: D, key: string): R;
  /** Frees decoded data that will never be uploaded (for example `ImageBitmap.close()`). */
  discard(decoded: D): void;
  /** Frees an uploaded resource. Only the cache calls this, on eviction. */
  dispose(resource: R): void;
  /** Resident bytes of an uploaded resource, for the warm budget. */
  bytes(resource: R): number;
}

export interface LeaseCacheOptions {
  /** Bytes of released-but-kept resources; set per quality tier. */
  warmBytes: number;
}

export interface LeaseCacheStats {
  /** Fetches started. */
  loads: number;
  /** Acquires served by an existing entry (pending, live or warm). */
  hits: number;
  uploads: number;
  /** Fetches that completed after every requester had left; discarded, never uploaded. */
  lateDrops: number;
  /** Uploaded resources disposed by eviction. */
  disposed: number;
  failures: number;
}

type EntryState = 'pending' | 'ready';

interface Entry<R> {
  readonly key: string;
  state: EntryState;
  refs: number;
  resource?: R;
  bytes: number;
  lastUsed: number;
  readonly controller: AbortController;
  ready: Promise<R>;
}

export interface EntryInfo {
  readonly state: EntryState;
  readonly refs: number;
  readonly bytes: number;
}

export class LeaseCache<D, R extends object> {
  private readonly entries = new Map<string, Entry<R>>();
  private readonly byResource = new WeakMap<object, Entry<R>>();
  private tick = 0;
  private warmLimit: number;
  private warmTotal = 0;
  private trimming = false;
  private trimAll = false;
  readonly stats: LeaseCacheStats = { loads: 0, hits: 0, uploads: 0, lateDrops: 0, disposed: 0, failures: 0 };

  constructor(private readonly loader: LeaseLoader<D, R>, options: LeaseCacheOptions) {
    this.warmLimit = options.warmBytes;
  }

  /**
   * Leases `key` for the lifetime of `signal`. Rejects with `AbortError` if the signal aborts before the value is
   * ready; once given, an abort of `signal` releases the lease. Before delivery, cleanup failures are attached
   * to AbortError.cause. After delivery, cleanup failures follow the host's abort-listener error reporting;
   * callers needing synchronous cleanup errors should explicitly release the lease.
   */
  acquire(key: string, signal: AbortSignal): Promise<Lease<R>> {
    if (signal.aborted) return Promise.reject(new AbortError());
    let entry = this.entries.get(key), begin: (() => void) | undefined;
    if (entry) this.stats.hits++;
    else { const pending = this.start(key); entry = pending.entry; begin = pending.begin; }
    const held = entry;
    if (held.state === 'ready' && held.refs === 0) this.warmTotal -= held.bytes;
    held.refs++;
    held.lastUsed = ++this.tick;
    const result = new Promise<Lease<R>>((resolve, reject) => {
      let lease: Lease<R> | undefined;
      let done = false;
      const onAbort = () => {
        if (lease) {
          lease.release();
          return;
        }
        if (done) return;
        done = true;
        const error = new AbortError();
        try { this.drop(held); } catch (cleanup) { error.cause = cleanup; }
        reject(error);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      held.ready.then(
        resource => {
          if (done) return;
          done = true;
          let released = false;
          lease = {
            value: resource,
            key,
            release: () => {
              if (released) return;
              released = true;
              signal.removeEventListener('abort', onAbort);
              this.drop(held);
            },
          };
          resolve(lease);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          if (done) return;
          done = true;
          reject(error);
        },
      );
    });
    // External fetch may synchronously abort or acquire the same key. Its first subscriber is already installed.
    begin?.();
    return result;
  }

  /** True for any resource this cache uploaded and still holds. Tree disposal must skip these. */
  owns(resource: unknown): boolean {
    return typeof resource === 'object' && resource !== null && this.byResource.has(resource);
  }

  info(key: string): EntryInfo | undefined {
    const e = this.entries.get(key);
    return e && { state: e.state, refs: e.refs, bytes: e.bytes };
  }

  refs(key: string): number {
    return this.entries.get(key)?.refs ?? 0;
  }

  residentBytes(): number {
    let n = 0;
    for (const e of this.entries.values()) n += e.bytes;
    return n;
  }

  warmBytes(): number { return this.warmTotal; }

  /** Changes the warm budget (a tier change). Live leases are untouched; warm entries over budget are evicted. */
  setWarmBytes(bytes: number): void {
    this.warmLimit = bytes;
    this.trim();
  }

  /** Disposes every released resource (for example before a context recycle). Live leases are untouched. */
  evictWarm(): void { this.trim(true); }

  private start(key: string): { entry: Entry<R>; begin(): void } {
    const controller = new AbortController();
    let resolve!: (resource: R) => void, reject!: (error: unknown) => void;
    const ready = new Promise<R>((yes, no) => { resolve = yes; reject = no; });
    const entry: Entry<R> = { key, state: 'pending', refs: 0, bytes: 0, lastUsed: 0, controller, ready };
    ready.catch(() => {});
    this.entries.set(key, entry);
    this.stats.loads++;
    return { entry, begin: () => { void this.load(entry).then(resolve, reject); } };
  }

  private async load(entry: Entry<R>): Promise<R> {
    const { key, controller } = entry;
    const current = () => !controller.signal.aborted && this.entries.get(key) === entry;
    let decoded: D;
    try {
      decoded = await this.loader.fetch(key, controller.signal);
    } catch (error) {
      if (!current()) throw new AbortError();
      this.entries.delete(key);
      this.stats.failures++;
      throw error;
    }
    if (!current()) {
      // Everyone left while the data was in flight: it never reaches the GPU.
      this.loader.discard(decoded);
      this.stats.lateDrops++;
      throw new AbortError();
    }
    let resource: R | undefined;
    try {
      // Decoded ownership transfers at call entry, including when upload throws.
      resource = this.loader.upload(decoded, key);
      this.stats.uploads++;
      if (!current()) throw new AbortError();
      const bytes = this.loader.bytes(resource);
      if (!Number.isFinite(bytes) || bytes < 0 || bytes > Number.MAX_SAFE_INTEGER) {
        throw new RangeError('lease cache: resource bytes must be finite, nonnegative and safely representable');
      }
      if (!current()) throw new AbortError();
      // Publish only after every external preparation callback completed under the same owner.
      entry.state = 'ready';
      entry.resource = resource;
      entry.bytes = bytes;
      this.byResource.set(resource, entry);
      return resource;
    } catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      this.stats.failures++;
      if (resource !== undefined) {
        this.stats.disposed++;
        try { this.loader.dispose(resource); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'lease cache: publication and cleanup failed'); }
      }
      throw error;
    }
  }

  private drop(entry: Entry<R>): void {
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs > 0) return;
    if (entry.state === 'pending') {
      if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
      entry.controller.abort();
      return;
    }
    entry.lastUsed = ++this.tick;
    this.warmTotal += entry.bytes;
    this.trim();
  }

  private trim(all = false): void {
    // A disposer can reenter cache operations. The outer pass revalidates its finite candidate snapshot.
    if (this.trimming) { this.trimAll ||= all; return; }
    this.trimming = true;
    this.trimAll = all;
    const errors: unknown[] = [];
    try {
      const idle = [...this.entries.values()].filter(e => e.state === 'ready');
      const remaining = new Set(idle);
      const over = () => this.trimAll || this.warmLimit <= 0 || this.warmTotal > this.warmLimit;
      // Ordinary eviction sorts once. Reentrant release of an already visited live entry needs a further pass;
      // each extra pass must retire an original candidate, so callback-generated loads cannot extend this drain.
      while (remaining.size && over()) {
        let retired = false;
        for (const e of [...remaining].sort((a, b) => a.lastUsed - b.lastUsed)) {
          if (!over()) break;
          if (this.entries.get(e.key) !== e || e.state !== 'ready') { remaining.delete(e); continue; }
          if (e.refs !== 0) continue;
          remaining.delete(e);
          this.entries.delete(e.key);
          this.warmTotal -= e.bytes;
          retired = true;
          if (e.resource !== undefined) {
            this.byResource.delete(e.resource);
            this.stats.disposed++;
            try { this.loader.dispose(e.resource); } catch (error) { errors.push(error); }
          }
        }
        if (!retired) break;
      }
    } finally { this.trimming = false; this.trimAll = false; }
    if (errors.length) throw new AggregateError(errors, 'lease cache: cleanup failed');
  }

}

/**
 * Consumer-side disposal guard: disposes `resource` only if no lease cache owns it, and says whether it did.
 * Replaces `userData.shared`, `isKitMaterial` and `preserveMaterial`-style flags.
 */
export function disposeUnowned<T>(
  caches: readonly { owns(resource: unknown): boolean }[],
  resource: T,
  dispose: (resource: T) => void,
): boolean {
  if (caches.some(c => c.owns(resource))) return false;
  dispose(resource);
  return true;
}

// ───────────────────────────── variant choice ─────────────────────────────

/** Texels per on-screen pixel at the reference resolution: 2x headroom for zoom. */
export const TEXELS_PER_PIXEL = 2;

export interface VariantQuery {
  /** On-screen size in CSS pixels at the reference resolution. Omit for non-image assets. */
  screenPx?: number;
  /** Device pixel ratio at the reference resolution. Default 1. */
  pixelRatio?: number;
  tier: QualityTier;
  /** The quality knob's cap on texture width. Undefined on the reference tier means uncapped. */
  maxWidth?: number;
  /** Formats the context can use (KTX2 only with a transcoder and a supported GPU format). */
  supports?: (format: AssetFormat) => boolean;
  locale?: string;
  voice?: string;
}

function eligible(def: AssetDef, q: VariantQuery): AssetVariant[] {
  return def.variants.filter(
    v =>
      (q.supports ? q.supports(v.format) : v.format !== 'ktx2') &&
      (v.maxTier === undefined || tierAtOrBelow(q.tier, v.maxTier)) &&
      (q.locale === undefined || v.locale === undefined || v.locale === q.locale) &&
      (q.voice === undefined || v.voice === undefined || v.voice === q.voice),
  );
}

/** Among equally wide candidates, prefer KTX2 (no main-thread decode), then the def's own order. */
function preferred(a: AssetVariant, b: AssetVariant): number {
  return (a.width ?? 0) - (b.width ?? 0) || Number(b.format === 'ktx2') - Number(a.format === 'ktx2');
}

/**
 * The smallest variant at least `screenPx × pixelRatio × 2` wide, capped by `maxWidth`; the largest allowed one if
 * none is wide enough. Throws if no variant is usable in this context.
 */
export function chooseVariant(def: AssetDef, q: VariantQuery): AssetVariant {
  const usable = eligible(def, q);
  if (usable.length === 0) throw new Error(`${def.id}: no variant usable on tier '${q.tier}'`);
  const capped = q.maxWidth === undefined ? usable : usable.filter(v => v.width === undefined || v.width <= q.maxWidth!);
  // A cap below every variant keeps the smallest one rather than failing.
  const pool = capped.length > 0 ? [...capped].sort(preferred) : [[...usable].sort(preferred)[0]];
  if (q.screenPx === undefined) return pool[pool.length - 1].width === undefined ? pool[0] : pool[pool.length - 1];
  const need = q.screenPx * (q.pixelRatio ?? 1) * TEXELS_PER_PIXEL;
  const wide = pool.filter(v => (v.width ?? 0) >= need);
  if (wide.length > 0) return wide[0];
  const top = pool[pool.length - 1].width;
  return pool.find(v => v.width === top)!;
}

// ───────────────────────────── asset leases ─────────────────────────────

/** The rendering-library seam for assets: the keyed loader, addressed by def and variant instead of key. */
export interface AssetLoader<D, R extends object> {
  fetch(def: AssetDef, variant: AssetVariant, signal: AbortSignal): Promise<D>;
  upload(decoded: D, def: AssetDef, variant: AssetVariant): R;
  discard(decoded: D): void;
  dispose(resource: R): void;
  bytes(resource: R): number;
  supports?(format: AssetFormat): boolean;
}

export interface AssetLeasesOptions {
  tier: QualityTier;
  warmBytes: number;
  maxWidth?: number;
}

export interface AcquireOptions {
  /** The owner's lifetime signal. Required: nothing loads without an owner (STD-REN-33). */
  signal: AbortSignal;
  screenPx?: number;
  pixelRatio?: number;
  locale?: string;
  voice?: string;
}

export function assetKey(id: string, variant: AssetVariant): string {
  return `${id}|${variant.path}`;
}

export class AssetLeases<D, R extends object> {
  private readonly defs = new Map<string, AssetDef>();
  private readonly cache: LeaseCache<{ def: AssetDef; variant: AssetVariant; decoded: D }, R>;
  private tier: QualityTier;
  private maxWidth: number | undefined;

  constructor(defs: readonly AssetDef[], private readonly loader: AssetLoader<D, R>, options: AssetLeasesOptions) {
    for (const def of defs) {
      if (this.defs.has(def.id)) throw new Error(`duplicate asset id ${def.id}`);
      this.defs.set(def.id, def);
    }
    this.tier = options.tier;
    this.maxWidth = options.maxWidth;
    const locate = (key: string) => {
      const bar = key.indexOf('|');
      const def = this.defs.get(key.slice(0, bar))!;
      const variant = def.variants.find(v => v.path === key.slice(bar + 1))!;
      return { def, variant };
    };
    this.cache = new LeaseCache(
      {
        fetch: async (key, signal) => {
          const { def, variant } = locate(key);
          return { def, variant, decoded: await loader.fetch(def, variant, signal) };
        },
        upload: ({ def, variant, decoded }) => loader.upload(decoded, def, variant),
        discard: ({ decoded }) => loader.discard(decoded),
        dispose: resource => loader.dispose(resource),
        bytes: resource => loader.bytes(resource),
      },
      { warmBytes: options.warmBytes },
    );
  }

  get stats(): Readonly<LeaseCacheStats> {
    return this.cache.stats;
  }

  def(id: string): AssetDef {
    const def = this.defs.get(id);
    if (!def) throw new Error(`unknown asset id ${id}`);
    return def;
  }

  /** The variant a new acquire would target (before reuse of a resident larger one). */
  choose(id: string, o: Omit<AcquireOptions, 'signal'> = {}): AssetVariant {
    return chooseVariant(this.def(id), this.query(o));
  }

  /**
   * Leases the asset at a variant adequate for `screenPx`. If an equal or larger usable variant of the same asset is
   * already live, warm or loading, that entry is shared instead of loading another copy.
   */
  async acquire(id: string, o: AcquireOptions): Promise<AssetLease<R>> {
    const def = this.def(id);
    if (o.signal.aborted) throw new AbortError();
    const query = this.query(o);
    const target = chooseVariant(def, query);
    const variant = this.resident(def, target, query) ?? target;
    const lease = await this.cache.acquire(assetKey(id, variant), o.signal);
    return { value: lease.value, key: lease.key, id, variant, release: lease.release };
  }

  /**
   * Changes the tier, its width cap and its warm budget. Affects later choices only: a live lease is never
   * downgraded (STD-REN-32).
   */
  setTier(tier: QualityTier, options: { warmBytes: number; maxWidth?: number }): void {
    this.tier = tier;
    this.maxWidth = options.maxWidth;
    this.cache.setWarmBytes(options.warmBytes);
  }

  owns(resource: unknown): boolean {
    return this.cache.owns(resource);
  }

  refs(id: string, path: string): number {
    return this.cache.refs(`${id}|${path}`);
  }

  info(id: string, path: string): EntryInfo | undefined {
    return this.cache.info(`${id}|${path}`);
  }

  residentBytes(): number {
    return this.cache.residentBytes();
  }

  warmBytes(): number {
    return this.cache.warmBytes();
  }

  evictWarm(): void {
    this.cache.evictWarm();
  }

  private query(o: Omit<AcquireOptions, 'signal'>): VariantQuery {
    return {
      screenPx: o.screenPx,
      pixelRatio: o.pixelRatio,
      tier: this.tier,
      maxWidth: this.maxWidth,
      supports: this.loader.supports?.bind(this.loader),
      locale: o.locale,
      voice: o.voice,
    };
  }

  /** The smallest entry already in the cache that is usable here and at least as wide as `target`. */
  private resident(def: AssetDef, target: AssetVariant, q: VariantQuery): AssetVariant | undefined {
    if (target.width === undefined) return undefined;
    const usable = eligible(def, q).filter(
      v => v !== target && (v.width ?? 0) >= target.width! && this.cache.info(assetKey(def.id, v)) !== undefined,
    );
    usable.sort(preferred);
    return usable[0];
  }
}
