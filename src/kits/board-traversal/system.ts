/**
 * kits/board-traversal/system: the character kit's walls and solids as a wall port, and an optional fixed-step adapter
 * that steps one rider per tick and writes the named target's Transform.
 */
import {
  defineSystem,
  scalarMath,
  Transform,
  type ScalarMathMode,
  type SceneContext,
  type SystemDefinition,
  type World,
} from '../../author';
import {areaOf, slide, type Area} from '../character';
import type {Board, BoardControls, BoardGround, BoardPose, BoardSlide, BoardStepResult} from './board';
import type {Rails} from './rails';

/** Sub-steps per planar move: a move longer than 64 half-radii in one sub-step is refused. */
const MAX_SLIDE_STEPS = 64;

/**
 * A wall port over the character kit's `Walls` and `Solid`s in a world (read once, on the port's first use and then
 * cached: build a new port each tick, as `boardSystem` does, or moved and added solids are ignored) or over a fixed
 * `Area`. Each move is split into pieces no longer than half
 * the board radius, so a piece cannot cross a solid's outline inflated by the radius. `math` should match the board's
 * (`board.math`) so rotated and round solids are evaluated with the same arithmetic. The character kit's `slide`
 * allocates a point per piece; that cost is the wall port's, not the board's.
 */
export function characterSlide(source: World | Area, radius = 0.3, math?: ScalarMathMode): BoardSlide {
  if (!source || typeof source !== 'object') throw new RangeError('board-traversal: a world or an area is required');
  if (!Number.isFinite(radius) || radius <= 0 || radius > 10)
    throw new RangeError('board-traversal: radius must be within (0, 10]');
  const m = scalarMath(math);
  // A fixed area keeps its own arithmetic unless `math` is given.
  let area: Area | null =
    'minX' in source ? {...source, body: radius, ...(math !== undefined || !source.math ? {math: m} : {})} : null;
  return (x, z, dx, dz, out) => {
    if (area === null) area = areaOf(source as World, radius, m);
    const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dz * dz) / (radius / 2)));
    if (steps > MAX_SLIDE_STEPS) throw new RangeError('board-traversal: planar move exceeds 32 radii in one sub-step');
    let p = {x, z};
    for (let i = 0; i < steps; i++) p = slide(area, p, {x: dx / steps, z: dz / steps});
    out.x = p.x;
    out.z = p.z;
  };
}

export interface BoardSystemOptions {
  /** System id, starting `board-traversal-`. Default 'board-traversal-ride'. */
  id?: string;
  board: Board;
  /** Named entity whose Transform shows the rider (default 'rider'). */
  target?: string;
  controls(ctx: SceneContext): BoardControls;
  ground: BoardGround;
  /** The current rail snapshot, read each tick (replace it with a new revision when the rails change). */
  rails?: (ctx: SceneContext) => Rails | undefined;
  /** Use the character kit's `Walls`/`Solid`s in this world as walls, with this board radius (m). */
  walls?: {radius: number};
  /** Whether the controls apply this tick; when false the board steps with neutral controls (it rolls on). */
  when?: (ctx: SceneContext) => boolean;
  /** Called after each successful step (sounds, scoring, camera). Must not step the board. */
  after?: (result: BoardStepResult, ctx: SceneContext) => void;
}

const NEUTRAL: BoardControls = Object.freeze({});

/**
 * One step per fixed tick. The board's step is a transaction; the Transform (x, y, z, ry) is written only after it
 * succeeds. Cost: at most `maxSubsteps` ground queries plus `maxSubsteps x segments` rail checks; no draws.
 */
export function boardSystem(o: BoardSystemOptions): SystemDefinition {
  if (!o || !o.board || typeof o.controls !== 'function' || typeof o.ground !== 'function')
    throw new RangeError('board-traversal: board, controls and ground are required');
  const id = o.id ?? 'board-traversal-ride';
  if (!/^board-traversal-[a-z0-9-]+$/.test(id))
    throw new RangeError('board-traversal: id must start with board-traversal-');
  const radius = o.walls?.radius;
  if (radius !== undefined && (!Number.isFinite(radius) || radius <= 0 || radius > 10))
    throw new RangeError('board-traversal: walls.radius must be within (0, 10]');
  const pose: BoardPose = {x: 0, y: 0, z: 0, ry: 0};
  return defineSystem({
    id,
    run(ctx, dt) {
      const e = ctx.named(o.target ?? 'rider'),
        tr = e === undefined ? undefined : ctx.world.get(e, Transform);
      if (!tr) return;
      const owned = !o.when || o.when(ctx);
      // Losing the controller forgets a held ollie, so it cannot pop on the neutral controls that follow.
      if (!owned) o.board.cancelInput();
      const controls = owned ? o.controls(ctx) : NEUTRAL;
      const result = o.board.step(dt, controls, {
        ground: o.ground,
        rails: o.rails?.(ctx),
        slide: radius === undefined ? undefined : characterSlide(ctx.world, radius, o.board.math),
      });
      o.board.pose(pose);
      tr.x = pose.x;
      tr.y = pose.y;
      tr.z = pose.z;
      tr.ry = pose.ry;
      ctx.world.touch();
      o.after?.(result, ctx);
    },
  });
}
