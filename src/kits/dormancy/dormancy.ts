/**
 * kits/dormancy/dormancy.ts: which tracked entities are dormant (not updated, optionally hidden) because they are
 * outside every active zone and outside every view volume, and which wake again.
 *
 * Each entity has a policy: `always` (never dormant), `zone` (awake while any of its zones is active), `view` (awake
 * while inside a camera-relative view volume) or `zone-or-view` (either). Zone ids are small integers the creator
 * assigns (for example region indices from the region-activation kit, or authored zone numbers); the active zones are
 * an input each step. A view volume is a plan-view frustum in front of a camera plus a box behind it, with optional
 * vertical bounds. Hysteresis has two parts: a dormant entity queues to wake inside the wake volume (grown by
 * `wakeMargin`) and stays queued while inside the sleep volume; an awake one stays awake until it leaves the sleep
 * volume (grown by the wider `sleepMargin`); and minimum dwell ticks keep an entity
 * awake (or dormant) for a number of steps after each transition. Wakes per step are bounded: entities that want to
 * wake beyond the budget wait in a first-in-first-out queue (ties in track order), so the wait is bounded by
 * `maxWakeLatency` steps while they keep wanting (a queued entity is judged against the wider sleep volume, so the
 * bound restarts only on a real withdrawal). Sleeps are not budgeted (they reduce work). Two documented exceptions
 * bypass the budget: `always` entities (including a policy change to `always`) and `initial: 'awake'` tracking.
 *
 * Pure bounded state: no clock, renderer, scheduler, ECS access or randomness. Time is the caller's step count.
 */

import {platformMath, type ScalarMath} from '../../core/dmath';

export type DormancyPolicy = 'always' | 'zone' | 'view' | 'zone-or-view';

export interface DormancyLimits {
  /** Zone id space: ids are integers in [0, zones). Default 256, at most 4,194,304. */
  readonly zones?: number;
  /** Default 4,096, at most 65,536. */
  readonly maxEntities?: number;
  /** Zones one entity may belong to (doorways, overlaps). Default 4, 1-16. */
  readonly maxZonesPerEntity?: number;
  /** Wakes applied per step; the rest are queued. Default 32, 1-maxEntities. */
  readonly maxWakesPerStep?: number;
  /** View volumes per step (split views, a second camera). Default 2, 1-8. */
  readonly maxViews?: number;
  /** A dormant entity queues to wake inside the volume grown by this distance. Default 0, within [0, 1e6]. */
  readonly wakeMargin?: number;
  /**
   * An awake entity stays awake, and a queued one stays queued, inside the volume grown by this distance. Default
   * wakeMargin; >= wakeMargin.
   */
  readonly sleepMargin?: number;
  /** Steps an entity stays awake after waking before it may sleep. Default 8, 0-10,000. */
  readonly minAwakeSteps?: number;
  /** Steps an entity stays dormant after sleeping before it may queue to wake. Default 0, 0-10,000. */
  readonly minDormantSteps?: number;
  /**
   * Evaluates the view trigonometry (sin, cos, sqrt). Default `platformMath`; pass the engine's `dmath` for view
   * membership identical in every JavaScript engine.
   */
  readonly math?: ScalarMath;
}

/** Hard ceilings of this implementation. */
export const DORMANCY_CEILING = Object.freeze({
  zones: 1 << 22,
  entities: 65536,
  zonesPerEntity: 16,
  views: 8,
  dwellSteps: 10000,
  distance: 1e6,
  extent: 1e7,
  spread: 100,
});

/**
 * A camera-relative view volume. The camera sits at (x, z) looking along −(sin yaw, cos yaw), the engine camera
 * convention (an orbit pose at yaw 0 sits on +z of its target and looks toward −z). In front, a frustum in plan view reaches `far` with half width `halfWidth + spread × forward distance`;
 * behind, a box of half width `halfWidth` reaches `behind`. With `y` set, `up` and `down` bound heights relative to
 * it (entities without a height skip the vertical test).
 */
export interface ViewVolume {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly far: number;
  readonly halfWidth: number;
  readonly behind?: number;
  readonly spread?: number;
  readonly y?: number;
  readonly up?: number;
  readonly down?: number;
}

