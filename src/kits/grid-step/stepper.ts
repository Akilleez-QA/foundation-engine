/**
 * Grid-step actor movement: actors stand on integer tiles, face one of four directions and move one tile (or jump
 * two over a ledge) in a fixed number of ticks. Requests are classified before anything moves; an actor in motion
 * reserves both its source and destination tile, so two actors never claim the same tile. Followers step into the
 * tile their leader just left. Pure owner of its actors; the creator supplies the tile rules and the clock.
 */
export type Direction = 'north' | 'east' | 'south' | 'west';
export const DIRECTIONS: readonly Direction[] = Object.freeze(['north', 'east', 'south', 'west']);
const DELTA: Readonly<Record<Direction, readonly [number, number]>> = Object.freeze({
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
});
const BIT: Readonly<Record<Direction, number>> = Object.freeze({north: 1, east: 2, south: 4, west: 8});
const OPPOSITE: Readonly<Record<Direction, Direction>> = Object.freeze({
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
});

/** What the creator's map says about one tile. All fields optional; a missing tile rule means an open tile. */
export interface TileRule {
  /** False: nothing may enter (walls, out-of-map). Default true. */
  readonly passable?: boolean;
  /** Bit set of tile classes (e.g. 1 = ground, 2 = water); an actor may enter only tiles sharing a bit with its `classes`. */
  readonly classes?: number;
  /** Directions (bit set: north 1, east 2, south 4, west 8) in which an actor may NOT enter this tile while moving. */
  readonly blockEnter?: number;
  /** Directions in which an actor may NOT leave this tile. */
  readonly blockLeave?: number;
  /** A ledge: moving in this direction onto the tile jumps over it and lands one tile beyond. */
  readonly ledge?: Direction;
  /** Arriving here forces another step: a fixed direction (conveyor) or `'continue'` (ice: keep going). */
  readonly forced?: Direction | 'continue';
  /** Height layer 0-255; an actor arriving takes it. Undefined: compatible with every elevation, no change. */
  readonly elevation?: number;
  /** A stair or ramp tile: enterable at any elevation, and arriving clears the actor's elevation. */
  readonly transition?: boolean;
}

export interface GridStepOptions {
  /** Tiles 0..width-1 by 0..height-1; anything outside is impassable. Each 1 to 65536. */
  readonly width: number;
  readonly height: number;
  /** 1 to 4096 actors. */
  readonly maxActors: number;
  /** Deterministic tile lookup; called a bounded number of times per request and arrival. */
  readonly tile: (x: number, y: number) => TileRule | undefined;
  /** Ticks for one tile step (default 16) and a two-tile ledge jump (default 2 * stepTicks). */
  readonly stepTicks?: number;
  readonly jumpTicks?: number;
  /** If true (default), a request in a direction the actor is not facing only turns it. */
  readonly turnBeforeMove?: boolean;
  /** Forced moves chained from one arrival before refusing (default 64), so ice loops cannot run forever. */
  readonly maxForcedChain?: number;
}

export interface ActorInput {
  readonly x: number;
  readonly y: number;
  readonly facing?: Direction;
  /** Tile classes this actor may enter (default all bits). */
  readonly classes?: number;
  readonly elevation?: number;
  /** Home leash: may not leave [homeX - rangeX, homeX + rangeX] (and Y likewise); 0 means unlimited on that axis. */
  readonly leash?: {readonly x: number; readonly y: number; readonly rangeX: number; readonly rangeY: number};
  /** Ignore tile rules (passable, classes, blocks, ledges) or other actors. */
  readonly ignoreTiles?: boolean;
  readonly ignoreActors?: boolean;
  /** Per-actor step duration override (e.g. running). */
  readonly stepTicks?: number;
}

export type Refusal = 'busy' | 'outside-range' | 'impassable' | 'elevation' | 'occupied' | 'chain-limit';
export type MoveResult =
  | {readonly kind: 'started' | 'jumped'; readonly toX: number; readonly toY: number; readonly ticks: number}
  | {readonly kind: 'turned'}
  | {readonly kind: 'bumped'; readonly reason: Refusal};

