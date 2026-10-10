import type {DocumentValue} from '../authoring/document';
import type {PredictionSnapshot} from './prediction-types';

/** Hard ceiling on the projected presentation width checked at construction. */
export const MAX_SMOOTHING_WIDTH = 64;
/** Hard ceiling on one `advance` step, so a stalled frame cannot request unbounded decay. */
export const MAX_SMOOTHING_ELAPSED_MS = 60_000;

export type PredictionSmoothingDecay = Readonly<{kind: 'half-life'; halfLifeMs: number}> | Readonly<{kind: 'linear'}>;

export interface PredictionSmoothingOptions {
  /** Fixed number of presented components, 1..MAX_SMOOTHING_WIDTH. */
  readonly width: number;
  /** Synchronous pure creator projection of predicted state to exactly `width` finite numbers. */
  readonly project: (value: DocumentValue) => readonly number[];
  /** Per-component offset bound (one number for all, or `width` numbers). A correction whose
   * accumulated offset exceeds it in any component snaps instead and is reported as a discontinuity. */
  readonly snapDistance: number | readonly number[];
  /** Per-component cap on decay movement in units per millisecond. Linear decay moves at this rate. */
  readonly maxRatePerMs: number | readonly number[];
  readonly decay: PredictionSmoothingDecay;
  /** Largest elapsed time honoured by one `advance` call, (0, MAX_SMOOTHING_ELAPSED_MS]. */
  readonly maxElapsedMs: number;
  /** A component at or below this after decay becomes exactly zero, if that stays within the step allowance. */
  readonly settle: number;
}

export type PredictionSmoothingRefusal = Readonly<{status: 'busy' | 'retired' | 'invalid'}>;
export type PredictionSmoothingCorrection =
  | Readonly<{status: 'smoothed' | 'snapped' | 'unchanged'}>
  | Readonly<{status: 'discontinuity'; reason: string}>
  | PredictionSmoothingRefusal;
export type PredictionSmoothingPresent =
  | Readonly<{status: 'presented'; values: readonly number[]; discontinuity: boolean}>
  | Readonly<{status: 'absent'; values: null; discontinuity: true}>
  | PredictionSmoothingRefusal;
export interface PredictionSmoothingState {
  readonly status: 'ready' | 'retired';
  readonly offset: readonly number[];
  readonly discontinuityPending: boolean;
  readonly corrections: number;
  readonly snaps: number;
  readonly discontinuities: number;
  readonly lastDiscontinuity: string | null;
}
export interface PredictionSmoothing {
  /** Compare two `Prediction.read()` snapshots taken around one `reconcile` call. */
  observe(before: PredictionSnapshot, after: PredictionSnapshot): PredictionSmoothingCorrection;
  /** Low-level: presentation was at `from`; simulation is now exactly `to`. */
  correct(from: DocumentValue, to: DocumentValue): PredictionSmoothingCorrection;
  advance(elapsedMs: number): Readonly<{status: 'advanced'; settled: boolean}> | PredictionSmoothingRefusal;
  /** Presented values = projection of exact state + bounded offset. Reading consumes the discontinuity flag. */
  present(value: DocumentValue | null): PredictionSmoothingPresent;
  /** Clear the offset and flag the next presentation as discontinuous (teleport, respawn, new owner). */
  discontinuity(reason?: string): void;
  read(): PredictionSmoothingState;
  dispose(): void;
}

/** Lists are validated to `width` entries, so the fallback is never used. */
const at = (list: readonly number[], i: number) => list[i] ?? 0;
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const reasonText = (why: unknown, fallback: string) =>
  typeof why === 'string' && why.length > 0 && why.length <= 256 ? why : fallback;

function perComponent(value: unknown, width: number, name: string): readonly number[] {
  const list = typeof value === 'number' ? Array.from({length: width}, () => value) : value;
  if (!Array.isArray(list) || list.length !== width || !list.every(positive))
    throw Error(`prediction smoothing: invalid ${name}`);
  return Object.freeze([...list]);
}

/**
 * Optional presentation offset over a creator projection of predicted state. Simulation state is
 * never modified; owns no clock, frame loop, ECS write or prediction state.
 */
