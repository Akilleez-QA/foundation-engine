/**
 * author/scene-light-rig.ts: a visit's local-light slots as three.js lights (VIS-02). Built once when the visit starts,
 * with the slot counts light-slots.ts decided (scene request capped by the `lights.local-max` knob), through the
 * platform's fixed light rig (platform/render/light-rig.ts). The rig never grows or shrinks during the visit, so no lit
 * program recompiles when a light is spawned or despawned (STD-REN-11): an empty slot is a light at intensity 0, never
 * a removed or hidden one (a hidden light changes the light count three compiles into programs).
 *
 * Each frame `apply` copies the slot holders' data and `Transform` onto their slots, and reports whether anything
 * changed, so a still scene draws nothing (STD-RUN-9).
 *
 * Shadows (VIS-03): the first `shadowed` slots of each kind cast shadows for the whole visit, through the platform
 * rig's live shadow map (`shadows.quality` clamps its size; `off` stops it) and the shadow scheduler, which redraws a map
 * only when a caster or its light changed (STD-REN-12, STD-REN-13). `createSunShadow` gives the environment's sun its
 * shadow the same way. This module is a lazy chunk: only scenes with `sceneLights()` or `sceneShadows()` load it.
 */
import * as T from 'three';
import type {World} from '../core/ecs/world';
import {createLightRig, type LightDef} from '../platform/render/light-rig';
import {liveShadowMap, type LiveShadowMap} from '../platform/render/quality-runtime';
import {scheduleShadows} from '../platform/render/shadows';
import type {ShadowMapRequest} from '../platform/render/quality';
import {Transform} from './defs';
import {pointLightKey, spotLightKey, type SceneLightLimits} from './lights';
import type {LightSlots} from './light-slots';

const forward = new T.Vector3(),
  euler = new T.Euler();

/** Local shadow defaults: a light with `distance` 0 still needs a far plane for its shadow camera. */
const LOCAL_SHADOW = {bias: -0.002, normalBias: 0.02, camera: {near: 0.1, far: 40}} as const;

export function createSceneLightRig(
  scene: T.Scene,
  slots: SceneLightLimits,
  shadows?: {
    shadowed: SceneLightLimits;
    mapSize: {point: ShadowMapRequest; spot: ShadowMapRequest};
    renderer: T.WebGLRenderer;
  },
) {
  const rows: Record<string, LightDef> = {};
  const shadow = (kind: 'point' | 'spot', i: number) =>
    shadows && i < shadows.shadowed[kind] ? {shadow: {...LOCAL_SHADOW, mapSize: shadows.mapSize[kind]}} : {};
  for (let i = 0; i < slots.point; i++)
    rows[`p${i}`] = {kind: 'point', color: 0xffffff, intensity: 0, distance: 0, decay: 2, ...shadow('point', i)};
  for (let i = 0; i < slots.spot; i++)
    rows[`s${i}`] = {
      kind: 'spot',
      color: 0xffffff,
      intensity: 0,
      distance: 0,
      angle: Math.PI / 3,
      penumbra: 0,
      decay: 2,
      ...shadow('spot', i),
    };
  const rig = createLightRig(rows, shadows?.renderer);
  const points: T.PointLight[] = [],
    spots: T.SpotLight[] = [];
  for (let i = 0; i < slots.point; i++) points.push(rig.lights[`p${i}`] as T.PointLight);
  for (let i = 0; i < slots.spot; i++) spots.push(rig.lights[`s${i}`] as T.SpotLight);
  for (const light of points) scene.add(light);
  // A spot's target must be in the scene so its world matrix follows its position.
  for (const light of spots) scene.add(light, light.target);
  const pointSig: string[] = points.map(() => ''),
    spotSig: string[] = spots.map(() => '');
  let disposed = false;
  return {
    /** The visit's lights, for tests and the dev handle: fixed for the visit. */
    lights: {points, spots} as const,
    /** Copy this frame's slot holders onto the rig; true when anything drawn changed. */
    apply(world: World, holders: LightSlots): boolean {
      if (disposed) return false;
      let changed = false;
      for (let i = 0; i < points.length; i++) {
        const light = points[i]!,
          held = holders.point(world, i),
          tr = held ? world.get(held.entity, Transform) : undefined;
        const sig = held && tr ? `${held.entity}|${tr.x},${tr.y},${tr.z}|${pointLightKey(held.data)}` : '';
        if (sig === pointSig[i]) continue;
        pointSig[i] = sig;
        changed = true;
        if (!held || !tr) {
          light.intensity = 0;
          continue;
        }
        const d = held.data;
        light.position.set(tr.x, tr.y, tr.z);
        light.color.setHex(d.color);
        light.intensity = d.visible ? d.intensity : 0;
        light.distance = d.distance;
        light.decay = d.decay;
      }
      for (let i = 0; i < spots.length; i++) {
        const light = spots[i]!,
          held = holders.spot(world, i),
          tr = held ? world.get(held.entity, Transform) : undefined;
        const sig =
          held && tr
            ? `${held.entity}|${tr.x},${tr.y},${tr.z},${tr.rx},${tr.ry},${tr.rz}|${spotLightKey(held.data)}`
            : '';
        if (sig === spotSig[i]) continue;
        spotSig[i] = sig;
        changed = true;
        if (!held || !tr) {
          light.intensity = 0;
          continue;
        }
        const d = held.data;
        light.position.set(tr.x, tr.y, tr.z);
        if (d.target) light.target.position.set(...d.target);
        else {
          forward.set(0, 0, -1).applyEuler(euler.set(tr.rx, tr.ry, tr.rz));
          light.target.position.set(tr.x + forward.x, tr.y + forward.y, tr.z + forward.z);
        }
        light.color.setHex(d.color);
        light.intensity = d.visible ? d.intensity : 0;
        light.distance = d.distance;
        light.decay = d.decay;
        light.angle = d.angle;
        light.penumbra = d.penumbra;
      }
      return changed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rig.dispose();
    },
  };
}

