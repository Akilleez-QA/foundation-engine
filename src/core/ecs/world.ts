/**
 * core/ecs/world.ts: a small, typed entity-component store (an "ECS-lite"). Pure: no DOM, no rendering, no clock.
 *
 * - A component type is a named default value: `const Health = component('health', { hp: 3 })`. Calling it makes an
 *   initialiser for spawning: `Health({ hp: 5 })` (missing fields take the defaults).
 * - An entity is a number. `spawn(...inits)` creates one; `add`, `remove`, `get`, `has` and `despawn` change it.
 * - `query(A, B)` iterates the entities that have every listed component, yielding `[entity, a, b]` with the live
 *   component objects (mutate them in place). Iteration order is spawn order, so runs are deterministic. Spawning,
 *   despawning, adding and removing while iterating are safe; see `query` for which entities are then visited.
 * - `resources` hold world-wide state (score, lives, the phase of a round); `emit`/`read` pass events inside one frame.
 * - `version` counts structural changes and every `touch`: a renderer skips work while it has not moved.
 * - Optional, allocated on first use (see world-tracking.ts): per-component change ticks with `added`/`changed` query
 *   filters (`trackChanges`, `changeCursor`, `markChanged`, `queryFiltered`), queued observers (`observe`,
 *   `flushObservers`) and incrementally maintained cached queries (`cachedQuery`).
 */
import {
  CachedMembership,
  ChangeTicks,
  CursorImpl,
  DEFAULT_TRACKING_LIMITS,
  ObserverHub,
  resolveTrackingLimits,
  type CachedQuery,
  type ChangeCursor,
  type ChangeFilter,
  type FlushReport,
  type Observer,
  type ObserverSpec,
  type ResolvedTrackingLimits,
  type TrackingLimits,
  type TrackingStats,
} from './world-tracking';

import type {ComponentInit, ComponentType, Entity} from './world-types';
export type {ComponentInit, ComponentType, Entity};

const COMPONENT_ID = /^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/;

/** Define a component type. `initial` is copied for each entity (structured clone), so defaults are never shared. */
export function component<T extends object>(id: string, initial: T): ComponentType<T> {
  if (!COMPONENT_ID.test(id)) throw Error(`component id '${id}' must be lowercase kebab-case`);
  const make = (partial?: Partial<T>): ComponentInit<T> => ({
    type: type as ComponentType<T>,
    value: {...structuredClone(initial), ...partial},
  });
  const type = Object.assign(make, {id, initial: () => structuredClone(initial)});
  Object.defineProperty(type, 'name', {value: id});
  return type;
}

type Values<Q extends readonly ComponentType<object>[]> = {
  [K in keyof Q]: Q[K] extends ComponentType<infer T> ? T : never;
};

/** A query row is built untyped; each store holds exactly its component type's values, so the row matches `Q`. */
function queryRow<Q extends readonly ComponentType<object>[]>(row: unknown[]): [Entity, ...Values<Q>] {
  return row as [Entity, ...Values<Q>];
}

export interface EntityMetadataRequest {
  afterId?: number;
  limit?: number;
  maxChecks?: number;
  maxLabelLength?: number;
}
export interface EntityMetadataPage {
  version: number;
  total: number;
  checks: number;
  nextAfterId: number | null;
  entities: {
    id: Entity;
    components: {label: string; truncated: boolean}[];
    componentStoresExamined: number;
    componentsComplete: boolean;
  }[];
}

interface Tracking {
  readonly limits: ResolvedTrackingLimits;
  ticks?: ChangeTicks;
  hub?: ObserverHub;
  /** Cached queries by each component type id they list. */
  cached?: Map<string, CachedMembership[]>;
  cachedCount: number;
}

