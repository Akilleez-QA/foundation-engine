/**
 * Optional bounded volume queries: overlap, fixed-orientation sweep and headroom for a sphere or capsule body against
 * an immutable snapshot of static spheres, capsules and oriented boxes. Pure helpers; no kit registration, physics
 * world, clock or movement policy. The creator owns the collision data, the snapshot revision and every effect.
 */
export {
  defineVolumeSet,
  overlapVolume,
  sweepVolume,
  headroom,
  VOLUME_MAX_COLLIDERS,
  VOLUME_MAX_ID_LENGTH,
  VOLUME_MAX_EXTENT,
} from './query';
export type {
  VolumeVec3,
  VolumeQuat,
  VolumeCollider,
  VolumeBody,
  VolumeSet,
  VolumeSetInput,
  VolumeQueryOptions,
  VolumeSweepResult,
  VolumeOverlapResult,
} from './query';
