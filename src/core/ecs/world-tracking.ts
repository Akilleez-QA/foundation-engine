/**
 * core/ecs/world-tracking.ts: the optional parts of `World` (change ticks, observers, cached queries). Pure: no DOM,
 * no clock. Nothing here is allocated until a world first uses one of them, so a world that never does behaves and
 * costs as before.
 *
 * - Change ticks: one world counter. A tracked component type records, per entity, the tick it was added and the tick
 *   it last changed (add, replace and `markChanged`). A `ChangeCursor` holds the caller's `since` tick.
 * - Observers: hooks on add, remove, change and despawn. Mutations queue events; `flushObservers` delivers them in
 *   mutation order, then observer registration order. The queue is bounded; dropped events are counted and reported.
 * - Cached queries: an incrementally maintained matching set, iterated in spawn (id) order.
 */
import type {ComponentType, Entity} from './world-types';

export interface TrackingLimits {
  /** Pending observer deliveries (one per event per observer). Further events are dropped and reported. */
  maxQueued?: number;
  /** Deliveries in one `flushObservers` call; the rest stay queued for the next flush. */
  maxDeliveriesPerFlush?: number;
  maxObservers?: number;
  maxCursors?: number;
  maxCachedQueries?: number;
  /** The highest change tick before the world rebases its ticks (see `ChangeCursor.overflowed`). */
  maxTick?: number;
}
export type ResolvedTrackingLimits = Required<TrackingLimits>;

export const DEFAULT_TRACKING_LIMITS: ResolvedTrackingLimits = Object.freeze({
  maxQueued: 4096,
  maxDeliveriesPerFlush: 16384,
  maxObservers: 256,
  maxCursors: 256,
  maxCachedQueries: 256,
  maxTick: Number.MAX_SAFE_INTEGER - 1,
});

export function resolveTrackingLimits(limits: TrackingLimits): ResolvedTrackingLimits {
  const out = {...DEFAULT_TRACKING_LIMITS, ...limits};
  for (const [key, value] of Object.entries(out)) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RangeError(`world tracking: ${key} must be a positive safe integer`);
  }
  if (out.maxTick < 8) throw new RangeError('world tracking: maxTick must be at least 8');
  if (out.maxTick > DEFAULT_TRACKING_LIMITS.maxTick)
    throw new RangeError('world tracking: maxTick is above the safe range');
  return out;
}

/** A query filter: the entity's component was added, or changed, after the cursor's tick. */
export interface ChangeFilter {
  readonly kind: 'added' | 'changed';
  readonly type: ComponentType<object>;
}
export const added = (type: ComponentType<object>): ChangeFilter => Object.freeze({kind: 'added', type});
export const changed = (type: ComponentType<object>): ChangeFilter => Object.freeze({kind: 'changed', type});

/**
 * A caller-held `since` tick. `advance()` moves it to the world's current tick (after a system has seen the
 * changes). `overflowed` is true when a tick rebase had to move past this cursor's tick: until the next `advance`,
 * every filter treats every present component as added and changed (a conservative superset, never a miss).
 */
export interface ChangeCursor {
  readonly tick: number;
  readonly overflowed: boolean;
  readonly disposed: boolean;
  advance(): void;
  dispose(): void;
}

export type ObserverKind = 'add' | 'remove' | 'change' | 'despawn';
export interface ObserverEvent {
  readonly kind: ObserverKind;
  readonly entity: Entity;
  /** The component type (absent for `despawn`). */
  readonly type?: ComponentType<object>;
  /** The component value at the time of the event (the removed value for `remove`). */
  readonly value?: object;
}
export interface ObserverSpec {
  on: ObserverKind;
  /** Required for add, remove and change; not allowed for despawn. */
  type?: ComponentType<object>;
  run(event: ObserverEvent): void;
  /** Called at the end of a flush with the number of this observer's events dropped since the last call. */
  overflow?(dropped: number): void;
}
export interface Observer {
  readonly active: boolean;
  /** Events dropped for this observer because the queue was full, since it was registered. */
  readonly dropped: number;
  unsubscribe(): void;
}
export interface FlushReport {
  // A report may be a shared frozen object; do not mutate it.
  delivered: number;
  /** Events dropped (queue full) since the previous flush. */
  dropped: number;
  /** Events still queued because the per-flush delivery bound was reached. */
  deferred: number;
  /** True when called from inside an observer: nothing was delivered by this call. */
  reentrant: boolean;
}
export interface TrackingStats {
  changeTick: number;
  rebases: number;
  cursorsOverflowed: number;
  cursors: number;
  observers: number;
  queued: number;
  delivered: number;
  dropped: number;
  observerErrors: number;
  cachedQueries: number;
}

