import { AnimationMixer, type Object3D } from 'three';
/** Keep skeletal playback code out of a scene's initial path until a model is ready. */
export const createModelPlayback = (root: Object3D): AnimationMixer => new AnimationMixer(root);
