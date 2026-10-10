/**
 * Companion recovery: decides when a follower that retraces a leader's trail has fallen behind (catch up faster) or
 * is stranded (teleport to a safe point on the trail behind the leader, ideally out of view). Pure decisions per
 * call; the creator moves the follower, checks placement and visibility, and applies the decision.
 */
import type {BreadcrumbTrail, Crumb} from './trail';

export type RecoveryVec3 = readonly [number, number, number];

export interface RecoveryOptions {
  /** Distance from the follower to its desired trail point beyond which it speeds up (> 0). */
  readonly catchUpDistance: number;
  /** Distance beyond which it is stranded and teleports (> catchUpDistance). */
  readonly teleportDistance: number;
  /** Speed multiplier reached at `teleportDistance` (1 to 10, default 2). */
  readonly maxBoost?: number;
  /** Seconds without `minProgress` toward the desired point (while beyond catch-up distance) that also count as stranded. */
  readonly stuckSeconds?: number;
  /** Distance the follower must close within `stuckSeconds` to count as progressing (default 0.25). */
  readonly minProgress?: number;
  /** Minimum seconds between teleports of one follower (default 2). */
  readonly cooldown?: number;
  /** Trail distances behind the leader to try as teleport targets, nearest first (1 to 32 entries). */
  readonly landing: readonly number[];
  /** Followers tracked (1 to 1024, default 16). */
  readonly maxFollowers?: number;
}

export type RecoveryDecision =
  | {readonly kind: 'follow'; readonly boost: 1}
  | {readonly kind: 'catch-up'; readonly boost: number}
  | {readonly kind: 'teleport'; readonly to: Crumb; readonly reason: 'distance' | 'stuck'}
  /** Stranded, but no landing point passed `canLand` (or cooldown): keep following and try again later. */
  | {readonly kind: 'stranded'; readonly reason: 'distance' | 'stuck'; readonly boost: number};

export interface RecoveryInput {
  /** Follower position now. */
  readonly position: RecoveryVec3;
  /** Where the follower should be (e.g. `trail.along(spacing)`); null when the trail has nothing to follow yet. */
  readonly desired: RecoveryVec3 | null;
  /** Simulation seconds, nondecreasing per follower. */
  readonly now: number;
  /**
   * Whether a teleport may land at this trail point: free space, not visible to the camera, same area. Called at
   * most `landing.length` times per teleport attempt; must not throw. Default: always true.
   */
  readonly canLand?: (point: Crumb) => boolean;
}

