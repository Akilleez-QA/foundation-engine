export interface VisibilityLimits {
  readonly cellCount: number;
  readonly maxSources: number;
  readonly maxCellsPerSource: number;
  readonly maxDrain: number;
}
export interface VisibilitySource {
  readonly generation: number;
}
export interface VisibilityTicket {
  readonly generation: number;
}
export interface VisibilityCell {
  readonly cell: number;
  readonly visible: boolean;
  readonly explored: boolean;
}
interface Source {
  cells: Uint32Array;
  ticket: VisibilityTicket | undefined;
}
const integer = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;

/** One observer's accepted contributions. No geometry, scheduling or publication callbacks. */
export function createVisibility(input: VisibilityLimits) {
  const limits = Object.freeze({
    cellCount: input.cellCount,
    maxSources: input.maxSources,
    maxCellsPerSource: input.maxCellsPerSource,
    maxDrain: input.maxDrain,
  });
  const {cellCount, maxSources, maxCellsPerSource, maxDrain} = limits;
  if (
    !integer(cellCount, 1, 1 << 20) ||
    !integer(maxSources, 1, 4096) ||
    !integer(maxCellsPerSource, 1, cellCount) ||
    maxSources * maxCellsPerSource > 1 << 22 ||
    !integer(maxDrain, 1, cellCount)
  )
    throw new RangeError('visibility: invalid limits');
  const counts = new Uint32Array(cellCount);
  const explored = new Uint8Array(cellCount);
  const dirty = new Uint8Array(cellCount);
  const queue = new Uint32Array(cellCount);
  const sources = new Map<VisibilitySource, Source>();
  const tickets = new Map<VisibilityTicket, Source>();
  let generation = 0,
    head = 0,
    pending = 0,
    closed = false,
    busy = false;
  const run = <T>(fn: () => T): T => {
    if (busy) throw new Error('visibility: reentrant mutation');
    busy = true;
    try {
      return fn();
    } finally {
      busy = false;
    }
  };
  const mark = (cell: number) => {
    if (dirty[cell]) return;
    dirty[cell] = 1;
    queue[(head + pending) % cellCount] = cell;
    pending++;
  };
  const revoke = (source: Source) => {
    if (source.ticket) tickets.delete(source.ticket);
    source.ticket = undefined;
  };
  const install = (source: Source, next: Uint32Array) => {
    const old = source.cells;
    let i = 0,
      j = 0;
    while (i < old.length || j < next.length) {
      const a = i < old.length ? old[i]! : Infinity;
      const b = j < next.length ? next[j]! : Infinity;
      if (a === b) {
        i++;
        j++;
        continue;
      }
      if (a < b) {
        counts[a]!--;
        if (!counts[a]) mark(a);
        i++;
      } else {
        if (!counts[b]) mark(b);
        counts[b]!++;
        explored[b] = 1;
        j++;
      }
    }
    source.cells = next;
  };
  const read = (cell: number): VisibilityCell =>
    Object.freeze({cell, visible: counts[cell]! > 0, explored: !!explored[cell]});
  const checkCell = (cell: number) => {
    if (!integer(cell, 0, cellCount - 1)) throw new RangeError('visibility: invalid cell');
  };
  return Object.freeze({
    limits,
    addSource() {
      return run(() => {
        if (closed) return {status: 'closed' as const};
        if (sources.size === maxSources) return {status: 'saturated' as const};
        if (generation === Number.MAX_SAFE_INTEGER) return {status: 'exhausted' as const};
        const source = Object.freeze({generation: ++generation});
        sources.set(source, {cells: new Uint32Array(0), ticket: undefined});
        return {status: 'added' as const, source};
      });
    },
    /** Starts a newer calculation without removing the last accepted contribution. */
    begin(source: VisibilitySource) {
      return run(() => {
        if (closed) return {status: 'closed' as const};
        const entry = sources.get(source);
        if (!entry) return {status: 'stale' as const};
        if (generation === Number.MAX_SAFE_INTEGER) return {status: 'exhausted' as const};
        revoke(entry);
        const ticket = Object.freeze({generation: ++generation});
        entry.ticket = ticket;
        tickets.set(ticket, entry);
        return {status: 'prepared' as const, ticket};
      });
    },
    /** Dense plain arrays only; duplicate cells are rejected. Failed admission preserves the ticket and coverage. */
    replace(ticket: VisibilityTicket, cells: readonly number[]) {
      return run(() => {
        if (closed) return 'closed' as const;
        const entry = tickets.get(ticket);
        if (!entry) return 'stale' as const;
        if (!Array.isArray(cells) || Object.getPrototypeOf(cells) !== Array.prototype)
          throw new TypeError('visibility: cells must be a plain array');
        const length = Object.getOwnPropertyDescriptor(cells, 'length')?.value;
        if (!integer(length, 0, maxCellsPerSource)) return 'saturated' as const;
        const next = new Uint32Array(length);
        for (let i = 0; i < length; i++) {
          const d = Object.getOwnPropertyDescriptor(cells, String(i));
          if (!d || !('value' in d) || !integer(d.value, 0, cellCount - 1))
            throw new TypeError('visibility: invalid cell data');
          next[i] = d.value;
        }
        next.sort();
        for (let i = 1; i < length; i++) if (next[i] === next[i - 1]) throw new TypeError('visibility: duplicate cell');
        install(entry, next);
        revoke(entry);
        return 'replaced' as const;
      });
    },
    cancel(ticket: VisibilityTicket) {
      return run(() => {
        if (closed) return 'closed' as const;
        const entry = tickets.get(ticket);
        if (!entry) return 'stale' as const;
        revoke(entry);
        return 'cancelled' as const;
      });
    },
    removeSource(source: VisibilitySource) {
      return run(() => {
        if (closed) return 'closed' as const;
        const entry = sources.get(source);
        if (!entry) return 'stale' as const;
        install(entry, new Uint32Array(0));
        revoke(entry);
        sources.delete(source);
        return 'removed' as const;
      });
    },
    cell(cell: number) {
      checkCell(cell);
      return closed ? undefined : read(cell);
    },
    /** Forget only cells no longer visible; currently covered cells remain explored. */
    resetExploration() {
      return run(() => {
        if (closed) return 'closed' as const;
        for (let cell = 0; cell < cellCount; cell++)
          if (explored[cell] && !counts[cell]) {
            explored[cell] = 0;
            mark(cell);
          }
        return 'reset' as const;
      });
    },
    /** Coalesced current state, not an event log. Initial state is all false. */
    drain(limit = maxDrain): readonly VisibilityCell[] {
      return run(() => {
        if (!integer(limit, 1, maxDrain)) throw new RangeError('visibility: invalid drain limit');
        const result: VisibilityCell[] = [];
        if (!closed)
          while (pending && result.length < limit) {
            const cell = queue[head]!;
            head = (head + 1) % cellCount;
            pending--;
            dirty[cell] = 0;
            result.push(read(cell));
          }
        return Object.freeze(result);
      });
    },
    dispose() {
      run(() => {
        if (closed) return;
        closed = true;
        sources.clear();
        tickets.clear();
        counts.fill(0);
        explored.fill(0);
        dirty.fill(0);
        pending = 0;
      });
    },
    get stats() {
      return Object.freeze({sources: sources.size, calculations: tickets.size, pending, closed});
    },
  });
}
