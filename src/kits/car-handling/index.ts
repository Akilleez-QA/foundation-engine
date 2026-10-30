/**
 * kits/car-handling: optional arcade-to-sim-lite car handling on ray-cast wheels (pure controller plus an optional
 * fixed-step adapter; no registration). Cost per car per step: at most `maxQueriesPerStep` creator ground queries
 * ((wheels + 8 body corners) x sub-steps), constant memory, no draws.
 */
export {
  createCarHandling,
  type CarControls,
  type CarHandling,
  type CarPose,
  type CarSnapshot,
  type CarState,
  type CarStepResult,
  type CarWheelState,
} from './car';
export {
  CAR_PRESETS,
  carConfig,
  carConfigFingerprint,
  evalCurve,
  validateCarConfig,
  type CarConfig,
  type CarConfigPatch,
  type CarWheel,
  type Curve,
  type Vec3Tuple,
} from './config';
export {
  createGroundHit,
  planeGround,
  sampledGround,
  type GroundHit,
  type GroundQuery,
  type GroundSample,
  type SampledGroundOptions,
} from './ground';
export {carHandlingSystem, type CarHandlingSystemOptions} from './system';