const fail = (message: string): never => {
  throw new RangeError(`breadcrumbs: ${message}`);
};
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9;
function vec(v: unknown, what: string): RecoveryVec3 {
  if (!Array.isArray(v) || v.length !== 3) return fail(`${what} must be three finite numbers`);
  const x: unknown = v[0],
    y: unknown = v[1],
    z: unknown = v[2];
  if (!finite(x) || !finite(y) || !finite(z)) return fail(`${what} must be three finite numbers`);
  return [x, y, z];
}
const distance = (a: RecoveryVec3, b: RecoveryVec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function createCompanionRecovery(trail: BreadcrumbTrail, options: RecoveryOptions) {
  if (typeof trail?.along !== 'function') fail('trail must be a breadcrumb trail');
  if (typeof options !== 'object' || options === null) fail('options must be an object');
  const {catchUpDistance, teleportDistance} = options;
  const maxBoost = options.maxBoost ?? 2,
    stuckSeconds = options.stuckSeconds ?? 3,
    minProgress = options.minProgress ?? 0.25,
    cooldown = options.cooldown ?? 2,
    maxFollowers = options.maxFollowers ?? 16;
  if (!finite(catchUpDistance) || catchUpDistance <= 0) fail('catchUpDistance must be positive');
  if (!finite(teleportDistance) || teleportDistance <= catchUpDistance)
    fail('teleportDistance must exceed catchUpDistance');
  if (!finite(maxBoost) || maxBoost < 1 || maxBoost > 10) fail('maxBoost must be in [1, 10]');
  if (!finite(stuckSeconds) || stuckSeconds <= 0 || stuckSeconds > 600) fail('stuckSeconds must be in (0, 600]');
  if (!finite(minProgress) || minProgress <= 0) fail('minProgress must be positive');
  if (!finite(cooldown) || cooldown < 0 || cooldown > 600) fail('cooldown must be in [0, 600]');
  if (!Number.isSafeInteger(maxFollowers) || maxFollowers < 1 || maxFollowers > 1024)
    fail('maxFollowers must be 1-1024');
  const landingInput = options.landing;
  if (!Array.isArray(landingInput) || landingInput.length < 1 || landingInput.length > 32)
    fail('landing must list 1-32 trail distances');
  const landing = landingInput.map(d => (finite(d) && d >= 0 ? d : fail('landing distances must be nonnegative')));

  /**
   * Per follower: the progress window (start time, the follower's position then and the unit direction toward its
   * desired point then) and the last teleport time.
   */
  interface Follower {
    windowStart: number;
    anchor: RecoveryVec3 | null;
    toward: RecoveryVec3;
    /** Largest distance to the desired point seen in this window. */
    farthest: number;
    lastTeleport: number;
    lastNow: number;
  }
  const followers = new Map<number, Follower>();
  const restart = (f: Follower, now: number, position: RecoveryVec3, desired: RecoveryVec3) => {
    f.windowStart = now;
    f.anchor = position;
    const gap = distance(position, desired);
    f.farthest = gap;
    f.toward =
      gap > 0
        ? [(desired[0] - position[0]) / gap, (desired[1] - position[1]) / gap, (desired[2] - position[2]) / gap]
        : [0, 0, 0];
  };
  const boostFor = (d: number) =>
    d <= catchUpDistance
      ? 1
      : 1 + (maxBoost - 1) * Math.min(1, (d - catchUpDistance) / (teleportDistance - catchUpDistance));

  return {
    get size() {
      return followers.size;
    },
    /** Decide for one follower this step. */
    update(id: number, input: RecoveryInput): RecoveryDecision {
      if (!Number.isSafeInteger(id) || id < 0) fail('id must be a nonnegative integer');
      if (typeof input !== 'object' || input === null) fail('input must be an object');
      const position = vec(input.position, 'position');
      const desiredInput = input.desired;
      const desired = desiredInput === null ? null : vec(desiredInput, 'desired');
      const now = input.now;
      const canLand = input.canLand ?? (() => true);
      if (!finite(now)) fail('now must be finite');
      if (typeof canLand !== 'function') fail('canLand must be a function');
      let f = followers.get(id);
      if (!f) {
        if (followers.size >= maxFollowers) fail('follower capacity reached');
        f = {windowStart: now, anchor: null, toward: [0, 0, 0], farthest: 0, lastTeleport: -Infinity, lastNow: now};
        followers.set(id, f);
      }
      if (now < f.lastNow) fail('now must be nondecreasing per follower');
      f.lastNow = now;
      if (!desired) {
        f.anchor = null;
        return Object.freeze({kind: 'follow', boost: 1});
      }
      const d = distance(position, desired);
      // A chasing follower (even one a faster leader pulls away from) is never "stuck"; one against a wall is.
      if (d <= catchUpDistance || f.anchor === null) restart(f, now, position, desired);
      else {
        const moved =
          (position[0] - f.anchor[0]) * f.toward[0] +
          (position[1] - f.anchor[1]) * f.toward[1] +
          (position[2] - f.anchor[2]) * f.toward[2];
        f.farthest = Math.max(f.farthest, d);
        // Progress is either the follower's own advance toward where it was heading, or the gap closing by
        // `minProgress` from the largest gap in this window (catching up after a sprint).
        if (moved >= minProgress || f.farthest - d >= minProgress) restart(f, now, position, desired);
      }
      const stuck = d > catchUpDistance && now - f.windowStart >= stuckSeconds;
      const far = d > teleportDistance;
      if (!stuck && !far) {
        const boost = boostFor(d);
        return Object.freeze(boost === 1 ? {kind: 'follow', boost: 1} : {kind: 'catch-up', boost});
      }
      const reason = far ? 'distance' : 'stuck';
      if (now - f.lastTeleport >= cooldown) {
        let previous: Crumb | null = null;
        for (const behind of landing) {
          const point = trail.along(behind);
          if (!point) break;
          // Skip repeats (the trail clamps to its oldest crumb) and points that would not help: no closer to the
          // desired point than the follower already is, or still beyond the teleport distance from it.
          const same = previous !== null && previous.x === point.x && previous.y === point.y && previous.z === point.z;
          previous = point;
          const gap = distance([point.x, point.y, point.z], desired);
          if (same || gap >= d || gap > teleportDistance) continue;
          let ok = false;
          try {
            ok = canLand(point) === true;
          } catch {
            ok = false;
          }
          if (ok) {
            f.lastTeleport = now;
            f.anchor = null;
            return Object.freeze({kind: 'teleport', to: point, reason});
          }
        }
      }
      return Object.freeze({kind: 'stranded', reason, boost: boostFor(d)});
    },
    /** Forget a follower (despawned, dismissed). */
    remove(id: number): boolean {
      return followers.delete(id);
    },
  };
}
export type CompanionRecovery = ReturnType<typeof createCompanionRecovery>;
