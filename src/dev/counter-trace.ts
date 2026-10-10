/**
 * dev/counter-trace.ts: opt-in per-frame numeric counter tracks and frame markers (ADR 0172). Imported only by the
 * dev/test API; production builds contain neither it nor its sampler.
 *
 * A bounded ring holds one row per frame: the frame number, its timestamp and up to `maxCounters` named values
 * (draws, triangles, GPU ms, queue depths, jobs in flight: whatever the caller's sources report). A value measured
 * later (GPU time arrives frames after its frame) is attributed with `sample(frame, name, value)` while that frame's
 * row is still in the ring, and counted as late-dropped otherwise. Every overflow is counted, never silent.
 *
 * `exportTrace()` writes Chrome Trace Event JSON: one global instant `frame` marker per row and one `C` (counter)
 * record per value, in microseconds, on the same process/thread as event and system timing, so
 * `mergeTraceExports(...)` produces one file a standard trace viewer loads with all three.
 */
import type {FrameRecord, FrameSamplerPort} from '../core/activity/ports';

export interface CounterTraceOptions {
  /** Frames retained, 1..65536. Default 2048; older rows are overwritten and counted. */
  capacity?: number;
  /** Distinct counter names, 1..64. Default 16; values for further names are dropped and counted. */
  maxCounters?: number;
  /** Counter name length, 1..120. Default 64; longer names are truncated and counted. */
  maxNameLength?: number;
}

export type CounterValues = Readonly<Record<string, number | undefined>>;

export interface CounterTraceRow {
  frame: number;
  timeMs: number;
  stepped: boolean;
  /** By counter index (`names`); undefined where the frame had no value. */
  values: (number | undefined)[];
}

export interface CounterTraceSnapshot {
  names: string[];
  rows: CounterTraceRow[];
  droppedFrames: number;
  droppedCounters: number;
  truncatedNames: number;
  invalidValues: number;
  invalidFrames: number;
  lateSamples: number;
  lateDropped: number;
  sourceErrors: number;
  disposed: boolean;
}

type CounterEvent =
  | {
      ph: 'i';
      s: 'g';
      cat: 'foundation.frames';
      name: 'frame';
      pid: 1;
      tid: 1;
      ts: number;
      args: {frame: number; stepped: boolean};
    }
  | {ph: 'C'; cat: 'foundation.counters'; name: string; pid: 1; tid: 1; ts: number; args: {value: number}};

export interface CounterTraceExport {
  traceEvents: CounterEvent[];
  displayTimeUnit: 'ms';
  metadata: Omit<CounterTraceSnapshot, 'names' | 'rows'> & {schemaVersion: 1; frames: number; counters: string[]};
}

export interface CounterTrace {
  /** Record one frame. `frame` must increase and `timeMs` must not go backwards; otherwise the row is refused. */
  frame(frame: number, timeMs: number, values?: CounterValues, stepped?: boolean): void;
  /** Attribute a late value to an earlier frame still in the ring. False when that frame has left it. */
  sample(frame: number, name: string, value: number): boolean;
  /** Counts a failing source (the sampler's own sources). */
  sourceFailed(): void;
  snapshot(): CounterTraceSnapshot;
  exportTrace(): CounterTraceExport;
  reset(): void;
  dispose(): void;
}

const increment = (n: number) => Math.min(Number.MAX_SAFE_INTEGER, n + 1);
const bound = (name: string, value: number, max: number) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new RangeError(`counter trace ${name} must be an integer in 1..${max}`);
  return value;
};