export type StepEvent =
  | {readonly kind: 'arrived'; readonly id: number; readonly x: number; readonly y: number}
  | {readonly kind: 'forced'; readonly id: number; readonly direction: Direction; readonly result: MoveResult}
  | {readonly kind: 'followed'; readonly id: number; readonly leader: number; readonly result: MoveResult};

export interface ActorView {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly facing: Direction;
  readonly elevation: number | undefined;
  /** Destination while moving, else the current tile. */
  readonly toX: number;
  readonly toY: number;
  /** Ticks elapsed / total of the current move (0 / 0 when standing). */
  readonly elapsed: number;
  readonly duration: number;
  readonly leader: number | null;
}

interface Actor {
  id: number;
  x: number;
  y: number;
  facing: Direction;
  classes: number;
  elevation: number | undefined;
  leash: {x: number; y: number; rangeX: number; rangeY: number} | null;
  ignoreTiles: boolean;
  ignoreActors: boolean;
  stepTicks: number;
  toX: number;
  toY: number;
  elapsed: number;
  duration: number;
  leader: number | null;
  forcedChain: number;
}

export const GRID_STEP_LIMITS = Object.freeze({maxSide: 65536, maxActors: 4096, maxTicks: 65536});

const fail = (message: string): never => {
  throw new RangeError(`grid-step: ${message}`);
};
const int = (value: unknown, lo: number, hi: number, what: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < lo || (value as number) > hi)
    return fail(`${what} must be an integer from ${lo} to ${hi}`);
  return value as number;
};
const direction = (value: unknown): Direction =>
  typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value)
    ? (value as Direction)
    : fail('direction must be north, east, south or west');

