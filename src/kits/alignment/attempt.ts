import {frameRef, type FrameRef} from '../frames/frame';

/** Planar rigid poses: world units and radians, positive yaw rotates +Z toward +X (author Transform.ry). */
export interface AlignmentPose {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}
export interface AlignmentTarget {
  readonly identity: FrameRef;
  readonly revision: number;
  readonly frame: AlignmentPose;
}
export interface AlignmentSample {
  readonly target: AlignmentTarget;
  readonly actor: AlignmentPose;
  readonly eligible: boolean;
  /** Creator checked clearance from actor through the destination, or the final pose for acknowledgment. */
  readonly clear: boolean;
}
export interface AlignmentLimits {
  readonly maxDistance: number;
  readonly maxAngle: number;
  readonly distanceTolerance: number;
  readonly angleTolerance: number;
  readonly speed: number;
  readonly angularSpeed: number;
  readonly maxStepSeconds: number;
  readonly timeoutSeconds: number;
  readonly maxSteps: number;
  readonly maxIdentityLength: number;
}
export interface AlignmentTicket {
  readonly target: FrameRef;
  readonly revision: number;
  readonly pose: AlignmentPose;
}
export type AlignmentReason =
  | 'cancelled'
  | 'disposed'
  | 'target-changed'
  | 'ineligible'
  | 'blocked'
  | 'approach-limit'
  | 'timeout'
  | 'step-budget'
  | 'drift';
export type AlignmentResult =
  | {readonly kind: 'paused'}
  | {readonly kind: 'proposal'; readonly pose: AlignmentPose}
  | {readonly kind: 'prepared'; readonly ticket: AlignmentTicket}
  | {readonly kind: 'accepted'; readonly ticket: AlignmentTicket}
  | {readonly kind: 'refused'; readonly reason: AlignmentReason | 'stale-ticket' | 'not-prepared'};

function pose(value: AlignmentPose): AlignmentPose {
  if (![value.x, value.z, value.yaw].every(Number.isFinite)) throw Error('planar pose outside numeric range');
  return Object.freeze({x: value.x, z: value.z, yaw: angle(value.yaw)});
}
function distanceBetween(a: AlignmentPose, b: AlignmentPose): number {
  const distance = Math.hypot(a.x - b.x, a.z - b.z);
  if (!Number.isFinite(distance)) throw Error('alignment distance overflow');
  return distance;
}
function angle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}
function target(value: AlignmentTarget): AlignmentTarget {
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw Error('invalid target revision');
  return Object.freeze({identity: frameRef(value.identity), revision: value.revision, frame: pose(value.frame)});
}
/** No frame hierarchy or pose owner: the creator supplies an already resolved planar frame. */
export function alignmentDestination(frame: AlignmentPose, local: AlignmentPose): AlignmentPose {
  const world = pose(frame),
    offset = pose(local);
  const c = Math.cos(world.yaw),
    s = Math.sin(world.yaw);
  return pose({
    x: world.x + c * offset.x + s * offset.z,
    z: world.z - s * offset.x + c * offset.z,
    yaw: angle(world.yaw + offset.yaw),
  });
}

