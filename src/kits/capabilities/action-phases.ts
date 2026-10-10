/**
 * Optional action phase timelines: creator-authored windows and once-only marks over one action's
 * own position. Pure values: no clock, callbacks, scheduler, effects or retained history.
 */
export interface PhaseWindowInput {
  /** Unique within the timeline. */
  id: string;
  /** Half-open `[from, to)` ranges on the timeline; at most 32 ranges per timeline in total. */
  ranges: readonly (readonly [number, number])[];
}
export interface PhaseMarkInput {
  /** Unique within the timeline. */
  id: string;
  /** Position at which the mark becomes due, `0 <= at <= length`. */
  at: number;
}
export interface PhaseTimelineInput {
  id: string;
  /** Positive finite length in the caller's chosen unit (ticks or seconds). */
  length: number;
  windows?: readonly PhaseWindowInput[];
  marks?: readonly PhaseMarkInput[];
}
/**
 * Plain, detached instance state. Safe to store in snapshots and rollback saves. Bits are positional
 * (declaration order), so `definition` fingerprints the exact timeline they were produced against.
 */
export interface PhaseState {
  readonly timeline: string;
  /** Fingerprint of the timeline definition (length, windows, ranges, marks in declaration order). */
  readonly definition: string;
  readonly position: number;
  /** Bit per mark (declaration order): already delivered or suppressed. */
  readonly marks: number;
  /** Bit per window range (declaration order, ranges flattened): already claimed. */
  readonly claims: number;
}
export interface PhaseMark {
  readonly id: string;
  readonly at: number;
}
export interface PhaseAdvance {
  readonly state: PhaseState;
  /** Marks that became due in this step, ordered by position then declaration. */
  readonly marks: readonly PhaseMark[];
  /** True when this step reached the end; later steps report `ended` without new marks. */
  readonly endedNow: boolean;
  readonly ended: boolean;
}
export type PhaseClaim =
  | {readonly kind: 'claimed' | 'already-claimed'; readonly state: PhaseState; readonly range: number}
  | {readonly kind: 'closed'};
export type PhaseRestore =
  {readonly kind: 'restored'; readonly state: PhaseState} | {readonly kind: 'invalid'; readonly reason: string};

interface Range {
  readonly from: number;
  readonly to: number;
  readonly index: number;
  readonly bit: number;
}
interface Timeline {
  readonly id: string;
  readonly length: number;
  readonly fingerprint: string;
  readonly windows: ReadonlyMap<string, readonly Range[]>;
  readonly marks: readonly {readonly id: string; readonly at: number; readonly bit: number}[];
  readonly markIndex: ReadonlyMap<string, number>;
  readonly rangeCount: number;
}
interface Snapshot {
  readonly timeline: string;
  readonly definition: string;
  readonly position: number;
  readonly marks: number;
  readonly claims: number;
}

const MAX_BITS = 32;
const identity = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const bit = (index: number) => 2 ** index;
const has = (mask: number, value: number) => Math.floor(mask / value) % 2 === 1;
const full = (count: number) => bit(count) - 1;
const fail = (message: string): never => {
  throw new RangeError(`action-phases: ${message}`);
};
const record = (value: unknown, what: string): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : fail(`${what} must be an object`);

function list<T>(value: unknown, maximum: number, what: string): readonly T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return fail(`${what} must be an array`);
  const length = value.length;
  if (length > maximum) return fail(`more than ${maximum} ${what}`);
  return Array.from({length}, (_, i) => value[i] as T);
}

