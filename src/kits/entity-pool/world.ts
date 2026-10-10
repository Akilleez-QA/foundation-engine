/**
 * kits/entity-pool/world.ts: compose an EntityPool with an ECS World.
 *
 * `spawnPooled` checks admission first, so a refused request spawns nothing; an admitted one spawns the entity,
 * despawns every evicted entity and emits one `POOL_EVICTED` world event per eviction (in eviction order) so later
 * systems in the same frame can react (a puff of smoke, a placement returned to dormant, a counter). `despawnPooled`
 * releases and despawns together. Entities removed elsewhere are recovered with `pool.sweep(e => world.exists(e), n)`.
 */
import type {ComponentInit, Entity, World} from '../../core/ecs/world';
import type {EntityPool, PoolResult} from './pool';

/** World event type emitted for each evicted entity. Payload: `PoolEvictedEvent`. */
export const POOL_EVICTED = 'entity-pool.evicted';

export interface PoolEvictedEvent {
  readonly entity: Entity;
  /** The evicted entity's class. */
  readonly class: string;
  /** The class of the request that evicted it. */
  readonly by: string;
}

/**
 * Spawn an entity of class `cls` with `inits` if the pool admits it. Returns the entity, or undefined when refused or
 * closed (`out.status` and `out.reason` say why; nothing was spawned or evicted).
 */
export function spawnPooled(
  world: World,
  pool: EntityPool,
  cls: string,
  inits: readonly ComponentInit<object>[],
  out: PoolResult,
): Entity | undefined {
  if (pool.check(cls, out, true) !== 'admitted') return undefined;
  const e = world.spawn(...inits);
  const status = pool.admit(e, cls, out);
  if (status !== 'admitted') {
    // Unreachable unless the id was already pooled (a foreign admit of a future id); keep the world consistent.
    world.despawn(e);
    return undefined;
  }
  for (let k = 0; k < out.count; k++) {
    const victim = out.evicted[k]!;
    world.despawn(victim);
    world.emit(POOL_EVICTED, {entity: victim, class: out.evictedClass[k]!, by: cls} satisfies PoolEvictedEvent);
  }
  return e;
}

/** Release `e` from the pool (if pooled) and despawn it. */
export function despawnPooled(world: World, pool: EntityPool, e: Entity): void {
  pool.release(e);
  world.despawn(e);
}
