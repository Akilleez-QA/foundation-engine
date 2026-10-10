/**
 * kits/retro/look.ts: the retro look's settings and its CPU reference (no three.js, runs headless).
 *
 * The look renders the scene into a low-resolution target, optionally with wide pixels (the column look of
 * column-based software renderers), then quantises each displayed colour to a creator palette (through a 3D lookup
 * table) or to a number of levels per channel, with an ordered (Bayer) dither so gradients stay readable. The GPU pass
 * in ./pass.ts and `retroReference` below implement the same arithmetic; the reference is what tests check.
 */

export type RetroDither = 'none' | 'bayer2' | 'bayer4' | 'bayer8';

export interface RetroLookInput {
  /** Low-resolution width in pixels. Integer 16..1920. Default 320. */
  readonly width?: number;
  /**
   * Width of one low-res pixel relative to its height. 1 is square; 2 doubles pixel width (half the columns for the
   * same rows). 0.25..4. Default 1.
   */
  readonly pixelAspect?: number;
  /** Up to 256 colours as 0xRRGGBB (display sRGB). Omit or null to quantise per channel with `levels`. */
  readonly palette?: readonly number[] | null;
  /** Levels per channel when there is no palette. Integer 2..256. Default 32. */
  readonly levels?: number;
  /** Ordered dither matrix. Default 'bayer4'. */
  readonly dither?: RetroDither;
  /** 0..1, scales the dither threshold. Default 1. */
  readonly ditherAmount?: number;
  /** Palette lookup table size per axis. Integer 8..64. Default 32 (32×32×32 RGBA8 = 128 KiB). */
  readonly lutSize?: number;
}

export interface RetroLook {
  readonly width: number;
  readonly pixelAspect: number;
  readonly palette: readonly number[] | null;
  readonly levels: number;
  readonly dither: RetroDither;
  readonly ditherAmount: number;
  readonly lutSize: number;
}

export const RETRO_LIMITS = Object.freeze({
  minWidth: 16,
  maxWidth: 1920,
  maxPalette: 256,
  minLut: 8,
  maxLut: 64,
});

function intIn(n: unknown, lo: number, hi: number, what: string): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < lo || n > hi)
    throw new RangeError(`retro: ${what} must be an integer ${lo}..${hi}`);
  return n;
}
function numIn(n: unknown, lo: number, hi: number, what: string): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi)
    throw new RangeError(`retro: ${what} must be a number ${lo}..${hi}`);
  return n;
}

/** Validate and fill defaults. Throws before anything is built. */
export function resolveRetroLook(input: RetroLookInput = {}): RetroLook {
  if (!input || typeof input !== 'object') throw new TypeError('retro: look must be an object');
  const width =
    input.width === undefined ? 320 : intIn(input.width, RETRO_LIMITS.minWidth, RETRO_LIMITS.maxWidth, 'width');
  const pixelAspect = input.pixelAspect === undefined ? 1 : numIn(input.pixelAspect, 0.25, 4, 'pixelAspect');
  let palette: readonly number[] | null = null;
  if (input.palette !== undefined && input.palette !== null) {
    if (!Array.isArray(input.palette) || input.palette.length < 2 || input.palette.length > RETRO_LIMITS.maxPalette)
      throw new RangeError(`retro: palette must hold 2..${RETRO_LIMITS.maxPalette} colours`);
    palette = Object.freeze(input.palette.map((c, i) => intIn(c, 0, 0xffffff, `palette[${i}]`)));
  }
  const levels = input.levels === undefined ? 32 : intIn(input.levels, 2, 256, 'levels');
  const dither = input.dither ?? 'bayer4';
  if (!['none', 'bayer2', 'bayer4', 'bayer8'].includes(dither))
    throw new RangeError("retro: dither must be 'none', 'bayer2', 'bayer4' or 'bayer8'");
  const ditherAmount = input.ditherAmount === undefined ? 1 : numIn(input.ditherAmount, 0, 1, 'ditherAmount');
  const lutSize =
    input.lutSize === undefined ? 32 : intIn(input.lutSize, RETRO_LIMITS.minLut, RETRO_LIMITS.maxLut, 'lutSize');
  return Object.freeze({width, pixelAspect, palette, levels, dither, ditherAmount, lutSize});
}

/** The low-resolution target size for a view of `viewWidth`×`viewHeight` (any unit; only the aspect matters). */
export function retroTargetSize(
  look: RetroLook,
  viewWidth: number,
  viewHeight: number,
): {width: number; height: number} {
  const w = numIn(viewWidth, 1e-6, 1e9, 'view width');
  const h = numIn(viewHeight, 1e-6, 1e9, 'view height');
  // Each low-res pixel covers pixelAspect times its height in width: columns = width, rows = width·(h/w)·pixelAspect.
  const height = Math.max(1, Math.min(4096, Math.round(look.width * (h / w) * look.pixelAspect)));
  return {width: look.width, height};
}