export function createGridStepper(options: GridStepOptions) {
  if (typeof options !== 'object' || options === null) fail('options must be an object');
  const width = int(options.width, 1, GRID_STEP_LIMITS.maxSide, 'width'),
    height = int(options.height, 1, GRID_STEP_LIMITS.maxSide, 'height'),
    maxActors = int(options.maxActors, 1, GRID_STEP_LIMITS.maxActors, 'maxActors'),
    stepTicks = int(options.stepTicks ?? 16, 1, GRID_STEP_LIMITS.maxTicks, 'stepTicks'),
    jumpTicks = int(options.jumpTicks ?? stepTicks * 2, 1, GRID_STEP_LIMITS.maxTicks, 'jumpTicks'),
    maxForcedChain = int(options.maxForcedChain ?? 64, 0, 4096, 'maxForcedChain');
  const turnBeforeMove = options.turnBeforeMove ?? true;
  if (typeof turnBeforeMove !== 'boolean') fail('turnBeforeMove must be a boolean');
  const tileOf = options.tile;
  if (typeof tileOf !== 'function') fail('tile must be a function');
  const actors = new Map<number, Actor>();
  /** Tile key -> actor ids holding it (standing, or both ends of a move). */
  const claims = new Map<number, Set<number>>();
  let busy = false;

  const key = (x: number, y: number) => y * width + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  let malformedTiles = 0;
  const CLOSED: TileRule = Object.freeze({passable: false});
  const isDir = (v: unknown): v is Direction => typeof v === 'string' && (DIRECTIONS as readonly string[]).includes(v);
  const mask = (v: unknown) =>
    v === undefined || (Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 15);
  /**
   * The normalized rule for a tile. Reads each field once. A tile function that throws or returns a malformed rule
   * fails closed (impassable) and is counted in `diagnostics().malformedTiles`, so no request can be half-applied.
   */
  const rule = (x: number, y: number): TileRule => {
    if (!inside(x, y)) return CLOSED;
    let r: unknown;
    try {
      r = tileOf(x, y);
    } catch {
      malformedTiles++;
      return CLOSED;
    }
    if (r === undefined) return {};
    try {
      if (typeof r !== 'object' || r === null) throw 0;
      const src: Record<string, unknown> = {...r};
      const {passable, classes, blockEnter, blockLeave, ledge, forced, elevation, transition} = src;
      if (passable !== undefined && typeof passable !== 'boolean') throw 0;
      if (transition !== undefined && typeof transition !== 'boolean') throw 0;
      if (
        classes !== undefined &&
        !(Number.isSafeInteger(classes) && (classes as number) >= 0 && (classes as number) <= 0xffffffff)
      )
        throw 0;
      if (!mask(blockEnter) || !mask(blockLeave)) throw 0;
      if (ledge !== undefined && !isDir(ledge)) throw 0;
      if (forced !== undefined && forced !== 'continue' && !isDir(forced)) throw 0;
      if (
        elevation !== undefined &&
        !(Number.isSafeInteger(elevation) && (elevation as number) >= 0 && (elevation as number) <= 255)
      )
        throw 0;
      return {passable, classes, blockEnter, blockLeave, ledge, forced, elevation, transition} as TileRule;
    } catch {
      malformedTiles++;
      return CLOSED;
    }
  };
  /** Leader id -> follower ids. */
  const followers = new Map<number, Set<number>>();
  const setLeader = (f: Actor, leader: number | null) => {
    if (f.leader !== null) {
      const set = followers.get(f.leader);
      set?.delete(f.id);
      if (set && set.size === 0) followers.delete(f.leader);
    }
    f.leader = leader;
    if (leader !== null) {
      let set = followers.get(leader);
      if (!set) followers.set(leader, (set = new Set()));
      set.add(f.id);
    }
  };
  const moving = new Set<number>();
  const claim = (x: number, y: number, id: number) => {
    const k = key(x, y);
    let set = claims.get(k);
    if (!set) claims.set(k, (set = new Set()));
    set.add(id);
  };
  const release = (x: number, y: number, id: number) => {
    const k = key(x, y);
    const set = claims.get(k);
    set?.delete(id);
    if (set && set.size === 0) claims.delete(k);
  };
  const guarded = <T>(fn: () => T): T => {
    if (busy) fail('reentrant call from a tile rule');
    busy = true;
    try {
      return fn();
    } finally {
      busy = false;
    }
  };
  const get = (id: number): Actor => {
    const a = actors.get(id);
    return a ?? fail(`unknown actor ${id}`);
  };
  const compatible = (a: number | undefined, b: number | undefined) => a === undefined || b === undefined || a === b;

  /** Classify a one-step move in `dir` without changing anything. `exempt` may share the destination (a leader). */
  function classify(a: Actor, dir: Direction, exempt: number | null): MoveResult {
    const [dx, dy] = DELTA[dir];
    let tx = a.x + dx,
      ty = a.y + dy;
    let ticks = a.stepTicks;
    let jumped = false;
    if (a.leash) {
      const {x, y, rangeX, rangeY} = a.leash;
      if ((rangeX > 0 && Math.abs(tx - x) > rangeX) || (rangeY > 0 && Math.abs(ty - y) > rangeY))
        return {kind: 'bumped', reason: 'outside-range'};
    }
    if (!a.ignoreTiles) {
      const here = rule(a.x, a.y);
      if ((here.blockLeave ?? 0) & BIT[dir]) return {kind: 'bumped', reason: 'impassable'};
      let target = rule(tx, ty);
      if (target.ledge === dir && target.passable !== false && ((target.blockEnter ?? 0) & BIT[dir]) === 0) {
        // Jump over the ledge tile and land one beyond it.
        tx += dx;
        ty += dy;
        if (!inside(tx, ty)) return {kind: 'bumped', reason: 'impassable'};
        target = rule(tx, ty);
        if (target.ledge !== undefined) return {kind: 'bumped', reason: 'impassable'};
        ticks = jumpTicks;
        jumped = true;
        if (a.leash) {
          const {x, y, rangeX, rangeY} = a.leash;
          if ((rangeX > 0 && Math.abs(tx - x) > rangeX) || (rangeY > 0 && Math.abs(ty - y) > rangeY))
            return {kind: 'bumped', reason: 'outside-range'};
        }
      } else if (target.ledge !== undefined) return {kind: 'bumped', reason: 'impassable'};
      if (target.passable === false || ((target.blockEnter ?? 0) & BIT[dir]) !== 0)
        return {kind: 'bumped', reason: 'impassable'};
      if (((target.classes ?? 0xffffffff) & a.classes) === 0) return {kind: 'bumped', reason: 'impassable'};
      if (target.transition !== true && !compatible(a.elevation, target.elevation))
        return {kind: 'bumped', reason: 'elevation'};
    } else if (!inside(tx, ty)) return {kind: 'bumped', reason: 'impassable'};
    if (!a.ignoreActors) {
      const holders = claims.get(key(tx, ty));
      if (holders)
        for (const other of holders) {
          if (other === a.id || other === exempt) continue;
          const o = actors.get(other)!;
          if (o.ignoreActors) continue;
          if (compatible(a.elevation, o.elevation)) return {kind: 'bumped', reason: 'occupied'};
        }
    }
    return {kind: jumped ? 'jumped' : 'started', toX: tx, toY: ty, ticks};
  }

  function begin(a: Actor, dir: Direction, result: MoveResult) {
    if (result.kind !== 'started' && result.kind !== 'jumped') return;
    a.facing = dir;
    a.toX = result.toX;
    a.toY = result.toY;
    a.elapsed = 0;
    a.duration = result.ticks;
    claim(a.toX, a.toY, a.id);
    moving.add(a.id);
  }

  /**
   * Followers step into the tile their leader is leaving: breadth-first down the chain, followers of one leader in
   * id order, iterative (no recursion). A follower two tiles straight behind with a ledge between jumps it.
   */
  function pullFollowers(first: Actor, events: StepEvent[] | null) {
    const queue: Actor[] = [first];
    for (let head = 0; head < queue.length; head++) {
      const leader = queue[head]!;
      const ids = followers.get(leader.id);
      if (!ids) continue;
      for (const fid of [...ids].sort((p, q) => p - q)) {
        const f = actors.get(fid)!;
        if (f.duration > 0) continue;
        const dx = leader.x - f.x,
          dy = leader.y - f.y;
        const span = Math.abs(dx) + Math.abs(dy);
        const dir =
          (span === 1 || span === 2) && (dx === 0 || dy === 0)
            ? DIRECTIONS.find(d => DELTA[d][0] === Math.sign(dx) && DELTA[d][1] === Math.sign(dy))
            : undefined;
        let result: MoveResult = dir ? classify(f, dir, leader.id) : {kind: 'bumped', reason: 'outside-range'};
        if (
          (result.kind === 'started' || result.kind === 'jumped') &&
          (result.toX !== leader.x || result.toY !== leader.y)
        )
          result = {kind: 'bumped', reason: 'outside-range'};
        if (dir && (result.kind === 'started' || result.kind === 'jumped')) {
          f.forcedChain = 0;
          begin(f, dir, result);
          queue.push(f);
        }
        events?.push(Object.freeze({kind: 'followed', id: f.id, leader: leader.id, result: Object.freeze(result)}));
      }
    }
  }

  const view = (a: Actor): ActorView =>
    Object.freeze({
      id: a.id,
      x: a.x,
      y: a.y,
      facing: a.facing,
      elevation: a.elevation,
      toX: a.toX,
      toY: a.toY,
      elapsed: a.elapsed,
      duration: a.duration,
      leader: a.leader,
    });

  return {
    get size() {
      return actors.size;
    },
    /** Place a new actor on a free tile. */
    add(id: number, input: ActorInput): ActorView {
      return guarded(() => {
        int(id, 0, Number.MAX_SAFE_INTEGER, 'id');
        if (actors.has(id)) fail(`actor ${id} already exists`);
        if (actors.size >= maxActors) fail('actor capacity reached');
        if (typeof input !== 'object' || input === null) fail('actor input must be an object');
        const x = int(input.x, 0, width - 1, 'x'),
          y = int(input.y, 0, height - 1, 'y');
        const leashInput = input.leash;
        const leash =
          leashInput === undefined
            ? null
            : {
                x: int(leashInput.x, 0, width - 1, 'leash x'),
                y: int(leashInput.y, 0, height - 1, 'leash y'),
                rangeX: int(leashInput.rangeX, 0, GRID_STEP_LIMITS.maxSide, 'leash rangeX'),
                rangeY: int(leashInput.rangeY, 0, GRID_STEP_LIMITS.maxSide, 'leash rangeY'),
              };
        const elevation = input.elevation === undefined ? undefined : int(input.elevation, 0, 255, 'elevation');
        const a: Actor = {
          id,
          x,
          y,
          facing: direction(input.facing ?? 'south'),
          classes: input.classes === undefined ? 0xffffffff : int(input.classes, 0, 0xffffffff, 'classes'),
          elevation,
          leash,
          ignoreTiles: input.ignoreTiles === true,
          ignoreActors: input.ignoreActors === true,
          stepTicks: int(input.stepTicks ?? stepTicks, 1, GRID_STEP_LIMITS.maxTicks, 'stepTicks'),
          toX: x,
          toY: y,
          elapsed: 0,
          duration: 0,
          leader: null,
          forcedChain: 0,
        };
        if (!a.ignoreTiles) {
          const here = rule(x, y);
          if (here.passable === false || ((here.classes ?? 0xffffffff) & a.classes) === 0)
            fail(`tile ${x},${y} cannot hold this actor`);
        }
        if (!a.ignoreActors) {
          const holders = claims.get(key(x, y));
          if (
            holders &&
            [...holders].some(o => !actors.get(o)!.ignoreActors && compatible(elevation, actors.get(o)!.elevation))
          )
            fail(`tile ${x},${y} is occupied`);
        }
        actors.set(id, a);
        claim(x, y, id);
        return view(a);
      });
    },
    remove(id: number): boolean {
      return guarded(() => {
        const a = actors.get(id);
        if (!a) return false;
        release(a.x, a.y, id);
        release(a.toX, a.toY, id);
        setLeader(a, null);
        for (const fid of [...(followers.get(id) ?? [])]) setLeader(actors.get(fid)!, null);
        actors.delete(id);
        moving.delete(id);
        return true;
      });
    },
    get(id: number): ActorView | null {
      const a = actors.get(id);
      return a ? view(a) : null;
    },
    /** Classify a move without changing anything (AI look-ahead, input previews). */
    probe(id: number, dir: Direction): MoveResult {
      return guarded(() => {
        const a = get(id);
        if (a.duration > 0) return {kind: 'bumped', reason: 'busy'};
        return classify(a, direction(dir), null);
      });
    },
    /**
     * Request one step. Standing actors only (`busy` while moving). With `turnBeforeMove`, a request away from the
     * current facing only turns the actor. A refused step still turns it to face the obstacle (a bump).
     */
    move(id: number, dir: Direction, o: {readonly turnOnly?: boolean} = {}): MoveResult {
      return guarded(() => {
        const a = get(id);
        const d = direction(dir);
        if (typeof o !== 'object' || o === null) fail('move options must be an object');
        if (a.duration > 0) return Object.freeze({kind: 'bumped', reason: 'busy'}) as MoveResult;
        if (o.turnOnly === true || (turnBeforeMove && a.facing !== d)) {
          a.facing = d;
          return Object.freeze({kind: 'turned'}) as MoveResult;
        }
        const result = Object.freeze(classify(a, d, null));
        a.facing = d;
        a.forcedChain = 0;
        begin(a, d, result);
        if (result.kind === 'started' || result.kind === 'jumped') pullFollowers(a, null);
        return result;
      });
    },
    /** Make `id` follow `leader` (null to stop). Refuses cycles. */
    follow(id: number, leader: number | null): void {
      guarded(() => {
        const a = get(id);
        if (leader === null) {
          setLeader(a, null);
          return;
        }
        get(leader);
        for (let cursor: number | null = leader, n = 0; cursor !== null; n++) {
          if (cursor === id || n > maxActors) fail('follower chains must not form a cycle');
          cursor = actors.get(cursor)!.leader;
        }
        setLeader(a, leader);
      });
    },
    /**
     * Advance every moving actor by one tick, in id order. Arrivals may start forced moves. Followers of every
     * actor that started a move this tick are pulled after all arrivals, so the outcome does not depend on ids.
     * Event order: arrivals and forced moves in id order, then follower moves breadth-first per leader.
     */
    step(): readonly StepEvent[] {
      return guarded(() => {
        const events: StepEvent[] = [];
        const started: Actor[] = [];
        for (const id of [...moving].sort((p, q) => p - q)) {
          const a = actors.get(id);
          if (!a || a.duration === 0) {
            moving.delete(id);
            continue;
          }
          a.elapsed++;
          if (a.elapsed < a.duration) continue;
          release(a.x, a.y, a.id);
          a.x = a.toX;
          a.y = a.toY;
          a.elapsed = 0;
          a.duration = 0;
          moving.delete(id);
          claim(a.x, a.y, a.id);
          const arrivedOn = a.ignoreTiles ? {} : rule(a.x, a.y);
          if (arrivedOn.transition === true) a.elevation = undefined;
          else if (arrivedOn.elevation !== undefined) a.elevation = arrivedOn.elevation;
          events.push(Object.freeze({kind: 'arrived', id: a.id, x: a.x, y: a.y}));
          const forced = arrivedOn.forced;
          if (forced !== undefined) {
            const dir = forced === 'continue' ? a.facing : forced;
            let result: MoveResult;
            if (a.forcedChain >= maxForcedChain) result = {kind: 'bumped', reason: 'chain-limit'};
            else {
              result = classify(a, dir, null);
              begin(a, dir, result);
              if (result.kind === 'started' || result.kind === 'jumped') {
                a.forcedChain++;
                started.push(a);
              }
            }
            events.push(Object.freeze({kind: 'forced', id: a.id, direction: dir, result: Object.freeze(result)}));
          } else a.forcedChain = 0;
        }
        for (const a of started) pullFollowers(a, events);
        return Object.freeze(events);
      });
    },
    /** Counters for creator diagnostics. */
    diagnostics(): {readonly malformedTiles: number; readonly moving: number} {
      return Object.freeze({malformedTiles, moving: moving.size});
    },
    /** Tiles currently claimed by actors (standing tiles and both ends of moves), for debugging and tests. */
    occupants(x: number, y: number): readonly number[] {
      if (!inside(x, y)) return [];
      return Object.freeze([...(claims.get(key(x, y)) ?? [])].sort((p, q) => p - q));
    },
    /**
     * Replace every actor from a snapshot taken from a stepper with the same options. Validates everything and
     * the tile claims before changing anything; a refused snapshot leaves the stepper unchanged.
     */
    restore(snapshot: GridStepSnapshot): void {
      guarded(() => {
        if (typeof snapshot !== 'object' || snapshot === null || snapshot.v !== 1) fail('snapshot must be v1');
        const list = snapshot.actors;
        if (!Array.isArray(list)) fail('snapshot actors must be an array');
        const count = list.length;
        if (!Number.isSafeInteger(count) || count > maxActors) fail('snapshot exceeds maxActors');
        const next = new Map<number, Actor>();
        for (let i = 0; i < count; i++) {
          const item: unknown = list[i];
          if (typeof item !== 'object' || item === null) return fail('snapshot actor must be an object');
          const r: Record<string, unknown> = {...item};
          const id = int(r.id, 0, Number.MAX_SAFE_INTEGER, 'id');
          if (next.has(id)) fail(`duplicate actor ${id}`);
          const leash = r.leash as Actor['leash'] | null;
          const a: Actor = {
            id,
            x: int(r.x, 0, width - 1, 'x'),
            y: int(r.y, 0, height - 1, 'y'),
            facing: direction(r.facing),
            classes: int(r.classes, 0, 0xffffffff, 'classes'),
            elevation: r.elevation === undefined ? undefined : int(r.elevation, 0, 255, 'elevation'),
            leash:
              leash === null || leash === undefined
                ? null
                : {
                    x: int(leash.x, 0, width - 1, 'leash x'),
                    y: int(leash.y, 0, height - 1, 'leash y'),
                    rangeX: int(leash.rangeX, 0, GRID_STEP_LIMITS.maxSide, 'leash rangeX'),
                    rangeY: int(leash.rangeY, 0, GRID_STEP_LIMITS.maxSide, 'leash rangeY'),
                  },
            ignoreTiles: r.ignoreTiles === true,
            ignoreActors: r.ignoreActors === true,
            stepTicks: int(r.stepTicks, 1, GRID_STEP_LIMITS.maxTicks, 'stepTicks'),
            toX: int(r.toX, 0, width - 1, 'toX'),
            toY: int(r.toY, 0, height - 1, 'toY'),
            elapsed: int(r.elapsed, 0, GRID_STEP_LIMITS.maxTicks, 'elapsed'),
            duration: int(r.duration, 0, GRID_STEP_LIMITS.maxTicks, 'duration'),
            leader: r.leader === null ? null : int(r.leader, 0, Number.MAX_SAFE_INTEGER, 'leader'),
            forcedChain: int(r.forcedChain, 0, maxForcedChain, 'forcedChain'),
          };
          const span = Math.abs(a.toX - a.x) + Math.abs(a.toY - a.y);
          const straight = a.toX === a.x || a.toY === a.y;
          if (
            a.duration === 0
              ? a.elapsed !== 0 || span !== 0
              : a.elapsed >= a.duration || !straight || span < 1 || span > 2
          )
            fail(`actor ${id} has an inconsistent move`);
          next.set(id, a);
        }
        for (const a of next.values()) {
          if (a.leader !== null && !next.has(a.leader)) fail(`actor ${a.id} follows a missing leader`);
          for (let cursor: number | null = a.leader, n = 0; cursor !== null; n++) {
            if (cursor === a.id || n > count) fail('follower chains must not form a cycle');
            cursor = next.get(cursor)!.leader;
          }
        }
        const nextClaims = new Map<number, Set<number>>();
        const add = (x: number, y: number, a: Actor) => {
          const k = key(x, y);
          let set = nextClaims.get(k);
          if (!set) nextClaims.set(k, (set = new Set()));
          if (!a.ignoreActors)
            for (const o of set) {
              const other = next.get(o)!;
              // Two actors may share a tile only when one is moving away from it and it is the other's
              // destination or standing tile (a follower stepping into, or already arrived on, a vacating tile).
              const vacates = (p: Actor, q: Actor) =>
                p.duration > 0 && p.x === x && p.y === y && ((q.toX === x && q.toY === y) || (q.x === x && q.y === y));
              const linked = o !== a.id && (vacates(a, other) || vacates(other, a));
              if (o !== a.id && !linked && !other.ignoreActors && compatible(a.elevation, other.elevation))
                fail(`actors ${o} and ${a.id} claim tile ${x},${y}`);
            }
          set.add(a.id);
        };
        for (const a of [...next.values()].sort((p, q) => p.id - q.id)) {
          add(a.x, a.y, a);
          if (a.duration > 0) add(a.toX, a.toY, a);
        }
        for (const set of nextClaims.values())
          if ([...set].filter(id => !next.get(id)!.ignoreActors).length > 2) fail('more than two actors share a tile');
        actors.clear();
        followers.clear();
        moving.clear();
        for (const [id, a] of next) {
          actors.set(id, a);
          if (a.duration > 0) moving.add(id);
        }
        for (const a of next.values()) {
          const leader = a.leader;
          a.leader = null;
          setLeader(a, leader);
        }
        claims.clear();
        for (const [k, set] of nextClaims) claims.set(k, set);
      });
    },
    /** Plain detached state for saves and rollback (actors in id order). */
    snapshot(): GridStepSnapshot {
      return Object.freeze({
        v: 1 as const,
        actors: Object.freeze(
          [...actors.values()]
            .sort((p, q) => p.id - q.id)
            .map(a => Object.freeze({...a, leash: a.leash ? Object.freeze({...a.leash}) : null})),
        ),
      });
    },
  };
}

export interface GridStepSnapshot {
  readonly v: 1;
  readonly actors: readonly Readonly<Actor>[];
}
export type GridStepper = ReturnType<typeof createGridStepper>;

/** The direction opposite `d`. */
export const opposite = (d: Direction): Direction => OPPOSITE[direction(d)];
/** Bit for `d` in `blockEnter` / `blockLeave` sets. */
export const directionBit = (d: Direction): number => BIT[direction(d)];

/**
 * A preset modelled on classic handheld tile games: 16-tick walks (16-pixel tiles at one pixel per tick), 8-tick
 * runs via a per-actor `stepTicks`, two-tile ledge jumps over 32 ticks, turn-before-move. Creator-tunable defaults,
 * not a claim of frame-exact fidelity to any one game.
 */
export const HANDHELD_TILE_PRESET = Object.freeze({stepTicks: 16, runTicks: 8, jumpTicks: 32, turnBeforeMove: true});
