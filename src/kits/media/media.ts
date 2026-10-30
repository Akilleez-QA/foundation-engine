/**
 * Medium volumes (water, mud, lava, low gravity): box-shaped regions with a floor and a surface height. A tracker
 * classifies bounded actors each fixed step into dry / wade / swim / under with hysteresis and reports enter, exit
 * and state changes; pure helpers turn submersion into buoyancy, drag and current accelerations. No clock, entity,
 * physics world or registration: the creator moves actors and applies the accelerations.
 */
export type MediumVec3 = readonly [number, number, number];

export interface VolumeInput {
  /** Horizontal extent: x in [minX, maxX), z in [minZ, maxZ) (half-open, so flush volumes leave no seam). */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Bottom of the medium and its surface height (surface > floor). */
  readonly floor: number;
  readonly surface: number;
  /** Creator tag, e.g. 'water', 'mud' (1-64 characters). */
  readonly kind: string;
  /** Higher wins where volumes overlap (default 0); ties: higher surface, then lower id. */
  readonly priority?: number;
  /** Density relative to the actor (1 = neutral when fully submerged). Default 1. */
  readonly density?: number;
  /** Linear drag coefficient per second (>= 0). Default 0. */
  readonly drag?: number;
  /** Velocity the medium carries actors toward (a current). Default [0, 0, 0]. */
  readonly current?: MediumVec3;
  /** False: ignored by queries (a drained pool). Default true. */
  readonly enabled?: boolean;
}

export interface Volume extends Readonly<Required<Omit<VolumeInput, 'current'>>> {
  readonly id: number;
  readonly current: MediumVec3;
}

export type MediumState = 'dry' | 'wade' | 'swim' | 'under';

export interface Probe {
  /** The winning volume containing the point horizontally and vertically overlapping the body, or null. */
  readonly volume: Volume | null;
  /** How deep the body stands in the medium: surface - max(feet, floor). 0 when no volume. */
  readonly depth: number;
  /** surface - head (positive when the head is below the surface). 0 when no volume. */
  readonly headDepth: number;
  /** Fraction of the body height inside the medium, 0..1. */
  readonly submerged: number;
}

export interface TrackerOptions {
  /** 1 to 65536 tracked actors. */
  readonly maxActors: number;
  /** Depth (surface - feet) at which wading starts and swimming starts; 0 < wadeDepth < swimDepth. */
  readonly wadeDepth: number;
  readonly swimDepth: number;
  /** Extra depth needed to enter a deeper state and extra shallowness to leave it (>= 0, default 0.05). */
  readonly hysteresis?: number;
}

export type MediumEvent =
  | {readonly kind: 'enter' | 'exit'; readonly actor: number; readonly volume: number}
  | {readonly kind: 'state'; readonly actor: number; readonly from: MediumState; readonly to: MediumState};

