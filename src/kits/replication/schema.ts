/**
 * kits/replication/schema.ts: a creator's numeric field list with quantization.
 *
 * Each field is a finite range and a step. A value is clamped to the range and stored as the integer number of steps
 * from `min`, so changes smaller than half a step neither mark a field dirty nor cost bytes, and the wire carries
 * small integers instead of long decimal strings. Up to 31 fields, so a dirty set fits one integer mask.
 */

export interface FieldSpec {
  /** Creator label, for diagnostics only. */
  readonly name: string;
  readonly min: number;
  readonly max: number;
  /** Quantization step (> 0). (max - min) / step must not exceed 2^30. */
  readonly step: number;
}

export interface FieldSchema {
  readonly fields: readonly FieldSpec[];
  readonly count: number;
  /** Quantizes `values` (length `count`, finite) into `out`. Throws on non-finite input. */
  quantize(values: ArrayLike<number>, out: Int32Array): void;
  /** The presented value of step count `q` for field `index`. */
  dequantize(index: number, q: number): number;
  /** Largest step count of field `index`. */
  steps(index: number): number;
}

export const MAX_FIELDS = 31;
const MAX_STEPS = 2 ** 30;

export function defineFieldSchema(fields: readonly FieldSpec[]): FieldSchema {
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > MAX_FIELDS)
    throw new RangeError(`replication: 1..${MAX_FIELDS} fields`);
  const specs = fields.map((f, i) => {
    const {name, min, max, step} = f ?? ({} as FieldSpec);
    if (typeof name !== 'string' || !name || name.length > 64) throw new TypeError(`replication: field ${i} name`);
    if (![min, max, step].every(Number.isFinite) || !(max > min) || !(step > 0))
      throw new RangeError(`replication: field ${name} needs finite min < max and step > 0`);
    // Treat a range that is a whole number of steps up to rounding error as exact, so max stays reachable.
    const ratio = (max - min) / step;
    const nearest = Math.round(ratio);
    const count = Math.abs(ratio - nearest) < 1e-9 * Math.max(1, ratio) ? nearest : Math.floor(ratio);
    if (count > MAX_STEPS) throw new RangeError(`replication: field ${name} has more than 2^30 steps`);
    return Object.freeze({name, min, max, step, count});
  });
  const names = new Set(specs.map(s => s.name));
  if (names.size !== specs.length) throw new TypeError('replication: field names must be unique');
  return Object.freeze({
    fields: Object.freeze(specs.map(({name, min, max, step}) => Object.freeze({name, min, max, step}))),
    count: specs.length,
    quantize(values: ArrayLike<number>, out: Int32Array) {
      if (!values || values.length !== specs.length) throw new TypeError(`replication: need ${specs.length} values`);
      for (let i = 0; i < specs.length; i++) {
        const s = specs[i]!;
        const v: unknown = values[i];
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`replication: ${s.name} must be finite`);
        const q = Math.round((Math.min(s.max, Math.max(s.min, v)) - s.min) / s.step);
        out[i] = Math.min(s.count, Math.max(0, q));
      }
    },
    dequantize(index: number, q: number) {
      const s = specs[index];
      if (!s) throw new RangeError('replication: field index');
      return Math.min(s.max, s.min + q * s.step);
    },
    steps(index: number) {
      const s = specs[index];
      if (!s) throw new RangeError('replication: field index');
      return s.count;
    },
  });
}
