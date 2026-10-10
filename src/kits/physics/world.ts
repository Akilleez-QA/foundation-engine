/**
 * kits/physics/world: the owner of one library world for one scene visit (or one test). It owns every WebAssembly
 * object it creates (the world, its event queue and character controllers), maps engine entities to library handles,
 * and frees everything exactly once in `dispose()`.
 *
 * Per engine tick (`tick(world)`, called once by the scene's fixed-lane system):
 *   1. sync: remove bodies whose entity is gone or no longer qualifies; admit new entities in a fixed order
 *      (characters, then bodies, then static colliders, each in ascending entity id) within the configured limits;
 *      push kinematic and character targets from Transform;
 *   2. step: `substeps` library steps, draining collision events after each into a bounded, sorted list;
 *   3. write back: dynamic body poses into Transform.
 * Refusals (a limit, invalid data) and dropped events are counted and reported in `status()`; nothing is truncated
 * silently. Every operation after `dispose()` returns a `disposed` result or null.
 */
import {scalarMath, Transform, type Entity, type ScalarMath, type World} from '../../author';
import {
  bodyProblem,
  characterProblem,
  Collider,
  colliderProblem,
  PhysicsCharacter,
  RigidBody,
  type BodyKind,
  type ColliderData,
  type PhysicsCharacterData,
} from './components';
import {physicsConfig, type PhysicsConfig, type PhysicsOptions, type PhysicsVector} from './config';
import type {Rapier} from './loader';
import {base64ToBytes, bytesToBase64, eulerToQuat, handleToHex, hexToHandle, quatToEuler} from './pose';

type RWorld = InstanceType<Rapier['World']>;
type RBody = InstanceType<Rapier['RigidBody']>;
type RCollider = InstanceType<Rapier['Collider']>;
type RController = InstanceType<Rapier['KinematicCharacterController']>;
type RShape = InstanceType<Rapier['Shape']>;

export type RecordKind = 'body' | 'static' | 'character';
interface Rec {
  readonly entity: Entity;
  readonly kind: RecordKind;
  readonly body: number | null;
  readonly collider: number | null;
  readonly sensor: boolean;
  readonly bodyKind: BodyKind | null;
}

/** One collision event between two admitted entities, `a < b`. */
export interface PhysicsCollision {
  readonly a: Entity;
  readonly b: Entity;
  readonly started: boolean;
  /** Either collider is a sensor (an overlap, not a contact). */
  readonly sensor: boolean;
  /** Library step within the tick (0 unless `substeps` > 1). */
  readonly substep: number;
}
export interface PhysicsEvents {
  readonly tick: number;
  /** Sorted by substep, a, b, then stopped before started. At most `maxEventsPerStep`. */
  readonly list: readonly PhysicsCollision[];
  /** Events produced this tick beyond the bound (not in `list`). */
  readonly dropped: number;
  /** Events naming a collider removed before the step (its entity is gone): the library's stop events for removed
   *  colliders. Not listed; counted so nothing disappears silently. */
  readonly unmapped: number;
}

export type RefusalReason =
  'limit-bodies' | 'limit-colliders' | 'limit-characters' | 'invalid-body' | 'invalid-collider' | 'invalid-character';

export interface PhysicsStatus {
  readonly state: 'running' | 'disposed';
  readonly tick: number;
  readonly bodies: number;
  readonly colliders: number;
  readonly characters: number;
  /** Entities currently refused, by reason (re-tried every tick). */
  readonly refused: Readonly<Record<RefusalReason, number>>;
  /** Times an entity became refused since creation. */
  readonly refusals: number;
  /** Collision events dropped over the bound since creation. */
  readonly droppedEvents: number;
  /** Collision events for already removed colliders since creation (see PhysicsEvents.unmapped). */
  readonly unmappedEvents: number;
  /** Kinematic targets skipped and dynamic poses not written back because a value was non-finite or beyond
   *  `maxCoordinate`, since creation. */
  readonly skippedPoses: number;
  /** Library objects released by this owner: worlds, event queues, character controllers. */
  readonly released: Readonly<{worlds: number; queues: number; controllers: number}>;
}

export interface PhysicsHit {
  readonly entity: Entity;
  readonly distance: number;
  readonly point: PhysicsVector;
  readonly normal: PhysicsVector;
}
export interface QueryShape {
  readonly shape: ColliderData['shape'];
  readonly hx?: number;
  readonly hy?: number;
  readonly hz?: number;
  readonly radius?: number;
  readonly halfHeight?: number;
}
export interface QueryPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rx?: number;
  readonly ry?: number;
  readonly rz?: number;
}
export interface QueryOptions {
  /** Leave this entity's colliders out (the caster itself). */
  readonly exclude?: Entity;
  /** Include sensor colliders. Default false. */
  readonly sensors?: boolean;
}
export type QueryResult<T> =
  Readonly<{status: 'ok'; hits: readonly T[]; truncated: boolean}> | Readonly<{status: 'invalid' | 'disposed'}>;

