/**
 * kits/replay/shadow.ts: a differential shadow runner with snapshot anchors.
 *
 * Two implementations of the same deterministic step (a reference and an optimised one, old and new code) advance in
 * lockstep from the same starting state with the same recorded inputs. After every step the runner digests both
 * states (canonical JSON, the replay kit's `hashText`) and stops at the first step whose digests differ, a side that
 * throws, or a state it cannot read. The report names the step, its input, a bounded list of differing paths and the
 * last agreeing state; periodic anchors (both sides' saved states at an agreeing boundary) let the divergence be
 * replayed from the nearest anchor instead of from the start.
 *
 * Each side is the rollback kit's `save`/`load`/`step` port contract (the sync test's ports), plus an optional `view`
 * that returns the state to compare when it should leave out scratch fields. Inputs come from any tick-addressed
 * source; `replayInputs` adapts a replay log player. Nothing here reads a clock or schedules work: the caller drives
 * `step()` or `run(slice)` and may stop at any boundary.
 */
import type {JsonLimits} from '../network/captured-json';
import {captureJson, captureJsonLimits} from '../network/captured-json';
import type {RollbackPorts} from '../rollback/types';
import {listDifferences, type StateDifference} from './explain';
import {hashText} from './hash';
import type {ReplayPlayer} from './log';

/** One implementation under comparison. Not sandboxed: calls are synchronous creator code. */
export interface ShadowSide extends Pick<RollbackPorts, 'save' | 'load' | 'step'> {
  /** JSON text of the state to compare (default: `save()`). Leave out fields that may legitimately differ. */
  view?(): string;
}
/** The inputs of step `step`, or undefined when the recording ends. The same frozen array reaches both sides. */
export type ShadowInputs = (step: number) => readonly string[] | undefined;

export interface ShadowLimits {
  /** Most steps one runner may take (from its first step): [1, 10_000_000]. Default 100_000. */
  readonly maxSteps?: number;
  /** An anchor is kept at every boundary that is a multiple of this (and at the first boundary): [1, 1_000_000].
   *  Default 256. */
  readonly anchorEvery?: number;
  /** Anchors retained; the oldest is evicted first: [1, 4096]. Default 16. */
  readonly maxAnchors?: number;
  /** Differing paths listed in a state divergence: [1, 1024]. Default 16. */
  readonly maxDiffPaths?: number;
  /** UTF-8 bytes of one input text: [1, 65_536]. Default 4096. */
  readonly maxInputBytes?: number;
  /** Inputs per step: [1, 64]. Default 8. */
  readonly maxInputsPerStep?: number;
  /** Bounds of each saved and compared state text (maxBytes at most 16 MiB). Default 1 MiB, 2^16 nodes, depth 32. */
  readonly state?: JsonLimits;
  /** Longest value preview in a difference: [1, 4096]. Default 160. */
  readonly maxValueChars?: number;
}

export const SHADOW_DEFAULTS = Object.freeze({
  maxSteps: 100_000,
  anchorEvery: 256,
  maxAnchors: 16,
  maxDiffPaths: 16,
  maxInputBytes: 4096,
  maxInputsPerStep: 8,
  state: Object.freeze({maxBytes: 1 << 20, maxNodes: 1 << 16, maxDepth: 32}),
  maxValueChars: 160,
});
export const SHADOW_LIMIT_RANGES = Object.freeze({
  maxSteps: [1, 10_000_000],
  anchorEvery: [1, 1_000_000],
  maxAnchors: [1, 4096],
  maxDiffPaths: [1, 1024],
  maxInputBytes: [1, 65_536],
  maxInputsPerStep: [1, 64],
  stateBytes: [1, 16 << 20],
  maxValueChars: [1, 4096],
} as const);

/** Both sides' saved states at an agreeing boundary: the state before step `step`. */
export type ShadowAnchor = Readonly<{step: number; digest: string; a: string; b: string}>;
export type ShadowSideName = 'a' | 'b' | 'both';