export class ChangeTicks {
  tick = 0;
  rebases = 0;
  cursorsOverflowed = 0;
  readonly cursors = new Set<CursorImpl>();
  /** Per tracked type id: added and last-changed ticks of entities holding it. */
  readonly tracked = new Map<string, {added: Map<Entity, number>; changed: Map<Entity, number>}>();
  constructor(private readonly limits: ResolvedTrackingLimits) {}

  next(): number {
    if (this.tick >= this.limits.maxTick) this.rebase();
    return ++this.tick;
  }
  /**
   * Shift every tick down so counting can continue. `base` is the oldest cursor tick, but at least half the range
   * below the current tick. Ticks at or below `base` (not new to any cursor at or after it) become 1 and later ticks
   * keep their order above it, so every stored tick stays at least 1 and a cursor at 0 (`fromStart`, created later)
   * still sees every present component. Cursors older than `base` are marked overflowed (they then see everything as
   * changed until advanced) and move to 0.
   */
  private rebase(): void {
    const half = Math.floor(this.limits.maxTick / 2);
    let oldest = this.tick;
    for (const c of this.cursors) oldest = Math.min(oldest, c.tick);
    const base = Math.max(oldest, this.tick - half); // >= 1: tick >= maxTick >= 8
    const shift = base - 1;
    for (const {added, changed} of this.tracked.values()) {
      for (const m of [added, changed]) for (const [e, t] of m) m.set(e, Math.max(1, t - shift));
    }
    for (const c of this.cursors) {
      if (c.tick < base) {
        if (!c.overflowed) this.cursorsOverflowed++;
        c.overflowed = true;
        c.tick = 0;
      } else c.tick -= shift;
    }
    this.tick -= shift;
    this.rebases++;
  }
  cursor(fromStart: boolean): CursorImpl {
    if (this.cursors.size >= this.limits.maxCursors)
      throw new RangeError(`world tracking: more than ${this.limits.maxCursors} change cursors`);
    const c = new CursorImpl(this, fromStart ? 0 : this.tick);
    this.cursors.add(c);
    return c;
  }
}

export class CursorImpl implements ChangeCursor {
  overflowed = false;
  disposed = false;
  constructor(
    readonly owner: ChangeTicks,
    public tick: number,
  ) {}
  advance(): void {
    if (this.disposed) throw Error('change cursor: disposed');
    this.tick = this.owner.tick;
    this.overflowed = false;
  }
  dispose(): void {
    this.disposed = true;
    this.owner.cursors.delete(this);
  }
}

class ObserverImpl implements Observer {
  active = true;
  dropped = 0;
  pendingOverflow = 0;
  /** Entries of this observer in the queue (released from the bound on unsubscribe). */
  queuedEntries = 0;
  constructor(
    readonly spec: ObserverSpec,
    readonly key: string,
    private readonly hub: ObserverHub,
  ) {}
  unsubscribe(): void {
    if (!this.active) return;
    this.active = false;
    this.hub.detach(this);
  }
}

/** The report of a flush that had nothing to do (shared, frozen: an idle flush allocates nothing). */
export const NOTHING_FLUSHED: FlushReport = Object.freeze({delivered: 0, dropped: 0, deferred: 0, reentrant: false});

export class ObserverHub {
  private readonly byKey = new Map<string, ObserverImpl[]>();
  private count = 0;
  private queue: {observer: ObserverImpl; event: ObserverEvent}[] = [];
  private head = 0;
  /** Queue entries of active observers: what `maxQueued` bounds. */
  private pending = 0;
  private flushing = false;
  private droppedSinceFlush = 0;
  private readonly overflowing: ObserverImpl[] = [];
  delivered = 0;
  dropped = 0;
  errors = 0;
  constructor(private readonly limits: ResolvedTrackingLimits) {}