/** The environment's sun shadow (`defineEnvironment({ directional: { shadow } })`), owned by the visit. */
export interface SunShadowSpec {
  /** Half-size in metres of the square around the world origin that receives sun shadows. */
  extent: number;
  softness: 'hard' | 'soft';
}
export function createSunShadow(renderer: T.WebGLRenderer, mapSize: ShadowMapRequest) {
  let live: LiveShadowMap | null = null,
    last = '';
  const direction = new T.Vector3();
  return {
    /** Shadow on (with `spec`) or off (null) for `light`, the sun whose authored direction is `position`. True when
     *  anything drawn changed. Turning the shadow on or off recompiles lit materials once; resizing does not. */
    apply(light: T.DirectionalLight, spec: SunShadowSpec | null, position: readonly [number, number, number]): boolean {
      // The light keeps its authored direction; it sits 2 × extent from the origin so the shadow box (±extent,
      // 4 × extent deep) holds everything within `extent` of the origin. The environment re-sets the authored
      // position on every change, so this runs whenever it is called.
      if (spec) {
        direction.set(position[0], position[1], position[2]).normalize();
        light.position.copy(direction).multiplyScalar(spec.extent * 2);
      }
      const key = spec ? `${spec.extent}|${spec.softness}` : '';
      if (key === last) return false;
      last = key;
      if (!spec) {
        if (!live) return true;
        live.dispose();
        live = null;
        light.castShadow = false;
        light.shadow.map?.dispose();
        light.shadow.map = null;
        return true;
      }
      const camera = light.shadow.camera;
      camera.left = camera.bottom = -spec.extent;
      camera.right = camera.top = spec.extent;
      camera.near = 0.5;
      camera.far = spec.extent * 4;
      camera.updateProjectionMatrix();
      light.shadow.bias = -0.0005;
      light.shadow.normalBias = 0.02;
      light.shadow.radius = spec.softness === 'soft' ? 3 : 1;
      if (!live) {
        light.castShadow = true;
        scheduleShadows(renderer);
        live = liveShadowMap(light, mapSize, renderer);
      }
      return true;
    },
    dispose() {
      live?.dispose();
      live = null;
    },
  };
}
export type SunShadow = ReturnType<typeof createSunShadow>;
