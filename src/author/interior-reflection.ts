/**
 * author/interior-reflection.ts: a procedural interior as the scene's reflection environment, as plain data, validation and
 * pure pixel maths. No three.js here: scene-interior-reflection.ts uploads the pixels once as one equirectangular texture
 * and sets it as `scene.environment`, which the renderer prefilters (PMREM) once and caches per texture.
 *
 * The interior is an axis-aligned box seen from a probe point inside it: walls, floor and ceiling each have one colour and
 * intensity, and up to {@link INTERIOR_REFLECTION_LIMITS.lights} spherical light panels glow inside it. Use it when the
 * reflections on metal, glass or wet surfaces should show a dim interior and a few lamps instead of a bright studio.
 * Colours are packed sRGB like every other environment colour; intensities multiply the colour in linear light, so
 * values above 1 are emissive (HDR) and a light at intensity 0 is black.
 */
type Vec3 = [x: number, y: number, z: number];

/** One interior surface: a packed sRGB colour times an intensity in linear light. */
export interface InteriorSurface {
  color: number;
  /** [0, 16]; default 1. */
  intensity?: number | undefined;
}
/** A glowing sphere in the interior (a lamp, a window, a panel seen from afar). */
export interface InteriorLight {
  /** Centre in interior metres: x and z from the floor's centre, y up from the floor. Must lie inside the interior. */
  position: Vec3;
  /** Radius in metres, (0, 10]. The probe must lie outside it. */
  radius: number;
  /** Packed sRGB; default white. */
  color?: number | undefined;
  /** Linear multiplier, [0, 1000]. Values well above 1 read as light sources in the reflection. */
  intensity: number;
}
export interface InteriorReflection {
  kind: 'interior';
  /** Interior width, height and depth in metres, each in [1, 200]; default [20, 8, 20]. */
  size?: Vec3 | undefined;
  /** The probe's height above the floor, strictly inside the interior; default min(1.6, height / 2). */
  eyeHeight?: number | undefined;
  wall: InteriorSurface;
  floor: InteriorSurface;
  ceiling: InteriorSurface;
  /** At most {@link INTERIOR_REFLECTION_LIMITS.lights}. */
  lights?: readonly InteriorLight[] | undefined;
}

export const INTERIOR_REFLECTION_LIMITS = Object.freeze({
  lights: 8,
  minSize: 1,
  maxSize: 200,
  surfaceIntensity: 16,
  lightIntensity: 1000,
  lightRadius: 10,
  /** The texture is fixed at this size (equirectangular, half-float RGBA: 1 MiB). */
  width: 512,
  height: 256,
});
const L = INTERIOR_REFLECTION_LIMITS;
const DEFAULT_SIZE: Vec3 = [20, 8, 20];

const isColor = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffff;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum);

/** True for the interior kind of `environment.reflection` (a cube reflection has no `kind`). */
export const isInteriorReflection = (v: unknown): v is InteriorReflection =>
  typeof v === 'object' && v !== null && (v as {kind?: unknown}).kind === 'interior';

/** The interior's size and probe height with defaults applied. */
export function interiorGeometry(interior: InteriorReflection): {size: Vec3; eye: number} {
  const size = interior.size ? ([...interior.size] as Vec3) : DEFAULT_SIZE;
  return {size, eye: interior.eyeHeight ?? Math.min(1.6, size[1] / 2)};
}

/** Throws, naming the field, on interior data the renderer would not draw as written. */
export function validateInteriorReflection(interior: InteriorReflection): void {
  const fail = (why: string): never => {
    throw Error(`environment: reflection.${why}`);
  };
  if (!isInteriorReflection(interior)) fail("kind must be 'interior'");
  if (interior.size !== undefined) {
    if (!isVec3(interior.size)) fail('size must be [width, height, depth] in metres');
    for (const v of interior.size as Vec3)
      if (v < L.minSize || v > L.maxSize) fail(`size must be in [${L.minSize}, ${L.maxSize}] metres per axis`);
  }
  const {size, eye} = interiorGeometry(interior);
  if (
    interior.eyeHeight !== undefined &&
    !(isNum(interior.eyeHeight) && interior.eyeHeight > 0 && interior.eyeHeight < size[1])
  )
    fail('eyeHeight must be inside the interior: (0, height)');
  for (const k of ['wall', 'floor', 'ceiling'] as const) {
    const s = interior[k];
    if (typeof s !== 'object' || s === null) fail(`${k} must be { color, intensity? }`);
    if (!isColor(s.color)) fail(`${k}.color must be a 24-bit RGB number`);
    if (s.intensity !== undefined && !(isNum(s.intensity) && s.intensity >= 0 && s.intensity <= L.surfaceIntensity))
      fail(`${k}.intensity must be in [0, ${L.surfaceIntensity}]`);
  }
  if (interior.lights !== undefined && !(Array.isArray(interior.lights) && interior.lights.length <= L.lights))
    fail(`lights must be a list of at most ${L.lights}`);
  for (const [i, light] of (interior.lights ?? []).entries()) {
    const k = `lights[${i}]`;
    if (typeof light !== 'object' || light === null) fail(`${k} must be { position, radius, color?, intensity }`);
    if (!isVec3(light.position)) fail(`${k}.position must be [x, y, z] in metres`);
    const [x, y, z] = light.position;
    if (!(Math.abs(x) < size[0] / 2 && y > 0 && y < size[1] && Math.abs(z) < size[2] / 2))
      fail(`${k}.position must be inside the interior`);
    if (!(isNum(light.radius) && light.radius > 0 && light.radius <= L.lightRadius))
      fail(`${k}.radius must be in (0, ${L.lightRadius}] metres`);
    if (Math.hypot(x, y - eye, z) <= light.radius) fail(`${k} must not contain the probe (eyeHeight)`);
    if (light.color !== undefined && !isColor(light.color)) fail(`${k}.color must be a 24-bit RGB number`);
    if (!(isNum(light.intensity) && light.intensity >= 0 && light.intensity <= L.lightIntensity))
      fail(`${k}.intensity must be in [0, ${L.lightIntensity}]`);
  }
}