  get size(): number {
    return this.count;
  }
  get queued(): number {
    return this.pending;
  }
  observe(spec: ObserverSpec): Observer {
    const kinds: readonly ObserverKind[] = ['add', 'remove', 'change', 'despawn'];
    if (!spec || !kinds.includes(spec.on)) throw Error(`observer: 'on' must be one of ${kinds.join(', ')}`);
    if (typeof spec.run !== 'function') throw Error('observer: run must be a function');
    if ((spec.on === 'despawn') !== (spec.type === undefined))
      throw Error(spec.on === 'despawn' ? 'observer: despawn takes no type' : `observer: '${spec.on}' needs a type`);
    if (this.count >= this.limits.maxObservers)
      throw new RangeError(`world tracking: more than ${this.limits.maxObservers} observers`);
    const key = spec.type ? `${spec.on}:${spec.type.id}` : spec.on;
    const o = new ObserverImpl(spec, key, this);
    let list = this.byKey.get(key);
    if (!list) this.byKey.set(key, (list = []));
    list.push(o);
    this.count++;
    return o;
  }
  detach(o: ObserverImpl): void {
    const list = this.byKey.get(o.key);
    this.pending -= o.queuedEntries; // its entries are skipped at delivery and no longer count
    o.queuedEntries = 0;
    if (!list) return;
    // Copy on write: a flush in progress keeps its own references; the observer is skipped as inactive.
    const next = list.filter(x => x !== o);
    if (next.length) this.byKey.set(o.key, next);
    else this.byKey.delete(o.key);
    this.count--;
  }
  wants(kind: ObserverKind, typeId?: string): boolean {
    return this.byKey.has(typeId === undefined ? kind : `${kind}:${typeId}`);
  }
  enqueue(event: ObserverEvent): void {
    const list = this.byKey.get(event.type ? `${event.kind}:${event.type.id}` : event.kind);
    if (!list) return;
    for (const observer of list) {
      if (this.pending >= this.limits.maxQueued) {
        observer.dropped++;
        if (observer.pendingOverflow++ === 0) this.overflowing.push(observer);
        this.dropped++;
        this.droppedSinceFlush++;
        continue;
      }
      this.queue.push({observer, event});
      observer.queuedEntries++;
      this.pending++;
    }
  }
  flush(): FlushReport {
    if (this.flushing) return {delivered: 0, dropped: 0, deferred: this.pending, reentrant: true};
    if (this.head === this.queue.length && !this.overflowing.length && !this.droppedSinceFlush) {
      if (this.queue.length) this.queue = [];
      this.head = 0;
      return NOTHING_FLUSHED;
    }
    this.flushing = true;
    const errors: unknown[] = [];
    let delivered = 0;
    try {
      while (this.head < this.queue.length && delivered < this.limits.maxDeliveriesPerFlush) {
        const {observer, event} = this.queue[this.head]!;
        this.queue[this.head++] = undefined!; // release the event
        if (!observer.active) continue;
        observer.queuedEntries--;
        this.pending--;
        delivered++;
        try {
          observer.spec.run(event);
        } catch (error) {
          errors.push(error);
        }
      }
      this.queue = this.queue.slice(this.head);
      this.head = 0;
      const overflowing = this.overflowing.splice(0);
      for (const o of overflowing) {
        const n = o.pendingOverflow;
        o.pendingOverflow = 0;
        if (!o.active || !o.spec.overflow) continue;
        try {
          o.spec.overflow(n);
        } catch (error) {
          errors.push(error);
        }
      }
    } finally {
      this.flushing = false;
    }
    this.delivered += delivered;
    this.errors += errors.length;
    const dropped = this.droppedSinceFlush;
    this.droppedSinceFlush = 0;
    if (errors.length) throw new AggregateError(errors, `${errors.length} world observer(s) failed`);
    if (!delivered && !dropped && !this.pending) return NOTHING_FLUSHED;
    return {delivered, dropped, deferred: this.pending, reentrant: false};
  }
}

export interface CachedQuery<Row> extends Iterable<Row> {
  /** Entities currently matching. */
  readonly size: number;
  readonly disposed: boolean;
  has(e: Entity): boolean;
  /** Stop maintaining the set. Iterating a disposed query throws; an iteration in progress ends. */
  dispose(): void;
}

/**
 * The membership of a cached query: a set, plus an id-ordered array that may hold stale ids (entities that left).
 * Entities that join with an id above the last one are appended; any other join marks the order for a rebuild at the
 * next iteration. An iteration keeps the array and length it began with, so joins during it are not visited, and
 * checks membership when it reaches each id, so leaves during it are skipped.
 */
export class CachedMembership {
  readonly members = new Set<Entity>();
  order: Entity[] = [];
  private sorted = true;
  disposed = false;
  constructor(readonly typeIds: readonly string[]) {}

  insert(e: Entity): void {
    if (this.members.has(e)) return;
    this.members.add(e);
    const last = this.order[this.order.length - 1];
    if (this.sorted && (last === undefined || e > last)) this.order.push(e);
    else this.sorted = false;
  }
  delete(e: Entity): void {
    this.members.delete(e);
  }
  /**
   * The array to iterate: exactly the members at this moment, in id order. Rebuilt as a new array when entities left
   * or joined out of order, so iterations in progress keep theirs.
   */
  snapshot(): Entity[] {
    if (!this.sorted) {
      this.order = [...this.members].sort((a, b) => a - b);
      this.sorted = true;
    } else if (this.order.length !== this.members.size) {
      this.order = this.order.filter(e => this.members.has(e));
    }
    return this.order;
  }
}
