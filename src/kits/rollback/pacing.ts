/** Pure recommendations for adaptive input delay and pacing. No clock, no state: the caller supplies measurements. */
import type {RollbackDelayPolicy} from './types';

export interface DelayRecommendationInput {
  /** Measured round trip (for example the exchange's `read().roundTrip` maximum), in caller time units. */
  readonly roundTrip: number;
  /** One fixed frame in the same units. */
  readonly frameTime: number;
  /** The delay now scheduled (`read().delayChanges` last delay, or the session's `read().delay`). */
  readonly current: number;
  readonly policy: Pick<RollbackDelayPolicy, 'minDelay' | 'maxDelay' | 'maxStep'>;
  /** Extra frames above the one-way latency, [0, 30] (default 1). */
  readonly margin?: number;
  /** Frames of slack before lowering the delay (hysteresis), [0, 30] (default 1). */
  readonly hysteresis?: number;
}

/**
 * The delay that hides half the round trip plus `margin`, clamped to the policy and moved at most `maxStep` from
 * `current`. A lower delay is only recommended when the target is at least `hysteresis` frames below `current`.
 * Returns `current` when the inputs are not usable (no measurement yet).
 */
export function recommendInputDelay(input: DelayRecommendationInput): number {
  const {roundTrip, frameTime, current, policy} = input;
  const margin = input.margin ?? 1,
    hysteresis = input.hysteresis ?? 1;
  if (
    !Number.isFinite(roundTrip) ||
    roundTrip < 0 ||
    !Number.isFinite(frameTime) ||
    frameTime <= 0 ||
    !Number.isSafeInteger(current) ||
    !Number.isSafeInteger(margin) ||
    margin < 0 ||
    margin > 30 ||
    !Number.isSafeInteger(hysteresis) ||
    hysteresis < 0 ||
    hysteresis > 30
  )
    return current;
  const wanted = Math.ceil(roundTrip / 2 / frameTime) + margin;
  let target = Math.max(policy.minDelay, Math.min(policy.maxDelay, wanted));
  if (target < current && current - target <= hysteresis) target = current;
  const step = Math.max(-policy.maxStep, Math.min(policy.maxStep, target - current));
  return current + step;
}

/**
 * The time-synchronization rule on two advantages: half the difference between this peer's advantage over a remote
 * peer and that peer's reported advantage over this one. Positive means this peer runs ahead; skip ticks above the
 * threshold.
 */
export function recommendPacing(local: number, remote: number, threshold: number): {advantage: number; skip: boolean} {
  if (![local, remote, threshold].every(Number.isFinite)) return {advantage: 0, skip: false};
  const advantage = (local - remote) / 2;
  return {advantage, skip: advantage > threshold};
}
