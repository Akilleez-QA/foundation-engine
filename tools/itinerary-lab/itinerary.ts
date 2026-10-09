/** Lab-local data controller. The consuming owner performs and cancels external work. */
export interface Destination {
  readonly id: string;
  readonly generation: number;
}
export interface OrderInput {
  readonly tag: string;
  readonly destination: Destination;
  readonly value: number;
}
export interface Order extends OrderInput {
  readonly id: number;
  readonly generation: number;
  readonly valid: boolean;
}
export interface Snapshot {
  readonly version: 1;
  readonly revision: number;
  readonly nextId: number;
  readonly activeId: number | null;
  readonly orders: readonly Order[];
}
export interface Ticket {
  readonly order: Order;
}
export type Edit =
  | {readonly type: 'insert'; readonly index: number; readonly order: OrderInput}
  | {readonly type: 'replace'; readonly id: number; readonly order: OrderInput}
  | {readonly type: 'remove'; readonly id: number; readonly current: 'stop' | 'advance'};
export type Result = 'accepted' | 'stale' | 'saturated' | 'exhausted' | 'closed';

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

export function createItinerary(options: {
  readonly maxOrders: number;
  readonly maxTextLength: number;
  readonly tags: readonly string[];
}) {
  const maxOrders = integer(options.maxOrders, 1);
  const maxTextLength = integer(options.maxTextLength, 1);
  function text(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > maxTextLength)
      throw new TypeError('Invalid text length');
    return value;
  }
  if (!Array.isArray(options.tags) || options.tags.length === 0 || options.tags.length > maxOrders)
    throw new TypeError('Tag count must fit maxOrders');
  const tags = new Set(Array.from(options.tags, text));
  if (tags.size !== options.tags.length) throw new TypeError('Duplicate tags');
  function destination(value: unknown): Destination {
    const data = record(value, ['id', 'generation']);
    return Object.freeze({id: text(data.id), generation: integer(data.generation)});
  }
  function input(value: unknown): OrderInput {
    const data = record(value, ['tag', 'destination', 'value']);
    const tag = text(data.tag);
    if (!tags.has(tag)) throw new TypeError('Unknown order tag');
    return Object.freeze({tag, destination: destination(data.destination), value: integer(data.value)});
  }
  let orders: readonly Order[] = Object.freeze([]);
  let activeId: number | null = null;
  let revision = 0;
  let nextId = 1;
  let pending: Ticket | null = null;
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
  function admit(expected: number): Result {
    integer(expected);
    if (closed) return 'closed';
    if (expected !== revision) return 'stale';
    return revision === MAX ? 'exhausted' : 'accepted';
  }
  function snapshot(): Snapshot {
    return Object.freeze({version: 1, revision, nextId, activeId, orders});
  }
  function edit(expected: number, change: Edit): Result {
    return mutation(() => {
      const status = admit(expected);
      if (status !== 'accepted') return status;
      // Copy only after validation; no rejected edit can retire the current ticket.
      if (change.type === 'insert') {
        const index = integer(change.index);
        if (index > orders.length) throw new RangeError('Insertion index outside itinerary');
        const value = input(change.order);
        if (orders.length >= maxOrders) return 'saturated';
        if (nextId === MAX) return 'exhausted';
        const inserted = Object.freeze({...value, id: nextId, generation: 0, valid: true});
        orders = Object.freeze([...orders.slice(0, index), inserted, ...orders.slice(index)]);
        nextId++;
      } else if (change.type === 'replace' || change.type === 'remove') {
        const id = integer(change.id, 1);
        const index = orders.findIndex(order => order.id === id);
        const previous = orders[index];
        if (!previous) return 'stale';
        if (change.type === 'replace') {
          const value = input(change.order);
          if (previous.generation === MAX) return 'exhausted';
          const replacement = Object.freeze({...value, id, generation: previous.generation + 1, valid: true});
          orders = Object.freeze(orders.map(order => (order.id === id ? replacement : order)));
        } else {
          if (change.current !== 'stop' && change.current !== 'advance')
            throw new TypeError('Explicit current deletion policy required');
          orders = Object.freeze(orders.filter(order => order.id !== id));
          if (activeId === id) activeId = change.current === 'advance' ? (orders[index]?.id ?? null) : null;
        }
        if (pending?.order.id === id) pending = null;
      } else throw new TypeError('Unknown edit');
      revision++;
      return 'accepted';
    });
  }
  function start(expected: number, id: number): Result {
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
  function begin(): Ticket | null {
    return mutation(() => {
      if (closed || pending || revision === MAX) return null;
      const order = orders.find(entry => entry.id === activeId);
      if (!order?.valid) return null;
      pending = Object.freeze({order});
      return pending;
    });
  }
  function check(ticket: Ticket): boolean {
    return !closed && pending !== null && pending === ticket;
  }
  function finish(ticket: Ticket): boolean {
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
  function invalidateDestination(value: Destination): Result {
    return mutation(() => {
      if (closed) return 'closed';
      const target = destination(value);
      const matches = (order: Order) =>
        order.destination.id === target.id && order.destination.generation === target.generation;
      if (!orders.some(order => order.valid && matches(order))) return 'stale';
      // Invalidation must revoke authority even when revision space is exhausted.
      orders = Object.freeze(orders.map(order => (matches(order) ? Object.freeze({...order, valid: false}) : order)));
      if (pending && matches(pending.order)) pending = null;
      if (revision < MAX) revision++;
      return 'accepted';
    });
  }
  function restore(expected: number, value: unknown): Result {
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
      const restored = Array.from(data.orders, (entry: unknown): Order => {
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
