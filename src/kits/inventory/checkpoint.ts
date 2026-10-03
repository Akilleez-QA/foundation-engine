import {
  createInventoryLedger,
  parseInventoryOperation,
  type InventoryOperation,
  type InventoryOptions,
  type InventorySnapshot,
  type MaterialBatch,
} from './ledger.js';
export interface CheckpointInventorySnapshot {
  version: 1;
  epoch: number;
  base: InventorySnapshot;
  operations: InventoryOperation[];
  materials: MaterialBatch[];
}
/** Explicit epoch boundary bounds retries without ever treating an old request as new. */
export function createCheckpointInventory(
  input: InventoryOptions & {maxMaterials?: number},
  saved?: CheckpointInventorySnapshot,
) {
  const options = structuredClone(input);
  const limit = options.maxOperations ?? 256,
    maxMaterials = options.maxMaterials ?? 1024;
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(maxMaterials) || maxMaterials < 1)
    throw Error('inventory checkpoint: invalid limits');
  const ledgerOptions = {...options, maxOperations: limit + maxMaterials + 2};
  let epoch = 0,
    base = createInventoryLedger(ledgerOptions).snapshot(),
    ledger = createInventoryLedger(ledgerOptions),
    operations: InventoryOperation[] = [];
  const materials = new Map<string, MaterialBatch>(),
    receipts = new Map<string, string>();
  const normalize = (b: MaterialBatch) => {
    const p = createInventoryLedger({capacities: {probe: 1}});
    p.transact('probe', [], [{container: 'probe', batch: b, quantity: 1}]);
    return p.material(b.id)!;
  };
  const apply = (generation: number, raw: InventoryOperation) => {
    if (!Number.isSafeInteger(generation) || generation < 0) throw Error('inventory checkpoint: invalid epoch');
    if (generation !== epoch) return {ok: false as const, reason: 'stale-epoch'};
    const op = parseInventoryOperation(raw),
      signature = JSON.stringify(op),
      old = receipts.get(op.id);
    if (old !== undefined)
      return old === signature ? {ok: true as const, duplicate: true} : {ok: false as const, reason: 'conflict'};
    if (typeof op.id !== 'string' || op.id.startsWith('__checkpoint-'))
      throw Error('inventory checkpoint: reserved operation ID');
    if (operations.length >= limit) return {ok: false as const, reason: 'checkpoint-required'};
    const next = new Map(materials);
    if ('produce' in op)
      for (const output of op.produce) {
        const b = normalize(output.batch),
          existing = next.get(b.id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(b))
          return {ok: false as const, reason: 'batch-conflict'};
        next.set(b.id, b);
      }
    if (next.size > maxMaterials) return {ok: false as const, reason: 'materials-full'};
    let result;
    switch (op.kind) {
      case 'exchange':
        result = ledger.transact(op.id, op.consume, op.produce);
        break;
      case 'reserve':
        result = ledger.reserve(op.id, op.consume);
        break;
      case 'release':
        result = ledger.release(op.id, op.reservationId);
        break;
      case 'commit':
        result = ledger.commitReservation(op.id, op.reservationId, op.produce);
        break;
      default:
        throw Error('inventory checkpoint: invalid operation');
    }
    // Base reservations retain stable IDs. They cannot be reused as new operation IDs.
    if (!result.ok) return result;
    if (result.duplicate) return {ok: false as const, reason: 'conflict'};
    materials.clear();
    for (const [id, b] of next) materials.set(id, b);
    operations.push(op);
    receipts.set(op.id, signature);
    return result;
  };
  if (saved) {
    if (
      saved.version !== 1 ||
      !Number.isSafeInteger(saved.epoch) ||
      saved.epoch < 0 ||
      !Array.isArray(saved.operations) ||
      saved.operations.length > limit ||
      !Array.isArray(saved.materials) ||
      saved.materials.length > maxMaterials
    )
      throw Error('inventory checkpoint: invalid snapshot');
    epoch = saved.epoch;
    base = structuredClone(saved.base);
    ledger = createInventoryLedger(ledgerOptions, base);
    for (const b of saved.materials) {
      const n = normalize(b);
      if (materials.has(n.id)) throw Error('inventory checkpoint: duplicate material');
      materials.set(n.id, n);
    }
    for (const op of base.operations)
      if ('produce' in op)
        for (const output of op.produce) {
          const b = normalize(output.batch);
          if (JSON.stringify(materials.get(b.id)) !== JSON.stringify(b))
            throw Error('inventory checkpoint: missing material identity');
        }
    for (const op of saved.operations) {
      const r = apply(epoch, op);
      if (!r.ok || r.duplicate) throw Error('inventory checkpoint: invalid history');
    }
  }
  return {
    apply,
    /** Persist snapshot() atomically after checkpoint() before accepting requests for its returned epoch. */
    checkpoint() {
      if (epoch === Number.MAX_SAFE_INTEGER) throw Error('inventory checkpoint: epoch exhausted');
      const snapshot = ledger.snapshot(),
        reservations = new Map<string, Extract<InventoryOperation, {kind: 'reserve'}>>();
      for (const op of snapshot.operations) {
        if (op.kind === 'reserve') reservations.set(op.id, op);
        else if (op.kind === 'release' || op.kind === 'commit') reservations.delete(op.reservationId);
      }
      if (reservations.size > maxMaterials) throw Error('inventory checkpoint: too many active reservations');
      const next = createInventoryLedger(ledgerOptions),
        produce = [];
      for (const container of Object.keys(options.capacities))
        for (const batch of materials.values()) {
          const quantity = ledger.quantity(container, batch.id);
          if (quantity) produce.push({container, batch, quantity});
        }
      if (produce.length) {
        const r = next.transact('__checkpoint-stock', [], produce);
        if (!r.ok) throw Error('inventory checkpoint: stock rebuild failed');
      }
      for (const reservation of reservations.values()) {
        const r = next.reserve(reservation.id, reservation.consume);
        if (!r.ok) throw Error('inventory checkpoint: reservation rebuild failed');
      }
      ledger = next;
      base = next.snapshot();
      epoch++;
      operations = [];
      receipts.clear();
      return epoch;
    },
    quantity: (container: string, batchId: string) => ledger.quantity(container, batchId),
    available: (container: string, batchId: string) => ledger.available(container, batchId),
    material: (id: string) => (materials.has(id) ? structuredClone(materials.get(id)!) : undefined),
    get epoch() {
      return epoch;
    },
    snapshot: (): CheckpointInventorySnapshot => ({
      version: 1,
      epoch,
      base: structuredClone(base),
      operations: structuredClone(operations),
      materials: [...materials.values()].map(b => structuredClone(b)),
    }),
  };
}
