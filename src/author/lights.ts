/**
 * author/lights.ts: local lights (VIS-02). `PointLight` and `SpotLight` are components on an entity with a `Transform`;
 * a scene opts in with a fixed set of light slots, `defineScene({ lights: sceneLights({ point: 8, spot: 2 }) })`.
 * Plain data and validation only: no three.js here, so a game that never uses lights carries none of the light code.
 * The runtime side is light-slots.ts (admission, also run by `testScene`) and scene-light-rig.ts (the three.js lights).
 *
 *   [Transform({ x, y: 2.45, z }), PointLight({ color: 0xffa850, intensity: 6, distance: 8 })]
 *   [Transform({ y: 6, rx: -Math.PI / 2 }), SpotLight({ intensity: 20, distance: 14, angle: 0.5, penumbra: 0.4 })]
 *
 * Why slots: three.js compiles the number of lights into every lit material's program, so adding or removing a light
 * recompiles them all (STD-REN-11). A scene's slots are created once per visit; an entity's light claims a free slot
 * and gives it back when it is despawned, and an empty slot is a light at intensity 0. A light that finds no free slot
 * is refused and reported once per cause.
 */
import {component, type ComponentType} from '../core/ecs/world';

type Vec3 = [x: number, y: number, z: number];

/** Validation bounds: data errors, not performance allowances (the scene's budgets still apply). */
export const LIGHT_LIMITS = Object.freeze({
  /** Candela for a point or spot light (three.js physical units). */
  intensity: 1000,
  /** Metres; 0 means the light never cuts off. */
  distance: 50,
  decay: 4,
  /** Hard caps of slots per scene, for `sceneLights`. */
  point: 16,
  spot: 4,
});

export interface PointLightData {
  /** 24-bit sRGB. */
  color: number;
  /** Candela, 0…{@link LIGHT_LIMITS.intensity}. */
  intensity: number;
  /** Where the light cuts off, in metres (0…{@link LIGHT_LIMITS.distance}); 0 never cuts off. */
  distance: number;
  /** How fast it fades with distance (0…{@link LIGHT_LIMITS.decay}); 2 is physically correct. */
  decay: number;
  /** Admitted before lights that are not essential, and kept on lighter quality presets first. */
  essential: boolean;
  /** False keeps the slot but gives no light (intensity 0, no recompile). */
  visible: boolean;
  /** Ask for a shadow (VIS-03): honoured in a scene with `sceneShadows()` while a shadowed slot is free (the
   *  `lights.shadowed-max` knob bounds them). Read when the light is admitted to a slot. */
  shadow: boolean;
}
export interface SpotLightData extends PointLightData {
  /** Half-angle of the cone in radians, (0, π/2]. */
  angle: number;
  /** Soft edge, 0 (hard) … 1 (soft from the centre). */
  penumbra: number;
  /** A world point to aim at; null aims along the entity's forward axis (−z rotated by its `Transform`). */
  target: Vec3 | null;
}

export const POINT_LIGHT_DEFAULTS: Readonly<PointLightData> = Object.freeze({
  color: 0xffffff,
  intensity: 1,
  distance: 0,
  decay: 2,
  essential: false,
  visible: true,
  shadow: false,
});
export const SPOT_LIGHT_DEFAULTS: Readonly<SpotLightData> = Object.freeze({
  ...POINT_LIGHT_DEFAULTS,
  angle: Math.PI / 3,
  penumbra: 0,
  target: null,
});

const fail = (kind: string, reason: string): never => {
  throw Error(`${kind}: ${reason}`);
};
const within = (n: unknown, min: number, max: number) =>
  typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;

function checkPoint(kind: string, d: PointLightData): void {
  if (!(Number.isInteger(d.color) && d.color >= 0 && d.color <= 0xffffff))
    fail(kind, 'color must be a 24-bit RGB number');
  if (!within(d.intensity, 0, LIGHT_LIMITS.intensity))
    fail(kind, `intensity must be in [0, ${LIGHT_LIMITS.intensity}] candela`);
  if (!within(d.distance, 0, LIGHT_LIMITS.distance))
    fail(kind, `distance must be in [0, ${LIGHT_LIMITS.distance}] metres (0 never cuts off)`);
  if (!within(d.decay, 0, LIGHT_LIMITS.decay)) fail(kind, `decay must be in [0, ${LIGHT_LIMITS.decay}]`);
  if (typeof d.essential !== 'boolean') fail(kind, 'essential must be a boolean');
  if (typeof d.visible !== 'boolean') fail(kind, 'visible must be a boolean');
  if (typeof d.shadow !== 'boolean') fail(kind, 'shadow must be a boolean');
}
/** Throws, naming the field, on point-light data the renderer would not draw as written. */
export function validatePointLight(d: PointLightData): void {
  if (typeof d !== 'object' || d === null) fail('PointLight', 'data must be an object');
  checkPoint('PointLight', d);
}
/** Throws, naming the field, on spot-light data the renderer would not draw as written. */
export function validateSpotLight(d: SpotLightData): void {
  if (typeof d !== 'object' || d === null) fail('SpotLight', 'data must be an object');
  checkPoint('SpotLight', d);
  if (!within(d.angle, Number.MIN_VALUE, Math.PI / 2)) fail('SpotLight', 'angle must be in (0, π/2] radians');
  if (!within(d.penumbra, 0, 1)) fail('SpotLight', 'penumbra must be in [0, 1]');
  if (
    d.target !== null &&
    !(
      Array.isArray(d.target) &&
      d.target.length === 3 &&
      d.target.every(v => typeof v === 'number' && Number.isFinite(v))
    )
  )
    fail('SpotLight', 'target must be [x, y, z] or null');
}