export class World {
  private next = 1;
  /** Component types by id, recorded when their store is created (observer events name the type). */
  private readonly types = new Map<string, ComponentType<object>>();
  /** Optional change ticks, observers and cached queries; undefined until first used. */
  private tracking: Tracking | undefined;
  private trackingLimits: ResolvedTrackingLimits = DEFAULT_TRACKING_LIMITS;
  private readonly alive = new Set<Entity>();
  private readonly stores = new Map<string, Map<Entity, object>>();
  private readonly events = new Map<string, unknown[]>();
  /** World-wide state, read by systems and probes. Keep values plain (numbers, strings, arrays, plain objects). */
  readonly resources: Record<string, unknown> = {};
  /** Structural changes and touches since creation. */
  version = 0;

  spawn(...inits: readonly ComponentInit<object>[]): Entity {
    const e = this.next++;
    this.alive.add(e);
    for (const i of inits) this.add(e, i);
    this.version++;
    return e;
  }
  despawn(e: Entity): void {
    if (!this.alive.delete(e)) return;
    if (!this.tracking) {
      for (const store of this.stores.values()) store.delete(e);
      this.version++;
      return;
    }
    for (const [id, store] of this.stores) {
      const value = store.get(e);
      if (value === undefined) continue;
      store.delete(e);
      this.trackRemove(e, this.types.get(id)!, value);
    }
    this.version++;
    this.tracking.hub?.enqueue({kind: 'despawn', entity: e});
  }
  exists(e: Entity): boolean {
    return this.alive.has(e);
  }
  get count(): number {
    return this.alive.size;
  }

  add<T extends object>(e: Entity, init: ComponentInit<T>): T {
    if (!this.alive.has(e)) throw Error(`entity ${e} does not exist`);
    let store = this.stores.get(init.type.id);
    if (!store) {
      this.stores.set(init.type.id, (store = new Map()));
      this.types.set(init.type.id, init.type);
    }
    const replaced = this.tracking !== undefined && store.has(e);
    store.set(e, init.value);
    this.version++;
    if (this.tracking) this.trackAdd(e, init.type, init.value, replaced);
    return init.value;
  }
  remove(e: Entity, type: ComponentType<object>): void {
    const store = this.stores.get(type.id);
    if (!this.tracking) {
      if (store?.delete(e)) this.version++;
      return;
    }
    const value = store?.get(e);
    if (value === undefined) return;
    store!.delete(e);
    this.version++;
    this.trackRemove(e, type, value);
  }
  get<T extends object>(e: Entity, type: ComponentType<T>): T | undefined {
    return this.stores.get(type.id)?.get(e) as T | undefined;
  }
  has(e: Entity, type: ComponentType<object>): boolean {
    return !!this.stores.get(type.id)?.has(e);
  }
  /** Mark a change made in place (a renderer that syncs on `version` then draws the next frame). */
  touch(): void {
    this.version++;
  }
  /**
   * Record a direct change to `e`'s component of `type`: its change tick (when the type is tracked), a `change`
   * observer event, and `version` (like `touch`). Returns false, changing nothing, when `e` does not hold it.
   */
  markChanged(e: Entity, type: ComponentType<object>): boolean {
    const value = this.stores.get(type.id)?.get(e);
    if (value === undefined) return false;
    this.version++;
    const t = this.tracking;
    if (!t) return true;
    const tracked = t.ticks?.tracked.get(type.id);
    if (tracked) tracked.changed.set(e, t.ticks!.next());
    t.hub?.enqueue({kind: 'change', entity: e, type, value});
    return true;
  }

