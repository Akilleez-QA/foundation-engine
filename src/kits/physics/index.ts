/**
 * @kits/physics: an optional rigid-body physics adapter over a lazily loaded WebAssembly library (the deterministic
 * compat build of Rapier, Apache-2.0). Core stays physics-free; a game that does not import this kit ships none of it,
 * and a game that does fetches the library chunk only when a scene's `prepare` asks for it. See README.md and
 * docs/guides/physics-adapter.md.
 *
 *   const physics = scenePhysics({ gravity: { x: 0, y: -9.81, z: 0 } });
 *   defineScene({ id, title, prepare: (_c, signal) => physics.prepare(signal), exit: ctx => physics.exit(ctx),
 *                 entities: [[Transform({ y: 3 }), RigidBody(), Collider({ shape: 'ball', radius: 0.5 })],
 *                            [Transform(), Collider({ hx: 10, hy: 0.1, hz: 10 })]],
 *                 systems: [physics.system, readsEvents] });
 *   physics.of(ctx)?.events()      this tick's bounded, ordered collision list
 *   physics.of(ctx)?.snapshot()    the world as text for rollback, `restore(text)` to go back
 */
import {defineKit, type KitDefinition} from '../../author';

export {RigidBody, Collider, PhysicsCharacter} from './components';
export type {BodyKind, ColliderShape, RigidBodyData, ColliderData, PhysicsCharacterData} from './components';
export {
  physicsConfig,
  ENGINE_FIXED_STEP,
  PHYSICS_DEFAULT_LIMITS,
  PHYSICS_LIMIT_RANGES,
  type PhysicsOptions,
  type PhysicsConfig,
  type PhysicsLimits,
  type PhysicsVector,
} from './config';
export {
  loadPhysics,
  createPhysicsLoader,
  physicsLoader,
  type PhysicsLoad,
  type PhysicsLoader,
  type Rapier,
} from './loader';
export {
  createPhysicsWorld,
  type PhysicsWorld,
  type PhysicsCollision,
  type PhysicsEvents,
  type PhysicsStatus,
  type PhysicsHit,
  type QueryShape,
  type QueryPose,
  type QueryOptions,
  type QueryResult,
  type SnapshotResult,
  type RestoreResult,
  type CharacterMove,
  type DebugLines,
  type RefusalReason,
  type RecordKind,
} from './world';
export {scenePhysics, type ScenePhysics, type ScenePhysicsOptions, type ScenePhysicsState} from './scene';
export {
  physicsCharacterSystem,
  physicsCharacterStats,
  type PhysicsCharacterOptions,
  type PhysicsCharacterStats,
} from './character';
export {physicsDebugDraw, type PhysicsDebugDrawOptions} from './debug-draw';
export {eulerToQuat, quatToEuler} from './pose';

/**
 * The kit: `defineGame({ kits: [physics()] })`. It contributes no definitions. With `{ characters: true }` it requires
 * the character kit, whose move axes `physicsCharacterSystem` reads; list `character()` too.
 */
export function physics(o: {characters?: boolean} = {}): KitDefinition {
  return defineKit({id: 'physics', requires: o.characters ? ['character'] : []});
}
