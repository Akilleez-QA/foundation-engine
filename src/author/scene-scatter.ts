/**
 * author/scene-scatter.ts: the visit's `Scatter` drawing, a lazy chunk loaded only by scenes that opt in with
 * `sceneScatter()` (author/scatter.ts; placement and admission in author/scatter-field.ts).
 *
 * Each admitted scatter is one `InstancedMesh` from the batching layer (`instanceStatic`): one draw, its triangles times
 * its kept copies. Geometry is a shared primitive lease (a `shape`) or the scatter's own indexed geometry (a `mesh`); the
 * surface comes from the visit's surfaces, so a `Material` on the entity shades every copy. The instance buffers are
 * written once: moving the entity's `Transform` moves the whole scatter without touching them, and a change of the
 * scatter's data (or its `Material` class) rebuilds once. Removing the component or the entity, or leaving the scene,
 * disposes the instance buffers, returns the geometry lease and releases the surface.
 */
import * as T from 'three';
import type {Entity, World} from '../core/ecs/world';
import {instanceStatic} from '../platform/render/batching/instance';
import {Name, Transform} from './defs';
import {Material, materialKey, type MaterialData} from './material';
import {Scatter, validateScatter, type ScatterData, type SceneScatterLimits} from './scatter';
import {createScatterAdmission, placeScatter, type ScatterStats} from './scatter-field';
import {indexedGeometry} from './indexed-geometry';
import type {PrimitiveGeometryLease} from './primitive-geometries';
import type {SceneSurfaces, Surface} from './scene-materials';
import type {createSceneResources} from './scene-resources';
import {retireRepresentations} from './representation-cleanup';

type Resources = ReturnType<typeof createSceneResources>;

export interface SceneScatterOptions {
  world: World;
  scene: T.Scene;
  limits: Readonly<SceneScatterLimits>;
  /** `scatterRoot(scene id, ?seed)`. */
  root: number;
  /** The `effects.scatter-density` knob, read once per visit. */
  density: number;
  surfaces: Pick<SceneSurfaces, 'create'>;
  geometries: {acquire(kind: string, size: readonly [number, number, number]): PrimitiveGeometryLease};
  resources: Resources;
  mask(entity: Entity): number;
  report(error: unknown): void;
}

export interface ScatterEntry {
  name: string;
  instances: number;
  requested: number;
  triangles: number;
}

export interface SceneScatterDrawing {
  /** Reconcile with the world; true when the picture changed. */
  sync(): boolean;
  readonly stats: ScatterStats & {draws: number; triangles: number; list: ScatterEntry[]};
  dispose(): void;
}

interface Slot {
  /** The data and look this slot was built from (rebuilt when either changes). */
  data: ScatterData;
  build: string;
  mesh: T.InstancedMesh | null;
  geometry: PrimitiveGeometryLease | {geometry: T.BufferGeometry; release(): void} | null;
  surface: Surface | null;
  sig: string;
  entry: ScatterEntry;
}