/** One bounded attempt, at most one live ticket, no scheduler, mutation callback, or effect ownership. */
export function createAlignment(initial: AlignmentTarget, local: AlignmentPose, input: AlignmentLimits) {
  const bound = target(initial),
    goal = alignmentDestination(bound.frame, local),
    limits = Object.freeze({
      maxDistance: input.maxDistance,
      maxAngle: input.maxAngle,
      distanceTolerance: input.distanceTolerance,
      angleTolerance: input.angleTolerance,
      speed: input.speed,
      angularSpeed: input.angularSpeed,
      maxStepSeconds: input.maxStepSeconds,
      timeoutSeconds: input.timeoutSeconds,
      maxSteps: input.maxSteps,
      maxIdentityLength: input.maxIdentityLength,
    });
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
      limits.maxIdentityLength,
    ].every(n => Number.isFinite(n) && n > 0) ||
    !Number.isSafeInteger(limits.maxSteps) ||
    !Number.isSafeInteger(limits.maxIdentityLength) ||
    bound.identity.id.length > limits.maxIdentityLength ||
    limits.maxAngle > Math.PI ||
    limits.angleTolerance > limits.maxAngle ||
    limits.distanceTolerance > limits.maxDistance
  )
    throw Error('invalid alignment limits');
  let elapsed = 0,
    steps = 0,
    ticket: AlignmentTicket | null = null;
  let terminal: AlignmentReason | 'accepted' | null = null;
  const refuse = (reason: AlignmentReason): AlignmentResult => {
    terminal = reason;
    ticket = null;
    return {kind: 'refused', reason};
  };
  const inspect = (sample: AlignmentSample): AlignmentReason | null => {
    if (sample.target.identity.id.length > limits.maxIdentityLength) throw Error('target identity exceeds limit');
    const current = target(sample.target);
    const actor = pose(sample.actor);
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
    if (distanceBetween(goal, actor) > limits.maxDistance || Math.abs(angle(goal.yaw - actor.yaw)) > limits.maxAngle)
      return 'approach-limit';
    return null;
  };
  const aligned = (value: AlignmentPose) => {
    const actor = pose(value);
    return (
      distanceBetween(goal, actor) <= limits.distanceTolerance &&
      Math.abs(angle(goal.yaw - actor.yaw)) <= limits.angleTolerance
    );
  };
  const propose = (value: AlignmentPose, seconds: number): AlignmentPose => {
    const actor = pose(value);
    const dx = goal.x - actor.x,
      dz = goal.z - actor.z;
    const distance = Math.hypot(dx, dz),
      fraction = distance === 0 ? 0 : Math.min(1, (limits.speed * seconds) / distance);
    const turn = angle(goal.yaw - actor.yaw),
      turnLimit = limits.angularSpeed * seconds;
    return pose({
      x: actor.x + dx * fraction,
      z: actor.z + dz * fraction,
      yaw: angle(actor.yaw + Math.max(-turnLimit, Math.min(turnLimit, turn))),
    });
  };
  return {
    step(sample: AlignmentSample, seconds: number, paused = false): AlignmentResult {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > limits.maxStepSeconds)
        throw Error('invalid step duration');
      if (terminal) return {kind: 'refused', reason: terminal === 'accepted' ? 'stale-ticket' : terminal};
      const invalid = inspect(sample);
      if (invalid) return refuse(invalid);
      if (ticket && !aligned(sample.actor)) return refuse('drift');
      if (paused || seconds === 0) return {kind: 'paused'};
      const ready = aligned(sample.actor);
      // Complete numeric validation before consuming time or work.
      const proposal = ready ? null : propose(sample.actor, seconds);
      elapsed = Math.min(limits.timeoutSeconds, elapsed + seconds);
      if (elapsed >= limits.timeoutSeconds) return refuse('timeout');
      if (steps >= limits.maxSteps) return refuse('step-budget');
      steps++;
      if (ready) {
        ticket ??= Object.freeze({target: bound.identity, revision: bound.revision, pose: goal});
        return {kind: 'prepared', ticket};
      }
      return {kind: 'proposal', pose: proposal!};
    },
    acknowledge(candidate: AlignmentTicket, sample: AlignmentSample, paused = false): AlignmentResult {
      if (terminal || candidate !== ticket) return {kind: 'refused', reason: 'stale-ticket'};
      if (!ticket) return {kind: 'refused', reason: 'not-prepared'};
      const invalid = inspect(sample);
      if (invalid) return refuse(invalid);
      if (!aligned(sample.actor)) return refuse('drift');
      if (paused) return {kind: 'paused'};
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

export type AlignmentAttempt = ReturnType<typeof createAlignment>;
