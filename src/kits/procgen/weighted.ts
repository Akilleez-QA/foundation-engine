import type {Rng} from '../../core/rng';

export interface WeightedCandidate {
  readonly id: string;
  readonly weight: number;
  readonly eligible: boolean;
}
export interface WeightedLimits {
  readonly maxCandidates: number;
  readonly maxIdLength: number;
}
export interface ChoiceHistoryOptions extends WeightedLimits {
  readonly maxLabels: number;
  readonly windowSize: number;
}
export interface ChoiceTicket {
  readonly label: string;
  readonly id: string;
}
export interface ChoiceHistorySnapshot {
  readonly version: 1;
  readonly options: ChoiceHistoryOptions;
  readonly histories: readonly Readonly<{label: string; ids: readonly string[]}>[];
}
export type ChoicePreparation =
  | Readonly<{status: 'prepared'; ticket: ChoiceTicket}>
  | Readonly<{status: 'empty' | 'saturated' | 'busy' | 'disposed'}>;

function integer(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new RangeError('weighted: invalid bound');
  return value;
}
function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || !value.length || value.length > limit) throw new TypeError('weighted: invalid id');
  return value;
}
function data(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    throw new TypeError('weighted: expected plain data');
  if (Reflect.ownKeys(value).length !== fields.length) throw new TypeError('weighted: unexpected fields');
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !('value' in descriptor)) throw new TypeError('weighted: expected data fields');
    output[field] = descriptor.value;
  }
  return output;
}
function entries(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new TypeError('weighted: expected array');
  const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > limit)
    throw new RangeError('weighted: array bound');
  if (Reflect.ownKeys(value).length !== length + 1) throw new TypeError('weighted: expected dense data array');
  const result: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor)) throw new TypeError('weighted: expected array data');
    result.push(descriptor.value);
  }
  return result;
}
function limits(options: WeightedLimits): WeightedLimits {
  return Object.freeze({
    maxCandidates: integer(options.maxCandidates, 4096),
    maxIdLength: integer(options.maxIdLength, 256),
  });
}
function capture(
  candidates: unknown,
  bounds: WeightedLimits,
  excluded: ReadonlySet<string>,
): {rows: WeightedCandidate[]; total: number} {
  const rows: WeightedCandidate[] = [];
  const ids = new Set<string>();
  let total = 0;
  for (const entry of entries(candidates, bounds.maxCandidates)) {
    const value = data(entry, ['id', 'weight', 'eligible']);
    const id = text(value.id, bounds.maxIdLength);
    if (ids.has(id)) throw new TypeError('weighted: duplicate id');
    ids.add(id);
    if (
      typeof value.weight !== 'number' ||
      !Number.isFinite(value.weight) ||
      value.weight < 0 ||
      typeof value.eligible !== 'boolean'
    )
      throw new TypeError('weighted: invalid candidate');
    if (!value.eligible || !value.weight || excluded.has(id)) continue;
    const next = total + value.weight;
    if (!Number.isFinite(next) || next <= total)
      throw new RangeError('weighted: weight sum overflow or lost precision');
    total = next;
    rows.push(Object.freeze({id, weight: value.weight, eligible: true}));
  }
  return {rows, total};
}
function draw(table: ReturnType<typeof capture>, rng: Pick<Rng, 'next'>): string | null {
  if (!table.rows.length) return null;
  const unit = rng.next();
  if (!Number.isFinite(unit) || unit < 0 || unit >= 1) throw new RangeError('weighted: draw must be in [0,1)');
  const position = unit * table.total;
  let cumulative = 0;
  for (const row of table.rows) {
    cumulative += row.weight;
    if (position < cumulative) return row.id;
  }
  // Multiplication can round the largest legal draw up to total for tiny totals.
  return table.rows[table.rows.length - 1]!.id;
}

/** One supplied draw, in caller order. Empty eligibility consumes no random value. */
export function chooseWeighted(
  candidates: readonly WeightedCandidate[],
  rng: Pick<Rng, 'next'>,
  options: WeightedLimits,
): string | null {
  return draw(capture(candidates, limits(options), new Set()), rng);
}

