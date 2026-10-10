/**
 * Contact layer: simple volumes with layer and mask bits, exact overlap tests, and per-update enter/stay/exit pair
 * events in a deterministic order, with bounded pair and per-body admission. Pure owner of its bodies; the creator
 * moves them from a fixed-step system and calls `update()` once per step.
 */
export type ContactVec3 = readonly [number, number, number];

export type ContactShape =
  /** Vertical cylinder: `position` is the centre of the base; extends `height` upward. */
  | {readonly kind: 'cylinder'; readonly radius: number; readonly height: number}
  | {readonly kind: 'sphere'; readonly radius: number}
  /** Axis-aligned box centred on `position`. */
  | {readonly kind: 'box'; readonly halfExtents: ContactVec3};

export interface BodyInput {
  readonly shape: ContactShape;
  readonly position: ContactVec3;
  /** Layers this body is on (bit set, unsigned 32-bit). */
  readonly layer: number;
  /** Layers this body senses. A pair forms when either body senses the other's layer. */
  readonly mask: number;
  /** False: the body takes part in no pairs (intangible), e.g. during invulnerability. Default true. */
  readonly enabled?: boolean;
}

export interface ContactEvent {
  readonly kind: 'enter' | 'stay' | 'exit';
  /** Smaller id first. */
  readonly a: number;
  readonly b: number;
  /** Whether `a` senses `b`'s layer, and the reverse. For `exit` events: as of the last time they touched. */
  readonly aSenses: boolean;
  readonly bSenses: boolean;
  /** `exit` only: true when one of the bodies was removed or disabled rather than moved apart. */
  readonly removed?: boolean;
}

export interface ContactUpdate {
  /** Exits, then enters, then stays; each group ordered by (a, b). */
  readonly events: readonly ContactEvent[];
  /** Overlapping pairs refused this update because a bound was reached (they produce no events). */
  readonly refused: number;
  /** Pairs currently in contact. */
  readonly pairs: number;
}

export interface ContactOptions {
  /** 1 to 65536 bodies. */
  readonly maxBodies: number;
  /** Simultaneous pairs, 1 to 1,048,576. Pairs already in contact keep priority over new ones. */
  readonly maxPairs: number;
  /** Simultaneous pairs per body (like a fixed collided-object list), 1 to 1024. Default 1024: always enforced. */
  readonly maxPerBody?: number;
}

export const CONTACT_LIMITS = Object.freeze({maxBodies: 65536, maxPairs: 1 << 20, maxPerBody: 1024, maxExtent: 1e9});

interface Body {
  readonly id: number;
  kind: 'cylinder' | 'sphere' | 'box';
  radius: number;
  height: number;
  hx: number;
  hy: number;
  hz: number;
  x: number;
  y: number;
  z: number;
  layer: number;
  mask: number;
  enabled: boolean;
  minX: number;
  maxX: number;
  /** Increments each time this id is added anew (first add, or after a removal). */
  incarnation: number;
}

interface Pair {
  readonly a: number;
  readonly b: number;
  aSenses: boolean;
  bSenses: boolean;
  /** Incarnations of a and b when the pair formed: a re-added id is a new body. */
  readonly ai: number;
  readonly bi: number;
}

const fail = (message: string): never => {
  throw new RangeError(`contact: ${message}`);
};
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= CONTACT_LIMITS.maxExtent;
const positive = (v: unknown, what: string): number => (finite(v) && v > 0 ? v : fail(`${what} must be positive`));
const bits = (v: unknown, what: string): number =>
  Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff
    ? (v as number)
    : fail(`${what} must be an unsigned 32-bit integer`);
const pairKey = (p: {readonly a: number; readonly b: number; readonly ai: number; readonly bi: number}) =>
  `${p.a}:${p.ai}:${p.b}:${p.bi}`;

function vec(v: unknown, what: string): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3) return fail(`${what} must be [x, y, z]`);
  const x: unknown = v[0],
    y: unknown = v[1],
    z: unknown = v[2];
  if (!finite(x) || !finite(y) || !finite(z)) return fail(`${what} must be finite`);
  return [x, y, z];
}