export type SnapshotResult =
  | Readonly<{status: 'ok'; text: string; bytes: number}>
  | Readonly<{status: 'too-large'; bytes: number; limit: number}>
  | Readonly<{status: 'disposed'}>;
export type RestoreResult =
  | Readonly<{status: 'restored'; tick: number; bodies: number; colliders: number}>
  | Readonly<{status: 'too-large'; bytes: number; limit: number}>
  | Readonly<{status: 'invalid'; reason: string}>
  | Readonly<{status: 'disposed'}>;

export type CharacterMove =
  | Readonly<{status: 'moved'; x: number; y: number; z: number; grounded: boolean; collisions: number}>
  | Readonly<{status: 'unknown' | 'invalid' | 'disposed'}>;

export interface DebugLines {
  /** xyz per vertex, two vertices per segment; a view valid until the next call. */
  readonly vertices: Float32Array;
  /** rgba per vertex. */
  readonly colors: Float32Array;
  readonly vertexCount: number;
  /** Vertices the library produced before the bound. */
  readonly total: number;
  readonly truncated: boolean;
}

export interface PhysicsWorld {
  readonly config: PhysicsConfig;
  readonly disposed: boolean;
  /** sync, step and write back: call once per engine fixed tick. */
  tick(world: World): PhysicsEvents | null;
  sync(world: World): void;
  step(): PhysicsEvents | null;
  writeBack(world: World): void;
  /** The last tick's collision events (empty before the first step and after a restore). */
  events(): PhysicsEvents;
  raycast(
    origin: PhysicsVector,
    direction: PhysicsVector,
    maxDistance: number,
    o?: QueryOptions,
  ): QueryResult<PhysicsHit>;
  raycastAll(
    origin: PhysicsVector,
    direction: PhysicsVector,
    maxDistance: number,
    o?: QueryOptions & {maxHits?: number},
  ): QueryResult<PhysicsHit>;
  overlap(shape: QueryShape, pose: QueryPose, o?: QueryOptions & {maxHits?: number}): QueryResult<Entity>;
  castShape(
    shape: QueryShape,
    pose: QueryPose,
    direction: PhysicsVector,
    maxDistance: number,
    o?: QueryOptions,
  ): QueryResult<Readonly<{entity: Entity; distance: number}>>;
  /** Resolve one character's desired displacement (metres) through its character controller. Does not move it. */
  moveCharacter(entity: Entity, desired: PhysicsVector): CharacterMove;
  /** Place a dynamic or kinematic body now; `stop` clears its velocities. False when not admitted. */
  teleport(entity: Entity, pose: QueryPose, stop?: boolean): boolean;
  /** Remove an entity's library objects; the next sync admits it again from its current components. */
  rebuild(entity: Entity): void;
  /** Library handles of an admitted entity (diagnostics and tests). */
  handles(entity: Entity): Readonly<{kind: RecordKind; body: number | null; collider: number | null}> | null;
  snapshot(): SnapshotResult;
  restore(text: string): RestoreResult;
  debugLines(): DebugLines | null;
  status(): PhysicsStatus;
  dispose(): void;
}

const SNAPSHOT_FORMAT = 'foundation-physics';
const SNAPSHOT_VERSION = 1;
const MAX_DISPLACEMENT = 100;
const MAX_QUERY_DISTANCE = 1e5;
/** Candidates one multi-hit query examines before choosing the nearest / lowest `maxHits`. Past it, `truncated`. */
export const QUERY_SCAN_CAP = 16384;
const EMPTY: readonly PhysicsCollision[] = Object.freeze([]);
const REASONS: readonly RefusalReason[] = [
  'limit-bodies',
  'limit-colliders',
  'limit-characters',
  'invalid-body',
  'invalid-collider',
  'invalid-character',
];

const finite = (v: PhysicsVector | undefined | null): v is PhysicsVector =>
  !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const finitePose = (p: QueryPose | undefined | null): p is QueryPose =>
  !!p && finite(p) && [p.rx ?? 0, p.ry ?? 0, p.rz ?? 0].every(Number.isFinite);