  /** Set the bounds of the optional tracking features (checked here). Only before any of them is first used. */
  configureTracking(limits: TrackingLimits): void {
    if (this.tracking) throw Error('world tracking: configure the limits before the first cursor, observer or cache');
    this.trackingLimits = resolveTrackingLimits(limits);
  }
  private useTracking(): Tracking {
    return (this.tracking ??= {limits: this.trackingLimits, cachedCount: 0});
  }
  private trackAdd(e: Entity, type: ComponentType<object>, value: object, replaced: boolean): void {
    const t = this.tracking!;
    const tracked = t.ticks?.tracked.get(type.id);
    if (tracked) {
      const tick = t.ticks!.next();
      if (!replaced) tracked.added.set(e, tick);
      tracked.changed.set(e, tick);
    }
    if (!replaced) {
      const queries = t.cached?.get(type.id);
      if (queries) for (const q of queries) if (q.typeIds.every(id => this.stores.get(id)?.has(e))) q.insert(e);
    }
    t.hub?.enqueue({kind: replaced ? 'change' : 'add', entity: e, type, value});
  }
  private trackRemove(e: Entity, type: ComponentType<object>, value: object): void {
    const t = this.tracking!;
    const tracked = t.ticks?.tracked.get(type.id);
    if (tracked) {
      tracked.added.delete(e);
      tracked.changed.delete(e);
    }
    const queries = t.cached?.get(type.id);
    if (queries) for (const q of queries) q.delete(e);
    t.hub?.enqueue({kind: 'remove', entity: e, type, value});
  }

  /**
   * Record add and change ticks for these component types from now on. Entities already holding one count as added
   * and changed at one new tick. Idempotent. Each recorded add, replace or `markChanged` advances `changeTick`.
   */
  trackChanges(...types: readonly ComponentType<object>[]): void {
    const t = this.useTracking();
    const ticks = (t.ticks ??= new ChangeTicks(t.limits));
    for (const type of types) {
      if (ticks.tracked.has(type.id)) continue;
      const entry = {added: new Map<Entity, number>(), changed: new Map<Entity, number>()};
      ticks.tracked.set(type.id, entry);
      const store = this.stores.get(type.id);
      if (!store?.size) continue;
      const tick = ticks.next();
      for (const e of store.keys()) {
        entry.added.set(e, tick);
        entry.changed.set(e, tick);
      }
    }
  }
  isTracked(type: ComponentType<object>): boolean {
    return !!this.tracking?.ticks?.tracked.has(type.id);
  }
  /** The tick of the most recent recorded change (0 before any). */
  get changeTick(): number {
    return this.tracking?.ticks?.tick ?? 0;
  }
  /**
   * A caller-held `since` tick: changes recorded after it pass `added`/`changed` filters until `advance()`. Starts at
   * the current tick, or at 0 with `fromStart` (every tracked component then counts as added). Bounded by
   * `maxCursors`; `dispose()` it when done.
   */
  changeCursor(options: {fromStart?: boolean} = {}): ChangeCursor {
    const t = this.useTracking();
    return (t.ticks ??= new ChangeTicks(t.limits)).cursor(!!options.fromStart);
  }
  /**
   * `query(...types)` (same order and mid-iteration rules) restricted to entities passing every filter relative to
   * `since`. Filters are checked when each entity is reached. Every filtered type must be tracked (`trackChanges`).
   */
  queryFiltered<Q extends readonly ComponentType<object>[]>(
    since: ChangeCursor,
    filters: readonly ChangeFilter[],
    ...types: Q
  ): Generator<[Entity, ...Values<Q>]> {
    const ticks = this.tracking?.ticks;
    if (!(since instanceof CursorImpl) || since.owner !== ticks)
      throw Error('queryFiltered: a cursor of this world is required');
    if (since.disposed) throw Error('queryFiltered: the cursor is disposed');
    const checks = filters.map(f => {
      const tracked = ticks.tracked.get(f.type.id);
      if (!tracked) throw Error(`queryFiltered: component '${f.type.id}' is not tracked; call trackChanges first`);
      return {map: f.kind === 'added' ? tracked.added : tracked.changed};
    });
    return this.filtered(since, checks, types);
  }
  private *filtered<Q extends readonly ComponentType<object>[]>(
    since: CursorImpl,
    checks: {map: Map<Entity, number>}[],
    types: Q,
  ): Generator<[Entity, ...Values<Q>]> {
    next: for (const row of this.query(...types)) {
      for (const {map} of checks) {
        const tick = map.get(row[0]);
        if (tick === undefined || (!since.overflowed && tick <= since.tick)) continue next;
      }
      yield row;
    }
  }

