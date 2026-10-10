/**
 * kits/replay/shadow.ts: a differential shadow runner with snapshot anchors.
 *
 * Two implementations of the same deterministic step (a reference and an optimised one, old and new code) advance in
 * lockstep from the same starting state with the same recorded inputs. After every step the runner canonicalises both
 * compared states (the network kit's canonical JSON) and stops at the first step where they differ, a side that throws,
 * or a state it cannot read; digests (`hashText`) identify states in reports and anchors. The report names the step, its input, a bounded list of differing paths and the
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
  /** JSON text of the state to compare (default: `save()`, which must then be JSON — narrower than the rollback
   *  ports, whose codec is free). Leave out fields that may legitimately differ. */
  view?(): string;
}
/**
 * The inputs of step `step`, or undefined when the recording ends. Any undefined ends the run as `agree` at that step
 * (`steps` shows how far it got), so a source with a hole stops early. The runner copies each array once and the same
 * frozen copy reaches both sides.
 */
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
  /** Also restore every anchor into both sides as it is taken and check each reproduces it (default false). Costs a
   *  `load` and a re-read per side per anchor; a mismatch ends the run early as `anchor-mismatch`. */
  readonly verifyAnchors?: boolean;
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
  verifyAnchors: false,
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
  /** A side's saved text is not a string or exceeds `state.maxBytes`, or its compared text (the view, else the saved
   *  text) is not a string, not JSON or exceeds the state bounds. A saved text is parsed only when there is no view. */
  | Readonly<{
      kind: 'unreadable';
      step: number | null;
      inputs: readonly string[] | null;
      side: ShadowSideName;
      reason: 'not-string' | 'over-limit-or-not-json';
      lastAgreed: ShadowAnchor | null;
      anchor: ShadowAnchor | null;
    }>
  /**
   * After `load` of the anchor at `step`, a side's compared state does not have the anchor's digest: typically an
   * incomplete `load`. `a` and `b` are each side's digest after the restore. This checks only what `save`/`view` show:
   * state kept outside `save` is invisible to it (use the rollback kit's sync test to find such hidden state), and
   * reproducing a divergence from an anchor assumes `save` and `load` are complete.
   */
  | Readonly<{kind: 'anchor-mismatch'; step: number; side: ShadowSideName; expected: string; a: string; b: string}>;

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
   *  'inputs-threw: …' (status 'failed': the input source broke its contract). Null for every other status. */
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
  /**
   * Stop; the report keeps its progress and the anchors stay readable. Idempotent. Called (or the signal aborted)
   * from inside a side during a step, it takes effect after that step's comparison: a divergence found by that step
   * wins (status 'diverged', reason null); otherwise the step counts and the status becomes 'cancelled'.
   */
  cancel(): void;
}
export interface ShadowOptions {
  readonly a: ShadowSide;
  readonly b: ShadowSide;
  readonly inputs: ShadowInputs;
  readonly limits?: ShadowLimits;
  /** Restore both sides to this anchor and start at its step (verifying its digest), instead of their current state. */
  readonly from?: ShadowAnchor;
  /** Abort cancels the run before the next step (or after the current one, as `cancel`). */
  readonly signal?: AbortSignal;
}

type Captured = Required<Omit<ShadowLimits, 'state'>> & {state: JsonLimits};
const within = (n: unknown, [min, max]: readonly [number, number]): n is number =>
  Number.isSafeInteger(n) && (n as number) >= min && (n as number) <= max;
