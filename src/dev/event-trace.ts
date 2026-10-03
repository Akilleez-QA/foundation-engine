/** Opt-in synchronous event diagnostics. Imported only by the dev/test API. */
import type {EventBusDebug} from '../core/events';

export interface EventTraceOptions {
  /** Same-thread monotonic milliseconds. Defaults to performance.now; failures are counted, never thrown by capture. */
  now?: () => number;
  capacity?: number;
  maxLabels?: number;
  maxLabelLength?: number;
}
export interface EventTraceRecord {
  /** Null when the diagnostic clock failed or returned an invalid/backward sample. */
  timeMs: number | null;
  sequence: number;
  id: number;
  parent: number | null;
  label: number | null;
  depth: number;
  phase: 'begin' | 'end' | 'rejected';
  listenerErrors: number;
}
export interface EventTraceSnapshot {
  records: EventTraceRecord[];
  labels: string[];
  droppedRecords: number;
  droppedLabels: number;
  truncatedLabels: number;
  disposed: boolean;
  invalidClockSamples: number;
}
export interface EventTrace {
  snapshot(): EventTraceSnapshot;
  exportTrace(): EventTraceExport;
  reset(): void;
  dispose(): void;
}

/** Chrome Trace Event complete intervals; timestamps and durations are microseconds. */
export interface EventTraceExport {
  traceEvents: {
    ph: 'X';
    cat: 'foundation.events';
    name: string;
    pid: 1;
    tid: 1;
    ts: number;
    dur: number;
    args: {id: number; parent: number | null; depth: number; listenerErrors: number};
  }[];
  displayTimeUnit: 'ms';
  metadata: {
    schemaVersion: 1;
    incompleteSpans: number;
    invalidTimingSpans: number;
    rejectedRecords: number;
    droppedRecords: number;
    droppedLabels: number;
    truncatedLabels: number;
    invalidClockSamples: number;
    disposed: boolean;
  };
}

/** Uses only the detached, bounded capture. Never invents endpoints after eviction or interruption. */
function exportSnapshot(data: EventTraceSnapshot): EventTraceExport {
  const pending = new Map<number, {record: EventTraceRecord; slot: number}>();
  const ordered: (EventTraceExport['traceEvents'][number] | undefined)[] = [];
  let incompleteSpans = 0,
    invalidTimingSpans = 0,
    rejectedRecords = 0;
  for (const record of data.records) {
    if (record.phase === 'rejected') {
      rejectedRecords++;
      continue;
    }
    if (record.phase === 'begin') {
      pending.set(record.id, {record, slot: ordered.length});
      ordered.push(undefined);
      continue;
    }
    const begin = pending.get(record.id);
    if (!begin) {
      incompleteSpans++;
      continue;
    }
    pending.delete(record.id);
    const start = begin.record.timeMs,
      end = record.timeMs;
    if (start === null || end === null || end < start || !Number.isFinite((end - start) * 1000)) {
      invalidTimingSpans++;
      continue;
    }
    ordered[begin.slot] = {
      ph: 'X',
      cat: 'foundation.events',
      name: begin.record.label === null ? '(unlabelled event)' : data.labels[begin.record.label]!,
      pid: 1,
      tid: 1,
      ts: start * 1000,
      dur: (end - start) * 1000,
      args: {id: record.id, parent: record.parent, depth: record.depth, listenerErrors: record.listenerErrors},
    };
  }
  return {
    traceEvents: ordered.filter((event): event is EventTraceExport['traceEvents'][number] => event !== undefined),
    displayTimeUnit: 'ms',
    metadata: {
      schemaVersion: 1,
      incompleteSpans: incompleteSpans + pending.size,
      invalidTimingSpans,
      rejectedRecords,
      droppedRecords: data.droppedRecords,
      droppedLabels: data.droppedLabels,
      truncatedLabels: data.truncatedLabels,
      invalidClockSamples: data.invalidClockSamples,
      disposed: data.disposed,
    },
  };
}

