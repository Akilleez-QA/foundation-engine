/** ItineraryDestination-based order data; the consuming owner performs and cancels external work. */
export interface ItineraryDestination {
  readonly id: string;
  readonly generation: number;
}
export interface ItineraryOrderInput {
  readonly tag: string;
  readonly destination: ItineraryDestination;
  readonly value: number;
}
export interface ItineraryOrder extends ItineraryOrderInput {
  readonly id: number;
  readonly generation: number;
  readonly valid: boolean;
}
export interface ItinerarySnapshot {
  readonly version: 1;
  readonly revision: number;
  readonly nextId: number;
  readonly activeId: number | null;
  readonly orders: readonly ItineraryOrder[];
}
export interface ItineraryTicket {
  readonly order: ItineraryOrder;
}
export type ItineraryEdit =
  | {readonly type: 'insert'; readonly index: number; readonly order: ItineraryOrderInput}
  | {readonly type: 'replace'; readonly id: number; readonly order: ItineraryOrderInput}
  | {readonly type: 'remove'; readonly id: number; readonly current: 'stop' | 'advance'};
export type ItineraryResult = 'accepted' | 'stale' | 'saturated' | 'exhausted' | 'closed';

const MAX = Number.MAX_SAFE_INTEGER;
function integer(value: unknown, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min)
    throw new TypeError('Expected a bounded integer');
  return value;
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('Expected a data record');
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError('Expected plain data');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length) throw new TypeError('Unexpected fields');
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor)) throw new TypeError('Expected own data fields');
    result[key] = descriptor.value;
  }
  return result;
}

/** ItinerarySnapshot/config arrays are plain dense data, not executable iterables. */
function arrayData(value: readonly unknown[], maxLength: number): unknown[] {
  const length = integer(Object.getOwnPropertyDescriptor(value, 'length')?.value);
  if (
    length > maxLength ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== length + 1
  )
    throw new TypeError('Expected plain array data');
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) throw new TypeError('Expected dense array data');
    result.push(descriptor.value);
  }
  return result;
}

export interface ItineraryOptions {
  readonly maxOrders: number;
  readonly maxTextLength: number;
  readonly tags: readonly string[];
}
export interface Itinerary {
  snapshot(): ItinerarySnapshot;
  edit(expectedRevision: number, change: ItineraryEdit): ItineraryResult;
  start(expectedRevision: number, id: number): ItineraryResult;
  begin(): ItineraryTicket | null;
  check(ticket: ItineraryTicket): boolean;
  finish(ticket: ItineraryTicket): boolean;
  cancel(): boolean;
  invalidateDestination(destination: ItineraryDestination): ItineraryResult;
  restore(expectedRevision: number, snapshot: unknown): ItineraryResult;
  dispose(): void;
}

