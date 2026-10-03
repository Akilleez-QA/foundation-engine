export interface MaterialBatch {
  id: string;
  material: string;
  properties: Record<string, number>;
}
export interface InventoryAmount {
  container: string;
  batchId: string;
  quantity: number;
}
export interface InventoryOutput {
  container: string;
  batch: MaterialBatch;
  quantity: number;
}
export interface InventoryOptions {
  capacities: Record<string, number>;
  maxOperations?: number;
}
export type InventoryOperation =
  | {kind: 'exchange'; id: string; consume: InventoryAmount[]; produce: InventoryOutput[]}
  | {kind: 'reserve'; id: string; consume: InventoryAmount[]}
  | {kind: 'release'; id: string; reservationId: string}
  | {kind: 'commit'; id: string; reservationId: string; produce: InventoryOutput[]};
export interface InventorySnapshot {
  version: 1;
  capacities: Record<string, number>;
  operations: InventoryOperation[];
}
export type InventoryResult =
  | {ok: true; duplicate: boolean}
  | {ok: false; reason: 'conflict' | 'insufficient' | 'capacity' | 'batch-conflict' | 'reservation' | 'history-full'};
const validId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
function identifier(v: unknown): string {
  if (!validId(v)) throw new Error('Invalid inventory ID');
  return v;
}
function units(v: unknown, zero = false): number {
  if (!Number.isSafeInteger(v) || Number(v) < (zero ? 0 : 1))
    throw new Error('Inventory quantities must be safe integers');
  return v as number;
}
function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected inventory record');
  return raw as Record<string, unknown>;
}
function batch(raw: unknown): MaterialBatch {
  const b = record(raw),
    p = record(b.properties);
  const properties: Record<string, number> = Object.create(null);
  for (const key of Object.keys(p).sort()) {
    identifier(key);
    if (typeof p[key] !== 'number' || !Number.isFinite(p[key])) throw new Error('Invalid material property');
    properties[key] = p[key] as number;
  }
  return {id: identifier(b.id), material: identifier(b.material), properties};
}
function list<T>(raw: unknown, parse: (v: unknown) => T): T[] {
  if (!Array.isArray(raw)) throw new Error('Expected inventory list');
  return raw.map(parse);
}
function amount(raw: unknown): InventoryAmount {
  const v = record(raw);
  return {container: identifier(v.container), batchId: identifier(v.batchId), quantity: units(v.quantity)};
}
function output(raw: unknown): InventoryOutput {
  const v = record(raw);
  return {container: identifier(v.container), batch: batch(v.batch), quantity: units(v.quantity)};
}
/** Internal shared parser for ledger and checkpoint retry identity. */
export function parseInventoryOperation(raw: unknown): InventoryOperation {
  const v = record(raw),
    id = identifier(v.id);
  if (v.kind === 'exchange')
    return {kind: v.kind, id, consume: list(v.consume, amount), produce: list(v.produce, output)};
  if (v.kind === 'reserve') {
    const consume = list(v.consume, amount);
    if (!consume.length) throw new Error('Empty reservation');
    return {kind: v.kind, id, consume};
  }
  if (v.kind === 'release') return {kind: v.kind, id, reservationId: identifier(v.reservationId)};
  if (v.kind === 'commit')
    return {kind: v.kind, id, reservationId: identifier(v.reservationId), produce: list(v.produce, output)};
  throw new Error('Invalid inventory operation');
}
function capacities(raw: unknown): Record<string, number> {
  const v = record(raw),
    result: Record<string, number> = Object.create(null);
  if (!Object.keys(v).length) throw new Error('Inventory requires containers');
  for (const key of Object.keys(v).sort()) result[identifier(key)] = units(v[key], true);
  return result;
}
const keyOf = (container: string, batchId: string) => JSON.stringify([container, batchId]);

