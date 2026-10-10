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
/** Plain, detached instance state. Safe to store in snapshots and rollback saves. */
export interface PhaseState {
  readonly timeline: string;
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
  | {readonly kind: 'claimed'; readonly state: PhaseState; readonly range: number}
  | {readonly kind: 'closed' | 'already-claimed'};
export type PhaseRestore =
  {readonly kind: 'restored'; readonly state: PhaseState} | {readonly kind: 'invalid'; readonly reason: string};

interface Timeline {
  readonly id: string;
  readonly length: number;
  readonly windows: ReadonlyMap<string, readonly {readonly from: number; readonly to: number; readonly bit: number}[]>;
  readonly marks: readonly {readonly id: string; readonly at: number; readonly bit: number}[];
  readonly markIndex: ReadonlyMap<string, number>;
  readonly rangeCount: number;
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

function list<T>(value: unknown, maximum: number, what: string): readonly T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return fail(`${what} must be an array`);
  const length = value.length;
  if (length > maximum) return fail(`more than ${maximum} ${what}`);
  return Array.from({length}, (_, i) => value[i] as T);
}

function capture(input: PhaseTimelineInput): Timeline {
  const {id, length} = input;
  const windowInputs = list<PhaseWindowInput>(input.windows, MAX_BITS, 'windows');
  const markInputs = list<PhaseMarkInput>(input.marks, MAX_BITS, 'marks');
  if (!identity(id)) fail('invalid timeline id');
  if (!finite(length) || length <= 0) fail(`timeline ${id}: length must be finite and positive`);
  const windows = new Map<string, readonly {from: number; to: number; bit: number}[]>();
  let rangeCount = 0;
  for (const window of windowInputs) {
    const wid = window?.id;
    if (!identity(wid) || windows.has(wid)) fail(`timeline ${id}: invalid or duplicate window id`);
    const ranges = list<readonly [number, number]>(window.ranges, MAX_BITS, 'ranges');
    if (ranges.length === 0) fail(`timeline ${id}: window ${wid} has no ranges`);
    const captured: {from: number; to: number; bit: number}[] = [];
    for (const range of ranges) {
      if (!Array.isArray(range) || range.length !== 2) fail(`timeline ${id}: window ${wid} range must be [from, to]`);
      const from = range[0];
      const to = range[1];
      if (!finite(from) || !finite(to) || from < 0 || to <= from || to > length)
        fail(`timeline ${id}: window ${wid} range must satisfy 0 <= from < to <= length`);
      if (rangeCount >= MAX_BITS) fail(`timeline ${id}: more than ${MAX_BITS} window ranges`);
      captured.push(Object.freeze({from, to, bit: bit(rangeCount++)}));
    }
    windows.set(wid, Object.freeze(captured));
  }
  const markIndex = new Map<string, number>();
  const marks = markInputs.map((mark, index) => {
    const mid = mark?.id;
    const at = mark?.at;
    if (!identity(mid) || markIndex.has(mid)) fail(`timeline ${id}: invalid or duplicate mark id`);
    if (!finite(at) || at < 0 || at > length) fail(`timeline ${id}: mark ${mid} must satisfy 0 <= at <= length`);
    markIndex.set(mid, index);
    return Object.freeze({id: mid, at, bit: bit(index)});
  });
  // Delivery order is position, then declaration; precomputed once.
  const ordered = marks
    .map((mark, index) => ({mark, index}))
    .sort((a, b) => a.mark.at - b.mark.at || a.index - b.index);
  return Object.freeze({
    id,
    length,
    windows,
    marks: Object.freeze(ordered.map(entry => entry.mark)),
    markIndex,
    rangeCount,
  });
}

const freezeState = (timeline: string, position: number, marks: number, claims: number): PhaseState =>
  Object.freeze({timeline, position, marks, claims});

/**
 * Create a bounded, immutable set of creator-authored action timelines.
 * Every operation is a pure function of its arguments and the captured definitions.
 */
export function createActionPhases(options: {timelines: readonly PhaseTimelineInput[]; maxTimelines?: number}) {
  const maxTimelines = options.maxTimelines ?? 256;
  if (!Number.isSafeInteger(maxTimelines) || maxTimelines < 1 || maxTimelines > 4096)
    fail('maxTimelines must be an integer from 1 to 4096');
  const inputs = list<PhaseTimelineInput>(options.timelines, maxTimelines, 'timelines');
  const timelines = new Map<string, Timeline>();
  for (const input of inputs) {
    const timeline = capture(input);
    if (timelines.has(timeline.id)) fail(`duplicate timeline ${timeline.id}`);
    timelines.set(timeline.id, timeline);
  }

  const check = (state: PhaseState): Timeline => {
    const reason = problem(state);
    if (reason) fail(reason);
    return timelines.get(state.timeline)!;
  };
  const problem = (state: unknown): string | null => {
    if (typeof state !== 'object' || state === null) return 'state must be an object';
    const {timeline, position, marks, claims} = state as Record<string, unknown>;
    const definition = typeof timeline === 'string' ? timelines.get(timeline) : undefined;
    if (!definition) return 'unknown timeline';
    if (!finite(position) || position < 0 || position > definition.length) return 'position outside the timeline';
    if (!Number.isSafeInteger(marks) || (marks as number) < 0 || (marks as number) > full(definition.marks.length))
      return 'mark bits outside the timeline';
    if (!Number.isSafeInteger(claims) || (claims as number) < 0 || (claims as number) > full(definition.rangeCount))
      return 'claim bits outside the timeline';
    return null;
  };
  const openRange = (definition: Timeline, state: PhaseState, window: string) => {
    const ranges = definition.windows.get(window);
    if (!ranges) return fail(`timeline ${definition.id}: unknown window ${window}`);
    return ranges.find(range => state.position >= range.from && state.position < range.to) ?? null;
  };

  return {
    /** Timeline ids in declaration order. */
    get ids(): readonly string[] {
      return Object.freeze([...timelines.keys()]);
    },
    length(timeline: string): number {
      const definition = timelines.get(timeline);
      if (!definition) return fail(`unknown timeline ${timeline}`);
      return definition.length;
    },
    /** A fresh instance at position 0. Marks at 0 are delivered by the first `advance`, even `advance(s, 0)`. */
    start(timeline: string): PhaseState {
      if (!timelines.has(timeline)) fail(`unknown timeline ${timeline}`);
      return freezeState(timeline, 0, 0, 0);
    },
    /**
     * Move forward by `delta >= 0` (clamped at the end) and deliver every mark now due exactly once,
     * including several crossed in one step. Zero delta delivers marks due at the current position.
     */
    advance(state: PhaseState, delta: number): PhaseAdvance {
      const definition = check(state);
      if (!finite(delta) || delta < 0) fail('delta must be finite and nonnegative');
      const sum = state.position + delta;
      if (!finite(sum)) fail('position overflow');
      const position = Math.min(sum, definition.length);
      let marks = state.marks;
      const due: PhaseMark[] = [];
      for (const mark of definition.marks) {
        if (mark.at > position) break;
        if (has(marks, mark.bit)) continue;
        marks += mark.bit;
        due.push(Object.freeze({id: mark.id, at: mark.at}));
      }
      const wasEnded = state.position >= definition.length;
      const ended = position >= definition.length;
      return Object.freeze({
        state: freezeState(state.timeline, position, marks, state.claims),
        marks: Object.freeze(due),
        endedNow: ended && !wasEnded,
        ended,
      });
    },
    /** Whether any range of `window` contains the current position (half-open). */
    isOpen(state: PhaseState, window: string): boolean {
      return openRange(check(state), state, window) !== null;
    },
    /** Ids of windows open at the current position, in declaration order. */
    open(state: PhaseState): readonly string[] {
      const definition = check(state);
      const ids: string[] = [];
      for (const [id, ranges] of definition.windows)
        if (ranges.some(range => state.position >= range.from && state.position < range.to)) ids.push(id);
      return Object.freeze(ids);
    },
    /**
     * Claim the currently open range of `window` once (for example: one contact per active hit range).
     * A later range of the same window can be claimed separately. Does not apply any consequence.
     */
    claim(state: PhaseState, window: string): PhaseClaim {
      const definition = check(state);
      const range = openRange(definition, state, window);
      if (!range) return Object.freeze({kind: 'closed'});
      if (has(state.claims, range.bit)) return Object.freeze({kind: 'already-claimed'});
      return Object.freeze({
        kind: 'claimed',
        state: freezeState(state.timeline, state.position, state.marks, state.claims + range.bit),
        range: Math.log2(range.bit),
      });
    },
    /** Marks not yet delivered or suppressed, in delivery order. */
    pending(state: PhaseState): readonly PhaseMark[] {
      const definition = check(state);
      return Object.freeze(
        definition.marks
          .filter(mark => !has(state.marks, mark.bit))
          .map(mark => Object.freeze({id: mark.id, at: mark.at})),
      );
    },
    /**
     * Retire named marks without delivering them (for example when another action takes over and
     * its consequences were already settled). Unknown ids throw; already-retired ids are ignored.
     */
    suppress(state: PhaseState, ids: readonly string[]): PhaseState {
      const definition = check(state);
      const names = list<string>(ids, MAX_BITS, 'mark ids');
      let marks = state.marks;
      for (const id of names) {
        const index = typeof id === 'string' ? definition.markIndex.get(id) : undefined;
        if (index === undefined) return fail(`timeline ${definition.id}: unknown mark ${String(id)}`);
        const value = bit(index);
        if (!has(marks, value)) marks += value;
      }
      return freezeState(state.timeline, state.position, marks, state.claims);
    },
    /** Validate untrusted saved data against the current definitions without throwing. */
    restore(data: unknown): PhaseRestore {
      let reason: string | null;
      let captured: PhaseState | null = null;
      try {
        reason = problem(data);
        if (!reason) {
          const {timeline, position, marks, claims} = data as PhaseState;
          captured = freezeState(timeline, position, marks, claims);
          reason = problem(captured);
        }
      } catch {
        reason = 'unreadable state';
      }
      return reason || !captured
        ? Object.freeze({kind: 'invalid', reason: reason ?? 'unreadable state'})
        : Object.freeze({kind: 'restored', state: captured});
    },
  };
}
export type ActionPhases = ReturnType<typeof createActionPhases>;