export function createEventTrace(bus: EventBusDebug, options: EventTraceOptions = {}): EventTrace {
  const now = options.now ?? (() => performance.now());
  const capacity = options.capacity ?? 2048;
  const maxLabels = options.maxLabels ?? 256;
  const maxLabelLength = options.maxLabelLength ?? 120;
  for (const [name, value] of Object.entries({capacity, maxLabels, maxLabelLength})) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 0xffffffff) {
      throw new RangeError(`event trace ${name} must be a positive array-sized integer`);
    }
  }
  const ring = new Array<EventTraceRecord | undefined>(capacity);
  const labels: string[] = [],
    labelIds = new Map<string, number>();
  let head = 0,
    size = 0,
    sequence = 0,
    id = 0,
    parent: number | null = null;
  let droppedRecords = 0,
    droppedLabels = 0,
    truncatedLabels = 0,
    disposed = false,
    generation = 0;
  let lastTime = 0,
    invalidClockSamples = 0;
  const increment = (n: number) => Math.min(Number.MAX_SAFE_INTEGER, n + 1);
  const sample = (epoch: number): number | null => {
    try {
      const value = now();
      if (disposed || epoch !== generation) return null;
      if (typeof value === 'number' && Number.isFinite(value * 1000) && value >= lastTime) {
        lastTime = value;
        return value;
      }
    } catch {
      /* A diagnostic clock must not change application delivery. */
    }
    if (!disposed && epoch === generation) invalidClockSamples = increment(invalidClockSamples);
    return null;
  };
  const write = (record: Omit<EventTraceRecord, 'sequence'>) => {
    // Preserve exact identifiers: stop capturing before their numeric representation loses precision.
    if (sequence === Number.MAX_SAFE_INTEGER) {
      droppedRecords = increment(droppedRecords);
      return;
    }
    ring[head] = {sequence: ++sequence, ...record};
    head = (head + 1) % capacity;
    if (size < capacity) size++;
    else droppedRecords = increment(droppedRecords);
  };
  const off = bus.observeEmits((name, depth, rejected) => {
    if (disposed) return;
    if (id === Number.MAX_SAFE_INTEGER) {
      droppedRecords = increment(droppedRecords);
      return;
    }
    const epoch = generation,
      timeMs = sample(epoch);
    if (disposed || epoch !== generation) return;
    const previous = parent,
      current = ++id;
    const bounded = name.slice(0, maxLabelLength);
    if (bounded.length !== name.length) truncatedLabels = increment(truncatedLabels);
    let label = labelIds.get(bounded) ?? null;
    if (label === null) {
      if (labels.length < maxLabels) {
        label = labels.length;
        labels.push(bounded);
        labelIds.set(bounded, label);
      } else droppedLabels = increment(droppedLabels);
    }
    const base = {id: current, parent: previous, label, depth, listenerErrors: 0};
    write({...base, timeMs, phase: rejected ? 'rejected' : 'begin'});
    if (rejected) return;
    parent = current;
    return listenerErrors => {
      if (disposed || epoch !== generation) return;
      const timeMs = sample(epoch);
      if (disposed || epoch !== generation) return;
      parent = previous;
      write({...base, timeMs, listenerErrors, phase: 'end'});
    };
  });
  const snapshot = (): EventTraceSnapshot => ({
    records: Array.from({length: size}, (_, i) => ({...ring[(head - size + capacity + i) % capacity]!})),
    labels: [...labels],
    droppedRecords,
    droppedLabels,
    truncatedLabels,
    disposed,
    invalidClockSamples,
  });
  return {
    snapshot,
    exportTrace: () => exportSnapshot(snapshot()),
    reset() {
      generation++;
      ring.fill(undefined);
      labels.length = 0;
      labelIds.clear();
      head = size = sequence = id = droppedRecords = droppedLabels = truncatedLabels = 0;
      parent = null;
      lastTime = invalidClockSamples = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      parent = null;
      off();
    },
  };
}
