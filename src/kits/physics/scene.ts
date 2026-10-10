/**
 * kits/physics/scene: bind a physics world to scene visits. One `scenePhysics(options)` per scene definition:
 *
 *   const physics = scenePhysics({ gravity: { x: 0, y: -9.81, z: 0 } });
 *   defineScene({ id: 'yard', title: 'Yard',
 *     prepare: (_ctx, signal) => physics.prepare(signal),   // loads the library (lazy chunk) before entry
 *     exit: ctx => physics.exit(ctx),                        // frees every library object of the visit
 *     systems: [physics.system, ...systemsThatReadEvents] });
 *
 * Owner: one physics world per visit, keyed by the visit's ECS world and created on the first fixed tick after the
 * library is ready. It is disposed by `exit(ctx)` and, where the runtime supplies one, by the visit's abort signal
 * (`ctx.view.signal`), whichever comes first; disposal is idempotent.
 */
import {defineSystem, type SceneContext, type SystemDefinition, type World} from '../../author';
import {ENGINE_FIXED_STEP, physicsConfig, type PhysicsOptions} from './config';
import {physicsLoader, type PhysicsLoader} from './loader';
import {createPhysicsWorld, type PhysicsWorld} from './world';

export interface ScenePhysicsOptions extends PhysicsOptions {
  /** Replace the library source (tests, a custom build). Default: the shared lazy loader. */
  loader?: PhysicsLoader;
  /** System id, when a scene needs two physics worlds. Default 'physics-step'. */
  id?: string;
}

export type ScenePhysicsState = 'not-loaded' | 'running' | 'disposed' | Readonly<{state: 'step-mismatch'; dt: number}>;

export interface ScenePhysics {
  /** Await in `defineScene({ prepare })`. Rejects with the abort reason on abort, or the load error on failure. */
  prepare(signal?: AbortSignal): Promise<void>;
  /** The fixed-lane system that ticks this visit's world once per engine tick. List it after systems that move
   *  kinematic bodies or characters and before systems that read `events()`. */
  readonly system: SystemDefinition;
  /** This visit's physics world (created on first use once loaded), or null before the library is ready or after
   *  exit. */
  of(ctx: Pick<SceneContext, 'world' | 'view'> | {world: World}): PhysicsWorld | null;
  /** This visit's physics world if it already exists (never creates one), or null. */
  current(ctx: {world: World}): PhysicsWorld | null;
  /** What the last tick did for this visit. */
  state(ctx: {world: World}): ScenePhysicsState;
  /** Dispose this visit's world. Idempotent. */
  exit(ctx: {world: World}): void;
}

export function scenePhysics(options: ScenePhysicsOptions = {}): ScenePhysics {
  const {loader = physicsLoader, id = 'physics-step', ...physics} = options;
  physicsConfig(physics); // refuse invalid configuration at definition time
  const worlds = new WeakMap<World, PhysicsWorld>();
  const states = new WeakMap<World, ScenePhysicsState>();
  const retired = new WeakSet<World>();
  const watched = new WeakSet<World>();
  const unwatch = new WeakMap<World, () => void>();

  /** Follow the visit's abort signal once it is seen (a caller without `view` may have created the world). */
  const watch = (key: World, ctx: object) => {
    if (watched.has(key)) return;
    const signal = 'view' in ctx ? (ctx as Pick<SceneContext, 'view'>).view?.signal : undefined;
    if (!signal) return;
    watched.add(key);
    if (signal.aborted) return dispose(key);
    const onAbort = () => dispose(key);
    signal.addEventListener('abort', onAbort, {once: true});
    unwatch.set(key, () => signal.removeEventListener('abort', onAbort));
  };
  const of: ScenePhysics['of'] = ctx => {
    const key = ctx.world;
    if (retired.has(key)) return null;
    let w = worlds.get(key);
    if (!w) {
      const rapier = loader.ready();
      if (!rapier) return null;
      worlds.set(key, (w = createPhysicsWorld(rapier, physics)));
    }
    watch(key, ctx);
    return w.disposed ? null : w;
  };
  function dispose(key: World) {
    unwatch.get(key)?.();
    unwatch.delete(key);
    retired.add(key);
    worlds.get(key)?.dispose();
    states.set(key, 'disposed');
  }

  return {
    async prepare(signal) {
      const result = await loader.load(signal);
      if (result.status === 'ready') return;
      if (result.status === 'aborted') throw signal?.reason ?? new DOMException('physics load aborted', 'AbortError');
      throw result.error;
    },
    system: defineSystem({
      id,
      run(ctx, dt) {
        if (Math.abs(dt - ENGINE_FIXED_STEP) > 1e-9) {
          states.set(ctx.world, Object.freeze({state: 'step-mismatch', dt}));
          return;
        }
        const w = of(ctx);
        if (!w) {
          states.set(ctx.world, retired.has(ctx.world) ? 'disposed' : 'not-loaded');
          return;
        }
        w.tick(ctx.world);
        states.set(ctx.world, 'running');
      },
    }),
    of,
    current: ctx => {
      const w = worlds.get(ctx.world);
      return w && !w.disposed ? w : null;
    },
    state: ctx => states.get(ctx.world) ?? (retired.has(ctx.world) ? 'disposed' : 'not-loaded'),
    exit: ctx => dispose(ctx.world),
  };
}
