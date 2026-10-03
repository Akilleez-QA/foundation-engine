import {defineKit, type Vec3} from '../../author';
export function combat() {
  return defineKit({id: 'combat'});
}
export interface SweepTarget {
  id: string;
  from: Vec3;
  to: Vec3;
  radius: number;
}
/** Relative swept spheres; deterministic nearest time, then stable target ID. */
export function sweep(from: Vec3, to: Vec3, radius: number, targets: readonly SweepTarget[]) {
  const valid = (p: Vec3) => p.length === 3 && p.every(Number.isFinite);
  if (!valid(from) || !valid(to) || !Number.isFinite(radius) || radius < 0 || targets.length > 4096)
    throw Error('combat: invalid sweep');
  const ids = new Set<string>();
  let nearest: {id: string; time: number; point: Vec3} | null = null;
  for (const target of targets) {
    if (
      !target.id ||
      ids.has(target.id) ||
      !valid(target.from) ||
      !valid(target.to) ||
      !Number.isFinite(target.radius) ||
      target.radius < 0
    )
      throw Error('combat: invalid target');
    ids.add(target.id);
    // Every Vec3 here has length 3 (valid), so the map index i is in range of each tuple.
    const p = from.map((v, i) => v - target.from[i]!),
      d = to.map((v, i) => v - from[i]! - (target.to[i]! - target.from[i]!)),
      r = radius + target.radius;
    if (![...p, ...d, r].every(Number.isFinite)) throw Error('combat: relative range overflow');
    // Scale coordinates to avoid overflow in the quadratic at large world distances.
    const scale = Math.max(r, ...p.map(Math.abs), ...d.map(Math.abs)) || 1,
      q = p.map(v => v / scale),
      v = d.map(x => x / scale),
      rr = r / scale;
    const a = v.reduce((s, x) => s + x * x, 0),
      b = 2 * q.reduce((s, x, i) => s + x * v[i]!, 0),
      c = q.reduce((s, x) => s + x * x, 0) - rr * rr;
    let time: number | null = c <= 0 ? 0 : null;
    if (time === null && a > 0) {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const root = Math.sqrt(disc),
          denom = -b + root;
        const t = denom !== 0 ? (2 * c) / denom : (-b - root) / (2 * a);
        if (t >= 0 && t <= 1) time = t;
      }
    }
    if (time !== null && (!nearest || time < nearest.time || (time === nearest.time && target.id < nearest.id)))
      nearest = {id: target.id, time, point: from.map((x, i) => x + (to[i]! - x) * time) as Vec3};
  }
  return nearest;
}
export interface ActionResult {
  id: string;
  target: string;
  allowed: boolean;
  hit: boolean;
  applied: number;
}
/** Application supplies rules; audiovisual consumers only observe the committed result. */
export function resolveAction(
  input: {id: string; target: string; amount: number},
  rules: {
    eligible: () => boolean;
    hit: () => boolean;
    mitigate: (amount: number) => number;
    commit: (result: ActionResult) => boolean;
  },
): ActionResult | null {
  if (!input.id || !input.target || !Number.isFinite(input.amount) || input.amount < 0)
    throw Error('combat: invalid action');
  input = {...input};
  const allowed = rules.eligible(),
    hit = allowed && rules.hit(),
    applied = hit ? rules.mitigate(input.amount) : 0;
  if (!Number.isFinite(applied) || applied < 0 || applied > input.amount) throw Error('combat: invalid mitigation');
  if (typeof allowed !== 'boolean' || typeof hit !== 'boolean') throw Error('combat: rules must return booleans');
  const result = Object.freeze({id: input.id, target: input.target, allowed, hit, applied});
  return rules.commit(result) ? result : null;
}
/** Bounded per-session shot identities. Completion/cancellation is terminal, including after owner removal. */
export function createShots(maxShots = 1024) {
  if (!Number.isSafeInteger(maxShots) || maxShots < 1) throw Error('combat: invalid limit');
  const shots = new Map<string, {owner: string; expires: number; status: 'active' | 'resolved' | 'cancelled'}>();
  return {
    launch(id: string, owner: string, expires: number) {
      if (!id || !owner || !Number.isFinite(expires)) throw Error('combat: invalid shot');
      if (shots.has(id) || shots.size >= maxShots) return false;
      shots.set(id, {owner, expires, status: 'active'});
      return true;
    },
    resolve(id: string, now: number) {
      if (!Number.isFinite(now)) throw Error('combat: invalid time');
      const s = shots.get(id);
      if (!s || s.status !== 'active') return false;
      if (now >= s.expires) {
        s.status = 'cancelled';
        return false;
      }
      s.status = 'resolved';
      return true;
    },
    cancelOwner(owner: string) {
      for (const s of shots.values()) if (s.owner === owner && s.status === 'active') s.status = 'cancelled';
    },
    status: (id: string) => shots.get(id)?.status,
  };
}