  /**
   * Register a hook on add, remove, change (replace or `markChanged`) or despawn. Events are queued when the world
   * changes and delivered only by `flushObservers` (the system runner calls it after each system), in the order the
   * changes happened, then in registration order. A despawn queues one `remove` per held component, then `despawn`.
   */
  observe(spec: ObserverSpec): Observer {
    const t = this.useTracking();
    return (t.hub ??= new ObserverHub(t.limits)).observe(spec);
  }
  /**
   * Deliver queued observer events, including events queued by observers during this flush, up to
   * `maxDeliveriesPerFlush`. A call from inside an observer does nothing. Observer errors are collected and thrown
   * together (AggregateError) after the flush completes.
   */
  flushObservers(): FlushReport {
    const hub = this.tracking?.hub;
    if (!hub) return {delivered: 0, dropped: 0, deferred: 0, reentrant: false};
    return hub.flush();
  }

  /**
   * An incrementally maintained `query(...types)`: iteration yields the same rows in the same order, with the same
   * rules for changes made while iterating, without scanning stores. Bounded by `maxCachedQueries`; `dispose()` it.
   */
  cachedQuery<Q extends readonly ComponentType<object>[]>(...types: Q): CachedQuery<[Entity, ...Values<Q>]> {
    if (!types.length) throw Error('cachedQuery: list at least one component type');
    const t = this.useTracking();
    if (t.cachedCount >= t.limits.maxCachedQueries)
      throw new RangeError(`world tracking: more than ${t.limits.maxCachedQueries} cached queries`);
    const ids = types.map(type => type.id);
    const unique = [...new Set(ids)];
    const m = new CachedMembership(unique);
    for (const [e] of this.query(...types)) m.insert(e);
    const cached = (t.cached ??= new Map());
    for (const id of unique) {
      let list = cached.get(id);
      if (!list) cached.set(id, (list = []));
      list.push(m);
    }
    t.cachedCount++;
    return {
      get size() {
        return m.members.size;
      },
      get disposed() {
        return m.disposed;
      },
      has: e => m.members.has(e),
      dispose() {
        if (m.disposed) return;
        m.disposed = true;
        m.members.clear();
        for (const id of unique) {
          const list = cached.get(id)!.filter(x => x !== m);
          if (list.length) cached.set(id, list);
          else cached.delete(id);
        }
        t.cachedCount--;
      },
      [Symbol.iterator]: () => this.iterateCached<Q>(m, ids),
    };
  }
  private *iterateCached<Q extends readonly ComponentType<object>[]>(
    m: CachedMembership,
    ids: readonly string[],
  ): Generator<[Entity, ...Values<Q>]> {
    if (m.disposed) throw Error('cachedQuery: disposed');
    const order = m.snapshot(),
      end = order.length;
    if (!end) return;
    // Every member holds every listed component, so each store exists; stores are never deleted.
    const stores = ids.map(id => this.stores.get(id)!);
    for (let i = 0; i < end; i++) {
      if (m.disposed) return;
      const e = order[i]!;
      if (!m.members.has(e)) continue;
      const row: unknown[] = [e];
      for (const s of stores) row.push(s.get(e));
      yield queryRow<Q>(row);
    }
  }

  /** Counters of the optional tracking features (all zero when unused). */
  trackingStats(): TrackingStats {
    const t = this.tracking;
    return {
      changeTick: t?.ticks?.tick ?? 0,
      rebases: t?.ticks?.rebases ?? 0,
      cursorsOverflowed: t?.ticks?.cursorsOverflowed ?? 0,
      cursors: t?.ticks?.cursors.size ?? 0,
      observers: t?.hub?.size ?? 0,
      queued: t?.hub?.queued ?? 0,
      delivered: t?.hub?.delivered ?? 0,
      dropped: t?.hub?.dropped ?? 0,
      observerErrors: t?.hub?.errors ?? 0,
      cachedQueries: t?.cachedCount ?? 0,
    };
  }