/** Create the owner. Throws a RangeError for invalid options (see config.ts). */
export function createPhysicsWorld(rapier: Rapier, options: PhysicsOptions = {}): PhysicsWorld {
  const config = physicsConfig(options);
  const m: ScalarMath = scalarMath(config.math);
  const R = rapier;
  const limits = config.limits;
  const bound = limits.maxCoordinate;
  const inBound = (v: number) => Number.isFinite(v) && Math.abs(v) <= bound;
  /** Position and rotation finite and within `maxCoordinate`. */
  const poseOk = (p: {x: number; y: number; z: number; rx?: number; ry?: number; rz?: number}) =>
    inBound(p.x) && inBound(p.y) && inBound(p.z) && inBound(p.rx ?? 0) && inBound(p.ry ?? 0) && inBound(p.rz ?? 0);
  const vectorOk = (v: PhysicsVector | undefined | null): v is PhysicsVector =>
    !!v && inBound(v.x) && inBound(v.y) && inBound(v.z);
  let world: RWorld | null = makeWorld();
  let queue: InstanceType<Rapier['EventQueue']> | null = new R.EventQueue(true);
  const records = new Map<Entity, Rec>();
  const byCollider = new Map<number, Rec>();
  const controllers = new Map<Entity, RController>();
  let refusedNow = new Map<Entity, RefusalReason>();
  let tickCount = 0,
    refusals = 0,
    droppedEvents = 0,
    unmappedEvents = 0,
    skippedPoses = 0,
    bodyCount = 0,
    colliderCount = 0,
    characterCount = 0;
  const released = {worlds: 0, queues: 0, controllers: 0};
  let lastEvents: PhysicsEvents = Object.freeze({tick: 0, list: EMPTY, dropped: 0, unmapped: 0});

  function makeWorld(): RWorld {
    const w = new R.World(config.gravity);
    w.timestep = config.step;
    w.numSolverIterations = config.solverIterations;
    return w;
  }

  const live = (): RWorld | null => world;

  function freeController(entity: Entity) {
    const c = controllers.get(entity);
    if (!c) return;
    controllers.delete(entity);
    world?.removeCharacterController(c); // frees it and drops it from the world's own set (no double free)
    released.controllers++;
  }
  function freeAllControllers() {
    for (const e of [...controllers.keys()]) freeController(e);
  }

  function remove(rec: Rec) {
    const w = world!;
    freeController(rec.entity);
    if (rec.body !== null) {
      const body = w.getRigidBody(rec.body);
      if (body) w.removeRigidBody(body); // removes its attached collider too
      bodyCount--;
    } else if (rec.collider !== null) {
      const c = w.getCollider(rec.collider);
      if (c) w.removeCollider(c, true);
    }
    if (rec.collider !== null) {
      byCollider.delete(rec.collider);
      colliderCount--;
    }
    if (rec.kind === 'character') characterCount--;
    records.delete(rec.entity);
  }

  function shapeDesc(c: QueryShape | ColliderData): InstanceType<Rapier['ColliderDesc']> {
    switch (c.shape) {
      case 'ball':
        return R.ColliderDesc.ball(c.radius!);
      case 'capsule':
        return R.ColliderDesc.capsule(c.halfHeight!, c.radius!);
      case 'cylinder':
        return R.ColliderDesc.cylinder(c.halfHeight!, c.radius!);
      default:
        return R.ColliderDesc.cuboid(c.hx!, c.hy!, c.hz!);
    }
  }
  function queryShape(s: QueryShape): RShape | null {
    const data = {hx: 0, hy: 0, hz: 0, radius: 0, halfHeight: 0, ...s} as ColliderData;
    const full: ColliderData = {...data, friction: 0, restitution: 0, density: 1, sensor: false, events: false};
    if (colliderProblem(full)) return null;
    switch (s.shape) {
      case 'ball':
        return new R.Ball(data.radius);
      case 'capsule':
        return new R.Capsule(data.halfHeight, data.radius);
      case 'cylinder':
        return new R.Cylinder(data.halfHeight, data.radius);
      default:
        return new R.Cuboid(data.hx, data.hy, data.hz);
    }
  }
  function colliderOf(c: ColliderData) {
    const desc = shapeDesc(c)
      .setFriction(c.friction)
      .setRestitution(c.restitution)
      .setDensity(c.density)
      .setSensor(c.sensor)
      .setActiveEvents(c.events ? R.ActiveEvents.COLLISION_EVENTS : R.ActiveEvents.NONE);
    if (c.sensor)
      desc.setActiveCollisionTypes(
        R.ActiveCollisionTypes.DEFAULT |
          R.ActiveCollisionTypes.KINEMATIC_FIXED |
          R.ActiveCollisionTypes.KINEMATIC_KINEMATIC,
      );
    return desc;
  }

  function refuse(entity: Entity, reason: RefusalReason, previous: Map<Entity, RefusalReason>) {
    refusedNow.set(entity, reason);
    if (!previous.has(entity)) refusals++;
  }

  type TransformData = ReturnType<typeof Transform.initial>;
  function admitCharacter(e: Entity, tr: TransformData, ch: PhysicsCharacterData, prev: Map<Entity, RefusalReason>) {
    if (characterProblem(ch) || !poseOk(tr)) return refuse(e, 'invalid-character', prev);
    if (characterCount + 1 > limits.maxCharacters) return refuse(e, 'limit-characters', prev);
    if (bodyCount + 1 > limits.maxBodies) return refuse(e, 'limit-bodies', prev);
    if (colliderCount + 1 > limits.maxColliders) return refuse(e, 'limit-colliders', prev);
    const w = world!;
    const body = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(tr.x, tr.y, tr.z));
    const collider = w.createCollider(
      R.ColliderDesc.capsule(ch.halfHeight, ch.radius).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    const rec: Rec = {
      entity: e,
      kind: 'character',
      body: body.handle,
      collider: collider.handle,
      sensor: false,
      bodyKind: 'kinematic',
    };
    records.set(e, rec);
    byCollider.set(collider.handle, rec);
    bodyCount++;
    colliderCount++;
    characterCount++;
  }
  function admitBody(
    e: Entity,
    tr: TransformData,
    b: ReturnType<typeof RigidBody.initial>,
    c: ColliderData | undefined,
    prev: Map<Entity, RefusalReason>,
  ) {
    if (bodyProblem(b) || !poseOk(tr)) return refuse(e, 'invalid-body', prev);
    if (c && colliderProblem(c)) return refuse(e, 'invalid-collider', prev);
    if (bodyCount + 1 > limits.maxBodies) return refuse(e, 'limit-bodies', prev);
    if (c && colliderCount + 1 > limits.maxColliders) return refuse(e, 'limit-colliders', prev);
    const w = world!;
    const q = eulerToQuat(tr.rx, tr.ry, tr.rz, m);
    const desc =
      b.kind === 'dynamic'
        ? R.RigidBodyDesc.dynamic()
        : b.kind === 'kinematic'
          ? R.RigidBodyDesc.kinematicPositionBased()
          : R.RigidBodyDesc.fixed();
    desc
      .setTranslation(tr.x, tr.y, tr.z)
      .setRotation(q)
      .setLinearDamping(b.linearDamping)
      .setAngularDamping(b.angularDamping)
      .setGravityScale(b.gravityScale)
      .setCcdEnabled(b.ccd);
    if (b.kind === 'dynamic') desc.setLinvel(b.vx, b.vy, b.vz);
    if (b.lockRotations) desc.lockRotations();
    const body = w.createRigidBody(desc);
    let collider: number | null = null;
    if (c) collider = w.createCollider(colliderOf(c), body).handle;
    const rec: Rec = {entity: e, kind: 'body', body: body.handle, collider, sensor: !!c?.sensor, bodyKind: b.kind};
    records.set(e, rec);
    bodyCount++;
    if (collider !== null) {
      byCollider.set(collider, rec);
      colliderCount++;
    }
  }
  function admitStatic(e: Entity, tr: TransformData, c: ColliderData, prev: Map<Entity, RefusalReason>) {
    if (colliderProblem(c) || !poseOk(tr)) return refuse(e, 'invalid-collider', prev);
    if (colliderCount + 1 > limits.maxColliders) return refuse(e, 'limit-colliders', prev);
    const q = eulerToQuat(tr.rx, tr.ry, tr.rz, m);
    const collider = world!.createCollider(colliderOf(c).setTranslation(tr.x, tr.y, tr.z).setRotation(q));
    const rec: Rec = {
      entity: e,
      kind: 'static',
      body: null,
      collider: collider.handle,
      sensor: c.sensor,
      bodyKind: null,
    };
    records.set(e, rec);
    byCollider.set(collider.handle, rec);
    colliderCount++;
  }

  /** The ECS world last synced: character controllers read their settings from it when first used. */
  let ecs: World | null = null;
  /** A character controller, created on first use and configured from the component at that time. */
  function makeController(entity: Entity): RController {
    const ch = ecs?.get(entity, PhysicsCharacter) ?? PhysicsCharacter.initial();
    const kcc = world!.createCharacterController(ch.offset);
    kcc.setUp({x: 0, y: 1, z: 0});
    kcc.setSlideEnabled(true);
    kcc.setMaxSlopeClimbAngle(ch.maxSlope);
    kcc.setMinSlopeSlideAngle(ch.minSlide);
    if (ch.stepHeight > 0) kcc.enableAutostep(ch.stepHeight, ch.stepWidth, false);
    else kcc.disableAutostep();
    if (ch.snap > 0) kcc.enableSnapToGround(ch.snap);
    else kcc.disableSnapToGround();
    kcc.setApplyImpulsesToDynamicBodies(false);
    return kcc;
  }

  const qualifies = (w: World, rec: Rec): boolean => {
    const e = rec.entity;
    if (!w.exists(e) || !w.has(e, Transform)) return false;
    const character = w.has(e, PhysicsCharacter),
      body = w.has(e, RigidBody);
    if (rec.kind === 'character') return character;
    if (rec.kind === 'body')
      return (
        !character &&
        body &&
        w.get(e, RigidBody)!.kind === rec.bodyKind &&
        w.has(e, Collider) === (rec.collider !== null)
      );
    return !character && !body && w.has(e, Collider);
  };

  function sync(w: World): void {
    if (!world) return;
    ecs = w;
    // Removal order changes the library's slot reuse, so it is canonical (ascending entity), never Map order.
    const gone = [...records.values()].filter(rec => !qualifies(w, rec)).sort((a, b) => a.entity - b.entity);
    for (const rec of gone) remove(rec);
    const prev = refusedNow;
    refusedNow = new Map();
    for (const [e, tr, ch] of w.query(Transform, PhysicsCharacter))
      if (!records.has(e)) admitCharacter(e, tr, ch, prev);
    for (const [e, tr, b] of w.query(Transform, RigidBody))
      if (!records.has(e) && !w.has(e, PhysicsCharacter)) admitBody(e, tr, b, w.get(e, Collider), prev);
    for (const [e, tr, c] of w.query(Transform, Collider))
      if (!records.has(e) && !w.has(e, PhysicsCharacter) && !w.has(e, RigidBody)) admitStatic(e, tr, c, prev);
    // Kinematic targets follow Transform; characters stay upright (their yaw is presentation only).
    for (const rec of records.values()) {
      if (rec.bodyKind !== 'kinematic') continue;
      const tr = w.get(rec.entity, Transform)!;
      if (!poseOk(tr)) {
        skippedPoses++; // the body keeps its last valid target
        continue;
      }
      const body = world.getRigidBody(rec.body!);
      body.setNextKinematicTranslation({x: tr.x, y: tr.y, z: tr.z});
      if (rec.kind === 'body') body.setNextKinematicRotation(eulerToQuat(tr.rx, tr.ry, tr.rz, m));
    }
  }

  function step(): PhysicsEvents | null {
    if (!world || !queue) return null;
    const cap = limits.maxEventsPerStep;
    const list: PhysicsCollision[] = [];
    let dropped = 0,
      unmapped = 0;
    for (let substep = 0; substep < config.substeps; substep++) {
      world.step(queue);
      // Kept in the library's drain order (deterministic in its deterministic build) up to the bound, then sorted.
      queue.drainCollisionEvents((h1, h2, started) => {
        const r1 = byCollider.get(h1),
          r2 = byCollider.get(h2);
        if (!r1 || !r2) {
          unmapped++; // a stop event for a collider removed by the last sync: its entity no longer exists
          return;
        }
        if (list.length >= cap) {
          dropped++;
          return;
        }
        const [a, b] = r1.entity < r2.entity ? [r1.entity, r2.entity] : [r2.entity, r1.entity];
        list.push(Object.freeze({a, b, started, sensor: r1.sensor || r2.sensor, substep}));
      });
    }
    list.sort((x, y) => x.substep - y.substep || x.a - y.a || x.b - y.b || Number(x.started) - Number(y.started));
    tickCount++;
    droppedEvents += dropped;
    unmappedEvents += unmapped;
    lastEvents = Object.freeze({tick: tickCount, list: Object.freeze(list), dropped, unmapped});
    return lastEvents;
  }

  function writeBack(w: World): void {
    if (!world) return;
    let moved = false;
    for (const rec of records.values()) {
      if (rec.bodyKind !== 'dynamic') continue;
      const tr = w.get(rec.entity, Transform);
      if (!tr) continue;
      const body = world.getRigidBody(rec.body!);
      const t = body.translation(),
        e = quatToEuler(body.rotation(), m);
      if (!poseOk({x: t.x, y: t.y, z: t.z, ...e})) {
        skippedPoses++; // never write a non-finite or runaway pose into Transform
        continue;
      }
      if (tr.x !== t.x || tr.y !== t.y || tr.z !== t.z || tr.rx !== e.rx || tr.ry !== e.ry || tr.rz !== e.rz) {
        tr.x = t.x;
        tr.y = t.y;
        tr.z = t.z;
        tr.rx = e.rx;
        tr.ry = e.ry;
        tr.rz = e.rz;
        moved = true;
      }
    }
    if (moved) w.touch(); // redraw only when a pose changed
  }

  function excludeOf(o: QueryOptions | undefined) {
    const rec = o?.exclude === undefined ? undefined : records.get(o.exclude);
    const w = world!;
    return {
      flags: o?.sensors ? undefined : R.QueryFilterFlags.EXCLUDE_SENSORS,
      collider: rec?.collider != null ? w.getCollider(rec.collider) : undefined,
      body: rec?.body != null ? w.getRigidBody(rec.body) : undefined,
    };
  }
  const hitsBound = (n: number | undefined) =>
    n === undefined ? limits.maxQueryHits : Number.isInteger(n) && n >= 1 && n <= limits.maxQueryHits ? n : null;
  const unit = (d: PhysicsVector): PhysicsVector | null => {
    const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
    return len > 1e-9 ? {x: d.x / len, y: d.y / len, z: d.z / len} : null;
  };
  const distanceOk = (d: number) => Number.isFinite(d) && d >= 0 && d <= MAX_QUERY_DISTANCE;

  const owner: PhysicsWorld = {
    config,
    get disposed() {
      return world === null;
    },
    tick(w) {
      if (!world) return null;
      sync(w);
      const events = step();
      writeBack(w);
      return events;
    },
    sync,
    step,
    writeBack,
    events: () => lastEvents,
    raycast(origin, direction, maxDistance, o) {
      const w = live();
      if (!w) return Object.freeze({status: 'disposed'});
      const dir = finite(direction) ? unit(direction) : null;
      if (!vectorOk(origin) || !dir || !distanceOk(maxDistance)) return Object.freeze({status: 'invalid'});
      const ex = excludeOf(o);
      const hit = w.castRayAndGetNormal(
        new R.Ray(origin, dir),
        maxDistance,
        true,
        ex.flags,
        undefined,
        ex.collider,
        ex.body,
      );
      const rec = hit ? byCollider.get(hit.collider.handle) : undefined;
      const hits: PhysicsHit[] = [];
      if (hit && rec) {
        const d = hit.timeOfImpact;
        hits.push(
          Object.freeze({
            entity: rec.entity,
            distance: d,
            point: Object.freeze({x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d}),
            normal: Object.freeze({x: hit.normal.x, y: hit.normal.y, z: hit.normal.z}),
          }),
        );
      }
      return Object.freeze({status: 'ok', hits: Object.freeze(hits), truncated: false});
    },
    raycastAll(origin, direction, maxDistance, o) {
      const w = live();
      if (!w) return Object.freeze({status: 'disposed'});
      const dir = finite(direction) ? unit(direction) : null;
      const max = hitsBound(o?.maxHits);
      if (!vectorOk(origin) || !dir || !distanceOk(maxDistance) || max === null)
        return Object.freeze({status: 'invalid'});
      const ex = excludeOf(o);
      // Collect every candidate (up to the scan cap), then keep the nearest: the result never depends on the
      // library's traversal order.
      const hits: PhysicsHit[] = [];
      let truncated = false;
      w.intersectionsWithRay(
        new R.Ray(origin, dir),
        maxDistance,
        true,
        hit => {
          const rec = byCollider.get(hit.collider.handle);
          if (!rec) return true;
          if (hits.length >= QUERY_SCAN_CAP) {
            truncated = true;
            return false;
          }
          const d = hit.timeOfImpact;
          hits.push(
            Object.freeze({
              entity: rec.entity,
              distance: d,
              point: Object.freeze({x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d}),
              normal: Object.freeze({x: hit.normal.x, y: hit.normal.y, z: hit.normal.z}),
            }),
          );
          return true;
        },
        ex.flags,
        undefined,
        ex.collider,
        ex.body,
      );
      hits.sort((a, b) => a.distance - b.distance || a.entity - b.entity);
      if (hits.length > max) truncated = true;
      return Object.freeze({status: 'ok', hits: Object.freeze(hits.slice(0, max)), truncated});
    },
    overlap(shape, pose, o) {
      const w = live();
      if (!w) return Object.freeze({status: 'disposed'});
      const s = queryShape(shape),
        max = hitsBound(o?.maxHits);
      if (!s || !finitePose(pose) || !poseOk(pose) || max === null) return Object.freeze({status: 'invalid'});
      const ex = excludeOf(o);
      const found = new Set<Entity>();
      let truncated = false;
      w.intersectionsWithShape(
        {x: pose.x, y: pose.y, z: pose.z},
        eulerToQuat(pose.rx ?? 0, pose.ry ?? 0, pose.rz ?? 0, m),
        s,
        c => {
          const rec = byCollider.get(c.handle);
          if (!rec) return true;
          if (found.size >= QUERY_SCAN_CAP) {
            truncated = true;
            return false;
          }
          found.add(rec.entity);
          return true;
        },
        ex.flags,
        undefined,
        ex.collider,
        ex.body,
      );
      const sorted = [...found].sort((a, b) => a - b);
      if (sorted.length > max) truncated = true;
      return Object.freeze({status: 'ok', hits: Object.freeze(sorted.slice(0, max)), truncated});
    },
    castShape(shape, pose, direction, maxDistance, o) {
      const w = live();
      if (!w) return Object.freeze({status: 'disposed'});
      const s = queryShape(shape);
      const dir = finite(direction) ? unit(direction) : null;
      if (!s || !finitePose(pose) || !poseOk(pose) || !dir || !distanceOk(maxDistance))
        return Object.freeze({status: 'invalid'});
      const ex = excludeOf(o);
      const hit = w.castShape(
        {x: pose.x, y: pose.y, z: pose.z},
        eulerToQuat(pose.rx ?? 0, pose.ry ?? 0, pose.rz ?? 0, m),
        dir,
        s,
        0,
        maxDistance,
        true,
        ex.flags,
        undefined,
        ex.collider,
        ex.body,
      );
      const rec = hit ? byCollider.get(hit.collider.handle) : undefined;
      const hits = hit && rec ? [Object.freeze({entity: rec.entity, distance: hit.time_of_impact})] : [];
      return Object.freeze({status: 'ok', hits: Object.freeze(hits), truncated: false});
    },
    moveCharacter(entity, desired) {
      const w = live();
      if (!w) return Object.freeze({status: 'disposed'});
      const rec = records.get(entity);
      if (!rec || rec.kind !== 'character') return Object.freeze({status: 'unknown'});
      if (!finite(desired) || Math.abs(desired.x) + Math.abs(desired.y) + Math.abs(desired.z) > MAX_DISPLACEMENT)
        return Object.freeze({status: 'invalid'});
      let kcc = controllers.get(entity);
      if (!kcc) controllers.set(entity, (kcc = makeController(entity)));
      const collider = w.getCollider(rec.collider!);
      kcc.computeColliderMovement(collider, desired, R.QueryFilterFlags.EXCLUDE_SENSORS);
      const out = kcc.computedMovement();
      return Object.freeze({
        status: 'moved',
        x: out.x,
        y: out.y,
        z: out.z,
        grounded: kcc.computedGrounded(),
        collisions: kcc.numComputedCollisions(),
      });
    },
    teleport(entity, pose, stop = true) {
      const w = live();
      const rec = records.get(entity);
      if (!w || !rec || rec.body === null || !finitePose(pose) || !poseOk(pose)) return false;
      const body = w.getRigidBody(rec.body);
      body.setTranslation({x: pose.x, y: pose.y, z: pose.z}, true);
      if (rec.kind !== 'character') body.setRotation(eulerToQuat(pose.rx ?? 0, pose.ry ?? 0, pose.rz ?? 0, m), true);
      if (stop && rec.bodyKind === 'dynamic') {
        body.setLinvel({x: 0, y: 0, z: 0}, true);
        body.setAngvel({x: 0, y: 0, z: 0}, true);
      }
      return true;
    },
    rebuild(entity) {
      const rec = records.get(entity);
      if (world && rec) remove(rec);
    },
    handles(entity) {
      const rec = records.get(entity);
      return rec ? Object.freeze({kind: rec.kind, body: rec.body, collider: rec.collider}) : null;
    },
    snapshot() {
      const w = live();
      if (!w) return Object.freeze({status: 'disposed'});
      const bytes = w.takeSnapshot();
      const estimate = Math.ceil(bytes.length / 3) * 4;
      if (estimate > limits.maxSnapshotBytes)
        return Object.freeze({status: 'too-large', bytes: estimate, limit: limits.maxSnapshotBytes});
      const recs = [...records.values()]
        .sort((a, b) => a.entity - b.entity)
        .map(r => [
          r.entity,
          r.kind,
          r.bodyKind ?? '',
          r.body === null ? '' : handleToHex(r.body),
          r.collider === null ? '' : handleToHex(r.collider),
          r.sensor ? 1 : 0,
        ]);
      const text = JSON.stringify({
        format: SNAPSHOT_FORMAT,
        v: SNAPSHOT_VERSION,
        tick: tickCount,
        records: recs,
        world: bytesToBase64(bytes),
      });
      if (text.length > limits.maxSnapshotBytes)
        return Object.freeze({status: 'too-large', bytes: text.length, limit: limits.maxSnapshotBytes});
      return Object.freeze({status: 'ok', text, bytes: text.length});
    },
    restore(text) {
      if (!world) return Object.freeze({status: 'disposed'});
      if (typeof text !== 'string') return Object.freeze({status: 'invalid', reason: 'not text'});
      if (text.length > limits.maxSnapshotBytes)
        return Object.freeze({status: 'too-large', bytes: text.length, limit: limits.maxSnapshotBytes});
      const fail = (reason: string): RestoreResult => Object.freeze({status: 'invalid', reason});
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return fail('not JSON');
      }
      const p = parsed as {format?: unknown; v?: unknown; tick?: unknown; records?: unknown; world?: unknown};
      if (!p || typeof p !== 'object' || p.format !== SNAPSHOT_FORMAT || p.v !== SNAPSHOT_VERSION)
        return fail('format');
      if (!Number.isSafeInteger(p.tick) || (p.tick as number) < 0) return fail('tick');
      if (!Array.isArray(p.records) || p.records.length > limits.maxBodies + limits.maxColliders)
        return fail('records');
      const next: Rec[] = [];
      const seen = new Set<Entity>(),
        bodyHandles = new Set<number>(),
        colliderHandles = new Set<number>();
      let bodies = 0,
        colliders = 0,
        characters = 0;
      for (const row of p.records as unknown[]) {
        if (!Array.isArray(row) || row.length !== 6) return fail('record');
        const [entity, kind, bodyKind, bodyHex, colliderHex, sensor] = row as unknown[];
        if (!Number.isSafeInteger(entity) || (entity as number) < 1 || seen.has(entity as number))
          return fail('entity');
        if (kind !== 'body' && kind !== 'static' && kind !== 'character') return fail('kind');
        if (sensor !== 0 && sensor !== 1) return fail('sensor');
        const body = bodyHex === '' ? null : hexToHandle(bodyHex);
        const collider = colliderHex === '' ? null : hexToHandle(colliderHex);
        if ((bodyHex !== '' && body === null) || (colliderHex !== '' && collider === null)) return fail('handle');
        const bk = bodyKind === '' ? null : bodyKind;
        if (bk !== null && bk !== 'dynamic' && bk !== 'kinematic' && bk !== 'fixed') return fail('body kind');
        if ((kind === 'static') !== (body === null) || (kind !== 'body' && collider === null))
          return fail('shape of record');
        if ((body === null) !== (bk === null) || (kind === 'character' && bk !== 'kinematic')) return fail('body kind');
        if ((body !== null && bodyHandles.has(body)) || (collider !== null && colliderHandles.has(collider)))
          return fail('duplicate handle');
        if (body !== null) bodyHandles.add(body);
        if (collider !== null) colliderHandles.add(collider);
        seen.add(entity as number);
        if (body !== null) bodies++;
        if (collider !== null) colliders++;
        if (kind === 'character') characters++;
        next.push({entity: entity as number, kind, body, collider, sensor: sensor === 1, bodyKind: bk});
      }
      if (bodies > limits.maxBodies || colliders > limits.maxColliders || characters > limits.maxCharacters)
        return fail('limits');
      const bytes = base64ToBytes(p.world);
      if (!bytes) return fail('world encoding');
      let restored: RWorld | null = null;
      try {
        restored = R.World.restoreSnapshot(bytes) ?? null;
      } catch {
        restored = null;
      }
      if (!restored) return fail('world bytes');
      const candidate = restored;
      const reject = (reason: string): RestoreResult => {
        candidate.free();
        released.worlds++;
        return fail(reason);
      };
      // The restored world must hold exactly the recorded objects, with this owner's configuration.
      if (candidate.bodies.len() !== bodies || candidate.colliders.len() !== colliders) return reject('object count');
      for (const r of next) {
        if (r.body !== null && !candidate.bodies.contains(r.body)) return reject('missing body');
        if (r.collider !== null && !candidate.colliders.contains(r.collider)) return reject('missing collider');
        const c = r.collider === null ? null : candidate.getCollider(r.collider);
        // The raw parent query: in 0.21.0 a deserialised world's `Collider.parent()` reports a body even for a
        // parentless collider, so the wrapper cannot be trusted here.
        const parent = r.collider === null ? undefined : candidate.colliders.raw.coParent(r.collider);
        if (r.body !== null && c && parent !== r.body) return reject('collider parent');
        if (r.kind === 'static' && parent !== undefined) return reject('collider parent');
        if (c && c.isSensor() !== r.sensor) return reject('sensor');
        if (r.body !== null) {
          const type = candidate.getRigidBody(r.body).bodyType();
          const want =
            r.bodyKind === 'dynamic'
              ? R.RigidBodyType.Dynamic
              : r.bodyKind === 'fixed'
                ? R.RigidBodyType.Fixed
                : R.RigidBodyType.KinematicPositionBased;
          if (type !== want) return reject('body type');
        }
      }
      if (
        candidate.timestep !== Math.fround(config.step) ||
        candidate.numSolverIterations !== config.solverIterations ||
        candidate.gravity.x !== Math.fround(config.gravity.x) ||
        candidate.gravity.y !== Math.fround(config.gravity.y) ||
        candidate.gravity.z !== Math.fround(config.gravity.z)
      )
        return reject('configuration');
      // Commit: release the old world and controllers, adopt the new world and mapping atomically.
      freeAllControllers();
      world.free();
      released.worlds++;
      world = candidate;
      queue?.clear();
      records.clear();
      byCollider.clear();
      for (const r of next) {
        records.set(r.entity, r);
        if (r.collider !== null) byCollider.set(r.collider, r);
      }
      refusedNow = new Map(); // refusals are re-evaluated against the restored mapping at the next sync
      bodyCount = bodies;
      colliderCount = colliders;
      characterCount = characters;
      tickCount = p.tick as number;
      lastEvents = Object.freeze({tick: tickCount, list: EMPTY, dropped: 0, unmapped: 0});
      return Object.freeze({status: 'restored', tick: tickCount, bodies, colliders});
    },
    debugLines() {
      const w = live();
      if (!w) return null;
      const buffers = w.debugRender();
      const total = Math.floor(buffers.vertices.length / 3);
      const count = Math.min(total, limits.maxDebugVertices - (limits.maxDebugVertices % 2));
      return Object.freeze({
        vertices: buffers.vertices.subarray(0, count * 3),
        colors: buffers.colors.subarray(0, count * 4),
        vertexCount: count,
        total,
        truncated: count < total,
      });
    },
    status() {
      const refused = Object.fromEntries(REASONS.map(r => [r, 0])) as Record<RefusalReason, number>;
      for (const reason of refusedNow.values()) refused[reason]++;
      return Object.freeze({
        state: world ? 'running' : 'disposed',
        tick: tickCount,
        bodies: bodyCount,
        colliders: colliderCount,
        characters: characterCount,
        refused: Object.freeze(refused),
        refusals,
        droppedEvents,
        unmappedEvents,
        skippedPoses,
        released: Object.freeze({...released}),
      });
    },
    dispose() {
      if (!world) return;
      freeAllControllers();
      queue?.free();
      released.queues++;
      queue = null;
      world.free();
      released.worlds++;
      world = null;
      records.clear();
      byCollider.clear();
      refusedNow = new Map();
      ecs = null;
      lastEvents = Object.freeze({tick: tickCount, list: EMPTY, dropped: 0, unmapped: 0});
    },
  };

  return owner;
}
