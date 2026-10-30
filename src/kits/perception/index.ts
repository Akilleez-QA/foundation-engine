/**
 * kits/perception: sight and hearing strengths with creator occlusion/path queries, per-agent awareness with alert
 * levels, decay and last-known positions (as blackboard facts), squad shared knowledge, cover selection with
 * reservations, and utility scoring. Pure helpers: no system, timer, geometry, renderer or decision tree.
 * Cost: per agent per update O(stimuli + remembered targets); cover O(points log points) plus bounded LOS checks.
 */
import {defineKit, type KitDefinition} from '../../author';
export {sightStrength, hearingStrength, type SightSpec, type Sound, type Vec3} from './senses';
export {
  createAwareness,
  type AlertLevel,
  type Awareness,
  type AwarenessFacts,
  type AwarenessOptions,
  type Stimulus,
  type StimulusKind,
  type TargetMemory,
} from './awareness';
export {
  chooseCover,
  chooseUtility,
  createCoverReservations,
  createSquadKnowledge,
  type CoverPoint,
  type SquadKnowledge,
  type SquadReport,
  type UtilityOption,
} from './tactics';

/** The kit: nothing to register. */
export function perception(): KitDefinition {
  return defineKit({id: 'perception'});
}
