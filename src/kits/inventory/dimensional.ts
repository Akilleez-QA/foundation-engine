/** Pure candidate transforms. The enclosing world owns revisions, receipts and durable publication. */
export interface StockBatch {
  id: string;
  material: string;
  unit: string;
  phase: string;
  /** Exact authored packing dimensions per integer unit, not an equation of state. */
  massMg: number;
  volumeUl: number;
  properties: Record<string, number>;
}
export interface StockContainer {
  id: string;
  maxMassMg: number;
  maxVolumeUl: number;
  phases: string[];
}
export interface StockPosition {
  container: string;
  batch: string;
  quantity: number;
}
export interface DimensionalStock {
  version: 1;
  containers: StockContainer[];
  batches: StockBatch[];
  positions: StockPosition[];
}
export interface StockBounds {
  containers: number;
  batches: number;
  positions: number;
  changes: number;
  properties: number;
}
export interface StockChange {
  addContainers?: StockContainer[];
  resizeContainers?: {id: string; maxMassMg: number; maxVolumeUl: number}[];
  removeContainers?: string[];
  issueBatches?: StockBatch[];
  consume?: StockPosition[];
  produce?: StockPosition[];
}
export type StockFailure =
  'invalid' | 'limit' | 'unknown' | 'identity' | 'insufficient' | 'capacity' | 'phase' | 'occupied';
export type StockCandidate =
  | {ok: true; state: DimensionalStock; consumedMassMg: number; producedMassMg: number}
  | {ok: false; reason: StockFailure};
export class StockValidationError extends Error {
  constructor(readonly reason: StockFailure) {
    super(reason);
  }
}
const fail = (reason: StockFailure): never => {
  throw new StockValidationError(reason);
};
const id = (v: unknown): string => (typeof v === 'string' && v.length > 0 && v.length <= 256 ? v : fail('invalid'));
const integer = (v: unknown, positive = false): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= (positive ? 1 : 0) ? v : fail('invalid');
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : fail('invalid');
function list(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v)) return fail('invalid');
  if (v.length > max) return fail('limit');
  const result: unknown[] = [];
  const length = v.length;
  for (let i = 0; i < length; i++) result.push(v[i]);
  return result;
}
const exact = (value: bigint): number => (value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : fail('capacity'));
function limits(raw: StockBounds): StockBounds {
  const b = object(raw);
  return {
    containers: integer(b.containers, true),
    batches: integer(b.batches, true),
    positions: integer(b.positions, true),
    changes: integer(b.changes, true),
    properties: integer(b.properties, true),
  };
}
function container(raw: unknown, b: StockBounds): StockContainer {
  const c = object(raw),
    phases = list(c.phases, b.changes).map(id);
  if (!phases.length || new Set(phases).size !== phases.length) return fail('invalid');
  return {id: id(c.id), maxMassMg: integer(c.maxMassMg), maxVolumeUl: integer(c.maxVolumeUl), phases: phases.sort()};
}
function batch(raw: unknown, bounds: StockBounds): StockBatch {
  const b = object(raw),
    p = object(b.properties),
    keys = Object.keys(p).sort();
  if (keys.length > bounds.properties) return fail('limit');
  const properties: Record<string, number> = Object.create(null);
  for (const k of keys) {
    id(k);
    if (typeof p[k] !== 'number' || !Number.isFinite(p[k])) return fail('invalid');
    properties[k] = p[k];
  }
  return {
    id: id(b.id),
    material: id(b.material),
    unit: id(b.unit),
    phase: id(b.phase),
    massMg: integer(b.massMg),
    volumeUl: integer(b.volumeUl),
    properties,
  };
}
function position(raw: unknown): StockPosition {
  const p = object(raw);
  return {container: id(p.container), batch: id(p.batch), quantity: integer(p.quantity, true)};
}
const key = (p: Pick<StockPosition, 'container' | 'batch'>) => JSON.stringify([p.container, p.batch]);
function unique<T extends {id: string}>(values: T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const v of values) {
    if (result.has(v.id)) return fail('identity');
    result.set(v.id, v);
  }
  return result;
}
function validateCapacity(
  containers: Map<string, StockContainer>,
  batches: Map<string, StockBatch>,
  positions: Map<string, StockPosition>,
) {
  const totals = new Map<string, {mass: bigint; volume: bigint}>();
  for (const p of positions.values()) {
    const c = containers.get(p.container),
      b = batches.get(p.batch);
    if (!c || !b) return fail('unknown');
    if (!c.phases.includes(b.phase)) return fail('phase');
    const t = totals.get(c.id) ?? {mass: 0n, volume: 0n};
    t.mass += BigInt(p.quantity) * BigInt(b.massMg);
    t.volume += BigInt(p.quantity) * BigInt(b.volumeUl);
    if (t.mass > BigInt(c.maxMassMg) || t.volume > BigInt(c.maxVolumeUl)) return fail('capacity');
    totals.set(c.id, t);
  }
}
function parse(raw: unknown, bounds: StockBounds) {
  const s = object(raw);
  if (s.version !== 1) return fail('invalid');
  const containers = unique(list(s.containers, bounds.containers).map(v => container(v, bounds)));
  const batches = unique(list(s.batches, bounds.batches).map(v => batch(v, bounds)));
  const positions = new Map<string, StockPosition>();
  for (const rawPosition of list(s.positions, bounds.positions)) {
    const p = position(rawPosition),
      k = key(p);
    if (positions.has(k)) return fail('identity');
    positions.set(k, p);
  }
  validateCapacity(containers, batches, positions);
  return {containers, batches, positions};
}
const ordered = <T extends {id: string}>(values: Iterable<T>) =>
  [...values].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