export interface DormancyPosition {
  readonly x: number;
  readonly z: number;
  readonly y?: number;
}

export interface DormancyStepInput {
  /** Active zone ids this step (duplicates allowed). Default none. */
  readonly activeZones?: ArrayLike<number>;
  /** View volumes this step. Default none: view-bound entities count as outside. */
  readonly views?: readonly ViewVolume[];
  /**
   * Position of a tracked entity, or null (counts as outside every view). Called only for view-bound entities when
   * at least one view is given, before anything changes. Must not track, untrack or step.
   */
  readonly position?: (id: number) => DormancyPosition | null;
}

export interface DormancyTrackOptions {
  readonly policy: DormancyPolicy;
  /** Zones this entity belongs to (at most maxZonesPerEntity). Default none. */
  readonly zones?: readonly number[];
  /** Bounding radius added to both margins. Default 0, within [0, 1e6]. */
  readonly radius?: number;
  /** Report the entity hidden while dormant (`hidden(id)`). Default false. */
  readonly hide?: boolean;
  /** Start dormant (default: the first step decides, within the wake budget) or awake. Dwell starts satisfied. */
  readonly initial?: 'dormant' | 'awake';
}

/**
 * - `complete`: every entity that wanted to wake was woken.
 * - `deferred`: the wake budget left entities queued (`deferred` > 0); they keep their place.
 */
export type DormancyStatus = 'complete' | 'deferred';

export interface DormancyStep {
  readonly status: DormancyStatus;
  /** Step ordinal (1 for the first step). */
  readonly step: number;
  /** Entities woken this step, in queue order (first queued first, ties in track order). */
  readonly woke: readonly number[];
  /** For each woken entity: steps it was dormant, or -1 if it had never been awake. */
  readonly dormantSteps: readonly number[];
  /** Entities put to sleep this step, in track order. */
  readonly slept: readonly number[];
  /** Entities still queued to wake after this step's budget. */
  readonly deferred: number;
  /** Queued entities removed this step because they no longer wanted to wake. */
  readonly withdrawn: number;
  /** Longest wait, in steps, of any entity still queued (0 when none). */
  readonly oldestWait: number;
  readonly awake: number;
  readonly dormant: number;
}

export interface DormancyStats {
  readonly steps: number;
  readonly tracked: number;
  readonly awake: number;
  readonly dormant: number;
  readonly queued: number;
  /** Queued entities dropped because they were untracked while waiting (since creation). */
  readonly cancelled: number;
}

export type DormancyState = 'awake' | 'dormant' | 'queued';

function fail(message: string): never {
  throw new RangeError(`dormancy: ${message}`);
}
const isInt = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;
const isNum = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;

const POLICIES: readonly DormancyPolicy[] = ['always', 'zone', 'view', 'zone-or-view'];

interface Entry {
  policy: DormancyPolicy;
  zones: readonly number[];
  radius: number;
  hide: boolean;
  awake: boolean;
  everAwake: boolean;
  /** Steps in the current state. */
  steps: number;
}

interface View {
  x: number;
  z: number;
  sin: number;
  cos: number;
  far: number;
  behind: number;
  halfWidth: number;
  spread: number;
  /** sqrt(1 + spread²): a margin perpendicular to a slanted side, measured along the lateral axis. */
  lateral: number;
  vertical: boolean;
  y: number;
  up: number;
  down: number;
}

interface Trig {
  readonly sin: (x: number) => number;
  readonly cos: (x: number) => number;
  readonly sqrt: (x: number) => number;
}

