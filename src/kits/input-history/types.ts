/** Public types for the optional input-history kit. Pure data contracts; no clock, device or scheduler. */

/** How two opposite actions held together resolve (SOCD cleaning). */
export type OppositePolicy = 'neutral' | 'last' | 'first' | 'a' | 'b';

export interface InputHistoryOptions {
  /** 1–32 distinct action ids; action `i` is bit `1 << i` in every mask. */
  readonly actions: readonly string[];
  /** Retained frames, 1–3600. Queries can look back at most this far. */
  readonly capacity: number;
  /**
   * At most 16 disjoint pairs. When both of a pair's raw actions are held on a frame, `policy` decides what
   * the cleaned history records: neither (`neutral`), the more recently pressed one (`last`), the earlier one
   * (`first`), or always `a` / always `b`. `last` and `first` resolve a same-frame tie to neutral.
   */
  readonly opposites?: readonly Readonly<{ a: string; b: string; policy: OppositePolicy }>[];
}

export type RecordResult =
  | Readonly<{ status: 'recorded'; frame: number; held: number; pressed: number; released: number }>
  /** `stale`: frame at or before the latest recorded one. `gap`: a frame was skipped. `invalid`: bad frame or mask. */
  | Readonly<{ status: 'stale' | 'gap' | 'invalid' }>;

/** One step of a sequence: conditions that must all hold on a single frame. Names are action ids. */
export interface SequenceStep {
  /** Every one of these is held (after opposite cleaning). */
  readonly all?: readonly string[];
  /** None of these is held. */
  readonly none?: readonly string[];
  /** Each of these has an unconsumed press edge on the frame. */
  readonly pressed?: readonly string[];
  /** Each of these has a release edge on the frame (negative edge). */
  readonly released?: readonly string[];
}

/** A compiled, frozen sequence (1–16 steps) bound to the history that compiled it. */
export interface InputSequence {
  readonly steps: number;
}

export interface MatchOptions {
  /** Frames to search, ending at `at`: 1..capacity. */
  readonly within: number;
  /** Largest frame distance between consecutive matched steps (default `within`). */
  readonly maxGap?: number;
  /** The last frame searched (default: the latest recorded frame). */
  readonly at?: number;
}

export type EdgeKind = 'press' | 'release';

export interface InputHistorySnapshot {
  readonly v: 1;
  /** Configuration fingerprint; a snapshot only loads into a history with identical options. */
  readonly config: string;
  /** First frame ever recorded since the last reset, or -1. */
  readonly first: number;
  /** Latest recorded frame, or -1. */
  readonly latest: number;
  readonly prevRaw: number;
  readonly prevHeld: number;
  /** Per action: the frame of its latest raw press, or -1. */
  readonly lastRawPress: readonly number[];
  /** Retained frames oldest first: cleaned held, press, release and consumed masks. */
  readonly held: readonly number[];
  readonly press: readonly number[];
  readonly release: readonly number[];
  readonly consumed: readonly number[];
}

export interface InputHistory {
  readonly actions: readonly string[];
  readonly capacity: number;
  /** Mask of the named actions; throws on an unknown name. */
  mask(names: readonly string[]): number;
  /** Action ids in a mask, in declaration order. */
  names(mask: number): readonly string[];
  /** Forget everything. `baseline` is the mask treated as held just before the next recorded frame (default 0). */
  reset(baseline?: number): void;
  /**
   * Record the next frame. `held` is the raw held mask; `taps` (default 0) adds actions pressed this frame
   * even if already released, so a tap shorter than a frame still appears as held for one frame.
   */
  record(frame: number, held: number, taps?: number): RecordResult;
  /** Latest recorded frame, or -1. */
  latest(): number;
  /** Oldest frame still retained, or -1. */
  oldest(): number;
  /** Cleaned held mask at a retained frame. Throws RangeError for a frame that was recorded and evicted, or never recorded. */
  heldAt(frame: number): number;
  held(action: string, frame?: number): boolean;
  pressed(action: string, frame?: number): boolean;
  released(action: string, frame?: number): boolean;
  /**
   * The latest frame in `[at - within + 1, at]` with this edge, or -1. Press edges already consumed are skipped
   * unless `includeConsumed`. Frames before the first recorded frame count as no edge; a window reaching into
   * evicted history throws RangeError rather than answering from a partial view.
   */
  lastEdge(action: string, edge: EdgeKind, within: number, at?: number, includeConsumed?: boolean): number;
  /** Mark a press edge used so buffered queries and sequences ignore it. True when an unconsumed edge was marked. */
  consume(action: string, frame: number): boolean;
  /** Compile a sequence once; reuse the result for every query. */
  sequence(steps: readonly SequenceStep[]): InputSequence;
  /** The match with the latest end frame inside the window, or null. Work is at most steps × within. */
  match(sequence: InputSequence, options: MatchOptions): Readonly<{ start: number; end: number }> | null;
  /** Detached plain data for a simulation's saved state. */
  save(): InputHistorySnapshot;
  /** Replace the whole history with a validated snapshot; throws RangeError and changes nothing when invalid. */
  load(snapshot: InputHistorySnapshot): void;
}
