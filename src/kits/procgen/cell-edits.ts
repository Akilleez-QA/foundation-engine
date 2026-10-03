/**
 * Sparse runtime edits over a regenerated grid (GEN-02). The baseline is never stored: it is regenerated from the
 * root seed (GEN-01), and only cells that differ from it are kept, encoded compactly for a chunk store record.
 *
 * Encoding (little-endian): magic 'FCE' + format byte 1, u32 cellsX, u32 cellsY, u32 cellsZ, u32 CRC-32 of the
 * baseline values (little-endian u16 bytes), u32 edit count, then per edit a minimal LEB128 varint of the index delta (first delta
 * from -1, so every delta is ≥ 1) and a u16 value. Indices are strictly increasing and varints minimal, so every
 * grid state has exactly one encoding. The baseline CRC binds edits to the content they were made against: loading
 * them over different content or different dimensions (a new seed, generator, parameters or grid shape) is refused
 * instead of silently applied. Two baselines with identical dimensions and identical values are the same content, so
 * edits correctly apply to either.
 */
import { crc32 } from '../../core/save/chunk-store';
export interface CellEditLimits { readonly maxEdits: number; readonly maxValue: number }
export const CELL_EDIT_DEFAULT_LIMITS: CellEditLimits = Object.freeze({ maxEdits: 65536, maxValue: 65535 });
const MAGIC = [0x46, 0x43, 0x45, 0x01];
const HEADER = 24;
const MAX_VARINT = 5;
const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** CRC-32 of a grid's values as little-endian u16 bytes, independent of platform byte order. */
export function baselineChecksum(values: Uint16Array): number {
  if (LITTLE) return crc32(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
  const out = new Uint8Array(values.length * 2), view = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) view.setUint16(i * 2, values[i]!, true);
  return crc32(out);
}

export interface CellEditBaseline { readonly cellsX: number; readonly cellsY: number; readonly cellsZ: number; readonly values: Uint16Array }
export interface CellEdits {
  /** `baselineChecksum` of the baseline these edits apply to. */
  readonly baseline: number;
  /** Current value: the edit if any, else the baseline. */
  get(x: number, y: number, z: number): number;
  /** `changed`, `unchanged` (same as the current value), or `full` (would exceed maxEdits; nothing changes). */
  set(x: number, y: number, z: number, value: number): 'changed' | 'unchanged' | 'full';
  /** Edited cells (differing from the baseline). */
  readonly size: number;
  /** Increments on every `changed`; use it as the chunk store record revision. Starts at the loaded revision. */
  readonly revision: number;
  /** True after a change until `markSaved(revision)` for that revision. */
  readonly dirty: boolean;
  markSaved(revision: number): void;
  /** A new array: baseline with edits applied. */
  materialize(): Uint16Array;
  encode(): Uint8Array;
}

const int = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;

function checkLimits(limits: Partial<CellEditLimits>): CellEditLimits {
  const l = { ...CELL_EDIT_DEFAULT_LIMITS, ...limits };
  if (!int(l.maxEdits, 1, 1 << 22) || !int(l.maxValue, 0, 65535)) throw Error('cell edits: invalid limits');
  return l;
}

/**
 * Decodes and validates an encoded edit list for a grid of `cells` cells. Throws on any malformation, and on a
 * baseline mismatch when `baseline` (a `baselineChecksum`) is given.
 */
export interface CellEditDimensions { readonly cellsX: number; readonly cellsY: number; readonly cellsZ: number }
export function decodeCellEdits(bytes: Uint8Array, dimensions: CellEditDimensions, limits: Partial<CellEditLimits> = {}, baseline?: number): Map<number, number> {
  const l = checkLimits(limits);
  if (!(bytes instanceof Uint8Array) || bytes.length < HEADER) throw Error('cell edits: truncated header');
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) throw Error('cell edits: bad magic or format');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { cellsX, cellsY, cellsZ } = dimensions ?? ({} as CellEditDimensions);
  if (![cellsX, cellsY, cellsZ].every(n => int(n, 1, 0xffffffff))) throw Error('cell edits: invalid dimensions');
  if (view.getUint32(4, true) !== cellsX || view.getUint32(8, true) !== cellsY || view.getUint32(12, true) !== cellsZ) throw Error('cell edits: grid dimensions mismatch');
  const cells = cellsX * cellsY * cellsZ;
  if (baseline !== undefined && view.getUint32(16, true) !== baseline) throw Error('cell edits: baseline mismatch (edits were made against different content)');
  const count = view.getUint32(20, true);
  if (count > l.maxEdits || count > cells) throw Error('cell edits: too many edits');
  const out = new Map<number, number>();
  let at = HEADER, index = -1;
  for (let n = 0; n < count; n++) {
    let delta = 0, shift = 0, length = 0, b: number;
    do {
      if (at >= bytes.length) throw Error('cell edits: truncated');
      if (++length > MAX_VARINT) throw Error('cell edits: varint too long');
      b = bytes[at++]!;
      if (b === 0 && length > 1) throw Error('cell edits: overlong varint');
      delta += (b & 0x7f) * 2 ** shift; shift += 7;
    } while (b & 0x80);
    if (delta < 1) throw Error('cell edits: indices not increasing');
    index += delta;
    if (index >= cells) throw Error('cell edits: index out of range');
    if (at + 2 > bytes.length) throw Error('cell edits: truncated');
    const value = view.getUint16(at, true); at += 2;
    if (value > l.maxValue) throw Error('cell edits: value out of range');
    out.set(index, value);
  }
  if (at !== bytes.length) throw Error('cell edits: trailing bytes');
  return out;
}

