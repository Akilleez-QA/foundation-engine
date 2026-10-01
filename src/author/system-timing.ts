import { monotonicNow } from '../core/clock';
import type { SystemSpec } from '../core/ecs/systems';
import type { SceneVisit } from '../core/router/handover';

export interface SystemTimingOptions {
  capacity?: number;
  maxLabels?: number;
  maxLabelLength?: number;
  /** Nonnegative monotonic same-thread milliseconds; diagnostic failures are contained. */
  now?: () => number;
}
export interface SystemTimingRecord {
  sequence: number;
  ordinal: number;
  phase: 'fixed' | 'frame';
  label: number | null;
  startMs: number | null;
  durationMs: number | null;
  failed: boolean;
}
export interface SystemTimingSnapshot {
  epoch: number;
  records: SystemTimingRecord[];
  labels: string[];
  droppedRecords: number;
  droppedLabels: number;
  truncatedLabels: number;
  invalidClockSamples: number;
  disposed: boolean;
}
export interface SystemTimingCapture {
  snapshot(): SystemTimingSnapshot;
  exportTrace(): {
    traceEvents: { ph: 'X'; cat: 'foundation.systems'; name: string; pid: 1; tid: 1; ts: number; dur: number;
      args: { epoch: number; ordinal: number; phase: 'fixed' | 'frame'; failed: boolean } }[];
    displayTimeUnit: 'ms';
    metadata: Omit<SystemTimingSnapshot, 'records' | 'labels'> & { schemaVersion: 1; invalidTimingRecords: number };
  };
  reset(): void;
  dispose(): void;
}

/** Optional dev/test composition. No runner, timer, event bus, context retention or production registration. */
export function createSystemTiming<C>(systems: readonly SystemSpec<C>[], visit: SceneVisit, activity: AbortSignal) {
  let active: ReturnType<typeof recorder> | undefined;
  const current = () => !activity.aborted && !visit.signal.aborted && visit.current();
  const close = () => {
    active?.capture.dispose();
    activity.removeEventListener('abort', close);
    visit.signal.removeEventListener('abort', close);
  };
  if (current()) {
    activity.addEventListener('abort', close, { once: true });
    visit.signal.addEventListener('abort', close, { once: true });
  }
  return {
    systems: systems.map((system, ordinal): SystemSpec<C> => ({
      ...system,
      run(ctx, dt) {
        const recording = active;
        if (!recording || !current()) return system.run(ctx, dt);
        const end = recording.begin(ordinal, system.phase ?? 'fixed', system.id);
        let failed = true;
        try { const result = system.run(ctx, dt); failed = false; return result; }
        finally { end?.(failed); }
      },
    })),
    start(options: SystemTimingOptions = {}): SystemTimingCapture | null {
      if (!current()) return null;
      const next = recorder(visit.epoch, options);
      active?.capture.dispose();
      active = next;
      return next.capture;
    },
  };
}

const increment = (n: number) => Math.min(Number.MAX_SAFE_INTEGER, n + 1);
function recorder(epoch: number, options: SystemTimingOptions) {
  const capacity = options.capacity ?? 2048, maxLabels = options.maxLabels ?? 256, maxLabelLength = options.maxLabelLength ?? 120;
  for (const n of [capacity, maxLabels, maxLabelLength]) {
    if (!Number.isSafeInteger(n) || n < 1 || n > 0xffffffff) throw new RangeError('system timing: invalid capture bound');
  }
  const now = options.now ?? monotonicNow;
  const ring = new Array<SystemTimingRecord | undefined>(capacity);
  const labels: string[] = [], ids = new Map<string, number>();
  let head = 0, size = 0, sequence = 0, generation = 0, disposed = false, observing = false;
  let droppedRecords = 0, droppedLabels = 0, truncatedLabels = 0, invalidClockSamples = 0, last = 0;
  const sample = (version: number): number | null => {
    try {
      const value = now();
      if (disposed || generation !== version) return null;
      if (typeof value === 'number' && Number.isFinite(value * 1000) && value >= last) { last = value; return value; }
    } catch { /* A diagnostic clock must not alter authored execution. */ }
    if (!disposed && generation === version) invalidClockSamples = increment(invalidClockSamples);
    return null;
  };
  const snapshot = (): SystemTimingSnapshot => ({
    epoch, records: Array.from({ length: size }, (_, i) => ({ ...ring[(head - size + capacity + i) % capacity]! })),
    labels: [...labels], droppedRecords, droppedLabels, truncatedLabels, invalidClockSamples, disposed,
  });
  const capture: SystemTimingCapture = {
    snapshot,
    exportTrace() {
      const { records, labels, ...metadata } = snapshot();
      let invalidTimingRecords = 0;
      const traceEvents: ReturnType<SystemTimingCapture['exportTrace']>['traceEvents'] = [];
      for (const row of records) {
        if (row.startMs === null || row.durationMs === null) { invalidTimingRecords++; continue; }
        traceEvents.push({ ph: 'X', cat: 'foundation.systems', name: row.label === null ? '(unlabelled system)' : labels[row.label],
          pid: 1, tid: 1, ts: row.startMs * 1000, dur: row.durationMs * 1000,
          args: { epoch, ordinal: row.ordinal, phase: row.phase, failed: row.failed } });
      }
      return { traceEvents, displayTimeUnit: 'ms', metadata: { ...metadata, schemaVersion: 1, invalidTimingRecords } };
    },
    reset() {
      generation++; ring.fill(undefined); labels.length = 0; ids.clear();
      head = size = sequence = droppedRecords = droppedLabels = truncatedLabels = invalidClockSamples = last = 0;
    },
    dispose() { disposed = true; generation++; },
  };
  return {
    capture,
    begin(ordinal: number, phase: 'fixed' | 'frame', name: string) {
      if (disposed || observing) return;
      observing = true;
      const version = generation;
      let startMs: number | null;
      try { startMs = sample(version); } finally { observing = false; }
      if (disposed || generation !== version) return;
      const bounded = name.slice(0, maxLabelLength);
      if (bounded.length !== name.length) truncatedLabels = increment(truncatedLabels);
      let label = ids.get(bounded) ?? null;
      if (label === null) {
        if (labels.length < maxLabels) { label = labels.length; labels.push(bounded); ids.set(bounded, label); }
        else droppedLabels = increment(droppedLabels);
      }
      return (failed: boolean) => {
        if (disposed || generation !== version) return;
        observing = true;
        let end: number | null;
        try { end = sample(version); } finally { observing = false; }
        if (disposed || generation !== version) return;
        const durationMs = startMs === null || end === null || !Number.isFinite((end - startMs) * 1000) ? null : end - startMs;
        if (sequence === Number.MAX_SAFE_INTEGER) { droppedRecords = increment(droppedRecords); return; }
        ring[head] = { sequence: ++sequence, ordinal, phase, label, startMs, durationMs, failed };
        head = (head + 1) % capacity;
        if (size < capacity) size++; else droppedRecords = increment(droppedRecords);
      };
    },
  };
}
