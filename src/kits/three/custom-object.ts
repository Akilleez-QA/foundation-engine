/**
 * kits/three/custom-object.ts: `customObject({ create, update, dispose })` and the `ThreeObject` component, the
 * convenience path of `@kits/three` (README.md).
 *
 * An entity with `Transform` and `ThreeObject({ use: '<id>' })` in a scene with `sceneThree({ objects })` gets the
 * object that definition creates: created once when the entity is drawn first, placed by its Transform (position,
 * rotation, uniform scale) and render mask, updated in the frame phase by `update` (return true when the picture
 * changed), and disposed when the entity goes or the visit ends: `dispose`, then everything `own()` registered, then
 * every geometry, material and texture left in the object's tree.
 *
 * Bounds: at most `sceneThree({ max })` objects per scene (default 16); each object's tree must stay within its declared
 * `limits` (triangles and textures, checked after `create`). An object over a bound is refused, reported once, and
 * disposed; the entity stays undrawn. `update` gets no world and no scene context: an object cannot write game state.
 */
import * as THREE from 'three';
import {defineComponent, Transform} from '../../author';
import type {Entity, World} from '../../core/ecs/world';
import {disposeOwnedTree} from '../../platform/render/dispose-owned-tree';

/** Which custom object an entity shows: a `customObject` id listed in the scene's `sceneThree({ objects })`. */
export const ThreeObject = defineComponent('three-object', {use: ''});

export interface CustomObjectFrame {
  /** Seconds since the visit began, this frame's step, and Calm (reduced motion: skip decorative motion). */
  readonly t: number;
  readonly dt: number;
  readonly calm: boolean;
}
export interface CustomObjectContext {
  /** Dispose `resource` with the object, even if it was detached from the tree. Returns it. */
  own<D extends {dispose(): void}>(resource: D): D;
  /** The render backend that runs. */
  readonly backend: string;
}
export interface CustomObjectLimits {
  /** Triangles in the object's tree (default 20 000, at most 2 000 000). */
  triangles?: number;
  /** Distinct textures in the object's tree (default 8, at most 64). */
  textures?: number;
}
export interface CustomObjectInput<O extends THREE.Object3D = THREE.Object3D> {
  /** Kebab-case, unique in a scene. */
  id: string;
  limits?: CustomObjectLimits;
  /** Make the object (once per entity). */
  create(ctx: CustomObjectContext): O;
  /** Each frame: change the object; return true when the picture changed (otherwise nothing is redrawn). */
  update?(object: O, frame: CustomObjectFrame): boolean | void;
  /** Before the engine disposes the object's tree: release what the tree does not hold. */
  dispose?(object: O): void;
}
export interface CustomObject {
  readonly kind: 'custom-object';
  readonly id: string;
  readonly limits: Readonly<Required<CustomObjectLimits>>;
  readonly create: (ctx: CustomObjectContext) => THREE.Object3D;
  readonly update: ((object: THREE.Object3D, frame: CustomObjectFrame) => boolean | void) | undefined;
  readonly dispose: ((object: THREE.Object3D) => void) | undefined;
}

export const CUSTOM_OBJECT_LIMITS = Object.freeze({
  triangles: 20_000,
  trianglesCap: 2_000_000,
  textures: 8,
  texturesCap: 64,
  perScene: 16,
  perSceneCap: 256,
});

const ID = /^[a-z][a-z0-9-]*$/;
const count = (v: number | undefined, fallback: number, cap: number, what: string) => {
  const n = v ?? fallback;
  if (!Number.isInteger(n) || n < 0 || n > cap)
    throw Error(`customObject: ${what} must be an integer from 0 to ${cap}`);
  return n;
};

