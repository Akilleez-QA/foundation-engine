/**
 * author/sky-pixels.ts: the sky's texture pixels and its stars (VIS-05). Pure and deterministic; loaded only with the
 * lazy sky layer (scene-sky.ts) and by tests.
 */
import {channels, mix, skyGradientAt, type Sky, type SkyDisc, type SkyStars} from './sky';

type Vec3 = [x: number, y: number, z: number];
/** The sky texture: one column (1 KiB) for a plain gradient, 512 columns (512 KiB) when a disc needs azimuth. */
export const SKY_TEXTURE = Object.freeze({height: 256, width: 1, discWidth: 512});

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** Adds a disc and its halo to `rgb` for the sky direction `dir` (unit). */
function disc(rgb: Vec3, dir: Vec3, d: SkyDisc): Vec3 {
  const to = unit(d.direction);
  const cos = Math.max(-1, Math.min(1, dir[0] * to[0] + dir[1] * to[1] + dir[2] * to[2]));
  const angle = Math.acos(cos),
    radius = (((d.size ?? 3) / 2) * Math.PI) / 180;
  const c = channels(d.color ?? 0xffffff);
  // A soft-edged disc (one radius of fall-off) plus a halo that fades over eight radii.
  const core = Math.max(0, Math.min(1, (2 * radius - angle) / radius));
  const halo = (d.glow ?? 0.3) * Math.exp(-angle / (radius * 4));
  const k = Math.min(1, core + halo);
  return mix(rgb, c, k);
}

/**
 * The sky texture's RGBA8 pixels (rows bottom to top, as three's `DataTexture` uploads them with `flipY` off; columns
 * from azimuth 0 around +y). Equirectangular: row y is elevation −90°…+90°, column x is longitude, matching the UVs of
 * three's `SphereGeometry` seen from inside. Deterministic for the same sky.
 */
export function skyPixels(sky: Sky): {width: number; height: number; data: Uint8Array} {
  const discs = sky.discs ?? [];
  const width = discs.length ? SKY_TEXTURE.discWidth : SKY_TEXTURE.width,
    height = SKY_TEXTURE.height;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const elevation = ((y + 0.5) / height - 0.5) * Math.PI;
    const base = skyGradientAt(sky, elevation);
    for (let x = 0; x < width; x++) {
      let rgb = base;
      if (width > 1) {
        // SphereGeometry: x = −cos(φ)·sin(θ), z = sin(φ)·sin(θ), with φ = u·2π and θ the polar angle from +y.
        const phi = ((x + 0.5) / width) * Math.PI * 2,
          theta = Math.PI / 2 - elevation;
        const dir: Vec3 = [-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)];
        for (const d of discs) rgb = disc(rgb, dir, d);
      }
      const i = (y * width + x) * 4;
      data[i] = Math.round(rgb[0]);
      data[i + 1] = Math.round(rgb[1]);
      data[i + 2] = Math.round(rgb[2]);
      data[i + 3] = 255;
    }
  }
  return {width, height, data};
}

/** A stable key of everything the sky texture depends on (stars are points, not texture). */
export const skyTextureKey = (sky: Sky): string =>
  JSON.stringify([sky.top, sky.horizon, sky.bottom, sky.exponent ?? 1, sky.discs ?? []]);

/** Deterministic star points for `stars` (directions on the upper hemisphere, dimmer towards the horizon). */
export function skyStars(stars: SkyStars): {direction: Vec3; color: number}[] {
  let s = Math.floor(stars.seed) >>> 0 || 1;
  const next = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const floor = stars.brightness ?? 1;
  const out: {direction: Vec3; color: number}[] = [];
  for (let i = 0; i < stars.count; i++) {
    const azimuth = next() * Math.PI * 2,
      y = 0.05 + next() * 0.95,
      r = Math.sqrt(1 - y * y);
    // Dimmer towards the horizon, where haze would hide them. They are drawn additively, so a dim star simply fades
    // into a bright sky.
    const fade = Math.min(1, y / 0.3),
      level = (floor * (0.5 + 0.5 * next()) * fade * 255) | 0;
    const warm = next() < 0.15;
    const c = warm ? [level, (level * 0.92) | 0, (level * 0.78) | 0] : [(level * 0.85) | 0, (level * 0.9) | 0, level];
    out.push({
      direction: [Math.cos(azimuth) * r, y, Math.sin(azimuth) * r],
      color: (c[0]! << 16) | (c[1]! << 8) | c[2]!,
    });
  }
  return out;
}
