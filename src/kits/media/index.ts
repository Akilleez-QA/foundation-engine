/**
 * kits/media: medium volumes (water, mud, lava, low gravity) with floor and surface heights, a bounded per-actor
 * tracker classifying dry / wade / swim / under with hysteresis and enter/exit/state events, and pure buoyancy,
 * drag and current accelerations. Cost: no draws; O(volumes) per probe.
 */
import {defineKit, type KitDefinition} from '../../author';

export {createMediumTracker, createMediumVolumes, mediumAcceleration, MEDIUM_LIMITS} from './media';
export type {
  ActorSample,
  MediumEvent,
  MediumState,
  MediumTracker,
  MediumVec3,
  MediumVolumes,
  Probe,
  TrackerOptions,
  Volume,
  VolumeInput,
} from './media';

/** Pure helpers only: listing the kit records the choice; nothing is installed. */
export function media(): KitDefinition {
  return defineKit({id: 'media'});
}