export interface ActorSample {
  /** Feet position and body height (> 0). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly height: number;
}

export const MEDIUM_LIMITS = Object.freeze({maxVolumes: 4096, maxActors: 65536, maxExtent: 1e9});

const fail = (message: string): never => {
  throw new RangeError(`media: ${message}`);
};
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MEDIUM_LIMITS.maxExtent;
function vec(v: unknown, what: string): MediumVec3 {
  if (!Array.isArray(v) || v.length !== 3) return fail(`${what} must be [x, y, z]`);
  const x: unknown = v[0],
    y: unknown = v[1],
    z: unknown = v[2];
  if (!finite(x) || !finite(y) || !finite(z)) return fail(`${what} must be finite`);
  return Object.freeze([x + 0, y + 0, z + 0]) as MediumVec3;
}

function captureVolume(id: number, input: VolumeInput): Volume {
  if (typeof input !== 'object' || input === null) return fail('volume must be an object');
  const r: Record<string, unknown> = {...input};
  const nums = ['minX', 'maxX', 'minZ', 'maxZ', 'floor', 'surface'] as const;
  const n: Record<(typeof nums)[number], number> = {minX: 0, maxX: 0, minZ: 0, maxZ: 0, floor: 0, surface: 0};
  for (const k of nums) {
    const v = r[k];
    if (!finite(v)) fail(`${k} must be finite`);
    n[k] = v as number;
  }
  if (!(n.maxX > n.minX && n.maxZ > n.minZ && n.surface > n.floor)) fail('volume extents must be positive');
  const kind = r.kind;
  if (typeof kind !== 'string' || kind.length < 1 || kind.length > 64) fail('kind must be 1-64 characters');
  const priority = r.priority ?? 0,
    density = r.density ?? 1,
    drag = r.drag ?? 0,
    enabled = r.enabled ?? true;
  if (!Number.isSafeInteger(priority)) fail('priority must be an integer');
  if (!finite(density) || density < 0) fail('density must be finite and nonnegative');
  if (!finite(drag) || drag < 0) fail('drag must be finite and nonnegative');
  if (typeof enabled !== 'boolean') fail('enabled must be a boolean');
  return Object.freeze({
    id,
    ...n,
    kind: kind as string,
    priority: priority as number,
    density: density as number,
    drag: drag as number,
    current: r.current === undefined ? (Object.freeze([0, 0, 0]) as MediumVec3) : vec(r.current, 'current'),
    enabled: enabled as boolean,
  });
}

function sample(input: ActorSample): ActorSample {
  if (typeof input !== 'object' || input === null) return fail('sample must be an object');
  const {x, y, z, height} = input;
  if (!finite(x) || !finite(y) || !finite(z)) return fail('sample position must be finite');
  if (!finite(height) || height <= 0) return fail('sample height must be positive');
  return {x, y, z, height};
}

/** A bounded, creator-owned set of medium volumes. */
export function createMediumVolumes(options: {readonly maxVolumes: number}) {
  if (typeof options !== 'object' || options === null) fail('options must be an object');
  const maxVolumes = options.maxVolumes;
  if (!Number.isSafeInteger(maxVolumes) || maxVolumes < 1 || maxVolumes > MEDIUM_LIMITS.maxVolumes)
    fail('maxVolumes must be an integer from 1 to 4096');
  const volumes = new Map<number, Volume>();
  let revision = 0;
  const probe = (input: ActorSample): Probe => {
    const s = sample(input);
    let best: Volume | null = null;
    for (const v of volumes.values()) {
      if (!v.enabled || s.x < v.minX || s.x >= v.maxX || s.z < v.minZ || s.z >= v.maxZ) continue;
      if (s.y >= v.surface || s.y + s.height <= v.floor) continue;
      if (
        !best ||
        v.priority > best.priority ||
        (v.priority === best.priority && (v.surface > best.surface || (v.surface === best.surface && v.id < best.id)))
      )
        best = v;
    }
    if (!best) return Object.freeze({volume: null, depth: 0, headDepth: 0, submerged: 0});
    const top = Math.min(s.y + s.height, best.surface),
      bottom = Math.max(s.y, best.floor);
    return Object.freeze({
      volume: best,
      depth: best.surface - bottom,
      headDepth: best.surface - (s.y + s.height),
      // Exactly 1 whenever the whole body is inside, regardless of rounding in the division.
      submerged:
        s.y + s.height <= best.surface && s.y >= best.floor ? 1 : Math.min(1, Math.max(0, (top - bottom) / s.height)),
    });
  };
  return {
    get size() {
      return volumes.size;
    },
    /** Increments on every accepted change (for creator caches; the tracker re-probes every update). */
    get revision() {
      return revision;
    },
    /** Add or replace a volume (moving platforms, tides: call again with new heights). */
    set(id: number, input: VolumeInput): Volume {
      if (!Number.isSafeInteger(id) || id < 0) fail('id must be a nonnegative integer');
      const v = captureVolume(id + 0, input);
      if (!volumes.has(id) && volumes.size >= maxVolumes) fail('volume capacity reached');
      volumes.set(id, v);
      revision++;
      return v;
    },
    remove(id: number): boolean {
      const removed = volumes.delete(id);
      if (removed) revision++;
      return removed;
    },
    get(id: number): Volume | null {
      return volumes.get(id) ?? null;
    },
    /** The medium around a body whose feet are at (x, y, z), `height` tall. O(volumes). */
    probe,
  };
}
export type MediumVolumes = ReturnType<typeof createMediumVolumes>;

/**
 * Per-actor medium state with hysteresis and enter/exit/state events. `under` (head below the surface) also has
 * hysteresis: entered at headDepth >= hysteresis, left below headDepth < -hysteresis.
 * A wade/swim threshold needs `depth >= threshold + hysteresis` to deepen and `depth < threshold - hysteresis` to
 * shallow.
 */
export function createMediumTracker(volumes: MediumVolumes, options: TrackerOptions) {
  if (typeof options !== 'object' || options === null) fail('options must be an object');
  const {maxActors, wadeDepth, swimDepth} = options;
  const hysteresis = options.hysteresis ?? 0.05;
  if (!Number.isSafeInteger(maxActors) || maxActors < 1 || maxActors > MEDIUM_LIMITS.maxActors)
    fail('maxActors must be an integer from 1 to 65536');
  if (!finite(wadeDepth) || !finite(swimDepth) || !(wadeDepth > 0 && swimDepth > wadeDepth))
    fail('0 < wadeDepth < swimDepth is required');
  if (!finite(hysteresis) || hysteresis < 0 || hysteresis * 2 >= swimDepth - wadeDepth || hysteresis >= wadeDepth)
    fail('hysteresis must be nonnegative and smaller than the gaps between thresholds');
  const actors = new Map<number, {state: MediumState; volume: number | null; kind?: string | undefined}>();
  const rank: Record<MediumState, number> = {dry: 0, wade: 1, swim: 2, under: 3};
  const levels: readonly MediumState[] = ['dry', 'wade', 'swim'];
  /**
   * Each threshold is crossed upward only at `threshold + hysteresis` and back only below `threshold - hysteresis`,
   * depending on which side the actor was on last update.
   */
  const classify = (p: Probe, previous: MediumState): MediumState => {
    if (!p.volume) return 'dry';
    if (previous === 'under' ? p.headDepth >= -hysteresis : p.headDepth >= hysteresis) return 'under';
    const prev = Math.min(rank[previous], 2);
    let level = 0;
    for (const [threshold, at] of [
      [wadeDepth, 1],
      [swimDepth, 2],
    ] as const)
      if (prev >= at ? p.depth >= threshold - hysteresis : p.depth >= threshold + hysteresis) level = at;
    return levels[level]!;
  };
  return {
    get size() {
      return actors.size;
    },
    /**
     * Update one actor from its feet sample; returns this actor's events (exit before enter when it changes
     * volume, then a state change). The first update of a new actor reports enter and state from 'dry'.
     */
    update(
      actor: number,
      input: ActorSample,
    ): {readonly state: MediumState; readonly probe: Probe; readonly events: readonly MediumEvent[]} {
      if (!Number.isSafeInteger(actor) || actor < 0) fail('actor must be a nonnegative integer');
      const s = sample(input);
      let record = actors.get(actor);
      if (!record) {
        if (actors.size >= maxActors) fail('actor capacity reached');
        record = {state: 'dry', volume: null};
      }
      const p = volumes.probe(s);
      const state = classify(p, record.state);
      const events: MediumEvent[] = [];
      const volume = p.volume?.id ?? null;
      const kind = p.volume?.kind;
      if (volume !== record.volume || (volume !== null && record.kind !== undefined && kind !== record.kind)) {
        if (record.volume !== null) events.push(Object.freeze({kind: 'exit', actor, volume: record.volume}));
        if (volume !== null) events.push(Object.freeze({kind: 'enter', actor, volume}));
      }
      if (state !== record.state) events.push(Object.freeze({kind: 'state', actor, from: record.state, to: state}));
      record.state = state;
      record.volume = volume;
      record.kind = kind;
      actors.set(actor, record);
      return Object.freeze({state, probe: p, events: Object.freeze(events)});
    },
    state(actor: number): MediumState {
      return actors.get(actor)?.state ?? 'dry';
    },
    /** Forget an actor; reports its exit if it was in a volume. */
    remove(actor: number): readonly MediumEvent[] {
      const r = actors.get(actor);
      if (!r) return Object.freeze([]);
      actors.delete(actor);
      return Object.freeze(
        r.volume === null ? [] : [Object.freeze({kind: 'exit', actor, volume: r.volume}) as MediumEvent],
      );
    },
    snapshot(): {
      readonly v: 1;
      readonly actors: readonly {
        readonly actor: number;
        readonly state: MediumState;
        readonly volume: number | null;
        readonly kind?: string | undefined;
      }[];
    } {
      return Object.freeze({
        v: 1 as const,
        actors: Object.freeze(
          [...actors.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([actor, r]) =>
              Object.freeze(
                r.kind === undefined
                  ? {actor, state: r.state, volume: r.volume}
                  : {actor, state: r.state, volume: r.volume, kind: r.kind},
              ),
            ),
        ),
      });
    },
    restore(snapshot: {
      readonly v: 1;
      readonly actors: readonly {
        readonly actor: number;
        readonly state: MediumState;
        readonly volume: number | null;
        readonly kind?: string | undefined;
      }[];
    }): void {
      if (typeof snapshot !== 'object' || snapshot === null || snapshot.v !== 1) fail('snapshot must be v1');
      const list: unknown = snapshot.actors;
      if (!Array.isArray(list)) return fail('snapshot actors must be an array');
      const count = list.length;
      if (count > maxActors) fail('snapshot exceeds maxActors');
      const next = new Map<number, {state: MediumState; volume: number | null; kind?: string | undefined}>();
      for (let i = 0; i < count; i++) {
        const item: unknown = list[i];
        if (typeof item !== 'object' || item === null) return fail('snapshot actor must be an object');
        const r: Record<string, unknown> = {...item};
        const actor = r.actor,
          state = r.state,
          volume = r.volume;
        if (!Number.isSafeInteger(actor) || (actor as number) < 0 || next.has(actor as number))
          fail('invalid actor id');
        if (typeof state !== 'string' || !Object.hasOwn(rank, state)) fail('invalid state');
        if (volume !== null && (!Number.isSafeInteger(volume) || (volume as number) < 0)) fail('invalid volume id');
        if (state !== 'dry' && volume === null) fail('a wet state needs a volume');
        const kind = r.kind;
        if (kind !== undefined && (typeof kind !== 'string' || kind.length < 1 || kind.length > 64))
          fail('invalid kind');
        next.set(actor as number, {
          state: state as MediumState,
          volume: volume as number | null,
          kind: kind as string | undefined,
        });
      }
      actors.clear();
      for (const [k, v] of next) actors.set(k, v);
    },
  };
}
export type MediumTracker = ReturnType<typeof createMediumTracker>;

/**
 * Accelerations a medium applies to a body this step (add to the creator's own gravity and controls):
 * buoyancy = gravity * density * submerged upward (with gravity > 0 along -y, density 1 fully submerged cancels
 * gravity); drag = -drag * submerged * (velocity - current). Zero outside a medium.
 */
export function mediumAcceleration(input: {
  readonly probe: Probe;
  readonly velocity: MediumVec3;
  readonly gravity: number;
}): MediumVec3 {
  if (typeof input !== 'object' || input === null) fail('input must be an object');
  const {probe} = input;
  const v = vec(input.velocity, 'velocity');
  const g = input.gravity;
  if (!finite(g) || g < 0) fail('gravity must be finite and nonnegative');
  const vol = probe?.volume;
  if (!vol) return Object.freeze([0, 0, 0]) as MediumVec3;
  const {drag, density} = vol;
  if (!finite(drag) || drag < 0 || !finite(density) || density < 0)
    fail('probe volume drag and density must be finite and nonnegative');
  const current = vec(vol.current, 'probe volume current');
  const f = probe.submerged;
  if (!finite(f) || f < 0 || f > 1) fail('probe.submerged must be in [0, 1]');
  const k = drag * f;
  return Object.freeze([
    -k * (v[0] - current[0]),
    g * density * f - k * (v[1] - current[1]),
    -k * (v[2] - current[2]),
  ]) as MediumVec3;
}