/** Squared distance from a point to an axis-aligned box. */
function boxDistance2(px: number, py: number, pz: number, b: Body): number {
  const dx = Math.max(b.x - b.hx - px, 0, px - (b.x + b.hx)),
    dy = Math.max(b.y - b.hy - py, 0, py - (b.y + b.hy)),
    dz = Math.max(b.z - b.hz - pz, 0, pz - (b.z + b.hz));
  return dx * dx + dy * dy + dz * dz;
}

/** Strict overlap (touching surfaces do not count). */
function overlaps(p: Body, q: Body): boolean {
  if (p.kind > q.kind) [p, q] = [q, p]; // order: box < cylinder < sphere
  if (p.kind === 'box' && q.kind === 'box')
    return Math.abs(p.x - q.x) < p.hx + q.hx && Math.abs(p.y - q.y) < p.hy + q.hy && Math.abs(p.z - q.z) < p.hz + q.hz;
  if (p.kind === 'box' && q.kind === 'sphere') return boxDistance2(q.x, q.y, q.z, p) < q.radius * q.radius;
  if (p.kind === 'box' && q.kind === 'cylinder') {
    if (!(q.y < p.y + p.hy && q.y + q.height > p.y - p.hy)) return false;
    const dx = Math.max(p.x - p.hx - q.x, 0, q.x - (p.x + p.hx)),
      dz = Math.max(p.z - p.hz - q.z, 0, q.z - (p.z + p.hz));
    return dx * dx + dz * dz < q.radius * q.radius;
  }
  if (p.kind === 'cylinder' && q.kind === 'cylinder') {
    if (!(p.y < q.y + q.height && q.y < p.y + p.height)) return false;
    const r = p.radius + q.radius;
    return (p.x - q.x) ** 2 + (p.z - q.z) ** 2 < r * r;
  }
  if (p.kind === 'cylinder' && q.kind === 'sphere') {
    const radial = Math.max(0, Math.hypot(q.x - p.x, q.z - p.z) - p.radius);
    const vertical = Math.max(0, p.y - q.y, q.y - (p.y + p.height));
    return radial * radial + vertical * vertical < q.radius * q.radius;
  }
  const r = p.radius + q.radius;
  return (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2 < r * r;
}

export function createContactLayer(options: ContactOptions) {
  if (typeof options !== 'object' || options === null) fail('options must be an object');
  const maxBodies = options.maxBodies,
    maxPairs = options.maxPairs,
    maxPerBody = options.maxPerBody ?? CONTACT_LIMITS.maxPerBody;
  if (!Number.isSafeInteger(maxBodies) || maxBodies < 1 || maxBodies > CONTACT_LIMITS.maxBodies)
    fail('maxBodies must be an integer from 1 to 65536');
  if (!Number.isSafeInteger(maxPairs) || maxPairs < 1 || maxPairs > CONTACT_LIMITS.maxPairs)
    fail('maxPairs must be an integer from 1 to 1048576');
  if (!Number.isSafeInteger(maxPerBody) || maxPerBody < 1 || maxPerBody > CONTACT_LIMITS.maxPerBody)
    fail('maxPerBody must be an integer from 1 to 1024');
  const bodies = new Map<number, Body>();
  let current = new Map<string, Pair>();
  /** Incarnation counter; persisted in snapshots so restored layers replay identically. */
  let incarnations = 0;
  const nextIncarnation = () => {
    if (incarnations >= Number.MAX_SAFE_INTEGER) fail('incarnations exhausted');
    return ++incarnations;
  };
  let busy = false;
  const guarded = <T>(fn: () => T): T => {
    if (busy) fail('reentrant call');
    busy = true;
    try {
      return fn();
    } finally {
      busy = false;
    }
  };

  function capture(id: number, input: BodyInput): Body {
    if (typeof input !== 'object' || input === null) return fail('body must be an object');
    const src: Record<string, unknown> = {...input};
    const shapeInput: unknown = src.shape;
    if (typeof shapeInput !== 'object' || shapeInput === null) return fail('shape must be an object');
    const shape: Record<string, unknown> = {...shapeInput};
    const [x, y, z] = vec(src.position, 'position');
    const body: Body = {
      id,
      kind: 'sphere',
      radius: 0,
      height: 0,
      hx: 0,
      hy: 0,
      hz: 0,
      x,
      y,
      z,
      layer: bits(src.layer, 'layer'),
      mask: bits(src.mask, 'mask'),
      enabled:
        src.enabled === undefined
          ? true
          : src.enabled === true
            ? true
            : src.enabled === false
              ? false
              : fail('enabled must be a boolean'),
      minX: 0,
      maxX: 0,
      incarnation: 0,
    };
    if (shape.kind === 'cylinder') {
      body.kind = 'cylinder';
      body.radius = positive(shape.radius, 'radius');
      body.height = positive(shape.height, 'height');
      body.minX = x - body.radius;
      body.maxX = x + body.radius;
    } else if (shape.kind === 'sphere') {
      body.radius = positive(shape.radius, 'radius');
      body.minX = x - body.radius;
      body.maxX = x + body.radius;
    } else if (shape.kind === 'box') {
      body.kind = 'box';
      [body.hx, body.hy, body.hz] = vec(shape.halfExtents, 'halfExtents');
      if (!(body.hx > 0 && body.hy > 0 && body.hz > 0)) fail('halfExtents must be positive');
      body.minX = x - body.hx;
      body.maxX = x + body.hx;
    } else fail('shape kind must be cylinder, sphere or box');
    return body;
  }

  return {
    get size() {
      return bodies.size;
    },
    /** Add or replace a body (its pairs are re-evaluated on the next update). */
    set(id: number, input: BodyInput): void {
      guarded(() => {
        if (!Number.isSafeInteger(id) || id < 0) fail('id must be a nonnegative integer');
        const body = capture(id, input);
        if (!bodies.has(id) && bodies.size >= maxBodies) fail('body capacity reached');
        const was = bodies.get(id);
        body.incarnation = was ? was.incarnation : nextIncarnation();
        bodies.set(id, body);
      });
    },
    /** Move a body without re-validating its shape. */
    move(id: number, position: ContactVec3): void {
      guarded(() => {
        const b = bodies.get(id) ?? fail(`unknown body ${id}`);
        const [x, y, z] = vec(position, 'position');
        const half = b.kind === 'box' ? b.hx : b.radius;
        b.x = x;
        b.y = y;
        b.z = z;
        b.minX = x - half;
        b.maxX = x + half;
      });
    },
    setEnabled(id: number, enabled: boolean): void {
      guarded(() => {
        const b = bodies.get(id) ?? fail(`unknown body ${id}`);
        if (typeof enabled !== 'boolean') fail('enabled must be a boolean');
        b.enabled = enabled;
      });
    },
    /** Remove a body; its pairs exit (with `removed: true`) on the next update. */
    remove(id: number): boolean {
      return guarded(() => {
        return bodies.delete(id);
      });
    },
    has(id: number): boolean {
      return bodies.has(id);
    },
    /** Find overlapping pairs and report what changed since the previous update. */
    update(): ContactUpdate {
      return guarded(() => {
        // Sort-and-sweep on x over enabled bodies; ties by id, so the candidate order never depends on insertion.
        const live = [...bodies.values()].filter(b => b.enabled).sort((p, q) => p.minX - q.minX || p.id - q.id);
        const found: Pair[] = [];
        for (let i = 0; i < live.length; i++) {
          const p = live[i]!;
          for (let j = i + 1; j < live.length; j++) {
            const q = live[j]!;
            if (q.minX >= p.maxX) break;
            const pSenses = (p.mask & q.layer) !== 0,
              qSenses = (q.mask & p.layer) !== 0;
            if (!pSenses && !qSenses) continue;
            if (!overlaps(p, q)) continue;
            const [a, b] = p.id < q.id ? [p, q] : [q, p];
            found.push({
              a: a.id,
              b: b.id,
              aSenses: a === p ? pSenses : qSenses,
              bSenses: a === p ? qSenses : pSenses,
              ai: a.incarnation,
              bi: b.incarnation,
            });
          }
        }
        found.sort((p, q) => p.a - q.a || p.b - q.b);
        // Admission: continuing pairs first, then new ones, each in (a, b) order, within both bounds.
        const next = new Map<string, Pair>();
        const perBody = new Map<number, number>();
        let refused = 0;
        const admit = (pair: Pair) => {
          const na = perBody.get(pair.a) ?? 0,
            nb = perBody.get(pair.b) ?? 0;
          if (next.size >= maxPairs || na >= maxPerBody || nb >= maxPerBody) {
            refused++;
            return;
          }
          perBody.set(pair.a, na + 1);
          perBody.set(pair.b, nb + 1);
          next.set(pairKey(pair), pair);
        };
        for (const pair of found) if (current.has(pairKey(pair))) admit(pair);
        for (const pair of found) if (!current.has(pairKey(pair))) admit(pair);
        /** A pair ends 'removed' when a body is gone, disabled, or is a new incarnation of its id. */
        const departed = (p: Pair) => {
          const a = bodies.get(p.a),
            b = bodies.get(p.b);
          return !a || !b || !a.enabled || !b.enabled || a.incarnation !== p.ai || b.incarnation !== p.bi;
        };
        const exits: ContactEvent[] = [],
          enters: ContactEvent[] = [],
          stays: ContactEvent[] = [];
        for (const [k, p] of current)
          if (!next.has(k))
            exits.push(
              Object.freeze({
                kind: 'exit',
                a: p.a,
                b: p.b,
                aSenses: p.aSenses,
                bSenses: p.bSenses,
                removed: departed(p),
              }) as ContactEvent,
            );
        for (const [k, p] of next) {
          const event = Object.freeze({
            kind: current.has(k) ? 'stay' : 'enter',
            a: p.a,
            b: p.b,
            aSenses: p.aSenses,
            bSenses: p.bSenses,
          }) as ContactEvent;
          (current.has(k) ? stays : enters).push(event);
        }
        const order = (p: ContactEvent, q: ContactEvent) => p.a - q.a || p.b - q.b;
        exits.sort(order);
        current = next;
        return Object.freeze({events: Object.freeze([...exits, ...enters, ...stays]), refused, pairs: next.size});
      });
    },
    /** Plain detached state (bodies in id order and current pairs) for saves and rollback. */
    snapshot(): ContactSnapshot {
      const shapeOf = (b: Body): ContactShape =>
        b.kind === 'box'
          ? {kind: 'box', halfExtents: [b.hx, b.hy, b.hz]}
          : b.kind === 'cylinder'
            ? {kind: 'cylinder', radius: b.radius, height: b.height}
            : {kind: 'sphere', radius: b.radius};
      return Object.freeze({
        v: 1 as const,
        bodies: Object.freeze(
          [...bodies.values()]
            .sort((p, q) => p.id - q.id)
            .map(b => ({
              id: b.id,
              shape: shapeOf(b),
              position: [b.x, b.y, b.z] as ContactVec3,
              layer: b.layer,
              mask: b.mask,
              enabled: b.enabled,
              incarnation: b.incarnation,
            })),
        ),
        incarnations,
        pairs: Object.freeze([...current.values()].sort((p, q) => p.a - q.a || p.b - q.b).map(p => ({...p}))),
      });
    },
    /**
     * Replace all state from a snapshot taken at any point (including between a removal and the next update);
     * validated before any change. Restored pairs are trusted as the last update's result: a pair that no longer
     * overlaps or senses simply exits on the next update.
     */
    restore(snapshot: ContactSnapshot): void {
      guarded(() => {
        if (typeof snapshot !== 'object' || snapshot === null || snapshot.v !== 1) fail('snapshot must be v1');
        const list: unknown = snapshot.bodies,
          pairList: unknown = snapshot.pairs;
        if (!Array.isArray(list) || !Array.isArray(pairList)) fail('snapshot bodies and pairs must be arrays');
        const nb = (list as unknown[]).length,
          np = (pairList as unknown[]).length;
        if (nb > maxBodies || np > maxPairs) fail('snapshot exceeds the configured bounds');
        const counter = snapshot.incarnations;
        if (!Number.isSafeInteger(counter) || counter < 0) fail('snapshot incarnations must be a nonnegative integer');
        const nextBodies = new Map<number, Body>();
        for (let i = 0; i < nb; i++) {
          const item: unknown = (list as unknown[])[i];
          if (typeof item !== 'object' || item === null) return fail('snapshot body must be an object');
          const r: Record<string, unknown> = {...item};
          const id = r.id;
          if (!Number.isSafeInteger(id) || (id as number) < 0 || nextBodies.has(id as number)) fail('invalid body id');
          const body = capture(
            id as number,
            {shape: r.shape, position: r.position, layer: r.layer, mask: r.mask, enabled: r.enabled} as BodyInput,
          );
          const inc = r.incarnation;
          if (!Number.isSafeInteger(inc) || (inc as number) < 1 || (inc as number) > counter)
            fail('body incarnation must be from 1 to the snapshot counter');
          body.incarnation = inc as number;
          nextBodies.set(id as number, body);
        }
        const nextPairs = new Map<string, Pair>();
        const seenIds = new Set<string>();
        const perBody = new Map<number, number>();
        for (let i = 0; i < np; i++) {
          const item: unknown = (pairList as unknown[])[i];
          if (typeof item !== 'object' || item === null) return fail('snapshot pair must be an object');
          const r: Record<string, unknown> = {...item};
          const a = r.a,
            b = r.b;
          if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || (a as number) >= (b as number))
            fail('pair ids must be ordered');
          const ai = r.ai,
            bi = r.bi;
          for (const inc of [ai, bi])
            if (!Number.isSafeInteger(inc) || (inc as number) < 1 || (inc as number) > counter)
              fail('pair incarnations must be from 1 to the snapshot counter');
          if (typeof r.aSenses !== 'boolean' || typeof r.bSenses !== 'boolean') fail('pair senses must be booleans');
          const k = pairKey({a: a as number, b: b as number, ai: ai as number, bi: bi as number});
          const ids = `${a as number}:${b as number}`;
          if (nextPairs.has(k) || seenIds.has(ids)) fail('duplicate pair');
          seenIds.add(ids);
          for (const id of [a as number, b as number]) {
            const n = (perBody.get(id) ?? 0) + 1;
            if (n > maxPerBody) fail('snapshot exceeds maxPerBody');
            perBody.set(id, n);
          }
          nextPairs.set(k, {
            a: a as number,
            b: b as number,
            aSenses: r.aSenses as boolean,
            bSenses: r.bSenses as boolean,
            ai: ai as number,
            bi: bi as number,
          });
        }
        bodies.clear();
        for (const [id, b] of nextBodies) bodies.set(id, b);
        current = nextPairs;
        incarnations = counter;
      });
    },
    /** Ids in contact with `id` as of the last update (or restore), ascending. O(current pairs). */
    touching(id: number): readonly number[] {
      const out: number[] = [];
      for (const p of current.values()) {
        if (p.a === id) out.push(p.b);
        else if (p.b === id) out.push(p.a);
      }
      return Object.freeze(out.sort((p, q) => p - q));
    },
  };
}
export type ContactLayer = ReturnType<typeof createContactLayer>;
export interface ContactSnapshot {
  readonly v: 1;
  /** The layer's incarnation counter. */
  readonly incarnations: number;
  readonly bodies: readonly (BodyInput & {readonly id: number; readonly incarnation: number})[];
  readonly pairs: readonly {
    readonly a: number;
    readonly b: number;
    readonly aSenses: boolean;
    readonly bSenses: boolean;
    readonly ai: number;
    readonly bi: number;
  }[];
}