function readView(v: ViewVolume, math: Trig): View {
  if (v === null || typeof v !== 'object') fail('a view volume must be an object');
  const {x, z, yaw, far, halfWidth} = v;
  const behind = v.behind ?? 0,
    spread = v.spread ?? 0,
    y = v.y,
    up = v.up,
    down = v.down;
  const E = DORMANCY_CEILING.extent;
  if (!isNum(x, -E, E) || !isNum(z, -E, E)) fail('view position must be finite within ±1e7');
  if (!isNum(yaw, -1e6, 1e6)) fail('view yaw must be finite');
  if (!isNum(far, 0, E) || far === 0) fail('view far must be within (0, 1e7]');
  if (!isNum(behind, 0, E)) fail('view behind must be within [0, 1e7]');
  if (!isNum(halfWidth, 0, E)) fail('view halfWidth must be within [0, 1e7]');
  if (!isNum(spread, 0, DORMANCY_CEILING.spread)) fail('view spread must be within [0, 100]');
  if (halfWidth === 0 && spread === 0) fail('degenerate view volume: halfWidth and spread are both 0');
  const vertical = y !== undefined;
  if (vertical) {
    if (!isNum(y, -E, E)) fail('view y must be finite within ±1e7');
    if (!isNum(up, 0, E) || !isNum(down, 0, E)) fail('a view with y needs up and down within [0, 1e7]');
    if (up + down === 0) fail('degenerate view volume: up and down are both 0');
  } else if (up !== undefined || down !== undefined) fail('view up and down need y');
  const sin = math.sin(yaw),
    cos = math.cos(yaw),
    lateral = math.sqrt(1 + spread * spread);
  if (!Number.isFinite(sin) || !Number.isFinite(cos) || !Number.isFinite(lateral))
    fail('the math functions returned a non-finite value for this view');
  return {
    x,
    z,
    sin,
    cos,
    lateral,
    far,
    behind,
    halfWidth,
    spread,
    vertical,
    y: vertical ? y : 0,
    up: vertical ? up! : 0,
    down: vertical ? down! : 0,
  };
}

/**
 * Whether a point lies inside a view volume grown by `m`. Engine camera convention: a view at `yaw` looks along
 * −(sin yaw, cos yaw), as the camera kit's orbit pose and the character kit's rig yaw do. Forward and vertical
 * margins are along the camera's axes; ahead of the camera the lateral margin is scaled by sqrt(1 + spread²) so it is at
 * least `m` perpendicular to a slanted side; the box behind takes the plain margin.
 */
function inside(v: View, px: number, py: number | undefined, pz: number, m: number): boolean {
  const dx = px - v.x,
    dz = pz - v.z;
  const f = -(dx * v.sin + dz * v.cos),
    s = dx * v.cos - dz * v.sin;
  if (f < -v.behind - m || f > v.far + m) return false;
  // Ahead, the sides slant: scale the margin so it is at least `m` perpendicular to them. Behind, the box's sides are
  // parallel to the view axis and take the plain margin.
  const lat = f > 0 ? m * v.lateral : m;
  const w = v.halfWidth + v.spread * Math.min(Math.max(f, 0), v.far) + lat;
  if (s < -w || s > w) return false;
  if (v.vertical && py !== undefined) {
    const dy = py - v.y;
    if (dy < -v.down - m || dy > v.up + m) return false;
  }
  return true;
}

