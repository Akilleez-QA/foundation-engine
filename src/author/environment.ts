import type {CubeSpec} from '../platform/assets/cube';
import {validateSky, type Sky} from './sky';
type Vec3 = [number, number, number];
/** Independent visual background, illumination and depth haze. Colors use packed sRGB. */
export interface EnvironmentState {
  background: number;
  cube?: CubeSpec;
  reflection?: CubeSpec;
  ambient: {sky: number; ground: number; intensity: number};
  /** The sun. `shadow` (VIS-03) makes it cast shadows in a scene with `sceneShadows()`: `extent` is the half-size in
   *  metres (0…200] of the square around the world origin that receives them, `softness` their edge. */
  directional: {
    color: number;
    intensity: number;
    position: Vec3;
    shadow?: {extent: number; softness?: 'hard' | 'soft' | undefined} | undefined;
  };
  /** Depth haze (fog): linear between `near` and `far` (the default kind), or exponential squared with a `density`
   *  (VIS-05). `color: 'sky'` takes the sky's horizon colour, so haze and sky always meet without a seam. */
  haze: LinearHaze | ExpHaze | null;
  /** A gradient sky with optional discs (a sun, or any body) and stars (VIS-05): one texture on a sphere around the camera.
   *  Without it the background is the `background` colour (or the `cube`), as before. */
  sky?: Sky | undefined;
  /** Directional decorative points. Scientific catalogs belong to a kit. */
  points: readonly {direction: Vec3; color: number}[];
  pointSize: number;
}
export interface LinearHaze {
  kind?: 'linear' | undefined;
  color: number | 'sky';
  near: number;
  far: number;
}
export interface ExpHaze {
  kind: 'exp2';
  color: number | 'sky';
  /** How thick, (0, 1]: about 2 / density metres is where things vanish. */
  density: number;
}
/** The haze colour as a number: its own, or the sky's horizon for `'sky'`. */
export const hazeColor = (e: Pick<EnvironmentState, 'haze' | 'sky'>): number =>
  e.haze?.color === 'sky' ? (e.sky?.horizon ?? 0) : (e.haze?.color ?? 0);
export function defineEnvironment(input: EnvironmentState): EnvironmentState {
  const e = structuredClone(input);
  const color = (v: number) => Number.isInteger(v) && v >= 0 && v <= 0xffffff;
  if (
    ![
      e.background,
      e.ambient.sky,
      e.ambient.ground,
      e.directional.color,
      ...e.points.map(p => p.color),
      ...(e.haze && e.haze.color !== 'sky' ? [e.haze.color] : []),
    ].every(color)
  )
    throw Error('environment: invalid color');
  if (
    ![e.ambient.intensity, e.directional.intensity].every(v => Number.isFinite(v) && v >= 0) ||
    !Number.isFinite(e.pointSize) ||
    e.pointSize <= 0 ||
    e.pointSize > 16
  )
    throw Error('environment: invalid intensity or point size');
  if (
    e.directional.position.length !== 3 ||
    !e.directional.position.every(Number.isFinite) ||
    !Number.isFinite(Math.hypot(...e.directional.position)) ||
    Math.hypot(...e.directional.position) === 0
  )
    throw Error('environment: invalid direction');
  const shadow = e.directional.shadow;
  if (shadow !== undefined) {
    if (typeof shadow !== 'object' || shadow === null) throw Error('environment: directional.shadow must be an object');
    if (!(
      typeof shadow.extent === 'number' &&
      Number.isFinite(shadow.extent) &&
      shadow.extent > 0 &&
      shadow.extent <= 200
    ))
      throw Error('environment: directional.shadow.extent must be in (0, 200] metres');
    if (shadow.softness !== undefined && shadow.softness !== 'hard' && shadow.softness !== 'soft')
      throw Error("environment: directional.shadow.softness must be 'hard' or 'soft'");
  }
  if (
    e.points.length > 4096 ||
    e.points.some(
      p =>
        p.direction.length !== 3 ||
        !p.direction.every(Number.isFinite) ||
        !Number.isFinite(Math.hypot(...p.direction)) ||
        Math.hypot(...p.direction) === 0,
    )
  )
    throw Error('environment: invalid points');
  if (e.haze) {
    if (e.haze.kind === 'exp2') {
      if (!(Number.isFinite(e.haze.density) && e.haze.density > 0 && e.haze.density <= 1))
        throw Error('environment: invalid haze: exp2 density must be in (0, 1]');
    } else if (
      (e.haze.kind !== undefined && e.haze.kind !== 'linear') ||
      !Number.isFinite(e.haze.near) ||
      !Number.isFinite(e.haze.far) ||
      e.haze.near < 0 ||
      e.haze.far <= e.haze.near
    )
      throw Error('environment: invalid haze');
    if (e.haze.color === 'sky' && !e.sky) throw Error("environment: haze.color 'sky' needs a sky");
  }
  if (e.sky !== undefined) {
    validateSky(e.sky);
    if (e.cube) throw Error('environment: sky and cube are both backgrounds; choose one');
  }
  return e;
}