/** FNV-1a (32-bit) over a canonical description: deterministic and independent of key order. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${hash.toString(16).padStart(8, '0')}`;
}

function capture(value: unknown): Timeline {
  const input = record(value, 'timeline');
  const id = input.id;
  const length = input.length;
  const windowInputs = list<unknown>(input.windows, MAX_BITS, 'windows');
  const markInputs = list<unknown>(input.marks, MAX_BITS, 'marks');
  if (!identity(id)) return fail('invalid timeline id');
  if (!finite(length) || length <= 0) return fail(`timeline ${id}: length must be finite and positive`);
  const canonical: string[] = [JSON.stringify(length)];
  const windows = new Map<string, readonly Range[]>();
  let rangeCount = 0;
  for (const entry of windowInputs) {
    const window = record(entry, `timeline ${id}: window`);
    const wid = window.id;
    if (!identity(wid) || windows.has(wid)) return fail(`timeline ${id}: invalid or duplicate window id`);
    const ranges = list<unknown>(window.ranges, MAX_BITS, 'ranges');
    if (ranges.length === 0) fail(`timeline ${id}: window ${wid} has no ranges`);
    const captured: Range[] = [];
    for (const range of ranges) {
      if (!Array.isArray(range) || range.length !== 2) fail(`timeline ${id}: window ${wid} range must be [from, to]`);
      const from = (range as unknown[])[0];
      const to = (range as unknown[])[1];
      if (!finite(from) || !finite(to) || from < 0 || to <= from || to > length)
        return fail(`timeline ${id}: window ${wid} range must satisfy 0 <= from < to <= length`);
      if (captured.some(other => from < other.to && other.from < to))
        fail(`timeline ${id}: window ${wid} ranges must not overlap`);
      if (rangeCount >= MAX_BITS) fail(`timeline ${id}: more than ${MAX_BITS} window ranges`);
      const index = rangeCount++;
      captured.push(Object.freeze({from: from + 0, to, index, bit: bit(index)}));
    }
    windows.set(wid, Object.freeze(captured));
    canonical.push(
      `w${JSON.stringify(wid)}${captured.map(r => `${JSON.stringify(r.from)},${JSON.stringify(r.to)}`).join(';')}`,
    );
  }
  const markIndex = new Map<string, number>();
  const marks = markInputs.map((entry, index) => {
    const mark = record(entry, `timeline ${id}: mark`);
    const mid = mark.id;
    const at = mark.at;
    if (!identity(mid) || markIndex.has(mid)) return fail(`timeline ${id}: invalid or duplicate mark id`);
    if (!finite(at) || at < 0 || at > length) return fail(`timeline ${id}: mark ${mid} must satisfy 0 <= at <= length`);
    markIndex.set(mid, index);
    canonical.push(`m${JSON.stringify(mid)}${JSON.stringify(at + 0)}`);
    return Object.freeze({id: mid, at: at + 0, bit: bit(index)});
  });
  // Delivery order is position, then declaration; precomputed once.
  const ordered = marks
    .map((mark, index) => ({mark, index}))
    .sort((a, b) => a.mark.at - b.mark.at || a.index - b.index);
  return Object.freeze({
    id,
    length,
    fingerprint: fingerprint(canonical.join('|')),
    windows,
    marks: Object.freeze(ordered.map(entry => entry.mark)),
    markIndex,
    rangeCount,
  });
}

const freezeState = (s: Snapshot): PhaseState =>
  Object.freeze({
    timeline: s.timeline,
    definition: s.definition,
    position: s.position + 0, // normalizes -0
    marks: s.marks + 0,
    claims: s.claims + 0,
  });

/**
 * Create a bounded, immutable set of creator-authored action timelines.
 * Every operation is a pure function of its arguments and the captured definitions.
 */
