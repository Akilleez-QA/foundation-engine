/**
 * Local avoidance among moving agents in the x/z plane, reciprocal-velocity-obstacle style by sampling: each agent
 * considers its preferred velocity, a stop and a fixed fan of directions and speeds, and picks the candidate with the
 * least penalty = |candidate − preferred| + weight / time-to-collision, where time to collision with each nearby agent
 * uses the reciprocal relative velocity (2·candidate − own − other), so both agents share the avoidance and do not
 * oscillate. Deterministic (fixed sample order, neighbours by distance then id), bounded, no geometry: combine with
 * `walkMesh` or character collision to stay inside walkable space.
 */
export interface AvoidanceAgent {
  readonly id: string;
  readonly position: readonly [number, number];
  readonly velocity: readonly [number, number];
  /** Where the agent wants to go this step (for example toward its next waypoint at cruise speed). */
  readonly preferred: readonly [number, number];
  readonly radius: number;
  readonly maxSpeed: number;
}
export interface AvoidanceOptions {
  /** Seconds ahead that collisions matter, (0, 60]. Default 2. */
  readonly horizon?: number;
  /** Neighbours considered within this distance (plus radii), (0, 1e4]. Default 5. */
  readonly neighborRadius?: number;
  /** Nearest neighbours considered per agent, [1, 64]. Default 10. */
  readonly maxNeighbors?: number;
  /** Directions sampled, [4, 64]. Default 16; speeds sampled are 1, 2/3 and 1/3 of max speed. */
  readonly directions?: number;
  /** Penalty weight for imminent collisions, (0, 1e4]. Default 1. */
  readonly weight?: number;
  /** Agents per step, [1, 4096]. Default 1024. */
  readonly maxAgents?: number;
}

