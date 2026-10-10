/**
 * kits/input-assist: optional aim assistance (target selection in a cone, magnetism, friction) and flick detection
 * over action values. Pure helpers and one small bounded state machine; no system, clock, device reader or
 * registration. Cost: no draws; an aim evaluation is O(candidates) (at most 256), a flick sample O(1).
 */
import {defineKit, type KitDefinition} from '../../author';
export {
  AIM_ASSIST_LIMITS,
  aimAngles,
  aimDirection,
  createAimAssist,
  type AimAssist,
  type AimAssistOptions,
  type AimCandidate,
  type AimFrame,
  type AimResult,
} from './aim';
export {
  createFlickDetector,
  FLICK_DIRECTIONS_4,
  FLICK_DIRECTIONS_8,
  FLICK_LIMITS,
  type Flick,
  type FlickDetector,
  type FlickOptions,
  type FlickPhase,
  type FlickSampleResult,
} from './flick';

/** Declares the kit in `defineGame({ kits })`; it contributes no definitions or modules. */
export function inputAssist(): KitDefinition {
  return defineKit({id: 'input-assist'});
}