export function createPredictionSmoothing(options: PredictionSmoothingOptions): PredictionSmoothing {
  const {width, project, decay, maxElapsedMs, settle} = options;
  if (!Number.isSafeInteger(width) || width < 1 || width > MAX_SMOOTHING_WIDTH)
    throw Error('prediction smoothing: invalid width');
  if (typeof project !== 'function') throw Error('prediction smoothing: invalid projection');
  const snapDistance = perComponent(options.snapDistance, width, 'snapDistance');
  const maxRate = perComponent(options.maxRatePerMs, width, 'maxRatePerMs');
  if (!positive(maxElapsedMs) || maxElapsedMs > MAX_SMOOTHING_ELAPSED_MS)
    throw Error('prediction smoothing: invalid maxElapsedMs');
  if (typeof settle !== 'number' || !Number.isFinite(settle) || settle < 0 || snapDistance.some(d => settle >= d))
    throw Error('prediction smoothing: invalid settle');
  const kind = decay?.kind;
  const halfLifeMs = kind === 'half-life' ? (decay as {halfLifeMs: unknown}).halfLifeMs : 0;
  if (kind !== 'linear' && !(kind === 'half-life' && positive(halfLifeMs)))
    throw Error('prediction smoothing: invalid decay');

  const offset = new Array<number>(width).fill(0);
  let status: 'ready' | 'retired' = 'ready',
    busy = false,
    pendingFlag = false;
  let corrections = 0,
    snaps = 0,
    discontinuities = 0,
    lastDiscontinuity: string | null = null;

  const refuse = (): PredictionSmoothingRefusal =>
    Object.freeze({status: status === 'retired' ? ('retired' as const) : ('busy' as const)});
  function clear(reason: string) {
    offset.fill(0);
    pendingFlag = true;
    discontinuities++;
    lastDiscontinuity = reason;
  }
  /** Calls creator code; returns null (after clearing) on any invalid projection. */
  function projected(value: DocumentValue): number[] | null {
    let out: unknown;
    try {
      out = project(value);
    } catch {
      out = null;
    }
    if (status !== 'ready') return null;
    if (!Array.isArray(out) || out.length !== width) return null;
    const copy = [...(out as unknown[])];
    return copy.every(n => typeof n === 'number' && Number.isFinite(n)) ? (copy as number[]) : null;
  }
  function correctNow(from: DocumentValue, to: DocumentValue): PredictionSmoothingCorrection {
    const a = projected(from);
    const b = a && projected(to);
    if (status !== 'ready') return refuse();
    if (!a || !b) {
      clear('projection-failed');
      return Object.freeze({status: 'discontinuity', reason: 'projection-failed'});
    }
    const next = offset.map((o, i) => o + (at(a, i) - at(b, i)));
    if (next.every((n, i) => n === at(offset, i))) return Object.freeze({status: 'unchanged'});
    if (next.some((n, i) => !Number.isFinite(n) || Math.abs(n) > at(snapDistance, i))) {
      snaps++;
      clear('snap');
      return Object.freeze({status: 'snapped'});
    }
    corrections++;
    next.forEach((n, i) => (offset[i] = n));
    return Object.freeze({status: 'smoothed'});
  }
  function guarded<T>(work: () => T): T | PredictionSmoothingRefusal {
    if (status !== 'ready' || busy) return refuse();
    busy = true;
    try {
      return work();
    } finally {
      busy = false;
    }
  }

  return Object.freeze({
    observe(before: PredictionSnapshot, after: PredictionSnapshot) {
      return guarded((): PredictionSmoothingCorrection => {
        const afterValue = after?.status === 'ready' ? after.predicted : null;
        const beforeValue = before?.status === 'ready' ? before.predicted : null;
        if (!afterValue || !beforeValue || before.epoch !== after.epoch) {
          const reason = !afterValue ? 'prediction-unavailable' : 'prediction-replaced';
          clear(reason);
          return Object.freeze({status: 'discontinuity', reason});
        }
        const fresh = after.correction !== null && after.correction !== before.correction;
        const revised = before.confirmed?.revision !== after.confirmed?.revision;
        if (revised && !fresh) {
          // A reconcile happened but a later push cleared its correction: the jump is unknown.
          clear('missed-correction');
          return Object.freeze({status: 'discontinuity', reason: 'missed-correction'});
        }
        if (!fresh || !after.correction!.changed) return Object.freeze({status: 'unchanged'});
        return correctNow(beforeValue.value, afterValue.value);
      });
    },
    correct(from: DocumentValue, to: DocumentValue) {
      return guarded(() => correctNow(from, to));
    },
    advance(elapsedMs: number) {
      if (status !== 'ready' || busy) return refuse();
      if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 0)
        return Object.freeze({status: 'invalid' as const});
      const dt = Math.min(elapsedMs, maxElapsedMs);
      const keep = kind === 'half-life' ? Math.pow(2, -dt / (halfLifeMs as number)) : 0;
      offset.forEach((value, i) => {
        const magnitude = Math.abs(value);
        if (magnitude === 0) return;
        const wanted = kind === 'half-life' ? magnitude * (1 - keep) : magnitude;
        const allowance = at(maxRate, i) * dt;
        const step = Math.min(wanted, allowance, magnitude);
        const rest = magnitude - step;
        // Settling to zero is itself a step, so it happens only within this call's allowance.
        offset[i] = rest <= settle && magnitude <= allowance ? 0 : Math.sign(value) * rest;
      });
      return Object.freeze({status: 'advanced' as const, settled: offset.every(o => o === 0)});
    },
    present(value: DocumentValue | null) {
      return guarded((): PredictionSmoothingPresent => {
        if (value === null) {
          offset.fill(0);
          pendingFlag = true;
          return Object.freeze({status: 'absent', values: null, discontinuity: true});
        }
        const base = projected(value);
        if (status !== 'ready') return refuse();
        if (!base) {
          clear('projection-failed');
          pendingFlag = true;
          return Object.freeze({status: 'absent', values: null, discontinuity: true});
        }
        const flag = pendingFlag;
        pendingFlag = false;
        return Object.freeze({
          status: 'presented',
          values: Object.freeze(base.map((n, i) => n + at(offset, i))),
          discontinuity: flag,
        });
      });
    },
    discontinuity(reason?: string) {
      if (status !== 'ready') return;
      clear(reasonText(reason, 'discontinuity'));
    },
    read() {
      return Object.freeze({
        status,
        offset: Object.freeze([...offset]),
        discontinuityPending: pendingFlag,
        corrections,
        snaps,
        discontinuities,
        lastDiscontinuity,
      });
    },
    dispose() {
      status = 'retired';
      offset.fill(0);
      pendingFlag = false;
    },
  });
}
