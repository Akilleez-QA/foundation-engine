/**
 * author/press-latch.ts: one scene visit's pressed actions and pointer press, addressed to lanes (STD-SIM-12).
 *
 * - A press is pending until the next fixed tick begins; that tick (all fixed systems in it) sees it, later ticks do
 *   not. A frame that runs zero fixed ticks (frame time below the step, or a resumed dt = 0 frame) keeps it pending.
 * - Per-frame systems, and reads outside the runner, see the presses that arrived since the previous frame ended.
 * - Retention is bounded by the visit and by cancellation: `clear()` (input/pointer cancellation, overlay, hidden tab,
 *   loss of input ownership, a frame that does not simulate) drops pending presses; the latch dies with the visit.
 *   A running fixed lane consumes a pending press within one step of frame time.
 * - Each press keeps its timestamp (page monotonic ms): `get(id)` answers it under the same lane rules as `has`. The
 *   first press of an action in a set wins, so a tick or frame reports its earliest press.
 */
const POINTER = Symbol('pointer');
type Key = string | typeof POINTER;
export interface PointerSource { x: number; y: number; down: boolean; pressed: boolean }

export function createPressLatch() {
  const pending = new Map<Key, number>(), frame = new Map<Key, number>(), tick = new Map<Key, number>();
  let lane: 'idle' | 'fixed' | 'frame' = 'idle';
  const view = () => (lane === 'fixed' ? tick : frame);
  const has = (key: Key) => view().has(key);
  const first = (set: Map<Key, number>, key: Key, at: number) => { if (!set.has(key)) set.set(key, at); };
  return {
    /** `at`: the press's timestamp in page monotonic ms. */
    add(id: string, at: number) { first(pending, id, at); first(frame, id, at); },
    has: (id: string) => has(id),
    /** The press's timestamp under the current lane, or undefined. */
    get: (id: string) => view().get(id),
    /** Lane-addressed view of the visit's pointer; `pressed` follows the same rules as actions. */
    pointer(source: PointerSource) {
      return {
        get x() { return source.x; }, get y() { return source.y; }, get down() { return source.down; },
        get pressed() { return has(POINTER); },
      };
    },
    pointerPressed(at: number) { first(pending, POINTER, at); first(frame, POINTER, at); },
    /** Runner hook: a fixed step begins and takes every pending press. */
    // Size guards: Set iteration and clear() allocate in V8 even when empty, and these run every tick.
    beginStep() { lane = 'fixed'; if (tick.size) tick.clear(); if (pending.size) { for (const [k, at] of pending) tick.set(k, at); pending.clear(); } },
    /** Runner hook: the per-frame lane begins. */
    beginFrameLane() { lane = 'frame'; if (tick.size) tick.clear(); },
    /** The frame ended: per-frame presses are spent; pending presses wait for a fixed tick. */
    endFrame() { lane = 'idle'; if (tick.size) tick.clear(); if (frame.size) frame.clear(); },
    clear() { pending.clear(); frame.clear(); tick.clear(); },
  };
}
export type PressLatch = ReturnType<typeof createPressLatch>;
