import {
  createInventoryLedger,
  parseInventoryOperation,
  type InventoryAmount,
  type InventoryOutput,
  type InventoryResult,
  type MaterialBatch,
} from './ledger.js';

/**
 * Optional slot, stack and key-item rules over the inventory ledger. The ledger keeps quantities per container and
 * batch; these rules add the familiar limits of item bags: a number of slots, a stack size per material, items that
 * cannot be discarded, and items a holder may own only a few of. Every operation is checked against the rules on the
 * projected result before the ledger applies it; refused operations change nothing and leave no receipt.
 */
export interface ContainerRule {
  /** Distinct slots (1–4,096). */
  readonly slots: number;
  /** Stack size for materials without their own (1–1,000,000). */
  readonly stackSize: number;
  /**
   * `spill` (default): a batch over its stack size occupies ⌈quantity / stack⌉ slots, as when a full stack overflows
   * into a new slot. `single`: one slot per batch and quantity at most the stack size.
   */
  readonly overflow?: 'spill' | 'single';
}
export interface MaterialRule {
  /** Stack size for this material in every container (1 = unstackable). */
  readonly stackSize?: number;
  /** Key items cannot be discarded, and are consumed only by operations that say `allowKey`. */
  readonly key?: boolean;
  /** Most units of this material the whole inventory may hold (1 = unique). */
  readonly maxOwned?: number;
  /** Containers this material may be placed in (default: all). */
  readonly containers?: readonly string[];
}
export interface InventoryRulesInput {
  readonly containers: Readonly<Record<string, ContainerRule>>;
  readonly materials?: Readonly<Record<string, MaterialRule>>;
}
export interface InventoryRules {
  readonly containers: Readonly<Record<string, Readonly<Required<ContainerRule>>>>;
  readonly materials: Readonly<Record<string, Readonly<MaterialRule>>>;
}
export type RuleRefusal = 'slots' | 'stack' | 'key-item' | 'owned' | 'container';
export type RuledResult = InventoryResult | {ok: false; reason: RuleRefusal; container?: string; material?: string};

const ID = /^.{1,256}$/su;
const int = (v: unknown, min: number, max: number, what: string): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
    throw new Error(`inventory rules: ${what} must be an integer in ${min}..${max}`);
  return v;
};
function plain(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`inventory rules: ${what} must be a record`);
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) throw new Error(`inventory rules: ${what} must be plain data`);
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(v)) {
    if (typeof key !== 'string' || !ID.test(key) || key === '__proto__')
      throw new Error(`inventory rules: ${what} has an invalid key`);
    const d = Object.getOwnPropertyDescriptor(v, key)!;
    if (!('value' in d)) throw new Error(`inventory rules: ${what} has an accessor`);
    out[key] = d.value;
  }
  return out;
}

/** Validate rules: known containers, positive stack sizes, consistent material placement. */
export function defineInventoryRules(input: InventoryRulesInput): InventoryRules {
  const raw = plain(input, 'rules');
  const containersRaw = plain(raw.containers, 'containers');
  const names = Object.keys(containersRaw).sort();
  if (!names.length || names.length > 64) throw new Error('inventory rules: 1..64 containers');
  const containers: Record<string, Readonly<Required<ContainerRule>>> = Object.create(null);
  for (const name of names) {
    const c = plain(containersRaw[name], `container ${name}`);
    const overflow = c.overflow ?? 'spill';
    if (overflow !== 'spill' && overflow !== 'single') throw new Error(`inventory rules: ${name} overflow`);
    containers[name] = Object.freeze({
      slots: int(c.slots, 1, 4096, `${name} slots`),
      stackSize: int(c.stackSize, 1, 1_000_000, `${name} stackSize`),
      overflow,
    });
  }
  const materialsRaw = raw.materials === undefined ? {} : plain(raw.materials, 'materials');
  if (Object.keys(materialsRaw).length > 4096) throw new Error('inventory rules: at most 4,096 material rules');
  const materials: Record<string, Readonly<MaterialRule>> = Object.create(null);
  for (const name of Object.keys(materialsRaw).sort()) {
    const m = plain(materialsRaw[name], `material ${name}`);
    const rule: {-readonly [K in keyof MaterialRule]: MaterialRule[K]} = {};
    if (m.stackSize !== undefined) rule.stackSize = int(m.stackSize, 1, 1_000_000, `${name} stackSize`);
    if (m.key !== undefined) {
      if (typeof m.key !== 'boolean') throw new Error(`inventory rules: ${name} key must be boolean`);
      rule.key = m.key;
    }
    if (m.maxOwned !== undefined) rule.maxOwned = int(m.maxOwned, 1, Number.MAX_SAFE_INTEGER, `${name} maxOwned`);
    if (m.containers !== undefined) {
      if (!Array.isArray(m.containers) || !m.containers.length) throw new Error(`inventory rules: ${name} containers`);
      for (const c of m.containers)
        if (typeof c !== 'string' || !Object.hasOwn(containers, c))
          throw new Error(`inventory rules: ${name} names unknown container ${String(c)}`);
      rule.containers = Object.freeze([...new Set(m.containers as string[])].sort());
    }
    materials[name] = Object.freeze(rule);
  }
  return Object.freeze({containers: Object.freeze(containers), materials: Object.freeze(materials)});
}

