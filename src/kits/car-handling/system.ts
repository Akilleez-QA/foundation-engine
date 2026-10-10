/**
 * kits/car-handling/system: an optional fixed-step adapter that steps one car per tick from creator-mapped controls
 * and writes the named target's Transform. The car itself stays a pure controller the creator owns.
 */
import {defineSystem, Transform, type SceneContext, type SystemDefinition} from '../../author';
import type {CarControls, CarHandling, CarPose, CarStepResult} from './car';
import type {GroundQuery} from './ground';

export interface CarHandlingSystemOptions {
  /** System id; prefix stays `car-handling-`. Default 'car-handling-drive'. Use one id per car. */
  id?: string;
  /** The car to step (from `createCarHandling`). */
  car: CarHandling;
  /** Named entity whose Transform shows the car (default 'car'). */
  target?: string;
  /** Map this tick's actions to controls, for example from `ctx.input.axis('steer')`. */
  controls(ctx: SceneContext): CarControls;
  ground: GroundQuery;
  /**
   * Whether the driver's controls apply this tick (for example `() => fleet.hasRider(playerId)` or the control kit's
   * `owns`). When false the car still simulates, with neutral controls: it coasts and settles rather than freezing.
   */
  when?: (ctx: SceneContext) => boolean;
  /** Called after each successful step (sounds, camera shake, a reset notice). Must not step the car. */
  after?: (result: CarStepResult, ctx: SceneContext) => void;
}

const NEUTRAL: CarControls = Object.freeze({});

/**
 * One step per fixed tick. The car's own step is a transaction (a throwing ground query or a refused step leaves it
 * unchanged); the Transform is written only after it succeeds. Cost: `car.maxQueriesPerStep` ground queries at most,
 * no draws, no allocation besides the step result.
 */
export function carHandlingSystem(o: CarHandlingSystemOptions): SystemDefinition {
  if (!o || !o.car || typeof o.controls !== 'function' || typeof o.ground !== 'function')
    throw new RangeError('car-handling: car, controls and ground are required');
  const id = o.id ?? 'car-handling-drive';
  if (!/^car-handling-[a-z0-9-]+$/.test(id)) throw new RangeError('car-handling: id must start with car-handling-');
  const pose: CarPose = {x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0};
  return defineSystem({
    id,
    run(ctx, dt) {
      const e = ctx.named(o.target ?? 'car'),
        tr = e === undefined ? undefined : ctx.world.get(e, Transform);
      if (!tr) return;
      const controls = o.when && !o.when(ctx) ? NEUTRAL : o.controls(ctx);
      const result = o.car.step(dt, controls, o.ground);
      o.car.pose(pose);
      tr.x = pose.x;
      tr.y = pose.y;
      tr.z = pose.z;
      tr.rx = pose.rx;
      tr.ry = pose.ry;
      tr.rz = pose.rz;
      ctx.world.touch();
      o.after?.(result, ctx);
    },
  });
}
