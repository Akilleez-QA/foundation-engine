/** Optional audio policy; delegates playback to the existing platform output. */
import {defineKit, type KitDefinition} from '../../author';
export {createCueMixer, type CueRequest, type CueMixerOptions} from './mixer';
export {createDucking} from './ducking';
export function audioMixer(): KitDefinition {
  return defineKit({id: 'audio-mixer', requires: [], defs: [], modules: []});
}
