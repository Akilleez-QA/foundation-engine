/** Visit-owned service/worksite claims. No scheduling, matching or effect policy. */
export interface AssignmentOptions {
  readonly maxActors?: number;
  readonly maxTargets?: number;
  readonly maxClaims?: number;
  readonly maxCapacity?: number;
  readonly maxRetries?: number;
}
export interface AssignmentHandle {
  readonly id: string;
  readonly generation: number;
}
export interface AssignmentToken {
  readonly actor: string;
  readonly target: string;
  readonly units: number;
  readonly generation: number;
}
export type AssignmentRefusal = Readonly<{
  status:
    | 'disposed'
    | 'invalid'
    | 'duplicate'
    | 'saturated'
    | 'generation-exhausted'
    | 'stale'
    | 'retry-exhausted'
    | 'busy'
    | 'full';
}>;
export type AssignmentAdmission = Readonly<{status: 'added'; handle: AssignmentHandle}> | AssignmentRefusal;
export type AssignmentClaim = Readonly<{status: 'claimed'; token: AssignmentToken}> | AssignmentRefusal;
export interface AssignmentSnapshot {
  readonly disposed: boolean;
  readonly actors: readonly Readonly<{
    id: string;
    generation: number;
    retries: number;
    exhausted: boolean;
    assigned: boolean;
  }>[];
  readonly targets: readonly Readonly<{id: string; generation: number; capacity: number; used: number}>[];
  readonly claims: readonly AssignmentToken[];
}
interface Actor {
  handle: AssignmentHandle;
  token: AssignmentToken | undefined;
  retries: number;
  exhausted: boolean;
}
interface Target {
  handle: AssignmentHandle;
  capacity: number;
  used: number;
}
interface Claim {
  actor: Actor;
  target: Target;
  units: number;
}

const integer = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9][a-z0-9.-]{0,63}$/.test(id);
const result = <T extends string>(status: T): Readonly<{status: T}> => Object.freeze({status});

