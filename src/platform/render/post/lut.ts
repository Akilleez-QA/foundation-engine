/**
 * platform/render/post/lut.ts: 3D colour lookup tables for the post grade (owner `platform.render.post`).
 *
 * A lookup table maps a display-referred colour (sRGB values, 0 to 1 per channel) to another one. The file format is
 * the plain-text `.cube` format most grading tools write (`LUT_3D_SIZE N`, then N³ rows of `r g b` with red changing
 * fastest). `parseCubeLut` reads it into a lattice; `cubeLutText` writes one from a function, so a game can generate a
 * table with a build-time script (`game/tools/`) instead of a grading tool. Pure: no renderer, no fetch, no DOM.
 *
 * Bounds: a lattice side from 2 to 65 (33 is usual), a file of at most `LUT_MAX_BYTES`, a domain of exactly 0 to 1.
 * Anything else is a data error that names the line. 1D tables (`LUT_1D_SIZE`) are refused.
 */

/** A parsed lattice: `size`³ RGB triples, red fastest, then green, then blue (the `.cube` order). */
export interface CubeLut {
  readonly size: number;
  /** `size`³ × 3 values, each finite. */
  readonly data: Float32Array;
  /** The file's `TITLE`, or ''. */
  readonly title: string;
}

/** Smallest and largest lattice side accepted. */
export const LUT_SIZE_LIMITS = Object.freeze([2, 65] as const);
/** Largest `.cube` text accepted, in bytes (a 65³ table written with 6 decimals is about 7 MB; 33³ about 0.9 MB). */
export const LUT_MAX_BYTES = 8 * 1024 * 1024;

const fail = (where: string, line: number, why: string): never => {
  throw Error(`${where}: line ${line}: ${why}`);
};

/** Read a `.cube` table. Throws, naming the line, on anything outside the bounds above. */
export function parseCubeLut(text: string, where = 'lut'): CubeLut {
  if (typeof text !== 'string') throw Error(`${where}: expected the text of a .cube file`);
  if (text.length > LUT_MAX_BYTES) throw Error(`${where}: larger than ${LUT_MAX_BYTES} bytes`);
  let size = 0,
    title = '',
    data: Float32Array | null = null,
    count = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1,
      line = lines[i]!.trim();
    if (!line || line.startsWith('#')) continue;
    const head = line.split(/\s+/, 1)[0]!;
    if (head === 'TITLE') {
      title = line.slice(5).trim().replace(/^"|"$/g, '');
      continue;
    }
    if (head === 'LUT_1D_SIZE') fail(where, n, 'a 1D table is not supported (use LUT_3D_SIZE)');
    if (head === 'LUT_3D_SIZE') {
      if (data) fail(where, n, 'LUT_3D_SIZE given twice');
      const v = Number(line.slice(head.length));
      const [min, max] = LUT_SIZE_LIMITS;
      if (!Number.isInteger(v) || v < min || v > max)
        fail(where, n, `LUT_3D_SIZE must be an integer from ${min} to ${max}`);
      size = v;
      data = new Float32Array(v * v * v * 3);
      continue;
    }
    if (head === 'DOMAIN_MIN' || head === 'DOMAIN_MAX') {
      const want = head === 'DOMAIN_MIN' ? 0 : 1;
      const v = line.slice(head.length).trim().split(/\s+/).map(Number);
      if (v.length !== 3 || v.some(x => x !== want)) fail(where, n, `${head} must be ${want} ${want} ${want}`);
      continue;
    }
    if (/^[A-Z][A-Z0-9_]*$/.test(head)) continue; // Other keywords (LUT_IN_VIDEO_RANGE and the like): no table data.
    if (!data) fail(where, n, 'a table row before LUT_3D_SIZE');
    const v = line.split(/\s+/);
    if (v.length !== 3) fail(where, n, 'a row must be three numbers');
    if (count >= size * size * size) fail(where, n, `more than ${size}³ rows`);
    for (let c = 0; c < 3; c++) {
      const x = Number(v[c]);
      if (!Number.isFinite(x)) fail(where, n, `"${v[c]}" is not a finite number`);
      data![count * 3 + c] = x;
    }
    count++;
  }
  if (!data) throw Error(`${where}: no LUT_3D_SIZE`);
  if (count !== size * size * size) throw Error(`${where}: ${count} rows, expected ${size}³ = ${size * size * size}`);
  return Object.freeze({size, data, title});
}

/**
 * Write a `.cube` table of side `size` (default 33) from `map`, which receives a lattice colour (each channel 0 to 1)
 * and returns its graded colour. Values are written with 6 decimals; a non-finite result is a data error.
 */
export function cubeLutText(
  map: (r: number, g: number, b: number) => readonly [number, number, number],
  options: {size?: number; title?: string} = {},
): string {
  const size = options.size ?? 33;
  const [min, max] = LUT_SIZE_LIMITS;
  if (!Number.isInteger(size) || size < min || size > max)
    throw Error(`lut: size must be an integer from ${min} to ${max}`);
  const title = (options.title ?? '').replace(/["\r\n]/g, '');
  const out: string[] = [];
  if (title) out.push(`TITLE "${title}"`);
  out.push(`LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1');
  const step = 1 / (size - 1);
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const c: unknown = map(r * step, g * step, b * step);
        if (!Array.isArray(c) || c.length !== 3 || !c.every(x => typeof x === 'number' && Number.isFinite(x)))
          throw Error(`lut: map(${r * step}, ${g * step}, ${b * step}) must return three finite numbers`);
        const [x, y, z] = c as [number, number, number];
        out.push(`${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`);
      }
  return out.join('\n') + '\n';
}

/** GPU bytes a lattice of side `size` holds as an RGBA half-float 3D texture. */
export const lutBytes = (size: number): number => size * size * size * 8;