export function createActionPhases(options: {timelines: readonly PhaseTimelineInput[]; maxTimelines?: number}) {
  const config = record(options, 'options');
  const maxTimelines = config.maxTimelines ?? 256;
  if (!Number.isSafeInteger(maxTimelines) || (maxTimelines as number) < 1 || (maxTimelines as number) > 4096)
    fail('maxTimelines must be an integer from 1 to 4096');
  const inputs = list<unknown>(config.timelines, maxTimelines as number, 'timelines');
  const timelines = new Map<string, Timeline>();
  for (const input of inputs) {
    const timeline = capture(input);
    if (timelines.has(timeline.id)) fail(`duplicate timeline ${timeline.id}`);
    timelines.set(timeline.id, timeline);
  }

  /** Reads each field exactly once, then validates that copy. Never throws for ordinary data. */
  const inspect = (value: unknown): {snapshot: Snapshot; definition: Timeline} | string => {
    if (typeof value !== 'object' || value === null) return 'state must be an object';
    const source = value as Record<string, unknown>;
    const timeline = source.timeline;
    const definitionPrint = source.definition;
    const position = source.position;
    const marks = source.marks;
    const claims = source.claims;
    const definition = typeof timeline === 'string' ? timelines.get(timeline) : undefined;
    if (!definition) return 'unknown timeline';
    if (definitionPrint !== definition.fingerprint) return 'state was produced against a different definition';
    if (!finite(position) || position < 0 || position > definition.length) return 'position outside the timeline';
    if (!Number.isSafeInteger(marks) || (marks as number) < 0 || (marks as number) > full(definition.marks.length))
      return 'mark bits outside the timeline';
    if (!Number.isSafeInteger(claims) || (claims as number) < 0 || (claims as number) > full(definition.rangeCount))
      return 'claim bits outside the timeline';
    // Reachability: a step that reaches `position > 0` has delivered every mark at or before it,
    // and only ranges that have started can have been claimed.
    if (position > 0 && definition.marks.some(m => m.at <= position && !has(marks as number, m.bit)))
      return 'undelivered mark behind the position';
    for (const ranges of definition.windows.values())
      if (ranges.some(r => r.from > position && has(claims as number, r.bit)))
        return 'claim on a range not yet started';
    return {
      snapshot: {
        timeline: definition.id,
        definition: definition.fingerprint,
        position,
        marks: marks as number,
        claims: claims as number,
      },
      definition,
    };
  };
  const check = (state: PhaseState) => {
    const result = inspect(state);
    return typeof result === 'string' ? fail(result) : result;
  };
  const openRange = (definition: Timeline, snapshot: Snapshot, window: string): Range | null => {
    const ranges = definition.windows.get(window);
    if (!ranges) return fail(`timeline ${definition.id}: unknown window ${String(window)}`);
    return ranges.find(range => snapshot.position >= range.from && snapshot.position < range.to) ?? null;
  };

  return {
    /** Timeline ids in declaration order. */
    get ids(): readonly string[] {
      return Object.freeze([...timelines.keys()]);
    },
    length(timeline: string): number {
      const definition = timelines.get(timeline);
      if (!definition) return fail(`unknown timeline ${String(timeline)}`);
      return definition.length;
    },
    /** A fresh instance at position 0. Marks at 0 are delivered by the first `advance`, even `advance(s, 0)`. */
    start(timeline: string): PhaseState {
      const definition = timelines.get(timeline);
      if (!definition) return fail(`unknown timeline ${String(timeline)}`);
      return freezeState({timeline, definition: definition.fingerprint, position: 0, marks: 0, claims: 0});
    },
    /**
     * Move forward by `delta >= 0` (clamped at the end) and deliver every mark now due exactly once,
     * including several crossed in one step. Zero delta delivers marks due at the current position.
     */
    advance(state: PhaseState, delta: number): PhaseAdvance {
      const {snapshot, definition} = check(state);
      if (!finite(delta) || delta < 0) fail('delta must be finite and nonnegative');
      const sum = snapshot.position + delta;
      if (!finite(sum)) fail('position overflow');
      const position = Math.min(sum, definition.length);
      let marks = snapshot.marks;
      const due: PhaseMark[] = [];
      for (const mark of definition.marks) {
        if (mark.at > position) break;
        if (has(marks, mark.bit)) continue;
        marks += mark.bit;
        due.push(Object.freeze({id: mark.id, at: mark.at}));
      }
      const wasEnded = snapshot.position >= definition.length;
      const ended = position >= definition.length;
      return Object.freeze({
        state: freezeState({...snapshot, position, marks}),
        marks: Object.freeze(due),
        endedNow: ended && !wasEnded,
        ended,
      });
    },
    /** Whether any range of `window` contains the current position (half-open). */
    isOpen(state: PhaseState, window: string): boolean {
      const {snapshot, definition} = check(state);
      return openRange(definition, snapshot, window) !== null;
    },
    /** Flattened index of the open range of `window`, or -1 when closed. Stable for identities. */
    openRange(state: PhaseState, window: string): number {
      const {snapshot, definition} = check(state);
      return openRange(definition, snapshot, window)?.index ?? -1;
    },
    /** Ids of windows open at the current position, in declaration order. */
    open(state: PhaseState): readonly string[] {
      const {snapshot, definition} = check(state);
      const ids: string[] = [];
      for (const [id, ranges] of definition.windows)
        if (ranges.some(range => snapshot.position >= range.from && snapshot.position < range.to)) ids.push(id);
      return Object.freeze(ids);
    },
    /**
     * Claim the currently open range of `window` once (for example: one contact per active hit range).
     * A later range of the same window can be claimed separately. Does not apply any consequence.
     * `already-claimed` returns the unchanged state and the same range index.
     */
    claim(state: PhaseState, window: string): PhaseClaim {
      const {snapshot, definition} = check(state);
      const range = openRange(definition, snapshot, window);
      if (!range) return Object.freeze({kind: 'closed'});
      if (has(snapshot.claims, range.bit))
        return Object.freeze({kind: 'already-claimed', state: freezeState(snapshot), range: range.index});
      return Object.freeze({
        kind: 'claimed',
        state: freezeState({...snapshot, claims: snapshot.claims + range.bit}),
        range: range.index,
      });
    },
    /** Marks not yet delivered or suppressed, in delivery order. */
    pending(state: PhaseState): readonly PhaseMark[] {
      const {snapshot, definition} = check(state);
      return Object.freeze(
        definition.marks
          .filter(mark => !has(snapshot.marks, mark.bit))
          .map(mark => Object.freeze({id: mark.id, at: mark.at})),
      );
    },
    /**
     * Retire named marks without delivering them (for example when another action takes over and
     * its consequences were already settled). At most 32 entries per call; unknown ids throw;
     * already-retired or repeated ids are ignored.
     */
    suppress(state: PhaseState, ids: readonly string[]): PhaseState {
      const {snapshot, definition} = check(state);
      const names = list<unknown>(ids, MAX_BITS, 'mark ids');
      let marks = snapshot.marks;
      for (const id of names) {
        const index = typeof id === 'string' ? definition.markIndex.get(id) : undefined;
        if (index === undefined) return fail(`timeline ${definition.id}: unknown mark ${String(id)}`);
        const value = bit(index);
        if (!has(marks, value)) marks += value;
      }
      return freezeState({...snapshot, marks});
    },
    /**
     * Validate untrusted saved data against the current definitions without throwing. Each field is
     * read once. A state from a changed definition, or one no step sequence could produce, is invalid.
     */
    restore(data: unknown): PhaseRestore {
      let result: ReturnType<typeof inspect>;
      try {
        result = inspect(data);
      } catch {
        result = 'unreadable state';
      }
      return typeof result === 'string'
        ? Object.freeze({kind: 'invalid', reason: result})
        : Object.freeze({kind: 'restored', state: freezeState(result.snapshot)});
    },
  };
}
export type ActionPhases = ReturnType<typeof createActionPhases>;