  /**
   * Entities with every listed component, in spawn order, with their live component values.
   *
   * Changes made while iterating are safe. The candidates are the entities that match when iteration begins; each is
   * yielded only if, when reached, it still has every listed component (a despawned entity, or one that lost a
   * component, is skipped and never yielded with `undefined`), with the values it holds at that moment. Entities
   * spawned, or that start matching, after iteration begins are not visited; the next query sees them.
   */
  *query<Q extends readonly ComponentType<object>[]>(...types: Q): Generator<[Entity, ...Values<Q>]> {
    if (!types.length) {
      // `alive` holds ids in ascending insertion order, and deleted entries are skipped by Set iteration.
      const end = this.next;
      for (const e of this.alive) {
        if (e >= end) return;
        yield queryRow<Q>([e]);
      }
      return;
    }
    const stores = types.map(t => this.stores.get(t.id));
    if (stores.some(s => !s)) return;
    const live = stores as Map<Entity, object>[];
    const [first, ...rest] = [...live].sort((a, b) => a.size - b.size);
    let order = [...first!.keys()]; // types.length > 0, so `first` exists
    if (rest.length) order = order.filter(e => rest.every(s => s.has(e)));
    order.sort((a, b) => a - b);
    next: for (const e of order) {
      const row: unknown[] = [e];
      for (const s of live) {
        const value = s.get(e); // component values are objects, so undefined means removed or despawned
        if (value === undefined) continue next;
        row.push(value);
      }
      yield queryRow<Q>(row);
    }
  }
  /** The first entity with every listed component, or undefined. */
  first<Q extends readonly ComponentType<object>[]>(...types: Q): [Entity, ...Values<Q>] | undefined {
    for (const row of this.query(...types)) return row;
    return undefined;
  }

  /** Detached metadata only. One shared budget counts ID probes (including gaps) and component-store checks. */
  inspectMetadata(request: EntityMetadataRequest = {}): EntityMetadataPage {
    const {afterId = 0, limit = 32, maxChecks = 512, maxLabelLength = 120} = request;
    for (const n of [afterId, limit, maxChecks, maxLabelLength]) {
      if (!Number.isSafeInteger(n) || n < 0)
        throw new RangeError('entity inspection: bounds must be nonnegative safe integers');
    }
    if (maxLabelLength === 0) throw new RangeError('entity inspection: label length must be positive');
    const entities: EntityMetadataPage['entities'] = [];
    const highWater = this.next - 1;
    let cursor = afterId,
      checks = 0;
    while (cursor < highWater && entities.length < limit && checks < maxChecks) {
      cursor++;
      checks++;
      if (!this.alive.has(cursor)) continue;
      const components: EntityMetadataPage['entities'][number]['components'] = [];
      let componentStoresExamined = 0;
      for (const [id, store] of this.stores) {
        if (checks >= maxChecks) break;
        checks++;
        componentStoresExamined++;
        if (store.has(cursor))
          components.push({label: id.slice(0, maxLabelLength), truncated: id.length > maxLabelLength});
      }
      entities.push({
        id: cursor,
        components,
        componentStoresExamined,
        componentsComplete: componentStoresExamined === this.stores.size,
      });
    }
    return {
      version: this.version,
      total: this.alive.size,
      checks,
      nextAfterId: cursor < highWater ? cursor : null,
      entities,
    };
  }

  /** Queue an event for this frame's later systems; `read` returns (and keeps) this frame's events of a type. */
  emit(type: string, payload: unknown = null): void {
    let q = this.events.get(type);
    if (!q) this.events.set(type, (q = []));
    q.push(payload);
  }
  read<T = unknown>(type: string): readonly T[] {
    return (this.events.get(type) ?? []) as T[];
  }
  /** Called by the runner at the end of each frame. */
  clearEvents(): void {
    this.events.clear();
  }
}