export function createDormancy(limits: DormancyLimits = {}) {
  if (limits === null || typeof limits !== 'object') fail('limits must be an object');
  const zones = limits.zones ?? 256,
    maxEntities = limits.maxEntities ?? 4096,
    maxZonesPerEntity = limits.maxZonesPerEntity ?? 4,
    maxViews = limits.maxViews ?? 2,
    wakeMargin = limits.wakeMargin ?? 0,
    sleepMargin = limits.sleepMargin ?? wakeMargin,
    minAwakeSteps = limits.minAwakeSteps ?? 8,
    minDormantSteps = limits.minDormantSteps ?? 0,
    math = limits.math ?? platformMath;
  if (
    math === null ||
    typeof math !== 'object' ||
    typeof math.sin !== 'function' ||
    typeof math.cos !== 'function' ||
    typeof math.sqrt !== 'function'
  )
    fail('math must provide sin, cos and sqrt');
  // Captured once: later changes to the caller's math object do not affect this instance.
  const trig: Trig = Object.freeze({sin: math.sin, cos: math.cos, sqrt: math.sqrt});
  const C = DORMANCY_CEILING;
  if (!isInt(zones, 1, C.zones)) fail(`zones must be an integer in [1, ${C.zones}]`);
  if (!isInt(maxEntities, 1, C.entities)) fail(`maxEntities must be an integer in [1, ${C.entities}]`);
  const maxWakesPerStep = limits.maxWakesPerStep ?? Math.min(32, maxEntities);
  if (!isInt(maxZonesPerEntity, 1, C.zonesPerEntity))
    fail(`maxZonesPerEntity must be an integer in [1, ${C.zonesPerEntity}]`);
  if (!isInt(maxWakesPerStep, 1, maxEntities)) fail('maxWakesPerStep must be an integer in [1, maxEntities]');
  if (!isInt(maxViews, 1, C.views)) fail(`maxViews must be an integer in [1, ${C.views}]`);
  if (!isNum(wakeMargin, 0, C.distance)) fail('wakeMargin must be within [0, 1e6]');
  if (!isNum(sleepMargin, wakeMargin, C.distance)) fail('sleepMargin must be within [wakeMargin, 1e6]');
  if (!isInt(minAwakeSteps, 0, C.dwellSteps)) fail(`minAwakeSteps must be an integer in [0, ${C.dwellSteps}]`);
  if (!isInt(minDormantSteps, 0, C.dwellSteps)) fail(`minDormantSteps must be an integer in [0, ${C.dwellSteps}]`);
  /** A queued entity has at most maxEntities - 1 ahead of it and later arrivals queue behind it. */
  const maxWakeLatency = Math.floor((maxEntities - 1) / maxWakesPerStep);
  const frozenLimits = Object.freeze({
    zones,
    maxEntities,
    maxZonesPerEntity,
    maxWakesPerStep,
    maxViews,
    wakeMargin,
    sleepMargin,
    minAwakeSteps,
    minDormantSteps,
    maxWakeLatency,
  });

  const entries = new Map<number, Entry>();
  /** Wake queue: insertion order is queue order; the value is the step it was queued on. */
  const queue = new Map<number, number>();
  // Generation stamps: 4 bytes per zone. On wrap the table is cleared, so a stale stamp never matches.
  const zoneStamp = new Uint32Array(zones);
  let steps = 0,
    zoneGen = 0,
    awakeCount = 0,
    cancelled = 0,
    stepping = false;

  const checkId = (id: number) => {
    if (!isInt(id, 0, Number.MAX_SAFE_INTEGER)) fail('ids must be nonnegative safe integers');
  };
  const checkPolicy = (p: unknown): DormancyPolicy => {
    if (!POLICIES.includes(p as DormancyPolicy)) fail('unknown policy');
    return p as DormancyPolicy;
  };
  const readZones = (input: readonly number[] | undefined): readonly number[] => {
    if (input === undefined) return Object.freeze([]);
    if (!Array.isArray(input)) fail('zones must be an array');
    const n = input.length;
    if (n > maxZonesPerEntity) fail(`an entity belongs to at most ${maxZonesPerEntity} zones`);
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      const r: unknown = input[k];
      if (!isInt(r, 0, zones - 1)) fail(`unknown zone id ${String(r)}: zone ids are integers in [0, ${zones - 1}]`);
      out.push(r);
    }
    return Object.freeze(out);
  };
  const guard = () => {
    if (stepping) fail('the position callback must not track, untrack, change or step');
  };

  return {
    limits: frozenLimits,
    /** Start tracking an entity. Refusals: `duplicate`, `full`. Malformed options throw before any change. */
    track(id: number, options: DormancyTrackOptions): 'tracked' | 'duplicate' | 'full' {
      guard();
      checkId(id);
      if (options === null || typeof options !== 'object') fail('track options must be an object');
      const policy = checkPolicy(options.policy);
      const zoneList = readZones(options.zones);
      const radius = options.radius ?? 0,
        hide = options.hide ?? false,
        initial = options.initial ?? 'dormant';
      if (!isNum(radius, 0, C.distance)) fail('radius must be within [0, 1e6]');
      if (typeof hide !== 'boolean') fail('hide must be a boolean');
      if (initial !== 'dormant' && initial !== 'awake') fail("initial must be 'dormant' or 'awake'");
      if (entries.has(id)) return 'duplicate';
      if (entries.size >= maxEntities) return 'full';
      const awake = policy === 'always' || initial === 'awake';
      entries.set(id, {
        policy,
        zones: zoneList,
        radius,
        hide,
        awake,
        everAwake: awake,
        steps: awake ? minAwakeSteps : minDormantSteps,
      });
      if (awake) awakeCount++;
      return 'tracked';
    },
    /** Stop tracking. A queued entity leaves the queue (counted in `cancelled`). */
    untrack(id: number): 'untracked' | 'absent' {
      guard();
      checkId(id);
      const e = entries.get(id);
      if (!e) return 'absent';
      if (queue.delete(id)) cancelled++;
      if (e.awake) awakeCount--;
      entries.delete(id);
      return 'untracked';
    },
    /** Change an entity's policy; it takes effect at the next step (an `always` entity wakes there unbudgeted). */
    setPolicy(id: number, policy: DormancyPolicy): boolean {
      guard();
      checkId(id);
      const p = checkPolicy(policy);
      const e = entries.get(id);
      if (!e) return false;
      e.policy = p;
      return true;
    },
    /** Replace an entity's zones (it moved through a doorway); takes effect at the next step. */
    setZones(id: number, zoneIds: readonly number[]): boolean {
      guard();
      checkId(id);
      const list = readZones(zoneIds);
      const e = entries.get(id);
      if (!e) return false;
      e.zones = list;
      return true;
    },
    /**
     * Decide one step. All input is validated and every position read before anything changes: a throw leaves the
     * state untouched. Call once per fixed step before the systems that consult `isAwake`.
     */
    step(input: DormancyStepInput = {}): DormancyStep {
      guard();
      if (input === null || typeof input !== 'object') fail('step input must be an object');
      const activeIn = input.activeZones ?? [],
        viewsIn = input.views ?? [],
        position = input.position;
      if (activeIn === null || typeof activeIn !== 'object' || !isInt(activeIn.length, 0, C.zones))
        fail('activeZones must be array-like');
      const activeCount = activeIn.length;
      const active: number[] = [];
      for (let k = 0; k < activeCount; k++) {
        const r: unknown = activeIn[k];
        if (!isInt(r, 0, zones - 1))
          fail(`unknown active zone id ${String(r)}: zone ids are integers in [0, ${zones - 1}]`);
        active.push(r);
      }
      if (!Array.isArray(viewsIn)) fail('views must be an array');
      const viewCount = viewsIn.length;
      if (viewCount > maxViews) fail(`at most ${maxViews} view volumes`);
      const views: View[] = [];
      for (let k = 0; k < viewCount; k++) {
        if (!(k in viewsIn)) fail('views must not have holes');
        views.push(readView(viewsIn[k]!, trig));
      }
      if (position !== undefined && typeof position !== 'function') fail('position must be a function');
      const list = [...entries];
      // Zone wants first (no callbacks), then positions only where the view decides.
      const stamp = steps + 1;
      // Every attempt gets a fresh zone generation, so stamps left by a refused step (a throwing callback) never count.
      if (zoneGen === 0xffffffff) {
        zoneStamp.fill(0);
        zoneGen = 0;
      }
      const gen = ++zoneGen;
      for (const r of active) zoneStamp[r] = gen;
      const zoneWant = list.map(
        ([, e]) => (e.policy === 'zone' || e.policy === 'zone-or-view') && e.zones.some(r => zoneStamp[r] === gen),
      );
      const positions: (DormancyPosition | null)[] = new Array<DormancyPosition | null>(list.length).fill(null);
      if (views.length > 0) {
        if (position === undefined && list.some(([, e]) => e.policy === 'view' || e.policy === 'zone-or-view'))
          fail('position is required when views are given and view-bound entities are tracked');
        stepping = true;
        try {
          list.forEach(([id, e], k) => {
            if (!(e.policy === 'view' || (e.policy === 'zone-or-view' && !zoneWant[k]))) return;
            const p = position!(id);
            if (p === null) return;
            if (typeof p !== 'object') fail('positions must be objects or null');
            const x = p.x,
              z = p.z,
              y = p.y;
            if (!Number.isFinite(x) || !Number.isFinite(z)) fail('positions must be finite');
            if (y !== undefined && !Number.isFinite(y)) fail('position y must be finite when given');
            positions[k] = y === undefined ? {x, z} : {x, z, y};
          });
        } finally {
          stepping = false;
        }
      }
      // Commit.
      steps = stamp;
      const woke: number[] = [],
        dormantSteps: number[] = [],
        slept: number[] = [];
      let withdrawn = 0;
      const wake = (id: number, e: Entry) => {
        woke.push(id);
        dormantSteps.push(e.everAwake ? e.steps : -1);
        e.awake = true;
        e.everAwake = true;
        e.steps = 0;
        awakeCount++;
      };
      list.forEach(([id, e], k) => {
        if (e.policy === 'always') {
          if (!e.awake) {
            queue.delete(id);
            wake(id, e);
          } else e.steps++;
          return;
        }
        // Awake and already-queued entities are judged against the wider sleep volume: jitter at the wake edge then
        // neither sleeps an awake entity nor withdraws a queued one (which would send it to the back of the queue).
        const margin = (e.awake || queue.has(id) ? sleepMargin : wakeMargin) + e.radius;
        const p = positions[k];
        const want =
          zoneWant[k]! || (p !== null && p !== undefined && views.some(v => inside(v, p.x, p.y, p.z, margin)));
        e.steps++;
        if (e.awake) {
          if (!want && e.steps >= minAwakeSteps) {
            e.awake = false;
            e.steps = 0;
            awakeCount--;
            slept.push(id);
          }
        } else if (!want) {
          if (queue.delete(id)) withdrawn++;
        } else if (e.steps >= minDormantSteps && !queue.has(id)) queue.set(id, stamp);
      });
      let budget = maxWakesPerStep;
      const take: number[] = [];
      for (const id of queue.keys()) {
        if (budget-- === 0) break;
        take.push(id);
      }
      for (const id of take) {
        queue.delete(id);
        wake(id, entries.get(id)!);
      }
      let oldestWait = 0;
      for (const queuedAt of queue.values()) {
        oldestWait = stamp - queuedAt;
        break;
      }
      return Object.freeze({
        status: queue.size > 0 ? 'deferred' : 'complete',
        step: stamp,
        woke: Object.freeze(woke),
        dormantSteps: Object.freeze(dormantSteps),
        slept: Object.freeze(slept),
        deferred: queue.size,
        withdrawn,
        oldestWait,
        awake: awakeCount,
        dormant: entries.size - awakeCount,
      });
    },
    /** Whether to update `id` this step. Untracked ids are awake: dormancy never freezes unknown entities. */
    isAwake(id: number): boolean {
      checkId(id);
      return entries.get(id)?.awake ?? true;
    },
    /** True only for a tracked, dormant entity tracked with `hide`. */
    isHidden(id: number): boolean {
      checkId(id);
      const e = entries.get(id);
      return e !== undefined && e.hide && !e.awake;
    },
    state(id: number): DormancyState | null {
      checkId(id);
      const e = entries.get(id);
      if (!e) return null;
      return e.awake ? 'awake' : queue.has(id) ? 'queued' : 'dormant';
    },
    policy(id: number): DormancyPolicy | null {
      checkId(id);
      return entries.get(id)?.policy ?? null;
    },
    stats(): DormancyStats {
      return Object.freeze({
        steps,
        tracked: entries.size,
        awake: awakeCount,
        dormant: entries.size - awakeCount,
        queued: queue.size,
        cancelled,
      });
    },
  };
}
export type Dormancy = ReturnType<typeof createDormancy>;

/**
 * Feed dormancy into the population kit's update tiers: wrap the tiers' position callback so a dormant entity reads
 * as far (null). A `near` tier entity is then frozen while dormant (its time is discarded; the wake event's
 * `dormantSteps` lets the creator catch up); a `background` tier entity keeps its round-robin slices at reduced rate
 * with time conserved; an `always` tier entity ignores positions and therefore dormancy. Call `dormancy.step` before
 * `tiers.step` in the same fixed step.
 */
export function dormantAsFar<P>(dormancy: Pick<Dormancy, 'isAwake'>, position: (id: number) => P | null) {
  return (id: number): P | null => (dormancy.isAwake(id) ? position(id) : null);
}