/** A custom object definition. Its functions own their three.js objects; the engine owns their lifetime. */
export function customObject<O extends THREE.Object3D>(input: CustomObjectInput<O>): CustomObject {
  if (!ID.test(input.id)) throw Error(`customObject: id must be kebab-case: ${JSON.stringify(input.id)}`);
  if (typeof input.create !== 'function') throw Error(`customObject ${input.id}: create must be a function`);
  for (const k of ['update', 'dispose'] as const)
    if (input[k] !== undefined && typeof input[k] !== 'function')
      throw Error(`customObject ${input.id}: ${k} must be a function`);
  return Object.freeze({
    kind: 'custom-object',
    id: input.id,
    limits: Object.freeze({
      triangles: count(
        input.limits?.triangles,
        CUSTOM_OBJECT_LIMITS.triangles,
        CUSTOM_OBJECT_LIMITS.trianglesCap,
        'limits.triangles',
      ),
      textures: count(
        input.limits?.textures,
        CUSTOM_OBJECT_LIMITS.textures,
        CUSTOM_OBJECT_LIMITS.texturesCap,
        'limits.textures',
      ),
    }),
    create: input.create as CustomObject['create'],
    update: input.update as CustomObject['update'],
    dispose: input.dispose as CustomObject['dispose'],
  });
}

/** Dispose the shadow maps of the lights in a tree (`disposeOwnedTree` releases geometries, materials and textures;
 *  a light's shadow map is its own render target). */
export function disposeLightShadows(root: THREE.Object3D) {
  const errors: unknown[] = [];
  root.traverse(o => {
    if (o instanceof THREE.Light && o.shadow?.map)
      try {
        o.shadow.dispose();
      } catch (error) {
        errors.push(error);
      }
  });
  if (errors.length) throw new AggregateError(errors, 'light shadow disposal failed');
}

/** Triangles and distinct textures in a tree (what `limits` bounds). */
export function measureTree(root: THREE.Object3D): {triangles: number; textures: number} {
  let triangles = 0;
  const textures = new Set<THREE.Texture>();
  root.traverse(o => {
    const m = o as Partial<THREE.Mesh> & {isMesh?: boolean; isInstancedMesh?: boolean; count?: number};
    if (m.isMesh && m.geometry) {
      const g = m.geometry,
        n = g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0);
      const range = Math.min(n, Number.isFinite(g.drawRange.count) ? g.drawRange.count : n);
      triangles += Math.floor(range / 3) * (m.isInstancedMesh ? (m.count ?? 1) : 1);
    }
    const mat = (o as Partial<THREE.Mesh>).material;
    for (const material of Array.isArray(mat) ? mat : mat ? [mat] : [])
      for (const v of Object.values(material)) if (v instanceof THREE.Texture) textures.add(v);
  });
  return {triangles, textures: textures.size};
}

export interface CustomObjectStats {
  admitted: number;
  refused: number;
  live: number;
  triangles: number;
  updates: number;
}

interface Slot {
  def: CustomObject;
  object: THREE.Object3D;
  owned: {dispose(): void}[];
  sig: string;
}

/** The definitions by id; throws on anything that is not a `customObject` or on a repeated id. */
export function customObjectsById(objects: readonly CustomObject[]): Map<string, CustomObject> {
  const defs = new Map<string, CustomObject>();
  for (const d of objects) {
    if (d?.kind !== 'custom-object') throw Error('sceneThree: objects takes customObject(...) definitions');
    if (defs.has(d.id)) throw Error(`sceneThree: custom object ${d.id} is listed twice`);
    defs.set(d.id, d);
  }
  return defs;
}

