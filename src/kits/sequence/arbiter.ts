/**
 * Event arbitration: at most one world event (a scripted scene, a conversation, a trigger) claims the stage at a time.
 *
 * Sources are declared in priority order. Each tick the caller opens a window only at a safe point (for example
 * when the player has settled at the end of a step and no claim is running) and offers candidates; `resolve()` picks
 * the first offered source in declaration order (ties within a source: first offer), claims the stage for it and
 * clears the other offers (one offer per source per tick, so at most 64). While a claim is held every offer is refused, so a trigger cannot fire under a running
 * scene. `release(claim)` ends it and starts that source's cooldown in ticks, so a trigger the player is still
 * standing in does not refire at once. Pure bookkeeping, bounded per tick. Claims and cooldowns are not saved.
 */
export interface ArbiterSource {
  readonly id: string;
  /** Ticks after release during which this source's offers are refused. Default 0. */
  readonly cooldown?: number;
}
export interface Claim<T> {
  readonly source: string;
  readonly payload: T;
  /** Monotonic claim number, for matching `release`. */
  readonly claim: number;
}
export const ARBITER_LIMITS = Object.freeze({sources: 64, cooldown: 1_000_000});

function fail(message: string): never {
  throw new RangeError(`event arbiter: ${message}`);
}

export function createEventArbiter<T = unknown>(input: {readonly sources: readonly ArbiterSource[]}) {
  if (!input || !Array.isArray(input.sources)) fail('sources must be an array');
  const n = input.sources.length;
  if (n < 1 || n > ARBITER_LIMITS.sources) fail(`1-${ARBITER_LIMITS.sources} sources`);
  const order = new Map<string, number>(),
    ids: string[] = [],
    cooldown: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = input.sources[i];
    if (!s || typeof s !== 'object') fail('a source must be an object');
    const id: unknown = s.id,
      c: unknown = s.cooldown ?? 0;
    if (typeof id !== 'string' || !id || id.length > 256 || order.has(id)) fail('source ids must be unique strings');
    if (typeof c !== 'number' || !Number.isSafeInteger(c) || c < 0 || c > ARBITER_LIMITS.cooldown)
      fail(`${id}: cooldown must be an integer tick count`);
    order.set(id, i);
    ids.push(id);
    cooldown.push(c);
  }
  const offers: ({payload: T} | undefined)[] = new Array(n).fill(undefined);
  const until = new Array<number>(n).fill(-1);
  let tick = 0,
    held: Claim<T> | null = null,
    next = 1;
  const index = (source: string) => {
    const i = order.get(source);
    if (i === undefined) fail(`unknown source ${String(source)}`);
    return i;
  };
  return {
    /** Advance the arbiter's tick (once per fixed step) and drop unresolved offers from the previous tick. */
    tick(): number {
      tick++;
      offers.fill(undefined);
      return tick;
    },
    /** Offer a candidate this tick. Refused while a claim is held, during the source's cooldown, or over budget. */
    offer(source: string, payload: T): 'offered' | 'held' | 'cooling' | 'duplicate' {
      const i = index(source);
      if (held) return 'held';
      if (tick < until[i]!) return 'cooling';
      if (offers[i]) return 'duplicate';
      offers[i] = {payload};
      return 'offered';
    },
    /** Claim the stage for the highest-priority offer of this tick, or null if none (or a claim is already held). */
    resolve(): Claim<T> | null {
      if (held) return null;
      const i = offers.findIndex(o => o !== undefined);
      if (i < 0) return null;
      held = Object.freeze({source: ids[i]!, payload: offers[i]!.payload, claim: next++});
      offers.fill(undefined);
      return held;
    },
    /** End a claim; starts its source's cooldown. Stale or foreign claims are refused. */
    release(claim: Claim<T>): 'released' | 'stale' {
      if (!held || claim !== held) return 'stale';
      const i = index(claim.source);
      // Offers are refused for the `cooldown` ticks after the release tick (and the rest of that tick when c > 0).
      until[i] = cooldown[i]! > 0 ? tick + cooldown[i]! + 1 : tick;
      held = null;
      return 'released';
    },
    get held(): Claim<T> | null {
      return held;
    },
    get now(): number {
      return tick;
    },
  };
}
export type EventArbiter<T = unknown> = ReturnType<typeof createEventArbiter<T>>;