/** A stable key for the interior's look: equal data gives an equal key, whatever the field order. */
export function interiorReflectionKey(interior: InteriorReflection): string {
  const {size, eye} = interiorGeometry(interior);
  const s = (v: InteriorSurface) => [v.color, v.intensity ?? 1];
  return JSON.stringify([
    'interior',
    size,
    eye,
    s(interior.wall),
    s(interior.floor),
    s(interior.ceiling),
    (interior.lights ?? []).map(l => [l.position, l.radius, l.color ?? 0xffffff, l.intensity]),
  ]);
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linear = (color: number, intensity: number): Vec3 => [
  srgbToLinear(((color >> 16) & 255) / 255) * intensity,
  srgbToLinear(((color >> 8) & 255) / 255) * intensity,
  srgbToLinear((color & 255) / 255) * intensity,
];

/**
 * The interior's linear radiance as an equirectangular RGBA float image ({@link INTERIOR_REFLECTION_LIMITS} width × height),
 * in three's equirectangular convention (row 0 is straight down; u = atan2(z, x) / 2π + 0.5). Deterministic.
 */
export function interiorReflectionPixels(interior: InteriorReflection): {
  width: number;
  height: number;
  data: Float32Array;
} {
  validateInteriorReflection(interior);
  const {width, height} = L;
  const {size, eye} = interiorGeometry(interior);
  const half = [size[0] / 2, size[1], size[2] / 2];
  const wall = linear(interior.wall.color, interior.wall.intensity ?? 1);
  const floor = linear(interior.floor.color, interior.floor.intensity ?? 1);
  const ceiling = linear(interior.ceiling.color, interior.ceiling.intensity ?? 1);
  // Lights far to near, so a nearer light covers a farther one. The interior is convex and empty: nothing else occludes.
  const lights = (interior.lights ?? [])
    .map(l => {
      const d: Vec3 = [l.position[0], l.position[1] - eye, l.position[2]];
      const dist = Math.hypot(...d);
      return {
        dir: d.map(v => v / dist) as Vec3,
        dist,
        cosRadius: Math.cos(Math.asin(Math.min(1, l.radius / dist))),
        angle: Math.asin(Math.min(1, l.radius / dist)),
        rgb: linear(l.color ?? 0xffffff, l.intensity),
      };
    })
    .sort((a, b) => b.dist - a.dist);
  // About one texel of angle: the light's edge is blended over it so the mirror-sharp level does not alias.
  const texel = (2 * Math.PI) / width;
  const data = new Float32Array(width * height * 4);
  for (let j = 0; j < height; j++) {
    const elevation = ((j + 0.5) / height - 0.5) * Math.PI;
    const y = Math.sin(elevation),
      r = Math.cos(elevation);
    for (let i = 0; i < width; i++) {
      const phi = ((i + 0.5) / width - 0.5) * 2 * Math.PI;
      const x = r * Math.cos(phi),
        z = r * Math.sin(phi);
      // Distance to each slab along the ray from the probe; the nearest names the surface hit.
      const tx = x === 0 ? Infinity : half[0]! / Math.abs(x);
      const tz = z === 0 ? Infinity : half[2]! / Math.abs(z);
      const ty = y > 0 ? (half[1]! - eye) / y : y < 0 ? eye / -y : Infinity;
      let c = ty < tx && ty < tz ? (y > 0 ? ceiling : floor) : wall;
      let [cr, cg, cb] = c;
      for (const l of lights) {
        const cos = x * l.dir[0] + y * l.dir[1] + z * l.dir[2];
        if (cos < l.cosRadius - texel) continue;
        const angle = Math.acos(Math.min(1, cos));
        const cover = Math.max(0, Math.min(1, (l.angle - angle) / texel + 0.5));
        if (cover === 0) continue;
        cr += (l.rgb[0] - cr) * cover;
        cg += (l.rgb[1] - cg) * cover;
        cb += (l.rgb[2] - cb) * cover;
      }
      c = [cr, cg, cb];
      const o = (j * width + i) * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 1;
    }
  }
  return {width, height, data};
}