export type ShadowDivergence =
  /** The compared states differ after step `step` (or, with `step` null, before the first step). */
  | Readonly<{
      kind: 'state';
      step: number | null;
      inputs: readonly string[] | null;
      a: string;
      b: string;
      differences: readonly StateDifference[];
      /** More paths differ than `maxDiffPaths`. */
      truncated: boolean;
      /** Why no paths are listed: the views are not readable as one JSON tree, or the digests differ only in text the
       *  canonical parse does not see. */
      unavailable: 'detail-unreadable' | 'no-difference' | null;
      lastAgreed: ShadowAnchor | null;
      anchor: ShadowAnchor | null;
    }>
  /** A side threw in `phase` while producing the state after step `step` (`load`: restoring the anchor at `step`). */
  | Readonly<{
      kind: 'threw';
      step: number;
      inputs: readonly string[] | null;
      side: ShadowSideName;
      phase: 'step' | 'save' | 'view' | 'load';
      message: string;
      lastAgreed: ShadowAnchor | null;
      anchor: ShadowAnchor | null;
    }>
  /** A side's saved or compared state is not a string, is not JSON, or exceeds the state bounds. */
  | Readonly<{
      kind: 'unreadable';
      step: number | null;
      inputs: readonly string[] | null;
      side: ShadowSideName;
      reason: 'not-string' | 'over-limit-or-not-json';
      lastAgreed: ShadowAnchor | null;
      anchor: ShadowAnchor | null;
    }>
  /** Restoring the anchor at `step` did not reproduce its digest: an incomplete `load` or state outside `save`. */
  | Readonly<{kind: 'anchor-mismatch'; step: number; side: ShadowSideName; expected: string; actual: string}>;

export type ShadowStatus = 'running' | 'agree' | 'diverged' | 'over-budget' | 'cancelled' | 'failed';
export interface ShadowReport {
  readonly status: ShadowStatus;
  /** The first step index (0, or the anchor's step). */
  readonly from: number;
  /** The next step to run; every boundary before it agreed (except the start, when the start diverged). */
  readonly next: number;
  /** Steps both sides completed and agreed on. */
  readonly steps: number;
  readonly anchorsTaken: number;
  readonly anchorsEvicted: number;
  readonly divergence: ShadowDivergence | null;
  /** Why the run stopped without a verdict: 'aborted' or 'cancelled' (status 'cancelled'); 'invalid-input' or
   *  'inputs-threw: …' (status 'failed': the input source broke its contract). Else null. */
  readonly reason: string | null;
}
export interface ShadowRunner {
  /** Run one step on both sides and compare. A finished runner returns its report unchanged. */
  step(): ShadowReport;
  /** Run at most `slice` steps (default: until finished), stopping early at any verdict. */
  run(slice?: number): ShadowReport;
  read(): ShadowReport;
  /** Retained anchors, oldest first. */
  anchors(): readonly ShadowAnchor[];
  /** Stop now; the report keeps its progress and the anchors stay readable. Idempotent. */
  cancel(): void;
}
export interface ShadowOptions {
  readonly a: ShadowSide;
  readonly b: ShadowSide;
  readonly inputs: ShadowInputs;
  readonly limits?: ShadowLimits;
  /** Restore both sides to this anchor and start at its step (verifying its digest), instead of their current state. */
  readonly from?: ShadowAnchor;
  /** Abort cancels the run at the next call. */
  readonly signal?: AbortSignal;
}

type Captured = Required<Omit<ShadowLimits, 'state'>> & {state: JsonLimits};
const within = (n: unknown, [min, max]: readonly [number, number]): n is number =>
  Number.isSafeInteger(n) && (n as number) >= min && (n as number) <= max;
const utf8 = (s: string) => new TextEncoder().encode(s).length;