/** One visit's custom objects (the `sceneThree` session drives it). */
export function createCustomObjects(o: {
  world: World;
  root: THREE.Object3D;
  objects: readonly CustomObject[];
  max: number;
  backend: string;
  mask(entity: Entity): number;
  report(error: unknown): void;
}) {
  const defs = customObjectsById(o.objects);
  const slots = new Map<Entity, Slot>(),
    refused = new Set<Entity>(),
    reported = new Set<string>();
  const stats: CustomObjectStats = {admitted: 0, refused: 0, live: 0, triangles: 0, updates: 0};
  const once = (key: string, error: unknown) => {
    if (reported.has(key)) return;
    reported.add(key);
    o.report(error);
  };
  const release = (slot: Slot) => {
    const errors: unknown[] = [];
    slot.object.removeFromParent();
    for (const step of [
      () => slot.def.dispose?.(slot.object),
      ...slot.owned.reverse().map(r => () => r.dispose()),
      () => disposeLightShadows(slot.object),
      () => disposeOwnedTree(slot.object),
    ])
      try {
        step();
      } catch (error) {
        errors.push(error);
      }
    if (errors.length) o.report(new AggregateError(errors, `custom object ${slot.def.id}: cleanup failed`));
  };
  const refuse = (e: Entity, key: string, error: unknown) => {
    refused.add(e);
    stats.refused++;
    once(key, error);
  };
  const admit = (e: Entity, id: string): Slot | null => {
    const def = defs.get(id);
    if (!def) {
      refuse(e, `unknown:${id}`, Error(`ThreeObject use '${id}': no such customObject in sceneThree({ objects })`));
      return null;
    }
    if (slots.size >= o.max) {
      refuse(e, 'max', Error(`sceneThree: more than ${o.max} custom objects in the scene; the rest are not drawn`));
      return null;
    }
    const owned: {dispose(): void}[] = [];
    let object: THREE.Object3D;
    try {
      object = def.create({
        own: r => {
          owned.push(r);
          return r;
        },
        backend: o.backend,
      });
      if (!(object instanceof THREE.Object3D)) throw Error(`custom object ${id}: create must return a THREE.Object3D`);
    } catch (error) {
      for (const r of owned.reverse())
        try {
          r.dispose();
        } catch {
          /* The create failure is the report. */
        }
      refuse(e, `create:${id}`, error);
      return null;
    }
    const slot: Slot = {def, object, owned, sig: ''};
    const size = measureTree(object);
    if (size.triangles > def.limits.triangles || size.textures > def.limits.textures) {
      release(slot);
      refuse(
        e,
        `limits:${id}`,
        Error(
          `custom object ${id}: ${size.triangles} triangles and ${size.textures} textures exceed its limits (${def.limits.triangles}, ${def.limits.textures}); refused`,
        ),
      );
      return null;
    }
    stats.admitted++;
    stats.triangles += size.triangles;
    o.root.add(object);
    slots.set(e, slot);
    return slot;
  };
  return {
    stats: () => ({...stats, live: slots.size}),
    /** Any live object animates (has `update`): the scene keeps drawing frames. */
    busy: () => [...slots.values()].some(s => !!s.def.update),
    /** Place, update, admit and release. True when the picture changed. */
    sync(dt: number, time: {t: number; calm: boolean}): boolean {
      let changed = false;
      const seen = new Set<Entity>();
      for (const [e, tr, use] of o.world.query(Transform, ThreeObject)) {
        seen.add(e);
        if (refused.has(e)) continue;
        let slot = slots.get(e);
        if (!slot) {
          slot = admit(e, use.use) ?? undefined;
          if (!slot) continue;
          changed = true;
        }
        const mask = o.mask(e),
          sig = `${tr.x},${tr.y},${tr.z},${tr.rx},${tr.ry},${tr.rz},${tr.scale},${mask}`;
        if (sig !== slot.sig) {
          slot.object.position.set(tr.x, tr.y, tr.z);
          slot.object.rotation.set(tr.rx, tr.ry, tr.rz);
          slot.object.scale.setScalar(tr.scale);
          slot.object.traverse(c => {
            c.layers.mask = mask;
          });
          slot.sig = sig;
          changed = true;
        }
        if (dt > 0 && slot.def.update) {
          stats.updates++;
          try {
            if (slot.def.update(slot.object, {t: time.t, dt, calm: time.calm})) changed = true;
          } catch (error) {
            slots.delete(e);
            release(slot);
            refuse(e, `update:${slot.def.id}`, error);
            changed = true;
          }
        }
      }
      for (const [e, slot] of [...slots])
        if (!seen.has(e)) {
          slots.delete(e);
          release(slot);
          changed = true;
        }
      for (const e of [...refused]) if (!seen.has(e)) refused.delete(e);
      return changed;
    },
    dispose() {
      for (const slot of [...slots.values()].reverse()) release(slot);
      slots.clear();
      refused.clear();
    },
  };
}
