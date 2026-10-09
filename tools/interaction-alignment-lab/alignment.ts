import {frameRef, type FrameRef} from '../../src/kits/frames/frame';

/** Planar rigid poses: world units and radians, positive yaw rotates +X toward +Z. */
export interface Pose {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}
export interface Target {
  readonly identity: FrameRef;
  readonly revision: number;
  readonly frame: Pose;
}
export interface Sample {
  readonly target: Target;
  readonly actor: Pose;
  readonly eligible: boolean;
  /** Creator checked clearance from actor through the destination, or the final pose for acknowledgment. */
  readonly clear: boolean;
}
export interface Limits {
  readonly maxDistance: number;
  readonly maxAngle: number;
  readonly distanceTolerance: number;
  readonly angleTolerance: number;
  readonly speed: number;
  readonly angularSpeed: number;
  readonly maxStepSeconds: number;
  readonly timeoutSeconds: number;
  readonly maxSteps: number;
}
export interface Ticket {
  readonly target: FrameRef;
  readonly revision: number;
  readonly pose: Pose;
}
export type Reason =
  | 'cancelled'
  | 'disposed'
  | 'target-changed'
  | 'ineligible'
  | 'blocked'
  | 'approach-limit'
  | 'timeout'
  | 'step-budget'
  | 'drift';
export type Result =
  | {readonly kind: 'paused'}
  | {readonly kind: 'proposal'; readonly pose: Pose}
  | {readonly kind: 'prepared'; readonly ticket: Ticket}
  | {readonly kind: 'accepted'; readonly ticket: Ticket}
  | {readonly kind: 'refused'; readonly reason: Reason | 'stale-ticket' | 'not-prepared'};

function pose(value: Pose): Pose {
  if (![value.x, value.z, value.yaw].every(Number.isFinite)) throw Error('non-finite planar pose');
  return Object.freeze({...value});
}
function angle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}
function target(value: Target): Target {
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw Error('invalid target revision');
  return Object.freeze({identity: frameRef(value.identity), revision: value.revision, frame: pose(value.frame)});
}
/** No frame hierarchy or pose owner: the creator supplies an already resolved planar frame. */
export function destination(frame: Pose, local: Pose): Pose {
  pose(frame);
  pose(local);
  const c = Math.cos(frame.yaw),
    s = Math.sin(frame.yaw);
  return pose({
    x: frame.x + c * local.x - s * local.z,
    z: frame.z + s * local.x + c * local.z,
    yaw: angle(frame.yaw + local.yaw),
  });
}

/** One bounded attempt, at most one live ticket, no scheduler, mutation callback, or effect ownership. */
export function createAlignment(initial: Target, local: Pose, input: Limits) {
  const bound = target(initial),
    goal = destination(bound.frame, local),
    limits = Object.freeze({...input});
  if (
    ![
      limits.maxDistance,
      limits.maxAngle,
      limits.distanceTolerance,
      limits.angleTolerance,
      limits.speed,
      limits.angularSpeed,
      limits.maxStepSeconds,
      limits.timeoutSeconds,
      limits.maxSteps,
    ].every(n => Number.isFinite(n) && n > 0) ||
    !Number.isSafeInteger(limits.maxSteps) ||
    limits.maxAngle > Math.PI ||
    limits.angleTolerance > limits.maxAngle ||
    limits.distanceTolerance > limits.maxDistance
  )
    throw Error('invalid alignment limits');
  let elapsed = 0,
    steps = 0,
    ticket: Ticket | null = null;
  let terminal: Reason | 'accepted' | null = null;
  const refuse = (reason: Reason): Result => {
    terminal = reason;
    ticket = null;
    return {kind: 'refused', reason};
  };
  const inspect = (sample: Sample): Reason | null => {
    const current = target(sample.target);
    pose(sample.actor);
    if (typeof sample.eligible !== 'boolean' || typeof sample.clear !== 'boolean')
      throw Error('invalid creator checks');
    if (
      current.identity.id !== bound.identity.id ||
      current.identity.generation !== bound.identity.generation ||
      current.revision !== bound.revision ||
      current.frame.x !== bound.frame.x ||
      current.frame.z !== bound.frame.z ||
      current.frame.yaw !== bound.frame.yaw
    )
      return 'target-changed';
    if (!sample.eligible) return 'ineligible';
    if (!sample.clear) return 'blocked';
    if (
      Math.hypot(goal.x - sample.actor.x, goal.z - sample.actor.z) > limits.maxDistance ||
      Math.abs(angle(goal.yaw - sample.actor.yaw)) > limits.maxAngle
    )
      return 'approach-limit';
    return null;
  };
  const aligned = (actor: Pose) =>
    Math.hypot(goal.x - actor.x, goal.z - actor.z) <= limits.distanceTolerance &&
    Math.abs(angle(goal.yaw - actor.yaw)) <= limits.angleTolerance;
  return {
    step(sample: Sample, seconds: number, paused = false): Result {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > limits.maxStepSeconds)
        throw Error('invalid step duration');
      if (terminal) return {kind: 'refused', reason: terminal === 'accepted' ? 'stale-ticket' : terminal};
      const invalid = inspect(sample);
      if (invalid) return refuse(invalid);
      if (paused || seconds === 0) return {kind: 'paused'};
      elapsed += seconds;
      if (elapsed >= limits.timeoutSeconds) return refuse('timeout');
      if (++steps > limits.maxSteps) return refuse('step-budget');
      if (ticket && !aligned(sample.actor)) return refuse('drift');
      if (aligned(sample.actor)) {
        ticket ??= Object.freeze({target: bound.identity, revision: bound.revision, pose: goal});
        return {kind: 'prepared', ticket};
      }
      const dx = goal.x - sample.actor.x,
        dz = goal.z - sample.actor.z;
      const distance = Math.hypot(dx, dz),
        fraction = Math.min(1, (limits.speed * seconds) / distance);
      const turn = angle(goal.yaw - sample.actor.yaw),
        turnLimit = limits.angularSpeed * seconds;
      return {
        kind: 'proposal',
        pose: pose({
          x: sample.actor.x + dx * fraction,
          z: sample.actor.z + dz * fraction,
          yaw: angle(sample.actor.yaw + Math.max(-turnLimit, Math.min(turnLimit, turn))),
        }),
      };
    },
    acknowledge(candidate: Ticket, sample: Sample, paused = false): Result {
      if (terminal || candidate !== ticket) return {kind: 'refused', reason: 'stale-ticket'};
      if (!ticket) return {kind: 'refused', reason: 'not-prepared'};
      const invalid = inspect(sample);
      if (invalid) return refuse(invalid);
      if (paused) return {kind: 'paused'};
      if (!aligned(sample.actor)) return refuse('drift');
      const accepted = ticket;
      ticket = null;
      terminal = 'accepted';
      return {kind: 'accepted', ticket: accepted};
    },
    cancel(): void {
      if (!terminal) refuse('cancelled');
    },
    dispose(): void {
      if (!terminal) refuse('disposed');
    },
    get state() {
      return Object.freeze({elapsed, steps, pendingTickets: ticket ? 1 : 0, terminal});
    },
  };
}