/** Throws on corrupt saved state; no input object is retained or modified. */
export function parseDimensionalStock(raw: unknown, inputBounds: StockBounds): DimensionalStock {
  const bounds = limits(inputBounds),
    s = parse(raw, bounds);
  return {
    version: 1,
    containers: ordered(s.containers.values()),
    batches: ordered(s.batches.values()),
    positions: [...s.positions.values()].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)),
  };
}
/**
 * Atomic in-memory transform, not storage or cross-tab CAS. All consumes precede all produces.
 * The enclosing owner validates sources/sinks (deposit, construction, recipe, cargo) and records
 * command identity. Calling this reducer twice against the same base is preparation, not two commits.
 */
export function prepareStockChange(raw: unknown, change: StockChange, inputBounds: StockBounds): StockCandidate {
  try {
    const bounds = limits(inputBounds),
      {containers, batches, positions} = parse(raw, bounds),
      op = object(change);
    const fields = [
      'addContainers',
      'resizeContainers',
      'removeContainers',
      'issueBatches',
      'consume',
      'produce',
    ] as const;
    const parts = Object.fromEntries(
      fields.map(k => [k, op[k] === undefined ? [] : list(op[k], bounds.changes)]),
    ) as Record<(typeof fields)[number], unknown[]>;
    if (fields.reduce((n, k) => n + parts[k].length, 0) > bounds.changes) return fail('limit');
    const touched = new Set<string>();
    for (const rawContainer of parts.addContainers) {
      const c = container(rawContainer, bounds);
      if (containers.has(c.id) || touched.has(c.id)) return fail('identity');
      touched.add(c.id);
      containers.set(c.id, c);
    }
    for (const rawResize of parts.resizeContainers) {
      const r = object(rawResize),
        cid = id(r.id),
        c = containers.get(cid);
      if (!c) return fail('unknown');
      if (touched.has(cid)) return fail('identity');
      touched.add(cid);
      containers.set(cid, {...c, maxMassMg: integer(r.maxMassMg), maxVolumeUl: integer(r.maxVolumeUl)});
    }
    for (const rawBatch of parts.issueBatches) {
      const b = batch(rawBatch, bounds),
        old = batches.get(b.id);
      if (old && JSON.stringify(old) !== JSON.stringify(b)) return fail('identity');
      batches.set(b.id, b);
    }
    let consumed = 0n,
      produced = 0n;
    for (const rawAmount of parts.consume) {
      const p = position(rawAmount),
        k = key(p),
        old = positions.get(k),
        b = batches.get(p.batch);
      if (!containers.has(p.container) || !b) return fail('unknown');
      if (!old || old.quantity < p.quantity) return fail('insufficient');
      consumed += BigInt(p.quantity) * BigInt(b.massMg);
      if (old.quantity === p.quantity) positions.delete(k);
      else positions.set(k, {...old, quantity: old.quantity - p.quantity});
    }
    for (const rawAmount of parts.produce) {
      const p = position(rawAmount),
        k = key(p),
        b = batches.get(p.batch);
      if (!containers.has(p.container) || !b) return fail('unknown');
      const quantity = exact(BigInt(positions.get(k)?.quantity ?? 0) + BigInt(p.quantity));
      positions.set(k, {...p, quantity});
      produced += BigInt(p.quantity) * BigInt(b.massMg);
    }
    for (const rawId of parts.removeContainers) {
      const cid = id(rawId);
      if (touched.has(cid)) return fail('identity');
      touched.add(cid);
      if (!containers.has(cid)) return fail('unknown');
      if ([...positions.values()].some(p => p.container === cid)) return fail('occupied');
      containers.delete(cid);
    }
    if (containers.size > bounds.containers || batches.size > bounds.batches || positions.size > bounds.positions)
      return fail('limit');
    validateCapacity(containers, batches, positions);
    return {
      ok: true,
      state: parseDimensionalStock(
        {
          version: 1,
          containers: [...containers.values()],
          batches: [...batches.values()],
          positions: [...positions.values()],
        },
        bounds,
      ),
      consumedMassMg: exact(consumed),
      producedMassMg: exact(produced),
    };
  } catch (error) {
    if (error instanceof StockValidationError) return {ok: false, reason: error.reason};
    throw error;
  }
}

