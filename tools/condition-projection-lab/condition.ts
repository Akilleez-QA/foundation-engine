import {createEquipment, type EquipmentSnapshot, type ItemInstance} from '../../src/kits/equipment/pure';
import {createModifiers, type Modifier} from '../../src/kits/capabilities/modifiers';
import type {SaveSection, SaveStore} from '../../src/core/save/section';

export interface ConditionDefinition {
  id: string;
  slots: string[];
  bagCapacity: number;
  base: Record<string, number>;
  items: {item: ItemInstance; initial: number; maximum: number; enabledAbove: number; modifiers: Modifier[]}[];
  equipped: string[];
}
export interface ConditionSnapshot {
  version: 1;
  definition: string;
  revision: number;
  equipment: EquipmentSnapshot;
  conditions: {id: string; value: number}[];
}
export interface ConditionTicket {
  readonly id: string;
  readonly revision: number;
}
export type Result = 'saved' | 'save-failed' | 'stale' | 'blocked' | 'refused' | 'capacity' | 'unchanged';
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 64;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function array(value: unknown, max: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > max) throw Error('condition: array bound');
}

/** Fixed-custody creator lab. Numeric condition meaning belongs to its definition. */
export function conditionFixture(input: ConditionDefinition) {
  array(input.items, 8);
  array(input.slots, 8);
  array(input.equipped, 8);
  if (
    !id(input.id) ||
    !integer(input.bagCapacity) ||
    input.bagCapacity > 8 ||
    !input.base ||
    typeof input.base !== 'object' ||
    Object.keys(input.base).length > 8
  )
    throw Error('condition: invalid definition');
  let rows = 0;
  for (const entry of input.items) {
    array(entry.item.slots, 8);
    array(entry.modifiers, 8);
    rows += entry.modifiers.length;
    if (
      !id(entry.item.id) ||
      !id(entry.item.definition) ||
      !integer(entry.maximum) ||
      !integer(entry.initial) ||
      entry.initial > entry.maximum ||
      !integer(entry.enabledAbove) ||
      entry.enabledAbove > entry.maximum
    )
      throw Error('condition: invalid domain');
  }
  if (rows > 64 || input.slots.some(slot => !id(slot)) || Object.keys(input.base).some(stat => !id(stat)))
    throw Error('condition: definition bound');
  const d = structuredClone(input);
  d.items.sort((a, b) => (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
  const equipment = (saved: EquipmentSnapshot) => createEquipment(d.slots, d.bagCapacity, saved);
  const initialEquipment = equipment({
    revision: 0,
    items: d.items.map(row => row.item),
    equipped: d.equipped,
  }).snapshot();
  const initial = (): ConditionSnapshot => ({
    version: 1,
    definition: d.id,
    revision: 0,
    equipment: structuredClone(initialEquipment),
    conditions: d.items.map(row => ({id: row.item.id, value: row.initial})),
  });
  const project = (state: ConditionSnapshot) => {
    const active = new Set(
      equipment(state.equipment)
        .active()
        .map(item => item.id),
    );
    const available = d.items.filter(
      (row, i) => active.has(row.item.id) && state.conditions[i]!.value > row.enabledAbove,
    );
    const modifiers = createModifiers(d.base, 1);
    // Publish all contributions in one existing modifier transaction: no transient
    // partial source installation, including when cancellation balances large values.
    modifiers.set(
      'conditioned-equipment',
      available.flatMap(row => row.modifiers),
    );
    return {available: available.map(row => row.item.id), values: modifiers.values()};
  };
  // Validate dormant row data without evaluating each source in isolation: a
  // creator may deliberately balance finite positive and negative contributions.
  createModifiers(d.base, 1).values();
  for (const row of d.items)
    for (const modifier of row.modifiers)
      if (
        !Object.hasOwn(d.base, modifier.stat) ||
        !Number.isFinite(modifier.add) ||
        !Number.isFinite(modifier.multiply) ||
        modifier.multiply < 0
      )
        throw Error('condition: invalid contribution');
  const parse = (raw: unknown): ConditionSnapshot => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('condition: invalid snapshot');
    for (const key of ['version', 'definition', 'revision', 'equipment', 'conditions'])
      if (!Object.hasOwn(raw, key)) throw Error('condition: missing field');
    const value = raw as ConditionSnapshot;
    if (
      value.version !== 1 ||
      value.definition !== d.id ||
      !integer(value.revision) ||
      !value.equipment ||
      typeof value.equipment !== 'object'
    )
      throw Error('condition: incompatible snapshot');
    array(value.conditions, 8);
    array(value.equipment.items, 8);
    array(value.equipment.equipped, 8);
    if (
      value.conditions.length !== d.items.length ||
      value.equipment.items.length !== d.items.length ||
      value.equipment.revision > value.revision
    )
      throw Error('condition: inconsistent snapshot');
    const conditions = d.items.map((row, i) => {
      const entry = value.conditions[i];
      if (!entry || entry.id !== row.item.id || !integer(entry.value) || entry.value > row.maximum)
        throw Error('condition: invalid saved condition');
      return {id: entry.id, value: entry.value};
    });
    const captured = equipment(value.equipment).snapshot();
    if (JSON.stringify(captured.items) !== JSON.stringify(initialEquipment.items))
      throw Error('condition: custody definition changed');
    const result: ConditionSnapshot = {
      version: 1,
      definition: d.id,
      revision: value.revision,
      equipment: captured,
      conditions,
    };
    project(result);
    return result;
  };
  parse(initial());
  const section: SaveSection<ConditionSnapshot> = {
    id: `lab.condition-${d.id}`,
    scope: 'player',
    version: 1,
    flush: 'lazy',
    initial,
    parse,
  };
  return {
    section,
    parse,
    owner(store: SaveStore, signal: AbortSignal) {
      const player = store.activePlayer(),
        handle = store.section(section).of(player);
      let observed = handle.get(),
        retired = false,
        busy = false,
        pending: ConditionTicket | null = null;
      let unsubscribe = () => {};
      const dispose = () => {
        retired = true;
        pending = null;
        unsubscribe();
        signal.removeEventListener('abort', dispose);
      };
      unsubscribe = store.onPlayerChanged(dispose);
      signal.addEventListener('abort', dispose, {once: true});
      if (signal.aborted) dispose();
      const live = () => {
        if (retired) return false;
        if (signal.aborted || store.activePlayer() !== player || handle.get() !== observed) dispose();
        return !retired;
      };
      const guarded = <T>(operation: () => T): T => {
        if (busy) throw Error('condition: reentrant update');
        busy = true;
        try {
          return operation();
        } finally {
          busy = false;
        }
      };
      const checkpoint = (): Result => {
        if (!live()) return 'stale';
        if (['quarantined', 'newer', 'unavailable'].includes(handle.status())) return 'blocked';
        store.flush();
        return handle.status() === 'saved' ? 'saved' : 'save-failed';
      };
      const commit = (candidate: ConditionSnapshot) => {
        const accepted = parse(candidate); // projection arithmetic must pass before publication
        handle.replace(accepted);
        observed = handle.get();
        pending = null;
        return checkpoint();
      };
      const advance = (candidate: ConditionSnapshot) => {
        if (candidate.revision === Number.MAX_SAFE_INTEGER) throw Error('condition: revision exhausted');
        candidate.revision++;
      };
      return {
        snapshot: (): ConditionSnapshot => structuredClone(handle.get()),
        view: () => ({revision: handle.get().revision, status: handle.status(), ...project(handle.get())}),
        prepare(itemId: string): ConditionTicket | null {
          return guarded(() => {
            if (!live() || handle.status() !== 'saved' || !d.items.some(row => row.item.id === itemId)) return null;
            if (pending) return null;
            return (pending = Object.freeze({id: itemId, revision: handle.get().revision}));
          });
        },
        update(ticket: ConditionTicket, value: number): Result {
          return guarded(() => {
            if (!live() || pending === null || ticket !== pending || ticket.revision !== handle.get().revision)
              return 'stale';
            if (handle.status() !== 'saved') return 'blocked';
            const candidate: ConditionSnapshot = structuredClone(handle.get());
            const index = d.items.findIndex(row => row.item.id === ticket.id),
              rule = d.items[index]!;
            if (!integer(value) || value > rule.maximum) return 'refused';
            if (candidate.conditions[index]!.value === value) {
              pending = null;
              return 'unchanged';
            }
            advance(candidate);
            candidate.conditions[index]!.value = value;
            return commit(candidate);
          });
        },
        equip(itemId: string, expectedRevision: number, wear = true): Result {
          return guarded(() => {
            if (!live() || expectedRevision !== handle.get().revision) return 'stale';
            if (handle.status() !== 'saved') return 'blocked';
            const candidate: ConditionSnapshot = structuredClone(handle.get()),
              arrangement = equipment(candidate.equipment);
            const result = arrangement.commit(itemId, candidate.equipment.revision, wear);
            if (result !== 'applied') return result;
            advance(candidate);
            candidate.equipment = arrangement.snapshot();
            return commit(candidate);
          });
        },
        cancel(ticket: ConditionTicket) {
          return guarded(() => {
            if (!live() || pending === null || ticket !== pending) return false;
            pending = null;
            return true;
          });
        },
        checkpoint: () => guarded(checkpoint),
        dispose,
      };
    },
  };
}
