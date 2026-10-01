import {createCheckpointInventory, type CheckpointInventorySnapshot} from './checkpoint.js';
import {parseInventoryOperation, type InventoryOperation, type InventoryOptions} from './ledger.js';

export interface RetirementInventoryOptions extends InventoryOptions { maxMaterials?: number; maxReferences?: number }
export interface RetirementInventorySnapshot {
  version: 1;
  generation: number;
  nextClaim: number;
  references: {claim: number; batchId: string}[];
  checkpoint: CheckpointInventorySnapshot;
}
const safe = (n: number) => Number.isSafeInteger(n) && n >= 0;
/** Canonical identity in one inventory's issuance namespace. Local names remain creator-defined. */
export function qualifiedInventoryId(generation: number, localId: string): string {
  if (!safe(generation) || typeof localId !== 'string' || !localId.length) throw Error('inventory retirement: invalid identity');
  const id = `${generation}:${localId}`;
  if (id.length > 256) throw Error('inventory retirement: identity too long');
  return id;
}
function identityGeneration(id: string): number {
  if (typeof id !== 'string') throw Error('inventory retirement: invalid identity');
  const separator = id.indexOf(':'), generation = Number(id.slice(0, separator));
  if (separator < 1 || qualifiedInventoryId(generation, id.slice(separator + 1)) !== id) throw Error('inventory retirement: noncanonical identity');
  return generation;
}

/** Optional local facade. Registered claims delimit its knowledge of external references. */
export function createRetirementInventory(input: RetirementInventoryOptions, saved?: RetirementInventorySnapshot) {
  const options = structuredClone(input), limit = options.maxMaterials ?? 1024, referenceLimit = options.maxReferences ?? 1024;
  if (!Number.isSafeInteger(referenceLimit) || referenceLimit < 1) throw Error('inventory retirement: invalid reference limit');
  let inventory = createCheckpointInventory(options), generation = 0, nextClaim = 0, busy = false;
  const references = new Map<number, string>();
  const guarded = <T>(work: () => T): T => {
    if (busy) throw Error('inventory retirement: reentrant mutation');
    busy = true; try { return work(); } finally { busy = false; }
  };
  if (saved !== undefined) {
    const snapshot = structuredClone(saved);
    if (snapshot.version !== 1 || !safe(snapshot.generation) || !safe(snapshot.nextClaim) || !Array.isArray(snapshot.references) || snapshot.references.length > referenceLimit) throw Error('inventory retirement: invalid snapshot');
    if (!snapshot.checkpoint || typeof snapshot.checkpoint !== 'object' || Array.isArray(snapshot.checkpoint)) throw Error('inventory retirement: missing checkpoint record');
    if (!snapshot.checkpoint.base || typeof snapshot.checkpoint.base !== 'object' || Array.isArray(snapshot.checkpoint.base)) throw Error('inventory retirement: missing checkpoint base record');
    inventory = createCheckpointInventory(options, snapshot.checkpoint);
    generation = snapshot.generation; nextClaim = snapshot.nextClaim;
    if (generation > inventory.epoch) throw Error('inventory retirement: generation exceeds epoch');
    for (const batch of inventory.snapshot().materials) if (identityGeneration(batch.id) > generation) throw Error('inventory retirement: future identity');
    for (const ref of snapshot.references) {
      if (!safe(ref.claim) || ref.claim >= nextClaim || references.has(ref.claim) || !inventory.material(ref.batchId)) throw Error('inventory retirement: invalid reference');
      references.set(ref.claim, ref.batchId);
    }
  }
  return {
    get epoch() { return inventory.epoch; },
    get generation() { return generation; },
    qualify: (localId: string) => qualifiedInventoryId(generation, localId),
    apply(epoch: number, raw: InventoryOperation) {
      return guarded(() => {
        if (!safe(epoch)) throw Error('inventory retirement: invalid epoch');
        if (epoch !== inventory.epoch) return {ok: false as const, reason: 'stale-epoch'};
        // Detach before parsing: caller array methods/getters must not retain authority over the draft.
        const operation = parseInventoryOperation(structuredClone(raw));
        // Preserve the checkpoint owner's current-epoch retry/conflict precedence.
        if (inventory.snapshot().operations.some(previous => previous.id === operation.id)) return inventory.apply(epoch, operation);
        if ('produce' in operation) for (const output of operation.produce) {
          const issued = identityGeneration(output.batch.id);
          if (!inventory.material(output.batch.id) && issued !== generation) return {ok: false as const, reason: 'retired-generation'};
        }
        return inventory.apply(epoch, operation);
      });
    },
    /** Null means unknown material or exhausted reference capacity; allocation never reuses claim IDs. */
    claim(batchId: string): number | null {
      return guarded(() => {
        if (typeof batchId !== 'string' || !inventory.material(batchId) || references.size >= referenceLimit) return null;
        if (nextClaim === Number.MAX_SAFE_INTEGER) throw Error('inventory retirement: claim counter exhausted');
        const claim = nextClaim++; references.set(claim, batchId); return claim;
      });
    },
    releaseClaim(claim: number): boolean { return guarded(() => references.delete(claim)); },
    /** Advances retry epoch only; publication/persistence is the caller's existing save responsibility. */
    checkpoint(): number {
      return guarded(() => {
        const draft = createCheckpointInventory(options, inventory.snapshot());
        const epoch = draft.checkpoint(); inventory = draft; return epoch;
      });
    },
    retire(raw: readonly string[]) {
      return guarded(() => {
        const candidates: readonly string[] = structuredClone(raw);
        if (!Array.isArray(candidates) || !candidates.length || candidates.length > limit) throw Error('inventory retirement: invalid candidates');
        const ids = new Set<string>(), pinned = new Set(references.values());
        for (const id of candidates) {
          if (typeof id !== 'string' || ids.has(id)) throw Error('inventory retirement: invalid candidate');
          ids.add(id);
          if (!inventory.material(id)) return {ok: false as const, reason: 'unknown-material'};
          if (pinned.has(id)) return {ok: false as const, reason: 'referenced'};
          for (const container of Object.keys(options.capacities)) if (inventory.quantity(container, id) !== 0) return {ok: false as const, reason: 'stock'};
        }
        if (generation === Number.MAX_SAFE_INTEGER) throw Error('inventory retirement: generation exhausted');
        const draft = createCheckpointInventory(options, inventory.snapshot());
        draft.checkpoint(); // Rebuild stock and reservations before removing any identity.
        const prepared = draft.snapshot();
        prepared.materials = prepared.materials.filter(batch => !ids.has(batch.id));
        const replacement = createCheckpointInventory(options, prepared);
        inventory = replacement; generation++;
        return {ok: true as const, epoch: inventory.epoch, generation};
      });
    },
    quantity: (container: string, batchId: string) => inventory.quantity(container, batchId),
    available: (container: string, batchId: string) => inventory.available(container, batchId),
    material: (id: string) => inventory.material(id),
    snapshot: (): RetirementInventorySnapshot => ({version: 1, generation, nextClaim, references: [...references].map(([claim, batchId]) => ({claim, batchId})), checkpoint: inventory.snapshot()}),
  };
}