export function captureShadowLimits(l: ShadowLimits = {}): Readonly<Captured> {
  if (l === null || typeof l !== 'object') throw RangeError('shadow: limits must be an object');
  const r = SHADOW_LIMIT_RANGES,
    d = SHADOW_DEFAULTS;
  const pick = (key: Exclude<keyof typeof r, 'stateBytes'>): number => {
    const value = l[key] ?? d[key];
    if (!within(value, r[key])) throw RangeError(`shadow: ${key} must be an integer in [${r[key][0]}, ${r[key][1]}]`);
    return value;
  };
  let state: JsonLimits;
  try {
    state = captureJsonLimits(l.state ?? d.state);
  } catch {
    throw RangeError('shadow: state limits must be positive integers');
  }
  if (!within(state.maxBytes, r.stateBytes)) throw RangeError('shadow: state.maxBytes must be at most 16 MiB');
  return Object.freeze({
    maxSteps: pick('maxSteps'),
    anchorEvery: pick('anchorEvery'),
    maxAnchors: pick('maxAnchors'),
    maxDiffPaths: pick('maxDiffPaths'),
    maxInputBytes: pick('maxInputBytes'),
    maxInputsPerStep: pick('maxInputsPerStep'),
    maxValueChars: pick('maxValueChars'),
    state,
  });
}

/** The inputs of a replay log as shadow inputs: one input per step, the log's canonical JSON text. */
export function replayInputs(player: ReplayPlayer): ShadowInputs {
  return step => {
    const json = player.json(step);
    return json === undefined ? undefined : Object.freeze([json]);
  };
}

/** The newest anchor at or before `step`, or null. */
export function nearestAnchor(anchors: readonly ShadowAnchor[], step: number): ShadowAnchor | null {
  let best: ShadowAnchor | null = null;
  for (const anchor of anchors) if (anchor.step <= step && (!best || anchor.step > best.step)) best = anchor;
  return best;
}

const MESSAGE_CHARS = 200;
const messageOf = (e: unknown) => {
  let text: string;
  try {
    text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  } catch {
    text = 'unprintable';
  }
  return text.length > MESSAGE_CHARS ? `${text.slice(0, MESSAGE_CHARS - 1)}…` : text;
};
const sideOf = (a: boolean, b: boolean): ShadowSideName | null => (a && b ? 'both' : a ? 'a' : b ? 'b' : null);

type Read =
  | {ok: true; saved: string; digest: string; view: string}
  | {ok: false; kind: 'threw'; phase: 'save' | 'view'; message: string}
  | {ok: false; kind: 'unreadable'; reason: 'not-string' | 'over-limit-or-not-json'};

/**
 * Create a step-by-step differential runner. Bounds: `maxSteps` steps; per step two `step`, two `save` (plus two
 * `view` when given) and two canonical parses of at most `state.maxBytes`; memory at most `maxAnchors` anchors of two
 * states, plus the last agreeing pair. Throws RangeError only for an invalid configuration.
 */
