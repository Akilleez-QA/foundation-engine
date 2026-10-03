/**
 * core/noise.ts: deterministic hashes and 2D value noise shared by terrain and scenery.
 * Each function is the exact arithmetic of the copy it replaces, so migrated callers stay bit-identical.
 * Pure: no imports, no randomness, no allocation.
 */

/** Classic sine hash in [0, 1): fract(sin(x·127.1 + z·311.7)·43758.5453). */
export function sineHash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise in [0, 1] on the unit lattice of sineHash2 (smoothstep-weighted bilinear). */
export function valueNoise2(x: number, z: number): number {
  const xi = Math.floor(x),
    zi = Math.floor(z),
    xf = x - xi,
    zf = z - zi,
    u = xf * xf * (3 - 2 * xf),
    v = zf * zf * (3 - 2 * zf);
  const a = sineHash2(xi, zi),
    b = sineHash2(xi + 1, zi),
    c = sineHash2(xi, zi + 1),
    d = sineHash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export type FbmOptions = {octaves?: number; lacunarity?: number; gain?: number};
/**
 * Fractal sum of valueNoise2, centred on zero: Σ amplitudeᵢ·(noise(p·frequencyᵢ) − 0.5).
 * Defaults: 4 octaves, lacunarity 2.03, gain 0.5; the odd lacunarity keeps octaves off each other's lattice.
 */
export function fbm2(x: number, z: number, {octaves = 4, lacunarity = 2.03, gain = 0.5}: FbmOptions = {}): number {
  let s = 0,
    a = 1,
    f = 1;
  for (let i = 0; i < octaves; i++) {
    s += a * (valueNoise2(x * f, z * f) - 0.5);
    a *= gain;
    f *= lacunarity;
  }
  return s;
}

/**
 * Integer hash in [0, 1) of a point quantised to 1/16 m, with a salt for independent channels.
 * Stable for the same placed coordinates across runs.
 */
export function gridHash2(x: number, z: number, salt = 0): number {
  let h = Math.imul(Math.round(x * 16) + salt * 7919, 374761393) ^ Math.imul(Math.round(z * 16), 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1] over gridHash2 on a lattice of spacing `scale`, for clumping woods and fields. */
export function gridValueNoise2(x: number, z: number, scale: number, salt: number): number {
  const gx = x / scale,
    gz = z / scale,
    x0 = Math.floor(gx),
    z0 = Math.floor(gz),
    fx = gx - x0,
    fz = gz - z0,
    s = (t: number) => t * t * (3 - 2 * t);
  const v = (i: number, j: number) => gridHash2(i, j, salt);
  return (
    (v(x0, z0) * (1 - s(fx)) + v(x0 + 1, z0) * s(fx)) * (1 - s(fz)) +
    (v(x0, z0 + 1) * (1 - s(fx)) + v(x0 + 1, z0 + 1) * s(fx)) * s(fz)
  );
}
