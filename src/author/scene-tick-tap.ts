/**
 * author/scene-tick-tap.ts: a dev/test-only seam around one scene visit's system runner. A development tool (the replay
 * surface in src/dev/replay.ts) installs a factory; the stock runtime asks it once per visit, only when TEST_API is
 * true, so production builds never construct a tap. A tap sees each fixed tick begin and end, supplies the input that
 * fixed systems read during the tick, and may hold the whole runner: fixed and frame-phase systems and the per-frame
 * clearing of world events stop while held (before arrival, or after a replay ends, until re-entry or stop).
 *
 * The tap does not add a clock: tick k is the k-th fixed step the visit's system runner takes after arrival.
 */
import type { World } from '../core/ecs/world';
import type { InputSource, InputState, SceneReplayDigest } from './defs';

export interface SceneTickTapContext {
  /** The scene id (without the `scene.` prefix). */
  readonly scene: string;
  readonly game: Readonly<{ id: string; version: string }>;
  /** The scene's declared inputs; `axis` marks axis actions. */
  readonly inputs: readonly Readonly<{ id: string; axis: boolean }>[];
  /** The visit's `?seed=`, or null when the random stream is not seeded (and so not replayable). */
  readonly seed: number | null;
  /** Seconds per fixed tick. */
  readonly step: number;
  readonly world: World;
  /** The scene definition's `replay.digest`, if any: the state a replay tool digests by default. */
  readonly replayDigest?: SceneReplayDigest | null;
  /** The visit's live input. */
  readonly live: InputSource;
  /** Ask the frame loop for another frame (e.g. after a replay is armed). */
  invalidate(): void;
}
export interface SceneTickTap {
  /** What `ctx.input` reads for the whole visit. */
  readonly input: InputState;
  /** May the system runner (fixed and frame-phase systems) run this frame? False before arrival and after a replay ends. */
  running(): boolean;
  /** Before the first fixed system of a tick. */
  beforeTick(): void;
  /** After the last fixed system of a tick. */
  afterTick(): void;
  /** The scene's `enter` has run: tick 0 is the next fixed step. */
  arrive(): void;
  /** The visit ended. Called once. */
  retire(): void;
}
export type SceneTickTapFactory = (context: SceneTickTapContext) => SceneTickTap | null;

let factory: SceneTickTapFactory | null = null;

/** Install (or with null, remove) the tap factory. Returns a function restoring the previous one. */
export function installSceneTickTap(next: SceneTickTapFactory | null): () => void {
  const previous = factory;
  factory = next;
  return () => { if (factory === next) factory = previous; };
}

/** The runtime's one call per visit. A throwing factory is reported by the caller and the visit runs untapped. */
export function openSceneTickTap(context: SceneTickTapContext): SceneTickTap | null {
  return factory ? factory(context) : null;
}