function fail(message: string): never {
  throw new RangeError(`avoidance: ${message}`);
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pair = (v: unknown, what: string): [number, number] => {
  if (!Array.isArray(v) || v.length !== 2) fail(`${what} must be [x, z]`);
  const a: unknown = v[0],
    b: unknown = v[1];
  if (!finite(a) || !finite(b)) fail(`${what} must be finite`);
  return [a, b];
};

/** Earliest t ≥ 0 at which a point at `p` moving at `v` enters a disc of radius r at the origin; Infinity if never. */
function timeToCollision(px: number, pz: number, vx: number, vz: number, r: number): number {
  const c = px * px + pz * pz - r * r;
  if (c <= 0) return 0;
  const a = vx * vx + vz * vz;
  if (a === 0) return Infinity;
  const b = px * vx + pz * vz;
  if (b >= 0) return Infinity;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  return (-b - Math.sqrt(disc)) / a;
}

export function createAvoidance(options: AvoidanceOptions = {}) {
  if (!options || typeof options !== 'object') fail('options must be an object');
  const horizon = options.horizon ?? 2,
    neighborRadius = options.neighborRadius ?? 5,
    maxNeighbors = options.maxNeighbors ?? 10,
    directions = options.directions ?? 16,
    weight = options.weight ?? 1,
    maxAgents = options.maxAgents ?? 1024;
  if (!finite(horizon) || horizon <= 0 || horizon > 60) fail('horizon must be within (0, 60]');
  if (!finite(neighborRadius) || neighborRadius <= 0 || neighborRadius > 1e4)
    fail('neighborRadius must be within (0, 1e4]');
  if (!Number.isSafeInteger(maxNeighbors) || maxNeighbors < 1 || maxNeighbors > 64)
    fail('maxNeighbors must be in [1, 64]');
  if (!Number.isSafeInteger(directions) || directions < 4 || directions > 64) fail('directions must be in [4, 64]');
  if (!finite(weight) || weight <= 0 || weight > 1e4) fail('weight must be within (0, 1e4]');
  if (!Number.isSafeInteger(maxAgents) || maxAgents < 1 || maxAgents > 4096) fail('maxAgents must be in [1, 4096]');
  const fan: [number, number][] = [];
  for (let k = 0; k < directions; k++) {
    const a = (2 * Math.PI * k) / directions;
    fan.push([Math.cos(a), Math.sin(a)]);
  }
  const speeds = [1, 2 / 3, 1 / 3];
  return {
    /**
     * New velocities for all agents (same order), chosen against the velocities they had at the start of the step.
     * Each result is at most the agent's max speed.
     */
    step(agentsIn: readonly AvoidanceAgent[]): readonly (readonly [number, number])[] {
      if (!Array.isArray(agentsIn) || agentsIn.length > maxAgents) fail(`at most ${maxAgents} agents`);
      const n = agentsIn.length;
      const ids = new Set<string>();
      const agents = [] as {
        id: string;
        p: [number, number];
        v: [number, number];
        pref: [number, number];
        r: number;
        max: number;
      }[];
      for (let i = 0; i < n; i++) {
        const a = agentsIn[i];
        if (!a || typeof a !== 'object') fail('an agent must be an object');
        const id: unknown = a.id,
          r: unknown = a.radius,
          max: unknown = a.maxSpeed;
        if (typeof id !== 'string' || !id || ids.has(id)) fail('agent ids must be unique names');
        ids.add(id);
        if (!finite(r) || r <= 0 || r > 1e4) fail(`${id}: radius must be within (0, 1e4]`);
        if (!finite(max) || max < 0 || max > 1e4) fail(`${id}: maxSpeed must be within [0, 1e4]`);
        agents.push({
          id,
          p: pair(a.position, `${id} position`),
          v: pair(a.velocity, `${id} velocity`),
          pref: pair(a.preferred, `${id} preferred`),
          r,
          max,
        });
      }
      // Uniform hash for neighbour search.
      const cell = neighborRadius,
        hash = new Map<string, number[]>();
      const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
      agents.forEach((a, i) => {
        const k = key(a.p[0], a.p[1]);
        const list = hash.get(k);
        if (list) list.push(i);
        else hash.set(k, [i]);
      });
      return Object.freeze(
        agents.map((a, i) => {
          const cx = Math.floor(a.p[0] / cell),
            cz = Math.floor(a.p[1] / cell);
          const near: {j: number; d: number}[] = [];
          for (let dz = -1; dz <= 1; dz++)
            for (let dx = -1; dx <= 1; dx++)
              for (const j of hash.get(`${cx + dx},${cz + dz}`) ?? []) {
                if (j === i) continue;
                const b = agents[j]!;
                const d = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]) - b.r - a.r;
                if (d <= neighborRadius) near.push({j, d});
              }
          near.sort((x, y) => x.d - y.d || (agents[x.j]!.id < agents[y.j]!.id ? -1 : 1));
          const neighbors = near.slice(0, maxNeighbors).map(x => agents[x.j]!);
          const clampSpeed = (v: [number, number]): [number, number] => {
            const s = Math.hypot(v[0], v[1]);
            return s > a.max && s > 0 ? [(v[0] / s) * a.max, (v[1] / s) * a.max] : v;
          };
          const candidates: [number, number][] = [clampSpeed(a.pref), [0, 0]];
          for (const s of speeds) for (const [ux, uz] of fan) candidates.push([ux * a.max * s, uz * a.max * s]);
          let best: [number, number] = candidates[0]!,
            bestPenalty = Infinity;
          for (const c of candidates) {
            let tc = Infinity,
              overlapPenalty = 0;
            for (const b of neighbors) {
              const px = b.p[0] - a.p[0],
                pz = b.p[1] - a.p[1],
                r = a.r + b.r;
              const vx = 2 * c[0] - a.v[0] - b.v[0],
                vz = 2 * c[1] - a.v[1] - b.v[1];
              const dist = Math.hypot(px, pz);
              if (dist < r) {
                // Already overlapping: prefer candidates that move apart.
                const away = dist > 0 ? -(c[0] * px + c[1] * pz) / dist : 0;
                overlapPenalty += (r - dist) * 10 - away;
                continue;
              }
              // B's offset from A closes at the reciprocal relative velocity: it moves by −(2c − vA − vB) per second.
              tc = Math.min(tc, timeToCollision(px, pz, -vx, -vz, r));
            }
            const collision = tc <= horizon ? weight / Math.max(tc, 1e-6) : 0;
            const penalty = Math.hypot(c[0] - a.pref[0], c[1] - a.pref[1]) + collision + overlapPenalty;
            if (penalty < bestPenalty) {
              bestPenalty = penalty;
              best = c;
            }
          }
          return Object.freeze([best[0], best[1]] as [number, number]);
        }),
      );
    },
  };
}
export type Avoidance = ReturnType<typeof createAvoidance>;