export function createCounterTrace(options: CounterTraceOptions = {}): CounterTrace {
  const capacity = bound('capacity', options.capacity ?? 2048, 65536);
  const maxCounters = bound('maxCounters', options.maxCounters ?? 16, 64);
  const maxNameLength = bound('maxNameLength', options.maxNameLength ?? 64, 120);
  const ring = new Array<CounterTraceRow | undefined>(capacity);
  const names: string[] = [],
    ids = new Map<string, number>();
  let head = 0,
    size = 0,
    lastFrame = -Infinity,
    lastTime = -Infinity,
    disposed = false;
  const c = {
    droppedFrames: 0,
    droppedCounters: 0,
    truncatedNames: 0,
    invalidValues: 0,
    invalidFrames: 0,
    lateSamples: 0,
    lateDropped: 0,
    sourceErrors: 0,
  };
  const bump = (k: keyof typeof c) => (c[k] = increment(c[k]));

  /** The counter's index, or null when the name table is full. */
  const idOf = (raw: string): number | null => {
    const name = raw.slice(0, maxNameLength);
    let id = ids.get(name);
    if (id !== undefined) return id;
    if (names.length >= maxCounters) {
      bump('droppedCounters');
      return null;
    }
    if (name.length !== raw.length) bump('truncatedNames');
    id = names.length;
    names.push(name);
    ids.set(name, id);
    return id;
  };
  const put = (row: CounterTraceRow, name: string, value: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      bump('invalidValues');
      return false;
    }
    const id = idOf(name);
    if (id === null) return false;
    row.values[id] = value;
    return true;
  };
  const rowAt = (i: number) => ring[(head - size + capacity + i) % capacity]!;
  const snapshot = (): CounterTraceSnapshot => ({
    names: [...names],
    rows: Array.from({length: size}, (_, i) => {
      const r = rowAt(i);
      return {...r, values: [...r.values]};
    }),
    ...c,
    disposed,
  });

  return {
    frame(frame, timeMs, values, stepped = false) {
      if (disposed) return;
      if (!Number.isSafeInteger(frame) || frame <= lastFrame || !Number.isFinite(timeMs * 1000) || timeMs < lastTime) {
        bump('invalidFrames');
        return;
      }
      lastFrame = frame;
      lastTime = timeMs;
      const row: CounterTraceRow = {frame, timeMs, stepped, values: []};
      if (values) for (const name of Object.keys(values)) if (values[name] !== undefined) put(row, name, values[name]);
      if (size === capacity) bump('droppedFrames');
      ring[head] = row;
      head = (head + 1) % capacity;
      if (size < capacity) size++;
    },
    sample(frame, name, value) {
      if (disposed) return false;
      // Late values are a few frames old: search newest first.
      for (let i = size - 1; i >= 0; i--) {
        const row = rowAt(i);
        if (row.frame < frame) break;
        if (row.frame === frame) {
          if (!put(row, name, value)) return false;
          bump('lateSamples');
          return true;
        }
      }
      bump('lateDropped');
      return false;
    },
    sourceFailed() {
      if (!disposed) bump('sourceErrors');
    },
    snapshot,
    exportTrace() {
      const snap = snapshot();
      const traceEvents: CounterEvent[] = [];
      for (const row of snap.rows) {
        const ts = row.timeMs * 1000;
        traceEvents.push({
          ph: 'i',
          s: 'g',
          cat: 'foundation.frames',
          name: 'frame',
          pid: 1,
          tid: 1,
          ts,
          args: {frame: row.frame, stepped: row.stepped},
        });
        row.values.forEach((value, id) => {
          if (value !== undefined)
            traceEvents.push({
              ph: 'C',
              cat: 'foundation.counters',
              name: snap.names[id]!,
              pid: 1,
              tid: 1,
              ts,
              args: {value},
            });
        });
      }
      const {names: counters, rows, ...rest} = snap;
      return {traceEvents, displayTimeUnit: 'ms', metadata: {...rest, schemaVersion: 1, frames: rows.length, counters}};
    },
    reset() {
      ring.fill(undefined);
      names.length = 0;
      ids.clear();
      head = size = 0;
      lastFrame = lastTime = -Infinity;
      for (const k of Object.keys(c) as (keyof typeof c)[]) c[k] = 0;
    },
    dispose() {
      disposed = true;
    },
  };
}

export interface CounterSamplerOptions {
  /** The loop's frame number for the record being sampled (the app loop's `stats.frames`). */
  frameNumber(): number;
  /** Extra per-frame values (renderer counters, queue depths, jobs in flight). A throwing source is counted and that
   *  frame keeps the loop's own values. Sources run inside the frame: keep them O(1) reads of existing stats. */
  sources?: (() => CounterValues) | undefined;
}

/**
 * The loop's one observational sampler, feeding `trace`: each rendered or skipped frame becomes a row with the loop's
 * `intervalMs` and `workMs` plus the sources' values; hidden records are not frames and are not recorded.
 */
export function counterSampler(trace: CounterTrace, o: CounterSamplerOptions): FrameSamplerPort {
  const values: Record<string, number | undefined> = {};
  return {
    frame(r: Readonly<FrameRecord>) {
      if (r.hidden) return;
      for (const k of Object.keys(values)) delete values[k];
      values.intervalMs = r.intervalMs;
      values.workMs = r.workMs;
      values.rendered = r.rendered ? 1 : 0;
      if (o.sources) {
        try {
          Object.assign(values, o.sources());
        } catch {
          trace.sourceFailed();
        }
      }
      trace.frame(o.frameNumber(), r.timeMs, values, r.stepped);
    },
  };
}

/** A Chrome Trace Event JSON document as the event, system and counter recorders export it. */
export interface TraceExport {
  traceEvents: readonly {ts: number}[];
  metadata?: unknown;
}

/** Concatenates exports into one document (events ordered by timestamp, ties keep input order); each source's
 *  metadata is kept, in input order, under `metadata.sources`. */
export function mergeTraceExports(...exports: TraceExport[]): {
  traceEvents: {ts: number}[];
  displayTimeUnit: 'ms';
  metadata: {schemaVersion: 1; sources: unknown[]};
} {
  const traceEvents = exports
    .flatMap((e, source) => e.traceEvents.map((event, index) => ({event, source, index})))
    .sort((a, b) => a.event.ts - b.event.ts || a.source - b.source || a.index - b.index)
    .map(x => x.event);
  return {traceEvents, displayTimeUnit: 'ms', metadata: {schemaVersion: 1, sources: exports.map(e => e.metadata)}};
}
