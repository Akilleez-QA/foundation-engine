/** Optional animation event and attachment contracts; no automatic simulation or render work. */
import {defineKit, type KitDefinition} from '../../author';
export {defineMarkerClip, createMarkerTrack, type MarkerClip, type ClipMarker, type MarkerOccurrence} from './markers';
export {createSocketRig, type SocketMatrix, type SocketLod, type Attachment, type AttachmentFrame} from './sockets';
export function animation(): KitDefinition {
  return defineKit({id: 'animation', requires: [], defs: [], modules: []});
}
export {
  definePoseClip,
  createPoseSampler,
  gaitPhase,
  type PoseClip,
  type PoseTrack,
  type PoseKey,
  type JointPose,
} from './pose-clip';
export {createRootMotion, type RootKey, type RootClip, type RootDelta} from './root-motion';
export {blendPoseLayers, solveTwoBone, type PoseLayer} from './pose-layers';
export {
  createLookAt,
  type LookAt,
  type LookAtJoint,
  type LookAtJointOutput,
  type LookAtOptions,
  type LookAtState,
} from './look-at';
