/**
 * kits/ballistics: drag-free trajectories under constant gravity. Launch solves (by duration, horizontal speed,
 * vertical speed, apex height, fixed launch speed with low/high arcs, moving-target lead), evaluation (position,
 * velocity, apex, time at a height) and bounded arc samples for previews.
 * Cost: no draws and no per-frame work; `samplePoints` can write into a reused buffer.
 */
import {defineKit, type KitDefinition} from '../../author';

export {
  BALLISTIC_LIMITS,
  apex,
  positionAt,
  samplePoints,
  solveByApexHeight,
  solveByDuration,
  solveByHorizontalSpeed,
  solveByLaunchSpeed,
  solveByVerticalSpeed,
  solveLead,
  timeAtHeight,
  velocityAt,
} from './trajectory';
export type {BallisticVec3, Solution, Trajectory} from './trajectory';

/** Pure helpers only: listing the kit records the choice; nothing is installed. */
export function ballistics(): KitDefinition {
  return defineKit({id: 'ballistics'});
}