/**
 * Wraps a regenerated baseline. `saved` (optional) is a decoded or encoded edit list loaded from storage, with the
 * record revision it was stored under. Edits equal to the baseline are dropped on load and on set, so the size is
 * the true number of differing cells. The baseline array is read, never written.
 */
export function createCellEdits(baseline: CellEditBaseline, options: { saved?: Uint8Array; revision?: number; limits?: Partial<CellEditLimits> } = {}): CellEdits {
  const { cellsX, cellsY, cellsZ, values } = baseline;
  if (![cellsX, cellsY, cellsZ].every(n => int(n, 1, 1 << 22)) || !(values instanceof Uint16Array) || values.length !== cellsX * cellsY * cellsZ || values.length > 0xffffffff) throw Error('cell edits: invalid baseline');
  const l = checkLimits(options.limits ?? {});
  let revision = options.revision ?? 0, saved = revision;
  if (!int(revision, 0, Number.MAX_SAFE_INTEGER)) throw Error('cell edits: invalid revision');
  const checksum = baselineChecksum(values);
  const edits = options.saved ? decodeCellEdits(options.saved, { cellsX, cellsY, cellsZ }, l, checksum) : new Map<number, number>();
  for (const [i, v] of edits) if (values[i] === v) edits.delete(i);
  const index = (x: number, y: number, z: number) => {
    if (!int(x, 0, cellsX - 1) || !int(y, 0, cellsY - 1) || !int(z, 0, cellsZ - 1)) throw Error('cell edits: cell outside grid');
    return (y * cellsZ + z) * cellsX + x;
  };
  return {
    baseline: checksum,
    get: (x, y, z) => { const i = index(x, y, z); return edits.get(i) ?? values[i]!; },
    set(x, y, z, value) {
      const i = index(x, y, z);
      if (!int(value, 0, l.maxValue)) throw Error('cell edits: value out of range');
      if ((edits.get(i) ?? values[i]) === value) return 'unchanged';
      if (values[i] === value) edits.delete(i);
      else { if (!edits.has(i) && edits.size >= l.maxEdits) return 'full'; edits.set(i, value); }
      revision++;
      return 'changed';
    },
    get size() { return edits.size; },
    get revision() { return revision; },
    get dirty() { return revision !== saved; },
    markSaved(r) { if (!int(r, 0, revision)) throw Error('cell edits: invalid saved revision'); saved = Math.max(saved, r); },
    materialize() { const out = values.slice(); for (const [i, v] of edits) out[i] = v; return out; },
    encode() {
      const sorted = [...edits].sort((a, b) => a[0] - b[0]);
      const out = new Uint8Array(HEADER + sorted.length * (MAX_VARINT + 2));
      out.set(MAGIC, 0);
      const view = new DataView(out.buffer);
      view.setUint32(4, cellsX, true); view.setUint32(8, cellsY, true); view.setUint32(12, cellsZ, true);
      view.setUint32(16, checksum, true); view.setUint32(20, sorted.length, true);
      let at = HEADER, prev = -1;
      for (const [i, v] of sorted) {
        let delta = i - prev; prev = i;
        while (delta >= 0x80) { out[at++] = (delta & 0x7f) | 0x80; delta = Math.floor(delta / 128); }
        out[at++] = delta;
        view.setUint16(at, v, true); at += 2;
      }
      return out.slice(0, at);
    },
  };
}
