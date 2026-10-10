/**
 * core/ecs/world.ts: a small, typed entity-component store (an "ECS-lite"). Pure: no DOM, no rendering, no clock.
 *
 * - A component type is a named default value: `const Health = component('health', { hp: 3 })`. Calling it makes an
 *   initialiser for spawning: `Health({ hp: 5 })` (missing fields take the defaults).
 * - An entity is a number. `spawn(...inits)` creates one; `add`, `remove`, `get`, `has` and `despawn` change it.
 * - `query(A, B)` iterates the entities that have every listed component, yielding `[entity, a, b]` with the live
 *   component objects (mutate them in place). Iteration order is spawn order, so runs are deterministic.
 * - `resources` hold world-wide state (score, lives, the phase of a round); `emit`/`read` pass events inside one frame.
 * - `version` counts structural changes and every `touch`: a renderer skips work while it has not moved.
 */

export interface ComponentType<T extends object> {
  readonly id: string;
  /** A fresh default value. */
  initial(): T;
  /** An initialiser for `spawn`/`add`: the defaults with `partial` over them. */
  (partial?: Partial<T>): ComponentInit<T>;
}
export interface ComponentInit<T extends object> {
  readonly type: ComponentType<T>;
  readonly value: T;
}
export type Entity = number;

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

export class World {
  private next = 1;
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
    for (const store of this.stores.values()) store.delete(e);
    this.version++;
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
    if (!store) this.stores.set(init.type.id, (store = new Map()));
    store.set(e, init.value);
    this.version++;
    return init.value;
  }
  remove(e: Entity, type: ComponentType<object>): void {
    if (this.stores.get(type.id)?.delete(e)) this.version++;
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
   * Entities with every listed component, in spawn order, with their live component values.
   *
   * Changes made while iterating are safe and order-independent: an entity is yielded only if it
   * matched when the query began and still matches when it is reached. An entity despawned, or one
   * that lost a listed component, earlier in the same pass is skipped (never yielded with a missing
   * value); one that is spawned or starts matching during the pass appears in the next query.
   */
  *query<Q extends readonly ComponentType<object>[]>(...types: Q): Generator<[Entity, ...Values<Q>]> {
    if (!types.length) {
      const order = [...this.alive];
      for (const e of order) if (this.alive.has(e)) yield queryRow<Q>([e]);
      return;
    }
    const stores = types.map(t => this.stores.get(t.id));
    if (stores.some(s => !s)) return;
    const all = stores as Map<Entity, object>[];
    const [first, ...rest] = [...all].sort((a, b) => a.size - b.size);
    // types.length > 0, so `first` exists. Candidates are fixed when the query begins.
    const order = [...first!.keys()].filter(e => rest.every(s => s.has(e))).sort((a, b) => a - b);
    for (const e of order) {
      if (!all.every(s => s.has(e))) continue;
      yield queryRow<Q>([e, ...all.map(s => s.get(e))]);
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
