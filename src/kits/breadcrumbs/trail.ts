/**
 * Breadcrumb trails: a leader records where it has been in a bounded ring; followers retrace that exact path at a
 * sample lag or a path distance behind. Pure owner of its own ring; no clock, entity, renderer or scheduler.
 * Call `record` from the creator's fixed-step system so trails replay identically.
 */

/** One recorded leader state. `flags` is a creator-defined bit set (e.g. swimming, hanging, on a lower layer). */
export interface Crumb {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly flags: number;
}

/** Input to `record`: `flags` defaults to 0. */
export type CrumbInput = Omit<Crumb, 'flags'> & {readonly flags?: number};

export type RecordPolicy =
  /** Record every call (a tick-delay follower: lag N is exactly N ticks behind). */
  | {readonly mode: 'every-tick'}
  /** Record only once the leader has moved at least `minDistance` from the last crumb (followers wait when it stops). */
  | {readonly mode: 'moved'; readonly minDistance: number};

export interface TrailOptions {
  /** Ring size, 2 to 65536 crumbs. Older crumbs are overwritten. */
  readonly capacity: number;
  readonly record: RecordPolicy;
}

export interface TrailSnapshot {
  readonly v: 1;
  readonly capacity: number;
  /** Oldest first. */
  readonly crumbs: readonly Crumb[];
  /** Number of crumbs, counted from the newest, that belong to the current unbroken segment. */
  readonly segment: number;
  readonly revision: number;
}

export interface BreadcrumbTrail {
  /** Crumbs currently held (at most capacity). */
  readonly size: number;
  /** Crumbs in the current segment (since the last `cut`), at most `size`. */
  readonly segment: number;
  /** Counts accepted changes (record, effective cut, clear); a restored trail keeps the snapshot's value. */
  readonly revision: number;
  /** Offer the leader's current state. `skipped` when the moved-policy distance was not reached. */
  record(crumb: CrumbInput): 'recorded' | 'skipped';
  /** The crumb `lag` records behind the newest (0 = newest), clamped to the oldest crumb of the current segment. */
  behind(lag: number): Crumb | null;
  /**
   * The point `distance` along the recorded path behind the newest crumb, interpolated between crumbs (heading
   * along the shorter arc, flags from the older crumb of the pair; at distance 0, the newest crumb itself).
   * Clamped to the oldest crumb of the current segment.
   */
  along(distance: number): Crumb | null;
  /** Start a new segment: queries never interpolate across a cut (use after a teleport or respawn). */
  cut(): void;
  /** Drop every crumb. */
  clear(): void;
  snapshot(): TrailSnapshot;
}

export const TRAIL_LIMITS = Object.freeze({maxCapacity: 65536, maxCoordinate: 1e9});

const fail = (message: string): never => {
  throw new RangeError(`breadcrumbs: ${message}`);
};
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= TRAIL_LIMITS.maxCoordinate;

function captureCrumb(value: unknown): Crumb {
  if (typeof value !== 'object' || value === null) return fail('crumb must be an object');
  const c = value as Record<string, unknown>;
  const x = c.x,
    y = c.y,
    z = c.z,
    heading = c.heading,
    flags = c.flags ?? 0;
  if (!finite(x) || !finite(y) || !finite(z) || !finite(heading))
    return fail('crumb x, y, z and heading must be finite');
  if (!Number.isSafeInteger(flags) || (flags as number) < 0 || (flags as number) > 0xffffffff)
    return fail('crumb flags must be an unsigned 32-bit integer');
  return Object.freeze({x: x + 0, y: y + 0, z: z + 0, heading: heading + 0, flags: flags as number});
}

function capturePolicy(value: unknown): RecordPolicy {
  if (typeof value !== 'object' || value === null) return fail('record policy must be an object');
  const p = value as Record<string, unknown>;
  const mode = p.mode;
  if (mode === 'every-tick') return Object.freeze({mode});
  if (mode === 'moved') {
    const minDistance = p.minDistance;
    if (!finite(minDistance) || minDistance <= 0) return fail('minDistance must be finite and positive');
    return Object.freeze({mode, minDistance});
  }
  return fail('record mode must be every-tick or moved');
}

function lerpAngle(from: number, to: number, f: number): number {
  const tau = Math.PI * 2;
  let d = (to - from) % tau;
  if (d > Math.PI) d -= tau;
  else if (d < -Math.PI) d += tau;
  return from + d * f;
}

