import type {CubeSpec} from '../platform/assets/cube';
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
  haze: {color: number; near: number; far: number} | null;
  /** Directional decorative points. Scientific catalogs belong to a kit. */
  points: readonly {direction: Vec3; color: number}[];
  pointSize: number;
}
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
      ...(e.haze ? [e.haze.color] : []),
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
  if (
    e.haze &&
    (!Number.isFinite(e.haze.near) || !Number.isFinite(e.haze.far) || e.haze.near < 0 || e.haze.far <= e.haze.near)
  )
    throw Error('environment: invalid haze');
  return e;
}
