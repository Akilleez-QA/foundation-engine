/**
 * author/shadow-casting.ts: creator shadows (VIS-03), as plain data. A scene opts in with
 * `defineScene({ shadows: sceneShadows({ cast: 'all-shapes', receive: 'all' }) })`; lights opt in one by one
 * (`defineEnvironment({ directional: { …, shadow: { extent } } })`, `PointLight({ shadow: true })`,
 * `SpotLight({ shadow: true })`), and an entity overrides the scene default with `Shadow({ cast, receive })`.
 * No three.js here: the renderer side is the scene runtime (mesh flags), scene-environment.ts (the sun) and
 * scene-light-rig.ts (local lights), all drawn through the platform shadow scheduler, which redraws a map only when a
 * caster or its light changed (STD-REN-12, STD-REN-13).
 */
import {component, type ComponentType} from '../core/ecs/world';

export interface ShadowData {
  /** This entity's shape or mesh casts a shadow. */
  cast: boolean;
  /** Shadows fall on this entity's shape or mesh. */
  receive: boolean;
}
const base = component<ShadowData>('shadow', {cast: true, receive: true});
/** Per-entity override of the scene's shadow defaults: `Shadow({ cast: false })` for grass that should not darken. */
export const Shadow: ComponentType<ShadowData> = Object.assign(
  (input: Partial<ShadowData> = {}) => {
    const value: ShadowData = {cast: true, receive: true, ...input};
    if (typeof value.cast !== 'boolean' || typeof value.receive !== 'boolean')
      throw Error('Shadow: cast and receive must be booleans');
    return {type: Shadow, value};
  },
  {id: base.id, initial: base.initial},
);

/** Which entities cast and receive without a `Shadow` component: every `Shape` and `Mesh` entity, or none. */
export interface SceneShadowDefaults {
  cast: 'all-shapes' | 'none';
  receive: 'all' | 'none';
}
export interface SceneShadows {
  readonly kind: 'scene-shadows';
  readonly defaults: Readonly<SceneShadowDefaults>;
}
/** Opt a scene into shadows. Without it nothing casts or receives, and shadow requests on lights are reported once. */
export function sceneShadows(defaults: Partial<SceneShadowDefaults> = {}): SceneShadows {
  const cast = defaults.cast ?? 'all-shapes',
    receive = defaults.receive ?? 'all';
  if (cast !== 'all-shapes' && cast !== 'none') throw Error("shadows: cast must be 'all-shapes' or 'none'");
  if (receive !== 'all' && receive !== 'none') throw Error("shadows: receive must be 'all' or 'none'");
  return Object.freeze({kind: 'scene-shadows' as const, defaults: Object.freeze({cast, receive})});
}

/** Whether an entity's drawn shape casts and receives, from its `Shadow` override or the scene's defaults. */
export function shadowFlags(
  scene: SceneShadows | undefined,
  own: ShadowData | undefined,
): {cast: boolean; receive: boolean} {
  if (!scene) return {cast: false, receive: false};
  return {
    cast: own?.cast ?? scene.defaults.cast === 'all-shapes',
    receive: own?.receive ?? scene.defaults.receive === 'all',
  };
}

/** The `lights.shadowed-max` knob's preset values: local (point and spot) lights that may cast shadows in a visit. */
export const SHADOWED_LIGHT_CAPS = Object.freeze({reference: 4, high: 2, medium: 1, low: 0} as const);
export type ShadowedLightCap = 0 | 1 | 2 | 4;
/** Local shadow map sizes. A point light's map holds 6 faces (three packs them into a 4 × 2 atlas, so 512 is a
 *  2048 × 1024 map), so points stay at 512; a spot draws one face: 1024 at reference, 512 below. */
export const localShadowMapSize = (cap: number): {point: 512; spot: 512 | 1024} => ({
  point: 512,
  spot: cap >= SHADOWED_LIGHT_CAPS.reference ? 1024 : 512,
});
/** The sun's requested map; `shadows.quality` clamps it (low and medium presets: 1024 or 2048). */
export const SUN_SHADOW_MAP = 2048;