export function createItinerary(options: ItineraryOptions): Itinerary {
  const configuration = record(options, ['maxOrders', 'maxTextLength', 'tags']);
  const maxOrders = integer(configuration.maxOrders, 1);
  const maxTextLength = integer(configuration.maxTextLength, 1);
  function text(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > maxTextLength)
      throw new TypeError('Invalid text length');
    return value;
  }
  if (!Array.isArray(configuration.tags) || configuration.tags.length === 0 || configuration.tags.length > maxOrders)
    throw new TypeError('Tag count must fit maxOrders');
  const tags = new Set(arrayData(configuration.tags, maxOrders).map(text));
  if (tags.size !== configuration.tags.length) throw new TypeError('Duplicate tags');
  function destination(value: unknown): ItineraryDestination {
    const data = record(value, ['id', 'generation']);
    return Object.freeze({id: text(data.id), generation: integer(data.generation)});
  }
  function input(value: unknown): ItineraryOrderInput {
    const data = record(value, ['tag', 'destination', 'value']);
    const tag = text(data.tag);
    if (!tags.has(tag)) throw new TypeError('Unknown order tag');
    return Object.freeze({tag, destination: destination(data.destination), value: integer(data.value)});
  }
  let orders: readonly ItineraryOrder[] = Object.freeze([]);
  let activeId: number | null = null;
  let revision = 0;
  let nextId = 1;
  let pending: ItineraryTicket | null = null;
  let closed = false;
  let busy = false;
  function mutation<T>(operation: () => T): T {
    if (busy) throw new Error('Reentrant itinerary mutation');
    busy = true;
    try {
      return operation();
    } finally {
      busy = false;
    }
  }
  function admit(expected: number): ItineraryResult {
    integer(expected);
    if (closed) return 'closed';
    if (expected !== revision) return 'stale';
    return revision === MAX ? 'exhausted' : 'accepted';
  }
  function snapshot(): ItinerarySnapshot {
    return Object.freeze({version: 1, revision, nextId, activeId, orders});
  }
  function edit(expected: number, change: ItineraryEdit): ItineraryResult {
    return mutation(() => {
      const status = admit(expected);
      if (status !== 'accepted') return status;
      // Capture plain data once before publication, including the deletion policy.
      const type: unknown = Object.getOwnPropertyDescriptor(change, 'type')?.value;
      if (type !== 'insert' && type !== 'replace' && type !== 'remove') throw new TypeError('Unknown edit');
      const data = record(
        change,
        type === 'insert'
          ? ['type', 'index', 'order']
          : type === 'replace'
            ? ['type', 'id', 'order']
            : ['type', 'id', 'current'],
      );
      if (type === 'insert') {
        const index = integer(data.index);
        if (index > orders.length) throw new RangeError('Insertion index outside itinerary');
        const value = input(data.order);
        if (orders.length >= maxOrders) return 'saturated';
        if (nextId === MAX) return 'exhausted';
        const inserted = Object.freeze({...value, id: nextId, generation: 0, valid: true});
        orders = Object.freeze([...orders.slice(0, index), inserted, ...orders.slice(index)]);
        nextId++;
      } else if (type === 'replace' || type === 'remove') {
        const id = integer(data.id, 1);
        const index = orders.findIndex(order => order.id === id);
        const previous = orders[index];
        if (!previous) return 'stale';
        if (type === 'replace') {
          const value = input(data.order);
          if (previous.generation === MAX) return 'exhausted';
          const replacement = Object.freeze({...value, id, generation: previous.generation + 1, valid: true});
          orders = Object.freeze(orders.map(order => (order.id === id ? replacement : order)));
        } else {
          if (data.current !== 'stop' && data.current !== 'advance')
            throw new TypeError('Explicit current deletion policy required');
          orders = Object.freeze(orders.filter(order => order.id !== id));
          if (activeId === id) activeId = data.current === 'advance' ? (orders[index]?.id ?? null) : null;
        }
        if (pending?.order.id === id) pending = null;
      } else throw new TypeError('Unknown edit');
      revision++;
      return 'accepted';
    });
  }
  function start(expected: number, id: number): ItineraryResult {
    return mutation(() => {
      const status = admit(expected);
      if (status !== 'accepted') return status;
      integer(id, 1);
      if (!orders.some(order => order.id === id)) return 'stale';
      activeId = id;
      pending = null;
      revision++;
      return 'accepted';
    });
  }
  function begin(): ItineraryTicket | null {
    return mutation(() => {
      if (closed || pending || revision === MAX) return null;
      const order = orders.find(entry => entry.id === activeId);
      if (!order?.valid) return null;
      pending = Object.freeze({order});
      return pending;
    });
  }
  function check(ticket: ItineraryTicket): boolean {
    return !closed && pending !== null && pending === ticket;
  }
  function finish(ticket: ItineraryTicket): boolean {
    return mutation(() => {
      if (!check(ticket) || revision === MAX) return false;
      const index = orders.findIndex(order => order.id === activeId);
      activeId = orders[index + 1]?.id ?? null;
      pending = null;
      revision++;
      return true;
    });
  }
  function cancel(): boolean {
    return mutation(() => {
      const hadPending = pending !== null;
      pending = null;
      return hadPending;
    });
  }
  function invalidateDestination(value: ItineraryDestination): ItineraryResult {
    return mutation(() => {
      if (closed) return 'closed';
      const target = destination(value);
      const matches = (order: ItineraryOrder) =>
        order.destination.id === target.id && order.destination.generation === target.generation;
      if (!orders.some(order => order.valid && matches(order))) return 'stale';
      // Invalidation must revoke authority even when revision space is exhausted.
      orders = Object.freeze(orders.map(order => (matches(order) ? Object.freeze({...order, valid: false}) : order)));
      if (pending && matches(pending.order)) pending = null;
      if (revision < MAX) revision++;
      return 'accepted';
    });
  }
  function restore(expected: number, value: unknown): ItineraryResult {
    return mutation(() => {
      const status = admit(expected);
      if (status !== 'accepted') return status;
      const data = record(value, ['version', 'revision', 'nextId', 'activeId', 'orders']);
      if (data.version !== 1) throw new TypeError('Unsupported itinerary snapshot version');
      const restoredRevision = integer(data.revision);
      const restoredNext = integer(data.nextId, 1);
      const restoredActive = data.activeId === null ? null : integer(data.activeId, 1);
      if (!Array.isArray(data.orders)) throw new TypeError('Expected orders');
      if (data.orders.length > maxOrders) return 'saturated';
      const ids = new Set<number>();
      const restored = arrayData(data.orders, maxOrders).map((entry: unknown): ItineraryOrder => {
        const row = record(entry, ['id', 'generation', 'tag', 'destination', 'value', 'valid']);
        const id = integer(row.id, 1);
        if (id >= restoredNext || ids.has(id)) throw new TypeError('Invalid order identity');
        ids.add(id);
        if (typeof row.valid !== 'boolean') throw new TypeError('Invalid destination validity');
        return Object.freeze({
          ...input({tag: row.tag, destination: row.destination, value: row.value}),
          id,
          generation: integer(row.generation),
          valid: row.valid,
        });
      });
      if (restoredActive !== null && !ids.has(restoredActive)) throw new TypeError('Missing active order');
      if (restoredRevision === MAX) return 'exhausted';
      orders = Object.freeze(restored);
      activeId = restoredActive;
      nextId = Math.max(nextId, restoredNext);
      revision = Math.max(revision, restoredRevision) + 1;
      pending = null;
      return 'accepted';
    });
  }
  function dispose(): void {
    mutation(() => {
      closed = true;
      pending = null;
      activeId = null;
      orders = Object.freeze([]);
    });
  }
  return Object.freeze({snapshot, edit, start, begin, check, finish, cancel, invalidateDestination, restore, dispose});
}