/**
 * A ledger with rules. Container capacities given to the ledger are derived from the rules (slots × the largest stack
 * size that container can hold), so the ledger never refuses what the rules allow. Persist `snapshot()` exactly as
 * the ledger's; restore replays history through the same rules.
 */
export function createRuledInventory(rules: InventoryRules, options: {maxOperations?: number} = {}, saved?: unknown) {
  const checked = defineInventoryRules(rules);
  const names = Object.keys(checked.containers);
  // The rules are the limit; the ledger's quantity capacity stays out of the way and does not change with content,
  // so adding a material rule never invalidates existing saves.
  const capacities = Object.fromEntries(names.map(n => [n, Number.MAX_SAFE_INTEGER]));
  /** Reservations seen by this facade: their amounts (consumed at commit) and whether key items were allowed. */
  const reservations = new Map<string, {consume: InventoryAmount[]; allowKey: boolean}>();
  const ledgerOptions =
    options.maxOperations === undefined ? {capacities} : {capacities, maxOperations: options.maxOperations};
  // Build empty, then replay the saved history through the rules (slots, stacks, ownership and placement; the
  // history does not record whether a consumption was allowed to take key items, so replay allows it).
  const ledger = createInventoryLedger(ledgerOptions);
  const stackOf = (container: string, material: string) =>
    checked.materials[material]?.stackSize ?? checked.containers[container]?.stackSize ?? 1;

  /** Check rules on the projected stock after consuming and producing. Null when allowed. */
  const check = (
    consume: readonly InventoryAmount[],
    produce: readonly InventoryOutput[],
    allowKey: boolean,
  ): RuledResult | null => {
    const materialOf = new Map<string, string>();
    const touched = new Set<string>();
    for (const a of consume) {
      if (!Object.hasOwn(checked.containers, a.container)) return null; // the ledger reports unknown containers
      const m = ledger.material(a.batchId);
      if (!m) return null; // the ledger reports insufficient stock
      materialOf.set(a.batchId, m.material);
      if (checked.materials[m.material]?.key && !allowKey)
        return {ok: false, reason: 'key-item', container: a.container, material: m.material};
      touched.add(a.container);
    }
    for (const o of produce) {
      if (!Object.hasOwn(checked.containers, o.container)) return null;
      materialOf.set(o.batch.id, o.batch.material);
      const allowed = checked.materials[o.batch.material]?.containers;
      if (allowed && !allowed.includes(o.container))
        return {ok: false, reason: 'container', container: o.container, material: o.batch.material};
      touched.add(o.container);
    }
    // Projected quantities per container and batch.
    const projected = new Map<string, Map<string, number>>();
    for (const c of touched) projected.set(c, new Map(ledger.contents(c).map(r => [r.batchId, r.quantity])));
    for (const a of consume) {
      const rows = projected.get(a.container)!;
      rows.set(a.batchId, (rows.get(a.batchId) ?? 0) - a.quantity);
    }
    for (const o of produce) {
      const rows = projected.get(o.container)!;
      rows.set(o.batch.id, (rows.get(o.batch.id) ?? 0) + o.quantity);
    }
    for (const c of [...touched].sort()) {
      const rule = checked.containers[c]!;
      let used = 0;
      for (const [batchId, q] of projected.get(c)!) {
        if (q <= 0) continue;
        const material = materialOf.get(batchId) ?? ledger.material(batchId)?.material ?? '';
        const stack = stackOf(c, material);
        if (rule.overflow === 'single') {
          if (q > stack) return {ok: false, reason: 'stack', container: c, material};
          used += 1;
        } else used += Math.ceil(q / stack);
      }
      if (used > rule.slots) return {ok: false, reason: 'slots', container: c};
    }
    // Ownership limits across every container, for materials whose quantity grows.
    const growing = new Set(produce.map(o => o.batch.material));
    for (const material of [...growing].sort()) {
      const limit = checked.materials[material]?.maxOwned;
      if (limit === undefined) continue;
      let owned = 0;
      for (const c of names) {
        const rows = projected.get(c) ?? new Map(ledger.contents(c).map(r => [r.batchId, r.quantity]));
        for (const [batchId, q] of rows)
          if (q > 0 && (materialOf.get(batchId) ?? ledger.material(batchId)?.material) === material) owned += q;
      }
      if (owned > limit) return {ok: false, reason: 'owned', material};
    }
    return null;
  };

  const ruled = {
    rules: checked,
    /** Consume and produce together under the rules. Consuming a key item needs `{allowKey: true}` (a scripted use). */
    transact(
      id: string,
      consume: InventoryAmount[],
      produce: InventoryOutput[],
      o: {allowKey?: boolean} = {},
    ): RuledResult {
      // A retry gets the ledger's own answer (duplicate or conflict), never a second rule check.
      if (ledger.hasReceipt(id)) return ledger.transact(id, consume, produce);
      const refusal = check(consume, produce, o.allowKey === true);
      return refusal ?? ledger.transact(id, consume, produce);
    },
    /** Throw away units. Key items are always refused. */
    discard(id: string, container: string, batchId: string, quantity: number): RuledResult {
      const consume = [{container, batchId, quantity}];
      if (ledger.hasReceipt(id)) return ledger.transact(id, consume, []);
      return check(consume, [], false) ?? ledger.transact(id, consume, []);
    },
    /** Move units between containers under both containers' rules (key items may move). */
    transfer(id: string, from: string, to: string, batchId: string, quantity: number): RuledResult {
      const batch: MaterialBatch | undefined = ledger.material(batchId);
      if (!batch || ledger.hasReceipt(id)) return ledger.transfer(id, from, to, batchId, quantity);
      const refusal = check([{container: from, batchId, quantity}], [{container: to, batch, quantity}], true);
      return refusal ?? ledger.transfer(id, from, to, batchId, quantity);
    },
    /** Lock units for a later commit. Reserving a key item needs `{allowKey: true}`, since the commit consumes it. */
    reserve(id: string, consume: InventoryAmount[], o: {allowKey?: boolean} = {}): RuledResult {
      if (ledger.hasReceipt(id)) return ledger.reserve(id, consume);
      const allowKey = o.allowKey === true;
      if (!allowKey)
        for (const a of consume) {
          const m = ledger.material(a.batchId);
          if (m && checked.materials[m.material]?.key)
            return {ok: false, reason: 'key-item', container: a.container, material: m.material};
        }
      const result = ledger.reserve(id, consume);
      if (result.ok && !result.duplicate) reservations.set(id, {consume: consume.map(a => ({...a})), allowKey});
      return result;
    },
    release(id: string, reservationId: string): RuledResult {
      const result = ledger.release(id, reservationId);
      if (result.ok && !result.duplicate) reservations.delete(reservationId);
      return result;
    },
    /** Complete a reservation: its reserved inputs are consumed and its outputs checked on that projection. */
    commitReservation(id: string, reservationId: string, produce: InventoryOutput[]): RuledResult {
      if (ledger.hasReceipt(id)) return ledger.commitReservation(id, reservationId, produce);
      const held = reservations.get(reservationId);
      if (held) {
        const refusal = check(held.consume, produce, true);
        if (refusal) return refusal;
      }
      const result = ledger.commitReservation(id, reservationId, produce);
      if (result.ok && !result.duplicate) reservations.delete(reservationId);
      return result;
    },
    /** How many more units of a batch fit in a container under the rules (0 when none). */
    room(container: string, batch: MaterialBatch): number {
      if (!Object.hasOwn(checked.containers, container)) throw new Error('inventory rules: unknown container');
      const known = ledger.material(batch.id);
      if (known && JSON.stringify(known) !== JSON.stringify({...batch, properties: {...batch.properties}})) return 0; // a different batch under this id would be a batch conflict
      let lo = 0,
        hi = checked.containers[container]!.slots * stackOf(container, batch.material);
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (check([], [{container, batch, quantity: mid}], true) === null) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
    /** Slots in use per container under the rules. */
    slotsUsed(container: string): number {
      const rule = checked.containers[container];
      if (!rule) throw new Error('inventory rules: unknown container');
      let used = 0;
      for (const r of ledger.contents(container)) {
        const stack = stackOf(container, ledger.material(r.batchId)!.material);
        used += rule.overflow === 'single' ? 1 : Math.ceil(r.quantity / stack);
      }
      return used;
    },
    contents: ledger.contents,
    quantity: ledger.quantity,
    available: ledger.available,
    material: ledger.material,
    snapshot: ledger.snapshot,
  };
  if (saved !== undefined) replay(saved);
  return Object.freeze(ruled);

  function replay(raw: unknown) {
    const s = plain(raw, 'snapshot');
    // Containers must match; the rules themselves are checked by replaying the history.
    if (
      s.version !== 1 ||
      JSON.stringify(Object.keys(plain(s.capacities, 'capacities')).sort()) !== JSON.stringify(names)
    )
      throw new Error('inventory rules: snapshot containers do not match these rules');
    if (!Array.isArray(s.operations)) throw new Error('inventory rules: invalid snapshot');
    for (const rawOp of s.operations as unknown[]) {
      const op = parseInventoryOperation(rawOp);
      const result =
        op.kind === 'exchange'
          ? ruled.transact(op.id, op.consume, op.produce, {allowKey: true})
          : op.kind === 'reserve'
            ? ruled.reserve(op.id, op.consume, {allowKey: true})
            : op.kind === 'release'
              ? ruled.release(op.id, op.reservationId)
              : ruled.commitReservation(op.id, op.reservationId, op.produce);
      if (!result.ok || result.duplicate) throw new Error('inventory rules: saved history breaks these rules');
    }
  }
}
export type RuledInventory = ReturnType<typeof createRuledInventory>;

/**
 * Starting points. `handheldBag` approximates the bag of the 1996 handheld monster-collecting RPGs as documented by
 * a community reconstruction (github.com/liuyanghejerry/open-pokered, revision 31b1eda, `items/inventory.rs`): a
 * 20-slot bag and a 50-slot box, 99 per slot, an overflowing stack spilling into a new slot. Differences: slots are
 * counted from each batch's packed total (the original keeps fragmented stacks after removals, so it can use more
 * slots), each item type must be one batch (two batches of one material count as two slots), slot order and the
 * original's refusal at the first matching stack in a full bag are not modelled, and key items are not in the preset:
 * add the game's key materials with `key: true` to forbid tossing them.
 */
export const inventoryPresets = Object.freeze({
  handheldBag: Object.freeze({
    containers: Object.freeze({
      bag: Object.freeze({slots: 20, stackSize: 99, overflow: 'spill' as const}),
      box: Object.freeze({slots: 50, stackSize: 99, overflow: 'spill' as const}),
    }),
  }) satisfies InventoryRulesInput,
  /** Survival archetype: a 9-slot hotbar and 27-slot pack, stacks of 64; the material named `tool` is unstackable. */
  hotbarAndPack: Object.freeze({
    containers: Object.freeze({
      hotbar: Object.freeze({slots: 9, stackSize: 64, overflow: 'spill' as const}),
      pack: Object.freeze({slots: 27, stackSize: 64, overflow: 'spill' as const}),
    }),
    materials: Object.freeze({tool: Object.freeze({stackSize: 1})}),
  }) satisfies InventoryRulesInput,
  /** Adventure archetype: one item per slot, quest items unique and kept. */
  adventureSlots: Object.freeze({
    containers: Object.freeze({pack: Object.freeze({slots: 24, stackSize: 1, overflow: 'single' as const})}),
    materials: Object.freeze({'quest-item': Object.freeze({key: true, maxOwned: 1})}),
  }) satisfies InventoryRulesInput,
});
