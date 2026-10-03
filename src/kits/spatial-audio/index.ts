/**
 * kits/spatial-audio: optional logical sound sources over the platform output. Virtual (voiceless) tracking,
 * importance ranking with HRTF for the sounds that matter, per-class distance curves with a hard cutoff, and occlusion
 * under a per-pump ray budget driving the output's smoothed filter. No system, timer, context or save data.
 */
import {defineKit, type KitDefinition} from '../../author';
export {
  createSpatialAudio,
  classGain,
  airCutoff,
  validateSoundClass,
  segmentQueryFromRaycast,
  type SpatialAudio,
  type SpatialAudioOptions,
  type SpatialAudioLimits,
  type SpatialAudioStats,
  type SoundClass,
  type SourceInput,
  type OcclusionOptions,
  type SegmentQuery,
  type PumpResult,
  type Point,
} from './sources';

/** The kit registration; `createSpatialAudio` works without it. */
export function spatialAudio(): KitDefinition {
  return defineKit({id: 'spatial-audio', requires: [], defs: [], modules: []});
}
