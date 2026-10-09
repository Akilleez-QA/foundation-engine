/** Experimental, visit-owned assignment ledger. No scheduling or matching policy. */
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const validId = id => typeof id === 'string' && /^[a-z0-9][a-z0-9.-]{0,63}$/.test(id);
const result = status => Object.freeze({status});

export function createAssignments(options = {}) {
  const {maxActors = 64, maxTargets = 64, maxClaims = 64, maxCapacity = 64, maxRetries = 2} = options;
  for (const n of [maxActors, maxTargets, maxClaims, maxCapacity])
    if (!integer(n, 1, 4096)) throw new RangeError('Assignment bounds must be integers in 1..4096');
  if (!integer(maxRetries, 0, 64)) throw new RangeError('maxRetries must be an integer in 0..64');

  const actors = new Map();
  const targets = new Map();
  // Identity maps avoid reading properties on caller-supplied handles or tokens.
  const actorHandles = new Map();
  const targetHandles = new Map();
  const claims = new Map();
  let generation = 0;
  let disposed = false;
  const fresh = fields => Object.freeze({...fields, generation: ++generation});
  const exhausted = () => generation === Number.MAX_SAFE_INTEGER;

  function release(token) {
    const claim = claims.get(token);
    if (!claim) return false;
    claim.target.used -= claim.units;
    claim.actor.token = undefined;
    claims.delete(token);
    return true;
  }

  function publish(actor, target, units) {
    const token = fresh({actor: actor.handle.id, target: target.handle.id, units});
    actor.token = token;
    target.used += units;
    claims.set(token, {actor, target, units});
    return Object.freeze({status: 'claimed', token});
  }

  return Object.freeze({
    addActor(id) {
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
    addTarget(id, capacity) {
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
    claim(actorHandle, targetHandle, units = 1) {
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
    transfer(token, targetHandle, units = 1) {
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
    complete(token) {
      if (disposed) return result('disposed');
      return result(release(token) ? 'completed' : 'stale');
    },
    cancel(token) {
      if (disposed) return result('disposed');
      return result(release(token) ? 'cancelled' : 'stale');
    },
    retry(token) {
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
    removeActor(handle) {
      if (disposed) return result('disposed');
      const actor = actorHandles.get(handle);
      if (!actor) return result('stale');
      release(actor.token);
      actors.delete(actor.handle.id);
      actorHandles.delete(handle);
      return result('removed');
    },
    removeTarget(handle) {
      if (disposed) return result('disposed');
      const target = targetHandles.get(handle);
      if (!target) return result('stale');
      for (const [token, claim] of claims) if (claim.target === target) release(token);
      targets.delete(target.handle.id);
      targetHandles.delete(handle);
      return result('removed');
    },
    snapshot() {
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
        claims: Object.freeze([...claims.keys()].map(token => Object.freeze({...token}))),
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