export function createAssignments(options: AssignmentOptions = {}) {
  const {maxActors = 64, maxTargets = 64, maxClaims = 64, maxCapacity = 64, maxRetries = 2} = options;
  for (const n of [maxActors, maxTargets, maxClaims, maxCapacity])
    if (!integer(n, 1, 4096)) throw new RangeError('Assignment bounds must be integers in 1..4096');
  if (!integer(maxRetries, 0, 64)) throw new RangeError('maxRetries must be an integer in 0..64');

  const actors = new Map<string, Actor>();
  const targets = new Map<string, Target>();
  // Identity maps avoid reading properties on caller-supplied handles or tokens.
  const actorHandles = new Map<unknown, Actor>();
  const targetHandles = new Map<unknown, Target>();
  const claims = new Map<unknown, Claim>();
  let generation = 0;
  let disposed = false;
  const fresh = <T extends object>(fields: T): Readonly<T & {generation: number}> =>
    Object.freeze({...fields, generation: ++generation});
  const exhausted = () => generation === Number.MAX_SAFE_INTEGER;

  function release(token: unknown) {
    const claim = claims.get(token);
    if (!claim) return false;
    claim.target.used -= claim.units;
    claim.actor.token = undefined;
    claims.delete(token);
    return true;
  }

  function publish(actor: Actor, target: Target, units: number): AssignmentClaim {
    const token = fresh({actor: actor.handle.id, target: target.handle.id, units});
    actor.token = token;
    target.used += units;
    claims.set(token, {actor, target, units});
    return Object.freeze({status: 'claimed' as const, token});
  }

  return Object.freeze({
    addActor(id: unknown): AssignmentAdmission {
      if (disposed) return result('disposed');
      if (!validId(id)) return result('invalid');
      if (actors.has(id)) return result('duplicate');
      if (actors.size >= maxActors) return result('saturated');
      if (exhausted()) return result('generation-exhausted');
      const handle = fresh({id});
      const actor = {handle, token: undefined, retries: 0, exhausted: false};
      actors.set(id, actor);
      actorHandles.set(handle, actor);
      return Object.freeze({status: 'added', handle});
    },
    addTarget(id: unknown, capacity: unknown): AssignmentAdmission {
      if (disposed) return result('disposed');
      if (!validId(id) || !integer(capacity, 1, maxCapacity)) return result('invalid');
      if (targets.has(id)) return result('duplicate');
      if (targets.size >= maxTargets) return result('saturated');
      if (exhausted()) return result('generation-exhausted');
      const handle = fresh({id});
      const target = {handle, capacity, used: 0};
      targets.set(id, target);
      targetHandles.set(handle, target);
      return Object.freeze({status: 'added', handle});
    },
    claim(actorHandle: unknown, targetHandle: unknown, units: unknown = 1): AssignmentClaim {
      if (disposed) return result('disposed');
      const actor = actorHandles.get(actorHandle);
      const target = targetHandles.get(targetHandle);
      if (!actor || !target) return result('stale');
      if (!integer(units, 1, maxCapacity)) return result('invalid');
      if (actor.exhausted) return result('retry-exhausted');
      if (actor.token) return result('busy');
      if (claims.size >= maxClaims) return result('saturated');
      if (target.used + units > target.capacity) return result('full');
      if (exhausted()) return result('generation-exhausted');
      return publish(actor, target, units);
    },
    transfer(token: unknown, targetHandle: unknown, units: unknown = 1): AssignmentClaim {
      if (disposed) return result('disposed');
      const claim = claims.get(token);
      const target = targetHandles.get(targetHandle);
      if (!claim || !target) return result('stale');
      if (!integer(units, 1, maxCapacity)) return result('invalid');
      const available = target.capacity - target.used + (claim.target === target ? claim.units : 0);
      if (units > available) return result('full');
      if (exhausted()) return result('generation-exhausted');
      // No callbacks or asynchronous boundary between preflight and publication.
      release(token);
      return publish(claim.actor, target, units);
    },
    /** Test current authority before adopting external results; does not consume the claim. */
    check(token: unknown): boolean {
      return !disposed && claims.has(token);
    },
    complete(token: unknown) {
      if (disposed) return result('disposed');
      return result(release(token) ? 'completed' : 'stale');
    },
    cancel(token: unknown) {
      if (disposed) return result('disposed');
      return result(release(token) ? 'cancelled' : 'stale');
    },
    retry(token: unknown) {
      if (disposed) return result('disposed');
      const claim = claims.get(token);
      if (!claim) return result('stale');
      release(token);
      const actor = claim.actor;
      if (actor.retries === maxRetries) {
        actor.exhausted = true;
        return result('retry-exhausted');
      }
      actor.retries++;
      return result('ready');
    },
    removeActor(handle: unknown) {
      if (disposed) return result('disposed');
      const actor = actorHandles.get(handle);
      if (!actor) return result('stale');
      release(actor.token);
      actors.delete(actor.handle.id);
      actorHandles.delete(handle);
      return result('removed');
    },
    removeTarget(handle: unknown) {
      if (disposed) return result('disposed');
      const target = targetHandles.get(handle);
      if (!target) return result('stale');
      for (const [token, claim] of claims) if (claim.target === target) release(token);
      targets.delete(target.handle.id);
      targetHandles.delete(handle);
      return result('removed');
    },
    snapshot(): AssignmentSnapshot {
      return Object.freeze({
        disposed,
        actors: Object.freeze(
          [...actors.values()].map(actor =>
            Object.freeze({
              id: actor.handle.id,
              generation: actor.handle.generation,
              retries: actor.retries,
              exhausted: actor.exhausted,
              assigned: actor.token !== undefined,
            }),
          ),
        ),
        targets: Object.freeze(
          [...targets.values()].map(target =>
            Object.freeze({
              id: target.handle.id,
              generation: target.handle.generation,
              capacity: target.capacity,
              used: target.used,
            }),
          ),
        ),
        claims: Object.freeze([...claims.values()].map(claim => Object.freeze({...claim.actor.token!}))),
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      claims.clear();
      actorHandles.clear();
      targetHandles.clear();
      actors.clear();
      targets.clear();
    },
  });
}

export type Assignments = ReturnType<typeof createAssignments>;