/** The n×n Bayer threshold matrix (n = 2, 4 or 8), values 0..n²−1 in row-major order. */
export function bayerMatrix(n: 2 | 4 | 8): Uint8Array {
  let m = Uint8Array.of(0, 2, 3, 1);
  for (let size = 2; size < n; size *= 2) {
    const next = new Uint8Array(size * 2 * size * 2);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const v = 4 * m[y * size + x]!;
        next[y * 2 * size + x] = v;
        next[y * 2 * size + x + size] = v + 2;
        next[(y + size) * 2 * size + x] = v + 3;
        next[(y + size) * 2 * size + x + size] = v + 1;
      }
    m = next;
  }
  return m;
}

export function ditherSize(d: RetroDither): 0 | 2 | 4 | 8 {
  return d === 'none' ? 0 : d === 'bayer2' ? 2 : d === 'bayer4' ? 4 : 8;
}

/** Threshold in [-0.5, 0.5) for low-res pixel (x, y). */
export function ditherThreshold(look: RetroLook, x: number, y: number, matrix?: Uint8Array): number {
  const n = ditherSize(look.dither);
  if (n === 0) return 0;
  const m = matrix ?? bayerMatrix(n);
  const v = m[(((y % n) + n) % n) * n + (((x % n) + n) % n)]!;
  return (v + 0.5) / (n * n) - 0.5;
}

const WR = 2,
  WG = 4,
  WB = 3;
/** Index of the nearest palette colour to (r, g, b) in 0..255 sRGB, by weighted squared distance; ties: lowest index. */
export function nearestPaletteIndex(palette: readonly number[], r: number, g: number, b: number): number {
  let best = 0,
    bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i]!;
    const dr = ((c >> 16) & 255) - r,
      dg = ((c >> 8) & 255) - g,
      db = (c & 255) - b;
    const d = WR * dr * dr + WG * dg * dg + WB * db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * The palette lookup table: for each of size³ cells (r fastest, then g, then b), the RGBA8 of the palette colour
 * nearest the cell's centre colour. Cell i on an axis samples the value i/(size−1).
 */
export function buildPaletteLut(palette: readonly number[], size: number): Uint8Array {
  intIn(size, RETRO_LIMITS.minLut, RETRO_LIMITS.maxLut, 'lutSize');
  const out = new Uint8Array(size * size * size * 4);
  let o = 0;
  for (let bi = 0; bi < size; bi++)
    for (let gi = 0; gi < size; gi++)
      for (let ri = 0; ri < size; ri++) {
        const c =
          palette[
            nearestPaletteIndex(palette, (ri / (size - 1)) * 255, (gi / (size - 1)) * 255, (bi / (size - 1)) * 255)
          ]!;
        out[o++] = (c >> 16) & 255;
        out[o++] = (c >> 8) & 255;
        out[o++] = c & 255;
        out[o++] = 255;
      }
  return out;
}

/** Dither spread: one level step without a palette; with n colours, 1/∛n (about one step of an even n-colour cube). */
export function paletteSpread(look: RetroLook): number {
  return look.palette ? 1 / Math.max(1, Math.cbrt(look.palette.length)) : 1 / (look.levels - 1);
}

/**
 * CPU reference of the GPU quantisation: display sRGB in 0..1 at low-res pixel (x, y) to the output in 0..1.
 * With a palette the lookup uses the nearest LUT cell (as the GPU's nearest-filtered 3D texture does).
 */
export function retroReference(
  look: RetroLook,
  rgb: readonly [number, number, number],
  x: number,
  y: number,
  lut?: Uint8Array,
): [number, number, number] {
  const d = ditherThreshold(look, x, y) * look.ditherAmount;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  if (look.palette) {
    const n = look.lutSize;
    const table = lut ?? buildPaletteLut(look.palette, n);
    const s = paletteSpread(look);
    const idx = rgb.map(v => Math.min(n - 1, Math.floor(clamp(v + d * s) * (n - 1) + 0.5)));
    const o = ((idx[2]! * n + idx[1]!) * n + idx[0]!) * 4;
    return [table[o]! / 255, table[o + 1]! / 255, table[o + 2]! / 255];
  }
  const l = look.levels - 1;
  return rgb.map(v => clamp(Math.floor(clamp(v) * l + 0.5 + d) / l)) as [number, number, number];
}
