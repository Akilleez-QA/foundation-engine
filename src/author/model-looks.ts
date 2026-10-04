/**
 * author/model-looks.ts: a `Material` on a `Model` entity, drawn over the model's own glTF materials.
 *
 * A model brings its own materials (shared by every instance of the asset, owned by the model library). A `Material`
 * on the entity overrides them for that instance only, never the shared template:
 *  - a field left at its default keeps the model's own value, so `defineMaterial({ emissive: 0xff8800 })` makes a
 *    model glow without flattening its authored roughness, colours or textures;
 *  - `shading: 'matte'` or `'toon'` redraws every part in that class (keeping its colour, maps, emission, opacity and
 *    side); 'flat' facets the model's own materials;
 *  - `texture`, `repeat` and `wrap` are not applied (a model keeps its own textures): naming a texture is reported once.
 *
 * Ownership: one override material per (source material, look) for the whole visit, shared by every instance and
 * entity that shows the same look on the same asset, counted and released with its last user (the visit's resources
 * dispose whatever is left on exit). Textures stay the model library's: an override borrows them, never disposes them.
 * The number of materials is bounded by the model's own material count times the looks in use.
 */
import * as T from 'three';
import type {Entity, World} from '../core/ecs/world';
import {Material, materialKey, validateMaterial, type MaterialData} from './material';
import type {SceneSurfaces, ToonGradient} from './scene-materials';

type Resources = {own<R extends {dispose(): void}>(resource: R): R; release(resource: {dispose(): void}): void};

export interface ModelLooks {
  /** Show `entity`'s `Material` (or none) on its model `instance`; true when the drawn look changed. */
  sync(entity: Entity, instance: T.Object3D): boolean;
  /** The entity's instance is going: restore its own materials and let go of the overrides. */
  release(entity: Entity): void;
  /** Override materials alive now (for tests and diagnostics). */
  readonly stats: {readonly materials: number};
}

interface Shown {
  instance: T.Object3D;
  key: string;
  originals: Map<T.Mesh, T.Material | T.Material[]>;
  held: string[];
  reported: boolean;
}

interface Override {
  material: T.Material;
  refs: number;
  gradient: ToonGradient | null;
}

type Lit = T.Material & {
  color?: T.Color;
  emissive?: T.Color;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  flatShading?: boolean;
};

/** The material-specific maps worth carrying across a class change; anything else falls back to the class default. */
const CARRIED = ['map', 'alphaMap', 'aoMap', 'lightMap', 'emissiveMap', 'normalMap', 'bumpMap'] as const;

function convert(source: T.Material, into: T.MeshLambertMaterial | T.MeshToonMaterial): T.Material {
  T.Material.prototype.copy.call(into, source); // side, opacity, transparency, cutout, blending, vertex colours
  const from = source as Lit & Partial<Record<(typeof CARRIED)[number], T.Texture | null>>,
    to: Partial<Record<(typeof CARRIED)[number], T.Texture | null>> = into;
  if (from.color) into.color.copy(from.color);
  if (from.emissive) into.emissive.copy(from.emissive);
  if (from.emissiveIntensity !== undefined) into.emissiveIntensity = from.emissiveIntensity;
  for (const slot of CARRIED) if (from[slot]) to[slot] = from[slot];
  return into;
}

export function createModelLooks(o: {
  world: World;
  surfaces: Pick<SceneSurfaces, 'toon'>;
  resources: Resources;
  report(error: unknown): void;
}): ModelLooks {
  const shown = new Map<Entity, Shown>();
  const overrides = new Map<string, Override>();
  const stats = {materials: 0};
  const report = (error: unknown) => {
    try {
      o.report(error);
    } catch {
      /* Diagnostics cannot strand cleanup. */
    }
  };

  const build = (source: T.Material, d: MaterialData): Override => {
    let gradient: ToonGradient | null = null;
    let material: Lit;
    if (d.shading === 'matte') material = convert(source, new T.MeshLambertMaterial());
    else if (d.shading === 'toon') {
      const toon = new T.MeshToonMaterial();
      convert(source, toon);
      gradient = o.surfaces.toon(d.toonSteps);
      toon.gradientMap = gradient.texture;
      material = toon;
    } else material = source.clone();
    material.userData = {}; // not the library's shared material: this visit owns and disposes it
    if (d.shading === 'flat' && 'flatShading' in material) material.flatShading = true;
    if (material.emissive && d.emissive !== 0) {
      material.emissive.setHex(d.emissive);
      material.emissiveIntensity = d.emissiveIntensity;
    } else if (d.emissiveIntensity !== 1 && material.emissiveIntensity !== undefined)
      material.emissiveIntensity = d.emissiveIntensity;
    if (d.roughness !== 1 && material.roughness !== undefined) material.roughness = d.roughness;
    if (d.metalness !== 0 && material.metalness !== undefined) material.metalness = d.metalness;
    if (d.opacity !== 1) material.opacity = d.opacity;
    if (d.transparent) material.transparent = true;
    if (d.side === 'double') material.side = T.DoubleSide;
    if (d.alphaCutoff > 0) material.alphaTest = d.alphaCutoff;
    if (!d.vertexColors) material.vertexColors = false;
    material.needsUpdate = true;
    return {material: o.resources.own(material), refs: 0, gradient};
  };

  const acquire = (source: T.Material, d: MaterialData, key: string, held: string[]): T.Material => {
    const id = `${source.uuid}|${key}`;
    let entry = overrides.get(id);
    if (!entry) {
      entry = build(source, d);
      overrides.set(id, entry);
      stats.materials = overrides.size;
    }
    entry.refs++;
    held.push(id);
    return entry.material;
  };

  const restore = (state: Shown) => {
    const errors: unknown[] = [];
    for (const [mesh, original] of state.originals) mesh.material = original;
    state.originals.clear();
    for (const id of state.held.splice(0)) {
      const entry = overrides.get(id);
      if (!entry || --entry.refs > 0) continue;
      overrides.delete(id);
      stats.materials = overrides.size;
      try {
        o.resources.release(entry.material);
      } catch (error) {
        errors.push(error);
      }
      try {
        entry.gradient?.release();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'model look cleanup failed');
  };

  return {
    stats,
    sync(entity, instance) {
      const data = o.world.get(entity, Material);
      let state = shown.get(entity);
      let key = data ? materialKey(data) : '';
      if (state?.instance === instance && state.key === key) return false;
      if (data)
        try {
          validateMaterial(data);
        } catch (error) {
          if (state?.instance !== instance || state.key !== `invalid:${key}`) report(error);
          key = `invalid:${key}`;
        }
      if (state?.instance === instance && state.key === key) return false;
      const reported = state?.instance === instance && state.reported;
      if (state) restore(state);
      state = {instance, key, originals: new Map(), held: [], reported};
      shown.set(entity, state);
      if (!data || key.startsWith('invalid:')) return true;
      if (data.texture && !state.reported) {
        state.reported = true;
        report(Error(`material: texture '${data.texture}' is not drawn on a model: a model keeps its own textures`));
      }
      const s = state;
      instance.traverse(node => {
        const mesh = node as T.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const own = mesh.material;
        s.originals.set(mesh, own);
        mesh.material = Array.isArray(own)
          ? own.map(m => acquire(m, data, key, s.held))
          : acquire(own, data, key, s.held);
      });
      return true;
    },
    release(entity) {
      const state = shown.get(entity);
      if (!state) return;
      shown.delete(entity);
      restore(state);
    },
  };
}