/** UTF-8 length of `s` is at most `max`. Encodes only when the UTF-16 length cannot decide (length <= bytes <= 3×). */
const bytesWithin = (s: string, max: number): boolean =>
  s.length > max ? false : s.length * 3 <= max ? true : new TextEncoder().encode(s).length <= max;

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
  const verifyAnchors = l.verifyAnchors ?? d.verifyAnchors;
  if (typeof verifyAnchors !== 'boolean') throw RangeError('shadow: verifyAnchors must be a boolean');
  return Object.freeze({
    maxSteps: pick('maxSteps'),
    anchorEvery: pick('anchorEvery'),
    maxAnchors: pick('maxAnchors'),
    maxDiffPaths: pick('maxDiffPaths'),
    maxInputBytes: pick('maxInputBytes'),
    maxInputsPerStep: pick('maxInputsPerStep'),
    maxValueChars: pick('maxValueChars'),
    verifyAnchors,
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

/** The newest anchor at or before `step`, or null. Any order; O(anchors), no copy. */
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

/** A side's functions, read once at creation and called with the side as `this`. */
interface Port {
  readonly save: () => unknown;
  readonly load: (text: string) => unknown;
  readonly step: (inputs: readonly string[], step: number) => unknown;
  readonly view: (() => unknown) | null;
}
function capturePort(side: ShadowSide): Port {
  if (side === null || typeof side !== 'object')
    throw RangeError('shadow: each side needs save, load and step functions');
  const save: unknown = side.save,
    load: unknown = side.load,
    step: unknown = side.step,
    view: unknown = side.view;
  if (typeof save !== 'function' || typeof load !== 'function' || typeof step !== 'function')
    throw RangeError('shadow: each side needs save, load and step functions');
  if (view !== undefined && typeof view !== 'function') throw RangeError('shadow: a side view must be a function');
  return Object.freeze({
    save: () => save.call(side) as unknown,
    load: (text: string) => load.call(side, text) as unknown,
    step: (inputs: readonly string[], at: number) => step.call(side, inputs, at) as unknown,
    view: typeof view === 'function' ? () => view.call(side) as unknown : null,
  });
}

type Read =
  | {ok: true; saved: string; canonical: string; view: string}
  | {ok: false; kind: 'threw'; phase: 'save' | 'view'; message: string}
  | {ok: false; kind: 'unreadable'; reason: 'not-string' | 'over-limit-or-not-json'};
type Good = Extract<Read, {ok: true}>;
/** The last agreeing boundary; its digest is computed only when reported or anchored. */
interface Agreed {
  readonly step: number;
  readonly canonical: string;
  readonly a: string;
  readonly b: string;
}

/**
 * Create a step-by-step differential runner. Bounds: `maxSteps` steps; per step two `step`, two `save` (plus two
 * `view` when given), two canonical parses of at most `state.maxBytes` and one string comparison; memory at most
 * `maxAnchors` anchors of two states, plus the last agreeing pair and its canonical text. Throws RangeError only for
 * an invalid configuration.
 */
export function createShadowRunner(options: ShadowOptions): ShadowRunner {
  if (options === null || typeof options !== 'object') throw RangeError('shadow: options must be an object');
  const limits = captureShadowLimits(options.limits);
  const ports = [capturePort(options.a), capturePort(options.b)] as const;
  const source: unknown = options.inputs;
  if (typeof source !== 'function') throw RangeError('shadow: inputs must be a function of the step');
  const signal = options.signal;
  if (signal !== undefined && (signal === null || typeof signal.aborted !== 'boolean'))
    throw RangeError('shadow: signal must be an AbortSignal');
  const given: unknown = options.from;
  let start: ShadowAnchor | null = null;
  if (given !== undefined) {
    if (given === null || typeof given !== 'object') throw RangeError('shadow: from must be an anchor');
    const g = given as Record<string, unknown>;
    // Each field is read exactly once.
    const step = g.step,
      digest = g.digest,
      a = g.a,
      b = g.b;
    if (
      !Number.isSafeInteger(step) ||
      (step as number) < 0 ||
      typeof digest !== 'string' ||
      typeof a !== 'string' ||
      typeof b !== 'string'
    )
      throw RangeError('shadow: from must be an anchor');
    start = Object.freeze({step: step as number, digest, a, b});
  }
  const from = start?.step ?? 0;

  let status: ShadowStatus = 'running',
    reason: string | null = null,
    divergence: ShadowDivergence | null = null,
    next = from,
    anchorsTaken = 0,
    anchorsEvicted = 0,
    busy = false,
    started = false,
    pendingCancel: string | null = null;
  let last: Agreed | null = null;
  const ring: ShadowAnchor[] = [];
  let head = 0;

  let cachedFor: Agreed | null = null,
    cached: ShadowAnchor | null = null;
  /** The boundary as an anchor; the digest is computed once per boundary, and only when needed. */
  const anchorOf = (g: Agreed): ShadowAnchor => {
    if (cachedFor !== g || !cached) {
      cached = Object.freeze({step: g.step, digest: hashText(g.canonical), a: g.a, b: g.b});
      cachedFor = g;
    }
    return cached;
  };
  const keep = (anchor: ShadowAnchor) => {
    anchorsTaken++;
    if (ring.length < limits.maxAnchors) ring.push(anchor);
    else {
      ring[head] = anchor;
      head = (head + 1) % limits.maxAnchors;
      anchorsEvicted++;
    }
  };
  /** Divergence context, built only when a divergence is reported. */
  const context = (at: number) => ({lastAgreed: last && anchorOf(last), anchor: nearestAnchor(ring, at)});

  const report = (): ShadowReport =>
    Object.freeze({status, from, next, steps: next - from, anchorsTaken, anchorsEvicted, divergence, reason});
  const diverge = (d: ShadowDivergence): ShadowReport => {
    status = 'diverged';
    reason = null;
    pendingCancel = null;
    divergence = Object.freeze(d);
    return report();
  };

  const readSide = (port: Port): Read => {
    let saved: unknown, view: unknown;
    try {
      saved = port.save();
    } catch (e) {
      return {ok: false, kind: 'threw', phase: 'save', message: messageOf(e)};
    }
    if (typeof saved !== 'string') return {ok: false, kind: 'unreadable', reason: 'not-string'};
    if (!bytesWithin(saved, limits.state.maxBytes))
      return {ok: false, kind: 'unreadable', reason: 'over-limit-or-not-json'};
    if (port.view) {
      try {
        view = port.view();
      } catch (e) {
        return {ok: false, kind: 'threw', phase: 'view', message: messageOf(e)};
      }
      if (typeof view !== 'string') return {ok: false, kind: 'unreadable', reason: 'not-string'};
      if (!bytesWithin(view, limits.state.maxBytes))
        return {ok: false, kind: 'unreadable', reason: 'over-limit-or-not-json'};
    } else view = saved;
    let canonical: string;
    try {
      canonical = captureJson(view as string, limits.state).json;
    } catch {
      return {ok: false, kind: 'unreadable', reason: 'over-limit-or-not-json'};
    }
    return {ok: true, saved, canonical, view: view as string};
  };

  /** A thrown or unreadable read as a divergence, or null when both reads are good. */
  const readFailure = (
    at: number,
    step: number | null,
    inputs: readonly string[] | null,
    ra: Read,
    rb: Read,
  ): ShadowReport | null => {
    const threw = sideOf(!ra.ok && ra.kind === 'threw', !rb.ok && rb.kind === 'threw');
    if (threw) {
      const t = (!ra.ok && ra.kind === 'threw' ? ra : rb) as Extract<Read, {kind: 'threw'}>;
      return diverge({
        kind: 'threw',
        step: step ?? at,
        inputs,
        side: threw,
        phase: t.phase,
        message: t.message,
        ...context(at),
      });
    }
    const unreadable = sideOf(!ra.ok, !rb.ok);
    if (unreadable) {
      const u = (!ra.ok ? ra : rb) as Extract<Read, {kind: 'unreadable'}>;
      return diverge({kind: 'unreadable', step, inputs, side: unreadable, reason: u.reason, ...context(at)});
    }
    return null;
  };

  /** Compare both reads at boundary `at`; a verdict to stop with, or the agreeing boundary. */
  const compare = (
    at: number,
    step: number | null,
    inputs: readonly string[] | null,
    ra: Read,
    rb: Read,
  ): ShadowReport | Agreed => {
    const failed = readFailure(at, step, inputs, ra, rb);
    if (failed) return failed;
    const x = ra as Good,
      y = rb as Good;
    // Exact canonical text equality: the per-step verdict does not depend on the 64-bit digest.
    if (x.canonical !== y.canonical) {
      const listed = listDifferences(x.view, y.view, {
        maxPaths: limits.maxDiffPaths,
        limits: limits.state,
        maxValueChars: limits.maxValueChars,
      });
      return diverge({
        kind: 'state',
        step,
        inputs,
        a: hashText(x.canonical),
        b: hashText(y.canonical),
        differences: listed.status === 'listed' ? listed.differences : Object.freeze([]),
        truncated: listed.status === 'listed' && listed.truncated,
        unavailable: listed.status === 'listed' ? null : listed.reason,
        ...context(at),
      });
    }
    return Object.freeze({step: at, canonical: x.canonical, a: x.saved, b: y.saved});
  };

  /** Load `anchor` into both sides and check each reproduces its digest. The reads on success, else a verdict. */
  const restore = (anchor: ShadowAnchor, inputs: readonly string[] | null): ShadowReport | readonly [Read, Read] => {
    const failed = [false, false];
    let message = '';
    ports.forEach((port, i) => {
      try {
        port.load(i === 0 ? anchor.a : anchor.b);
      } catch (e) {
        failed[i] = true;
        message ||= messageOf(e);
      }
    });
    const threw = sideOf(failed[0]!, failed[1]!);
    if (threw)
      return diverge({
        kind: 'threw',
        step: anchor.step,
        inputs,
        side: threw,
        phase: 'load',
        message,
        ...context(anchor.step),
      });
    const ra = readSide(ports[0]),
      rb = readSide(ports[1]);
    const bad = readFailure(anchor.step, anchor.step, inputs, ra, rb);
    if (bad) return bad;
    const da = hashText((ra as Good).canonical),
      db = hashText((rb as Good).canonical);
    // Each side must reproduce the anchor, whatever the other side did.
    const mismatch = sideOf(da !== anchor.digest, db !== anchor.digest);
    if (mismatch)
      return diverge({
        kind: 'anchor-mismatch',
        step: anchor.step,
        side: mismatch,
        expected: anchor.digest,
        a: da,
        b: db,
      });
    return [ra, rb] as const;
  };

  /** Record an agreeing boundary; anchor it on the interval (verifying the restore when configured). */
  const agreed = (g: Agreed): ShadowReport | null => {
    last = g;
    if (g.step !== from && g.step % limits.anchorEvery !== 0) return null;
    const anchor = anchorOf(g);
    if (limits.verifyAnchors && g.step !== from) {
      const restored = restore(anchor, null);
      if (!Array.isArray(restored)) return restored as ShadowReport;
    }
    keep(anchor);
    return null;
  };

  /** Apply a cancellation requested during the current call (it never overrides a divergence). */
  const settle = (): ShadowReport => {
    if (status === 'running' && (pendingCancel || signal?.aborted)) {
      status = 'cancelled';
      reason = pendingCancel ?? 'aborted';
    }
    pendingCancel = null;
    return report();
  };

  /** Restore the starting anchor (when given) and compare the starting boundary. */
  const begin = (): ShadowReport | null => {
    started = true;
    let reads: readonly [Read, Read];
    if (start) {
      const restored = restore(start, null);
      if (!Array.isArray(restored)) return restored as ShadowReport;
      reads = restored as readonly [Read, Read];
    } else reads = [readSide(ports[0]), readSide(ports[1])];
    const result = compare(from, null, null, reads[0], reads[1]);
    if (!('canonical' in result)) return result;
    return agreed(result);
  };

  /** Read the step's inputs once each into a frozen copy, or null when they break the contract. */
  const captureInputs = (supplied: unknown): readonly string[] | null => {
    if (!Array.isArray(supplied)) return null;
    const n: unknown = supplied.length;
    if (!within(n, [1, limits.maxInputsPerStep])) return null;
    const copy: string[] = [];
    for (let i = 0; i < n; i++) {
      const item: unknown = supplied[i];
      if (typeof item !== 'string' || !bytesWithin(item, limits.maxInputBytes)) return null;
      copy.push(item);
    }
    return Object.freeze(copy);
  };

  const once = (): ShadowReport => {
    if (status === 'running' && signal?.aborted) {
      status = 'cancelled';
      reason = 'aborted';
    }
    if (status !== 'running') return report();
    if (busy) throw Error('shadow: step called re-entrantly from a side');
    busy = true;
    try {
      if (!started) {
        const stopped = begin();
        if (stopped) return stopped;
        if (pendingCancel || signal?.aborted) return settle();
      }
      let supplied: unknown;
      try {
        supplied = (source as ShadowInputs)(next);
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
      const inputs = captureInputs(supplied);
      if (!inputs) {
        status = 'failed';
        reason = 'invalid-input';
        return report();
      }
      const at = next;
      const failed = [false, false];
      let message = '';
      ports.forEach((port, i) => {
        try {
          port.step(inputs, at);
        } catch (e) {
          failed[i] = true;
          message ||= messageOf(e);
        }
      });
      const threw = sideOf(failed[0]!, failed[1]!);
      if (threw) return diverge({kind: 'threw', step: at, inputs, side: threw, phase: 'step', message, ...context(at)});
      // A state verdict for the boundary after `at` names `at` as the step that produced it.
      const result = compare(at + 1, at, inputs, readSide(ports[0]), readSide(ports[1]));
      if (!('canonical' in result)) return result;
      next = at + 1;
      const stopped = agreed(result);
      if (stopped) return stopped;
      return settle();
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
    anchors: () => Object.freeze([...ring.slice(head), ...ring.slice(0, head)]),
    cancel() {
      if (status !== 'running') return;
      if (busy) pendingCancel ??= 'cancelled';
      else {
        status = 'cancelled';
        reason = 'cancelled';
      }
    },
  });
}