/** A stable signature of a light's drawn fields (change detection; no allocation beyond the string). */
export const pointLightKey = (d: PointLightData): string =>
  `${d.color}|${d.intensity}|${d.distance}|${d.decay}|${d.visible}`;
export const spotLightKey = (d: SpotLightData): string =>
  `${pointLightKey(d)}|${d.angle}|${d.penumbra}|${d.target === null ? '' : d.target.join(',')}`;

const pointBase = component<PointLightData>('point-light', {...POINT_LIGHT_DEFAULTS});
/** A point light at the entity's `Transform` position. Validated when written: `PointLight({ intensity: 6 })`. */
export const PointLight: ComponentType<PointLightData> = Object.assign(
  (input: Partial<PointLightData> = {}) => {
    const value: PointLightData = {...POINT_LIGHT_DEFAULTS, ...input};
    validatePointLight(value);
    return {type: PointLight, value};
  },
  {id: pointBase.id, initial: pointBase.initial},
);
const spotBase = component<SpotLightData>('spot-light', {...SPOT_LIGHT_DEFAULTS});
/** A spot light at the entity's `Transform` position, aimed along its forward axis or at `target`. */
export const SpotLight: ComponentType<SpotLightData> = Object.assign(
  (input: Partial<SpotLightData> = {}) => {
    const value: SpotLightData = {
      ...SPOT_LIGHT_DEFAULTS,
      ...input,
      target: input.target ? ([...input.target] as Vec3) : null,
    };
    validateSpotLight(value);
    return {type: SpotLight, value};
  },
  {id: spotBase.id, initial: spotBase.initial},
);

/** A scene's light slots. Each slot is part of every lit material's program, so it costs fragment work even when
 *  unused: ask for what the scene shows at once, not for everything it might spawn. */
export interface SceneLightLimits {
  /** Point-light slots, 0…{@link LIGHT_LIMITS.point}. */
  point: number;
  /** Spot-light slots, 0…{@link LIGHT_LIMITS.spot}. */
  spot: number;
}
export interface SceneLights {
  readonly kind: 'scene-lights';
  readonly limits: Readonly<SceneLightLimits>;
}
export const SCENE_LIGHT_DEFAULTS: Readonly<SceneLightLimits> = Object.freeze({point: 4, spot: 0});

/** Opt a scene into local lights: `defineScene({ lights: sceneLights({ point: 8, spot: 2 }) })`. */
export function sceneLights(limits: Partial<SceneLightLimits> = {}): SceneLights {
  const point = limits.point ?? SCENE_LIGHT_DEFAULTS.point,
    spot = limits.spot ?? SCENE_LIGHT_DEFAULTS.spot;
  if (!Number.isInteger(point) || point < 0 || point > LIGHT_LIMITS.point)
    throw Error(`lights: point must be an integer in [0, ${LIGHT_LIMITS.point}]`);
  if (!Number.isInteger(spot) || spot < 0 || spot > LIGHT_LIMITS.spot)
    throw Error(`lights: spot must be an integer in [0, ${LIGHT_LIMITS.spot}]`);
  return Object.freeze({kind: 'scene-lights' as const, limits: Object.freeze({point, spot})});
}

/** The `lights.local-max` quality knob's preset values: the most slots of each kind a visit creates. */
export const LOCAL_LIGHT_CAPS = Object.freeze({reference: 16, high: 8, medium: 4, low: 2} as const);
export type LocalLightCap = 2 | 4 | 8 | 16;

/** The slots a visit creates: the scene's request, capped per kind by the knob (read once per visit). */
export function lightSlotsFor(lights: SceneLights | undefined, cap: number): SceneLightLimits {
  if (!lights) return {point: 0, spot: 0};
  return {point: Math.min(lights.limits.point, cap), spot: Math.min(lights.limits.spot, cap)};
}