/** Local, synchronous inventory ledger. No storage, network, or cross-ledger atomicity. */
export function createInventoryLedger(options: InventoryOptions, saved?: unknown) {
  const caps = capacities(options.capacities);
  const maxOperations = units(options.maxOperations ?? 10000);
  let stock = new Map<string, number>();
  let batches = new Map<string, MaterialBatch>();
  const reservations = new Map<string, InventoryAmount[]>();
  const receipts = new Map<string, string>();
  const history: InventoryOperation[] = [];
  const locked = (key: string, except?: string) => {
    let n = 0;
    for (const [id, amounts] of reservations)
      if (id !== except) for (const a of amounts) if (keyOf(a.container, a.batchId) === key) n += a.quantity;
    return n;
  };
  const apply = (raw: InventoryOperation): InventoryResult => {
    const op = parseInventoryOperation(raw),
      signature = JSON.stringify(op),
      old = receipts.get(op.id);
    if (old !== undefined) return old === signature ? {ok: true, duplicate: true} : {ok: false, reason: 'conflict'};
    if (history.length >= maxOperations) return {ok: false, reason: 'history-full'};
    const reservationId = op.kind === 'commit' || op.kind === 'release' ? op.reservationId : undefined;
    if (reservationId !== undefined && !reservations.has(reservationId)) return {ok: false, reason: 'reservation'};
    const consume =
      op.kind === 'commit' ? reservations.get(op.reservationId)! : op.kind === 'release' ? [] : op.consume;
    const produce = op.kind === 'commit' || op.kind === 'exchange' ? op.produce : [];
    const candidate = new Map(stock),
      types = new Map(batches);
    for (const a of consume) {
      if (!Object.hasOwn(caps, a.container)) throw new Error('Unknown container');
      const key = keyOf(a.container, a.batchId),
        n = candidate.get(key) ?? 0;
      if (a.quantity > n - locked(key, reservationId)) return {ok: false, reason: 'insufficient'};
      candidate.set(key, n - a.quantity);
    }
    for (const a of produce) {
      if (!Object.hasOwn(caps, a.container)) throw new Error('Unknown container');
      const previous = types.get(a.batch.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(a.batch))
        return {ok: false, reason: 'batch-conflict'};
      types.set(a.batch.id, a.batch);
      const key = keyOf(a.container, a.batch.id),
        n = candidate.get(key) ?? 0;
      if (a.quantity > Number.MAX_SAFE_INTEGER - n) return {ok: false, reason: 'capacity'};
      candidate.set(key, n + a.quantity);
    }
    const remaining = new Map(Object.entries(caps));
    for (const [key, quantity] of candidate) {
      const [container] = JSON.parse(key) as [string, string];
      const room = remaining.get(container)!;
      if (quantity > room) return {ok: false, reason: 'capacity'};
      remaining.set(container, room - quantity);
    }
    if (op.kind === 'reserve') reservations.set(op.id, consume);
    else if (op.kind === 'release') reservations.delete(op.reservationId);
    else {
      stock = candidate;
      batches = types;
      if (op.kind === 'commit') reservations.delete(op.reservationId);
    }
    receipts.set(op.id, signature);
    history.push(op);
    return {ok: true, duplicate: false};
  };
  if (saved !== undefined) {
    const s = record(saved);
    if (
      s.version !== 1 ||
      JSON.stringify(capacities(s.capacities)) !== JSON.stringify(caps) ||
      !Array.isArray(s.operations)
    )
      throw new Error('Invalid inventory snapshot');
    for (const raw of s.operations) {
      const result = apply(parseInventoryOperation(raw));
      if (!result.ok || result.duplicate) throw new Error('Invalid inventory history');
    }
  }
  return {
    /** Consume and produce together, or change nothing. Failures can retry with the same ID. */
    transact(id: string, consume: InventoryAmount[], produce: InventoryOutput[]): InventoryResult {
      return apply({kind: 'exchange', id, consume, produce});
    },
    transfer(id: string, from: string, to: string, batchId: string, quantity: number): InventoryResult {
      identifier(id);
      identifier(from);
      identifier(to);
      identifier(batchId);
      units(quantity);
      const type = batches.get(batchId);
      if (!type) return {ok: false, reason: 'insufficient'};
      return apply({
        kind: 'exchange',
        id,
        consume: [{container: from, batchId, quantity}],
        produce: [{container: to, batch: type, quantity}],
      });
    },
    reserve(id: string, consume: InventoryAmount[]): InventoryResult {
      return apply({kind: 'reserve', id, consume});
    },
    release(id: string, reservationId: string): InventoryResult {
      return apply({kind: 'release', id, reservationId});
    },
    commitReservation(id: string, reservationId: string, produce: InventoryOutput[]): InventoryResult {
      return apply({kind: 'commit', id, reservationId, produce});
    },
    quantity(container: string, batchId: string): number {
      return stock.get(keyOf(container, batchId)) ?? 0;
    },
    available(container: string, batchId: string): number {
      const key = keyOf(container, batchId);
      return (stock.get(key) ?? 0) - locked(key);
    },
    material(batchId: string): MaterialBatch | undefined {
      const b = batches.get(batchId);
      return b ? batch(b) : undefined;
    },
    snapshot(): InventorySnapshot {
      return {version: 1, capacities: {...caps}, operations: history.map(parseInventoryOperation)};
    },
  };
}
