/**
 * author/scene-light-rig.ts: a visit's local-light slots as three.js lights (VIS-02). Built once when the visit starts,
 * with the slot counts light-slots.ts decided (scene request capped by the `lights.local-max` knob), through the
 * platform's fixed light rig (platform/render/light-rig.ts). The rig never grows or shrinks during the visit, so no lit
 * program recompiles when a light is spawned or despawned (STD-REN-11): an empty slot is a light at intensity 0, never
 * a removed or hidden one (a hidden light changes the light count three compiles into programs).
 *
 * Each frame `apply` copies the slot holders' data and `Transform` onto their slots, and reports whether anything
 * changed, so a still scene draws nothing (STD-RUN-9).
 */
import * as T from 'three';
import type {World} from '../core/ecs/world';
import {createLightRig, type LightDef} from '../platform/render/light-rig';
import {Transform} from './defs';
import {pointLightKey, spotLightKey, type SceneLightLimits} from './lights';
import type {LightSlots} from './light-slots';

const forward = new T.Vector3(),
  euler = new T.Euler();

export function createSceneLightRig(scene: T.Scene, slots: SceneLightLimits) {
  const rows: Record<string, LightDef> = {};
  for (let i = 0; i < slots.point; i++)
    rows[`p${i}`] = {kind: 'point', color: 0xffffff, intensity: 0, distance: 0, decay: 2};
  for (let i = 0; i < slots.spot; i++)
    rows[`s${i}`] = {
      kind: 'spot',
      color: 0xffffff,
      intensity: 0,
      distance: 0,
      angle: Math.PI / 3,
      penumbra: 0,
      decay: 2,
    };
  const rig = createLightRig(rows);
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
