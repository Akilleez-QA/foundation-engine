/**
 * kits/grid-step: tile-to-tile actor movement with facing, classified bumps (leash, impassable, directional
 * blocks, tile classes, elevation, occupied), ledge jumps, forced-movement tiles, reservations during motion and
 * follower chains. Cost: no draws; O(m log m) per tick for m moving actors, plus pulled followers.
 */
import {defineKit, type KitDefinition} from '../../author';

export {createGridStepper, directionBit, DIRECTIONS, GRID_STEP_LIMITS, HANDHELD_TILE_PRESET, opposite} from './stepper';
export type {
  ActorInput,
  ActorView,
  Direction,
  GridStepOptions,
  GridStepper,
  GridStepSnapshot,
  MoveResult,
  Refusal,
  StepEvent,
  TileRule,
} from './stepper';

/** Pure helpers only: listing the kit records the choice; nothing is installed. */
export function gridStep(): KitDefinition {
  return defineKit({id: 'grid-step'});
}