const trianglesOf = (g: T.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

export function createSceneScatter(o: SceneScatterOptions): SceneScatterDrawing {
  const report = (error: unknown) => {
    try {
      o.report(error);
    } catch {
      /* Diagnostics cannot strand cleanup. */
    }
  };
  const admission = createScatterAdmission<Entity>(o.limits, report);
  const slots = new Map<Entity, Slot>();
  /** Entities refused for the data they had then; offered again when it changes or capacity frees. */
  const refused = new Map<Entity, ScatterData>();
  let closed = false,
    retry = false;
  const stats = Object.assign(admission.stats, {draws: 0, triangles: 0, list: [] as ScatterEntry[]});
  const tally = () => {
    let draws = 0,
      triangles = 0;
    const list: ScatterEntry[] = [];
    for (const s of slots.values()) {
      if (!s.mesh) continue;
      if (s.mesh.visible) {
        draws++;
        triangles += s.entry.triangles;
      }
      list.push(s.entry);
    }
    stats.draws = draws;
    stats.triangles = triangles;
    stats.list = list;
  };

  const teardown = (slot: Slot) => {
    const mesh = slot.mesh,
      geometry = slot.geometry,
      surface = slot.surface;
    slot.mesh = null;
    slot.geometry = null;
    slot.surface = null;
    retireRepresentations(o.scene, mesh ? [mesh] : [], [
      () => mesh?.dispose(),
      () => geometry?.release(),
      () => surface?.dispose(),
    ]);
  };
  const retire = (e: Entity) => {
    const slot = slots.get(e);
    if (!slot) return false;
    slots.delete(e);
    admission.release(e);
    teardown(slot);
    return true;
  };

  /** Build (or rebuild) the drawing of `e`; false when refused. */
  const build = (e: Entity, data: ScatterData, look: MaterialData | undefined, buildKey: string): boolean => {
    const placed = placeScatter(data, o.root, o.density);
    if (!admission.admit(e, placed.count, placed.requested)) {
      if (slots.has(e)) {
        const slot = slots.get(e)!;
        slots.delete(e);
        teardown(slot);
      }
      refused.set(e, data);
      return false;
    }
    refused.delete(e);
    const previous = slots.get(e);
    let geometry: Slot['geometry'] = null,
      surface: Surface | null = null,
      mesh: T.InstancedMesh | null = null;
    try {
      if (data.shape) geometry = o.geometries.acquire(data.shape.kind, data.shape.size);
      else {
        const g = indexedGeometry(data.mesh!, o.resources);
        geometry = {geometry: g, release: () => o.resources.release(g)};
      }
      const colors = !!data.mesh?.colors.length;
      surface = o.surfaces.create(look, placed.colors ? 0xffffff : data.color, {
        colors,
        uv: !!data.shape,
      });
      if (placed.count) {
        mesh = instanceStatic(geometry.geometry, surface.material, placed);
        mesh.name = o.world.get(e, Name)?.name ?? `scatter${e}`;
        o.scene.add(mesh);
      }
    } catch (error) {
      admission.release(e);
      for (const cleanup of [
        () => mesh?.removeFromParent(),
        () => mesh?.dispose(),
        () => geometry?.release(),
        () => surface?.dispose(),
      ])
        try {
          cleanup();
        } catch (e2) {
          report(e2);
        }
      throw error;
    }
    const slot: Slot = {
      data,
      build: buildKey,
      mesh,
      geometry,
      surface,
      sig: '',
      entry: {
        name: mesh?.name ?? `scatter${e}`,
        instances: placed.count,
        requested: placed.requested,
        triangles: trianglesOf(geometry.geometry) * placed.count,
      },
    };
    slots.set(e, slot);
    if (previous) teardown(previous);
    return true;
  };

  return {
    stats,
    sync() {
      if (closed) return false;
      let changed = false;
      const seen = new Set<Entity>();
      const offered: [Entity, ScatterData][] = [];
      for (const [e, data] of o.world.query(Scatter)) if (o.world.has(e, Transform)) offered.push([e, data]);
      // Essential scatters are offered first, then in entity order: admission is deterministic.
      offered.sort(([a, x], [b, y]) => Number(y.essential) - Number(x.essential) || a - b);
      for (const e of slots.keys()) if (!offered.some(([x]) => x === e)) changed = retire(e) || changed;
      for (const e of [...refused.keys()]) if (!offered.some(([x]) => x === e)) refused.delete(e);
      let freed = changed || retry,
        releasedLater = false;
      retry = false;
      for (const [e, data] of offered) {
        seen.add(e);
        const look = o.world.get(e, Material),
          slot = slots.get(e);
        // The data object, or its look's class, decides a rebuild; plain look fields change in place below.
        const buildKey = look ? look.shading : '';
        const fresh = !slot || slot.data !== data || slot.build !== buildKey;
        if (fresh) {
          if (!slot && refused.get(e) === data && !freed) continue;
          try {
            validateScatter(data);
          } catch (error) {
            if (slot) {
              changed = retire(e) || changed;
              freed = true;
              releasedLater = true;
            }
            if (refused.get(e) !== data) admission.invalid(error);
            refused.set(e, data);
            continue;
          }
          try {
            const had = !!slot;
            if (build(e, data, look, buildKey)) changed = true;
            else if (had) {
              changed = true;
              freed = true;
              releasedLater = true;
            }
          } catch (error) {
            report(error);
            refused.set(e, data);
          }
          if (closed) return changed;
        }
        const s = slots.get(e);
        if (!s) continue;
        const lookKey = look ? materialKey(look) : '';
        if (s.surface && s.surface.key !== lookKey && s.surface.update(look)) changed = true;
        else if (s.surface && s.surface.key !== lookKey) {
          // Invalid look data: one plain surface for the same instance buffers (reported by the surfaces).
          const previous = s.surface;
          s.surface = o.surfaces.create(look, s.data.colorJitter.some(j => j > 0) ? 0xffffff : s.data.color, {
            colors: !!s.data.mesh?.colors.length,
            uv: !!s.data.shape,
          });
          if (s.mesh) s.mesh.material = s.surface.material;
          previous.dispose();
          changed = true;
        }
        const tr = o.world.get(e, Transform)!;
        const mask = o.mask(e);
        const sig = `${tr.x},${tr.y},${tr.z},${tr.rx},${tr.ry},${tr.rz},${tr.scale},${data.visible},${mask}`;
        if (s.mesh && s.sig !== sig) {
          s.mesh.position.set(tr.x, tr.y, tr.z);
          s.mesh.rotation.set(tr.rx, tr.ry, tr.rz);
          s.mesh.scale.setScalar(tr.scale);
          s.mesh.visible = data.visible;
          s.mesh.layers.mask = mask;
          s.sig = sig;
          changed = true;
        }
      }
      // Capacity freed during this pass is offered to scatters refused earlier in it on the next pass.
      if (releasedLater) retry = refused.size > 0;
      if (changed) tally();
      return changed;
    },
    dispose() {
      if (closed) return;
      closed = true;
      const errors: unknown[] = [];
      for (const e of [...slots.keys()])
        try {
          retire(e);
        } catch (error) {
          errors.push(error);
        }
      refused.clear();
      tally();
      if (errors.length) throw new AggregateError(errors, 'scatter cleanup failed');
    },
  };
}
