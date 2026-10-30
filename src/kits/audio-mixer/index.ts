/** Optional audio policy; delegates playback to the existing platform output. */
import {defineKit, type KitDefinition} from '../../author';
export {createCueMixer, type CueRequest, type CueMixerOptions} from './mixer';
export {createDucking} from './ducking';
export {
  blendListener,
  createInstanceLimits,
  createRetrigger,
  dopplerRate,
  type AudioVec3,
  type InstanceLimits,
  type ListenerPose,
  type Retrigger,
} from './extras';
export {
  createMusicClock,
  createMusicDirector,
  type MusicChange,
  type MusicClock,
  type MusicDirector,
  type MusicDirectorOptions,
  type MusicState,
  type Quantum,
} from './music';
export function audioMixer(): KitDefinition {
  return defineKit({id: 'audio-mixer', requires: [], defs: [], modules: []});
}