/** Optional recent-choice memory. Preparation consumes randomness; only commit consumes history. */
export function createChoiceHistory(options: ChoiceHistoryOptions) {
  const supplied = data(options, ['maxCandidates', 'maxIdLength', 'maxLabels', 'windowSize']);
  const bounds = limits({
    maxCandidates: integer(supplied.maxCandidates, 4096),
    maxIdLength: integer(supplied.maxIdLength, 256),
  });
  const config = Object.freeze({
    ...bounds,
    maxLabels: integer(supplied.maxLabels, 4096),
    windowSize: integer(supplied.windowSize, 4096),
  });
  if (config.maxLabels * config.windowSize > 65536) throw new RangeError('weighted: history product bound');
  let histories = new Map<string, readonly string[]>();
  let pending: ChoiceTicket | null = null;
  let disposed = false;
  let busy = false;
  function mutation<T>(operation: () => T): T {
    if (busy) throw new Error('weighted: reentrant mutation');
    busy = true;
    try {
      return operation();
    } finally {
      busy = false;
    }
  }
  return Object.freeze({
    prepare(labelInput: string, candidates: readonly WeightedCandidate[], rng: Pick<Rng, 'next'>): ChoicePreparation {
      return mutation(() => {
        if (disposed) return Object.freeze({status: 'disposed'});
        if (pending) return Object.freeze({status: 'busy'});
        const label = text(labelInput, config.maxIdLength);
        if (!histories.has(label) && histories.size === config.maxLabels) return Object.freeze({status: 'saturated'});
        const table = capture(candidates, config, new Set(histories.get(label) ?? []));
        if (disposed) return Object.freeze({status: 'disposed'});
        const id = draw(table, rng);
        if (disposed) return Object.freeze({status: 'disposed'});
        if (id === null) return Object.freeze({status: 'empty'});
        pending = Object.freeze({label, id});
        return Object.freeze({status: 'prepared', ticket: pending});
      });
    },
    commit(ticket: ChoiceTicket): boolean {
      return mutation(() => {
        if (disposed || pending === null || ticket !== pending) return false;
        const previous = histories.get(pending.label) ?? [];
        const start = Math.max(0, previous.length - config.windowSize + 1);
        histories.set(pending.label, Object.freeze([...previous.slice(start), pending.id]));
        pending = null;
        return true;
      });
    },
    cancel(ticket: ChoiceTicket): boolean {
      return mutation(() => {
        if (disposed || pending === null || ticket !== pending) return false;
        pending = null;
        return true;
      });
    },
    clear(label: string): boolean {
      return mutation(() => {
        if (disposed) return false;
        text(label, config.maxIdLength);
        if (pending?.label === label) pending = null;
        return histories.delete(label);
      });
    },
    snapshot(): ChoiceHistorySnapshot {
      return Object.freeze({
        version: 1,
        options: config,
        histories: Object.freeze([...histories].map(([label, ids]) => Object.freeze({label, ids}))),
      });
    },
    restore(value: unknown): boolean {
      return mutation(() => {
        if (disposed) return false;
        const raw = data(value, ['version', 'options', 'histories']);
        const saved = data(raw.options, ['maxCandidates', 'maxIdLength', 'maxLabels', 'windowSize']);
        if (raw.version !== 1 || Object.entries(config).some(([key, val]) => saved[key] !== val))
          throw new TypeError('weighted: incompatible snapshot');
        const next = new Map<string, readonly string[]>();
        for (const item of entries(raw.histories, config.maxLabels)) {
          const row = data(item, ['label', 'ids']);
          const label = text(row.label, config.maxIdLength);
          const ids = entries(row.ids, config.windowSize).map(id => text(id, config.maxIdLength));
          if (next.has(label) || !ids.length || new Set(ids).size !== ids.length)
            throw new TypeError('weighted: invalid history');
          next.set(label, Object.freeze(ids));
        }
        if (disposed) return false;
        histories = next;
        pending = null;
        return true;
      });
    },
    dispose(): void {
      disposed = true;
      pending = null;
      histories.clear();
    },
  });
}
export type ChoiceHistory = ReturnType<typeof createChoiceHistory>;