export interface StockTransfer {
  from: string;
  to: string;
  batch: string;
  quantity: number;
}
/** Ordered, all-or-nothing transfers. Two stock changes per transfer count against
 * the existing changes bound. Every intermediate capacity/position limit applies;
 * a later transfer cannot rescue an earlier overfill. No persistent owner. */
export function prepareStockTransfers(
  raw: unknown,
  input: readonly StockTransfer[],
  inputBounds: StockBounds,
): StockCandidate {
  try {
    const bounds = limits(inputBounds),
      transfers = list(input, Math.floor(bounds.changes / 2)).map(value => {
        const t = object(value);
        return {from: id(t.from), to: id(t.to), batch: id(t.batch), quantity: integer(t.quantity, true)};
      });
    const {containers, batches, positions} = parse(raw, bounds);
    let moved = 0n;
    for (const t of transfers) {
      const source = {container: t.from, batch: t.batch, quantity: t.quantity},
        target = {...source, container: t.to};
      const from = key(source),
        to = key(target),
        old = positions.get(from),
        batch = batches.get(t.batch);
      if (!containers.has(t.from) || !containers.has(t.to) || !batch) return fail('unknown');
      if (!old || old.quantity < t.quantity) return fail('insufficient');
      if (old.quantity === t.quantity) positions.delete(from);
      else positions.set(from, {...old, quantity: old.quantity - t.quantity});
      positions.set(to, {...target, quantity: exact(BigInt(positions.get(to)?.quantity ?? 0) + BigInt(t.quantity))});
      if (positions.size > bounds.positions) return fail('limit');
      validateCapacity(containers, batches, positions);
      moved += BigInt(t.quantity) * BigInt(batch.massMg);
    }
    return {
      ok: true,
      state: parseDimensionalStock(
        {
          version: 1,
          containers: [...containers.values()],
          batches: [...batches.values()],
          positions: [...positions.values()],
        },
        bounds,
      ),
      consumedMassMg: exact(moved),
      producedMassMg: exact(moved),
    };
  } catch (error) {
    if (error instanceof StockValidationError) return {ok: false, reason: error.reason};
    throw error;
  }
}
