/**
 * author/sky.ts: a gradient sky, its discs (a sun, or any other body) and its stars (VIS-05), as data and pure pixel
 * maths. No
 * three.js here: scene-environment.ts uploads the pixels as one texture on an inverted sphere drawn with a built-in
 * unlit material (no custom shader, so the same data works on the WebGPU backend, ADR 0078). Colours are packed sRGB,
 * like every other environment colour; the gradient is blended in sRGB so the authored colours come out exactly.
 */
type Vec3 = [x: number, y: number, z: number];

/** A disc in the sky: a sun, or any other body seen from the ground. */
export interface SkyDisc {
  /** Towards the disc (any non-zero vector; y is up). */
  direction: Vec3;
  /** Angular diameter in degrees, (0, 20]; default 3. */
  size?: number | undefined;
  /** Packed sRGB; default white. */
  color?: number | undefined;
  /** Halo strength around the disc, 0…1; default 0.3. */
  glow?: number | undefined;
}
export interface SkyStars {
  /** How many, 0…4096 (added to the environment's own `points`). */
  count: number;
  /** The same seed gives the same stars. */
  seed: number;
  /** 0…1 (default 1): how bright the faintest stars are. */
  brightness?: number | undefined;
}
export interface GradientSky {
  kind: 'gradient';
  /** Straight up. */
  top: number;
  /** At the horizon. */
  horizon: number;
  /** Straight down (below the horizon). */
  bottom: number;
  /** How fast the colour leaves the horizon, (0, 8]; 1 is linear in elevation, below 1 widens the horizon band. */
  exponent?: number | undefined;
  /** Up to {@link SKY_LIMITS.discs} discs, drawn in order (a later one covers an earlier one). */
  discs?: readonly SkyDisc[] | undefined;
  stars?: SkyStars | undefined;
}
export type Sky = GradientSky;

export const SKY_LIMITS = Object.freeze({exponent: 8, discSize: 20, discs: 4, stars: 4096});

const color = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffff;
const finite3 = (v: unknown) =>
  Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) && Math.hypot(...(v as number[])) > 0;

/** Throws, naming the field, on sky data the renderer would not draw as written. */
export function validateSky(sky: Sky): void {
  const fail = (why: string): never => {
    throw Error(`environment: sky.${why}`);
  };
  if (typeof sky !== 'object' || sky === null || sky.kind !== 'gradient') fail("kind must be 'gradient'");
  for (const k of ['top', 'horizon', 'bottom'] as const) if (!color(sky[k])) fail(`${k} must be a 24-bit RGB number`);
  if (
    sky.exponent !== undefined &&
    !(Number.isFinite(sky.exponent) && sky.exponent > 0 && sky.exponent <= SKY_LIMITS.exponent)
  )
    fail(`exponent must be in (0, ${SKY_LIMITS.exponent}]`);
  if (sky.discs !== undefined && !(Array.isArray(sky.discs) && sky.discs.length <= SKY_LIMITS.discs))
    fail(`discs must be a list of at most ${SKY_LIMITS.discs}`);
  for (const [i, d] of (sky.discs ?? []).entries()) {
    const k = `discs[${i}]`;
    if (typeof d !== 'object' || d === null || !finite3(d.direction))
      fail(`${k}.direction must be a non-zero [x, y, z]`);
    if (d.size !== undefined && !(Number.isFinite(d.size) && d.size > 0 && d.size <= SKY_LIMITS.discSize))
      fail(`${k}.size must be in (0, ${SKY_LIMITS.discSize}] degrees`);
    if (d.color !== undefined && !color(d.color)) fail(`${k}.color must be a 24-bit RGB number`);
    if (d.glow !== undefined && !(Number.isFinite(d.glow) && d.glow >= 0 && d.glow <= 1))
      fail(`${k}.glow must be in [0, 1]`);
  }
  const s = sky.stars;
  if (s !== undefined) {
    if (typeof s !== 'object' || s === null) fail('stars must be an object');
    if (!(Number.isInteger(s.count) && s.count >= 0 && s.count <= SKY_LIMITS.stars))
      fail(`stars.count must be an integer in [0, ${SKY_LIMITS.stars}]`);
    if (!Number.isFinite(s.seed)) fail('stars.seed must be a number');
    if (s.brightness !== undefined && !(Number.isFinite(s.brightness) && s.brightness >= 0 && s.brightness <= 1))
      fail('stars.brightness must be in [0, 1]');
  }
}

export const channels = (c: number): Vec3 => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
export const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** The gradient's colour (0…255 sRGB channels) at an elevation in radians (−π/2 straight down … π/2 straight up). */
export function skyGradientAt(sky: Sky, elevation: number): Vec3 {
  const h = Math.max(-1, Math.min(1, elevation / (Math.PI / 2)));
  const t = Math.pow(Math.abs(h), sky.exponent ?? 1);
  return mix(channels(sky.horizon), channels(h >= 0 ? sky.top : sky.bottom), t);
}