export function createShadowRunner(options: ShadowOptions): ShadowRunner {
  if (options === null || typeof options !== 'object') throw RangeError('shadow: options must be an object');
  const limits = captureShadowLimits(options.limits);
  const sides = [options.a, options.b] as const;
  for (const side of sides)
    if (
      side === null ||
      typeof side !== 'object' ||
      ![side.save, side.load, side.step].every(f => typeof f === 'function') ||
      (side.view !== undefined && typeof side.view !== 'function')
    )
      throw RangeError('shadow: each side needs save, load and step functions (and view, if given, a function)');
  const source = options.inputs;
  if (typeof source !== 'function') throw RangeError('shadow: inputs must be a function of the step');
  const signal = options.signal;
  if (signal !== undefined && (signal === null || typeof signal.aborted !== 'boolean'))
    throw RangeError('shadow: signal must be an AbortSignal');
  const start = options.from;
  if (
    start !== undefined &&
    (start === null ||
      typeof start !== 'object' ||
      !Number.isSafeInteger(start.step) ||
      start.step < 0 ||
      typeof start.digest !== 'string' ||
      typeof start.a !== 'string' ||
      typeof start.b !== 'string')
  )
    throw RangeError('shadow: from must be an anchor');
  const from = start?.step ?? 0;

  let status: ShadowStatus = 'running',
    reason: string | null = null,
    divergence: ShadowDivergence | null = null,
    next = from,
    anchorsTaken = 0,
    anchorsEvicted = 0,
    busy = false,
    started = false;
  let last: ShadowAnchor | null = null;
  const ring: ShadowAnchor[] = [];
  let head = 0;

  const retained = (): ShadowAnchor[] => [...ring.slice(head), ...ring.slice(0, head)];
  const keep = (anchor: ShadowAnchor) => {
    anchorsTaken++;
    if (ring.length < limits.maxAnchors) ring.push(anchor);
    else {
      ring[head] = anchor;
      head = (head + 1) % limits.maxAnchors;
      anchorsEvicted++;
    }
  };

  const report = (): ShadowReport =>
    Object.freeze({
      status,
      from,
      next,
      steps: next - from,
      anchorsTaken,
      anchorsEvicted,
      divergence,
      reason,
    });
  const diverge = (d: ShadowDivergence): ShadowReport => {
    status = 'diverged';
    divergence = Object.freeze(d);
    return report();
  };

  const readSide = (side: ShadowSide): Read => {
    let saved: unknown, view: unknown;
    try {
      saved = side.save();
    } catch (e) {
      return {ok: false, kind: 'threw', phase: 'save', message: messageOf(e)};
    }
    if (typeof saved !== 'string') return {ok: false, kind: 'unreadable', reason: 'not-string'};
    if (utf8(saved) > limits.state.maxBytes) return {ok: false, kind: 'unreadable', reason: 'over-limit-or-not-json'};
    if (side.view) {
      try {
        view = side.view();
      } catch (e) {
        return {ok: false, kind: 'threw', phase: 'view', message: messageOf(e)};
      }
      if (typeof view !== 'string') return {ok: false, kind: 'unreadable', reason: 'not-string'};
    } else view = saved;
    let canonical: string;
    try {
      canonical = captureJson(view as string, limits.state).json;
    } catch {
      return {ok: false, kind: 'unreadable', reason: 'over-limit-or-not-json'};
    }
    return {ok: true, saved, digest: hashText(canonical), view: view as string};
  };

  /** Read both sides at boundary `at`; returns a verdict to stop with, or the agreeing anchor. */
  const compare = (
    at: number,
    step: number | null,
    inputs: readonly string[] | null,
    ra: Read = readSide(sides[0]),
    rb: Read = readSide(sides[1]),
  ): ShadowReport | ShadowAnchor => {
    const context = {step, inputs, lastAgreed: last, anchor: nearestAnchor(retained(), at)};
    const threw = sideOf(!ra.ok && ra.kind === 'threw', !rb.ok && rb.kind === 'threw');
    if (threw) {
      const t = (!ra.ok && ra.kind === 'threw' ? ra : rb) as Extract<Read, {kind: 'threw'}>;
      return diverge({kind: 'threw', ...context, step: step ?? at, side: threw, phase: t.phase, message: t.message});
    }
    const unreadable = sideOf(!ra.ok, !rb.ok);
    if (unreadable) {
      const u = (!ra.ok ? ra : rb) as Extract<Read, {kind: 'unreadable'}>;
      return diverge({kind: 'unreadable', ...context, side: unreadable, reason: u.reason});
    }
    const x = ra as Extract<Read, {ok: true}>,
      y = rb as Extract<Read, {ok: true}>;
    if (x.digest !== y.digest) {
      const listed = listDifferences(x.view, y.view, {
        maxPaths: limits.maxDiffPaths,
        limits: limits.state,
        maxValueChars: limits.maxValueChars,
      });
      return diverge({
        kind: 'state',
        ...context,
        a: x.digest,
        b: y.digest,
        differences: listed.status === 'listed' ? listed.differences : Object.freeze([]),
        truncated: listed.status === 'listed' && listed.truncated,
        unavailable: listed.status === 'listed' ? null : listed.reason,
      });
    }
    return Object.freeze({step: at, digest: x.digest, a: x.saved, b: y.saved});
  };

  const agreed = (anchor: ShadowAnchor) => {
    last = anchor;
    if (anchor.step === from || anchor.step % limits.anchorEvery === 0) keep(anchor);
  };

  const cancelled = (): boolean => {
    if (status === 'running' && signal?.aborted) {
      status = 'cancelled';
      reason = 'aborted';
    }
    return status !== 'running';
  };

  /** Restore the starting anchor (when given) and compare the starting boundary. */
  const begin = (): ShadowReport | null => {
    started = true;
    if (start) {
      const failed = [false, false];
      let message = '';
      sides.forEach((side, i) => {
        try {
          side.load(i === 0 ? start.a : start.b);
        } catch (e) {
          failed[i] = true;
          message ||= messageOf(e);
        }
      });
      const threw = sideOf(failed[0]!, failed[1]!);
      if (threw)
        return diverge({
          kind: 'threw',
          step: from,
          inputs: null,
          side: threw,
          phase: 'load',
          message,
          lastAgreed: null,
          anchor: null,
        });
    }
    const ra = readSide(sides[0]),
      rb = readSide(sides[1]);
    if (start && ra.ok && rb.ok) {
      // Each side must reproduce the anchor it was restored from, whatever the other side did.
      const mismatch = sideOf(ra.digest !== start.digest, rb.digest !== start.digest);
      if (mismatch)
        return diverge({
          kind: 'anchor-mismatch',
          step: from,
          side: mismatch,
          expected: start.digest,
          actual: mismatch === 'b' ? rb.digest : ra.digest,
        });
    }
    const result = compare(from, null, null, ra, rb);
    if (!('digest' in result)) return result;
    agreed(result);
    return null;
  };

  const once = (): ShadowReport => {
    if (cancelled()) return report();
    if (busy) throw Error('shadow: step called re-entrantly from a side');
    busy = true;
    try {
      if (!started) {
        const stopped = begin();
        if (stopped) return stopped;
      }
      let supplied: unknown;
      try {
        supplied = source(next);
      } catch (e) {
        status = 'failed';
        reason = `inputs-threw: ${messageOf(e)}`;
        return report();
      }
      if (supplied === undefined) {
        status = 'agree';
        return report();
      }
      if (next - from >= limits.maxSteps) {
        status = 'over-budget';
        return report();
      }
      if (
        !Array.isArray(supplied) ||
        supplied.length < 1 ||
        supplied.length > limits.maxInputsPerStep ||
        !supplied.every(i => typeof i === 'string' && utf8(i) <= limits.maxInputBytes)
      ) {
        status = 'failed';
        reason = 'invalid-input';
        return report();
      }
      const inputs = Object.freeze([...(supplied as readonly string[])]);
      const at = next;
      const failed = [false, false];
      let message = '';
      sides.forEach((side, i) => {
        try {
          side.step(inputs, at);
        } catch (e) {
          failed[i] = true;
          message ||= messageOf(e);
        }
      });
      const threw = sideOf(failed[0]!, failed[1]!);
      if (threw)
        return diverge({
          kind: 'threw',
          step: at,
          inputs,
          side: threw,
          phase: 'step',
          message,
          lastAgreed: last,
          anchor: nearestAnchor(retained(), at),
        });
      // A state verdict for the boundary after `at` names `at` as the step that produced it.
      const result = compare(at + 1, at, inputs);
      if (!('digest' in result)) return result;
      next = at + 1;
      agreed(result);
      return report();
    } finally {
      busy = false;
    }
  };

  return Object.freeze({
    step: once,
    run(slice?: number) {
      if (slice !== undefined && !(Number.isSafeInteger(slice) && slice > 0))
        throw RangeError('shadow: slice must be a positive integer');
      let result = report();
      for (let i = 0; slice === undefined || i < slice; i++) {
        result = once();
        if (result.status !== 'running') break;
      }
      return result;
    },
    read: report,
    anchors: () => Object.freeze(retained()),
    cancel() {
      if (status === 'running') {
        status = 'cancelled';
        reason = 'cancelled';
      }
    },
  });
}