export function createBreadcrumbTrail(options: TrailOptions, restore?: TrailSnapshot): BreadcrumbTrail {
  if (typeof options !== 'object' || options === null) fail('options must be an object');
  const capacity = options.capacity;
  if (!Number.isSafeInteger(capacity) || capacity < 2 || capacity > TRAIL_LIMITS.maxCapacity)
    fail('capacity must be an integer from 2 to 65536');
  const policy = capturePolicy(options.record);
  const ring: (Crumb | undefined)[] = new Array(capacity);
  let head = -1, // index of newest
    size = 0,
    segment = 0,
    revision = 0;

  if (restore !== undefined) {
    if (typeof restore !== 'object' || restore === null || restore.v !== 1)
      fail('snapshot must be a v1 trail snapshot');
    if (restore.capacity !== capacity) fail('snapshot capacity differs from the trail capacity');
    const crumbs = restore.crumbs;
    if (!Array.isArray(crumbs)) fail('snapshot crumbs must be an array');
    const count = crumbs.length;
    if (!Number.isSafeInteger(count) || count > capacity) fail('snapshot crumbs exceed the capacity');
    const captured: Crumb[] = [];
    for (let i = 0; i < count; i++) captured.push(captureCrumb(crumbs[i]));
    const seg = restore.segment,
      rev = restore.revision;
    if (!Number.isSafeInteger(seg) || seg < 0 || seg > captured.length) fail('snapshot segment out of range');
    if (!Number.isSafeInteger(rev) || rev < 0 || rev >= Number.MAX_SAFE_INTEGER)
      fail('snapshot revision must be a nonnegative integer below the safe-integer ceiling');
    captured.forEach((c, i) => (ring[i] = c));
    size = captured.length;
    head = size - 1;
    segment = seg;
    revision = rev;
  }

  const at = (lag: number) => ring[(((head - lag) % capacity) + capacity) % capacity]!;
  const bump = () => {
    if (revision >= Number.MAX_SAFE_INTEGER) fail('revision exhausted');
    revision++;
  };

  return {
    get size() {
      return size;
    },
    get segment() {
      return segment;
    },
    get revision() {
      return revision;
    },
    record(input) {
      const crumb = captureCrumb(input);
      if (policy.mode === 'moved' && segment > 0) {
        const last = at(0);
        if (Math.hypot(crumb.x - last.x, crumb.y - last.y, crumb.z - last.z) < policy.minDistance) return 'skipped';
      }
      bump();
      head = (head + 1) % capacity;
      ring[head] = crumb;
      size = Math.min(size + 1, capacity);
      segment = Math.min(segment + 1, capacity);
      return 'recorded';
    },
    behind(lag) {
      if (!Number.isSafeInteger(lag) || lag < 0) fail('lag must be a nonnegative integer');
      if (segment === 0) return null;
      return at(Math.min(lag, segment - 1));
    },
    along(distance) {
      if (!finite(distance) || distance < 0) fail('distance must be finite and nonnegative');
      if (segment === 0) return null;
      // Distance 0 (or a point reached inside a run of stationary crumbs) is the newest crumb there.
      if (distance === 0) return at(0);
      let remaining = distance;
      for (let lag = 0; lag < segment - 1; lag++) {
        const newer = at(lag),
          older = at(lag + 1);
        const length = Math.hypot(newer.x - older.x, newer.y - older.y, newer.z - older.z);
        if (length === 0) continue;
        if (remaining <= length) {
          const f = remaining / length; // 0 at newer, 1 at older
          return Object.freeze({
            x: newer.x + (older.x - newer.x) * f,
            y: newer.y + (older.y - newer.y) * f,
            z: newer.z + (older.z - newer.z) * f,
            heading: lerpAngle(newer.heading, older.heading, f),
            flags: f === 0 ? newer.flags : older.flags,
          });
        }
        remaining -= length;
      }
      return at(segment - 1);
    },
    cut() {
      if (segment === 0) return;
      bump();
      segment = 0;
    },
    clear() {
      bump();
      ring.fill(undefined);
      head = -1;
      size = 0;
      segment = 0;
    },
    snapshot() {
      const crumbs: Crumb[] = [];
      for (let lag = size - 1; lag >= 0; lag--) crumbs.push(at(lag));
      return Object.freeze({v: 1, capacity, crumbs: Object.freeze(crumbs), segment, revision});
    },
  };
}

/**
 * Optional lag controller for a sample-lag follower, as in classic party followers. Lag counts crumbs behind the
 * newest. When the trail recorded a crumb this tick, a follower closer than `movingLag` waits on its crumb (lag
 * grows by one), one at `movingLag` steps forward with the leader, and one farther back closes in one crumb. When nothing was recorded (the leader is
 * still) it closes in by one crumb every `catchUpEvery` ticks until `idleLag`. Pure: returns the next lag.
 * `tick` is the caller's fixed-step tick counter.
 */
export function nextFollowerLag(
  lag: number,
  input: {
    readonly recorded: boolean;
    readonly movingLag: number;
    readonly idleLag: number;
    readonly catchUpEvery: number;
    readonly tick: number;
  },
): number {
  const {recorded, movingLag, idleLag, catchUpEvery, tick} = input;
  for (const [name, value] of [
    ['lag', lag],
    ['movingLag', movingLag],
    ['idleLag', idleLag],
    ['tick', tick],
  ] as const)
    if (!Number.isSafeInteger(value) || value < 0) fail(`${name} must be a nonnegative integer`);
  if (!Number.isSafeInteger(catchUpEvery) || catchUpEvery < 1) fail('catchUpEvery must be a positive integer');
  if (idleLag > movingLag) fail('idleLag must not exceed movingLag');
  if (typeof recorded !== 'boolean') fail('recorded must be a boolean');
  if (recorded) return lag > movingLag ? lag - 1 : Math.min(lag + 1, movingLag);
  if (lag > idleLag && tick % catchUpEvery === 0) return lag - 1;
  return lag;
}
