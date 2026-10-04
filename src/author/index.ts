/**
 * author/index.ts (`@engine`): the author-facing API. Game code in `game/` imports only this module (and kits).
 *
 *   defineBuild        the build brief: goal, audience, genre, devices, targets, modes, success criteria
 *   defineGame         identity, first scene, kits, extra strings
 *   defineScene        any game state or world: entities, systems, view, enter/exit, a lazy body
 *   defineComponent    data on entities: `defineComponent('health', { hp: 3 })`
 *   defineEntity       a prefab: a named list of component initialisers
 *   defineSystem       logic over the world: fixed-step (default) or per frame
 *   defineInput        a named action (button) or axis, with key, pad and tap bindings
 *   defineSaveSection  saved state, with migrations
 *   defineAsset        a shipped file with its licence and source
 *   defineMode         a way to play (play, practice, learn) and where it starts
 *   defineKit          (for kits) a kit's modules and definitions
 *   Transform, Shape, Name   the built-in components the renderer and tools read
 *   Material, defineMaterial how a shape, mesh or model looks: texture, roughness, metalness, emission, transparency,
 *                            shading (standard/matte/flat/toon), double side, alpha cut-out, vertex colours
 *   Emitter, defineEmitter, burst, sceneParticles   optional particles: one instanced draw per emitter, fixed-step, seeded
 *   view.output (validateSceneOutput)               opt-in tone mapping and exposure per scene
 *
 * Budgets are data in game/budgets.json (the ratchet compares them across revisions without running code).
 */
export {defineBuild, TIER, type BuildBrief, type BuildInput, type DeviceClass, type SuccessCriterion} from './build';
export {
  defineGame,
  defineScene,
  defineComponent,
  defineEntity,
  defineSystem,
  defineInput,
  defineSaveSection,
  defineAsset,
  defineMode,
  defineKit,
  shapeParser,
  Transform,
  Shape,
  Name,
  type AuthorDef,
  type GameDefinition,
  type SceneDefinition,
  type EntityDefinition,
  type SystemDefinition,
  type InputDefinition,
  type SaveSectionDef,
  type AssetDefinition,
  type PlayOptions,
  validatePlayOptions,
  PLAY_LATE_MS,
  type ModeDefinition,
  type KitDefinition,
  type SceneContext,
  type SaveHandle,
  type InputState,
  type InputSource,
  type ActionHint,
  type ViewState,
  type ReadingSheet,
  type ReadingSheetOptions,
  type ScenePreparationContext,
  type Vec3,
  type SceneBody,
  type SceneInput,
  type SceneReplayDigest,
  type ComponentType,
  type ComponentInit,
  type Entity,
  type World,
} from './defs';
export {
  testScene,
  createTestWorkerHost,
  createTestSaves,
  type TestScene,
  type TestVoice,
  type TestSaves,
  type TestSaveStore,
} from './testing';
/** Seeded randomness whose state a simulation can save and restore (rollback, reload, replay). */
export {createSaveableRng, type SaveableRng, type Rng} from '../core/rng';
export {effectiveFov, viewRay, pointerOnGround, projectToView} from './view-math';
export {Mesh, defineMesh, type MeshData, type MeshInput} from './mesh';
export type {
  CueVoice,
  CueVoiceOptions,
  CueFilter,
  SpatialCue,
  PanningModel,
  DistanceModel,
  AudioVector,
} from '../platform/audio/audio-output';
export {distanceGain, audibleGain, BUILT_IN_CUES} from '../platform/audio/audio-output';
export type {SpatialAudioOptions} from '../platform/audio/module';
export {
  Material,
  defineMaterial,
  validateMaterial,
  MATERIAL_DEFAULTS,
  MATERIAL_LIMITS,
  MATERIAL_SHADINGS,
  type MaterialData,
  type MaterialWrap,
  type MaterialShading,
  type MaterialSide,
} from './material';
export {
  musicBudgets,
  MUSIC_START_MARGIN,
  type MusicOptions,
  type MusicVoice,
  type MusicState,
  type MusicStats,
} from '../platform/audio/music-clock';
export {
  Emitter,
  defineEmitter,
  validateEmitter,
  burst,
  EMITTER_DEFAULTS,
  PARTICLE_LIMITS,
  type EmitterData,
  type EmitterMode,
  type EmitterBlending,
} from './particles';
export {sceneParticles} from './particle-sim';
export type {ParticleStats, SceneParticles, SceneParticleLimits} from './particle-contract';
export {
  createAudioTimeline,
  estimateOffset,
  validateCalibration,
  MAX_CALIBRATION_MS,
  NO_CALIBRATION,
  type AudioTimeline,
  type AudioTimelineOptions,
  type AudioTimelineStats,
  type AudioClockReading,
  type AudioCalibration,
  type TimelineEvent,
  type TimelineSource,
  type OffsetEstimate,
} from '../platform/audio/audio-timeline';

export {dmath, platformMath, scalarMath, type ScalarMath, type ScalarMathMode} from '../core/dmath';

export {defineEnvironment, type EnvironmentState} from './environment';
export {
  validateSceneOutput,
  OUTPUT_DEFAULTS,
  OUTPUT_LIMITS,
  TONE_MAPPINGS,
  type SceneOutput,
  type ToneMappingName,
} from './scene-output';
export {
  validatePost,
  POST_DEFAULTS,
  POST_LIMITS,
  type PostSettings,
  type PostBloom,
  type PostVignette,
  type PostGrade,
  type PostMode,
} from '../platform/render/post/settings';

export {Model, validateModel, type ModelData, type ModelSocketPose} from './model';
export {RenderMask, validateRenderMask} from './render-mask';
export {
  createDependencyLease,
  type DependencyNode,
  type DependencyValue,
  type DependencyOptions,
} from '../platform/assets/dependency-lease';
export {
  createDependencyBudget,
  type DependencyBudget,
  type DependencyReservation,
} from '../platform/assets/dependency-budget';
export type {AssetResidencyInput, AssetResidencyBudget, AssetResidencyPressure} from '../platform/assets/residency';

export {
  measureUiOcclusion,
  UI_OCCLUSION_LIMITS,
  type OcclusionRect,
  type OcclusionMeasure,
  type UiOcclusionReport,
} from '../platform/ui/occlusion';

export type {SectionStatus} from '../core/save/section';

export type {ModelState} from './model-state';

export {ModelAttachment, type ModelAttachmentData, type ModelAttachmentState} from './model-attachment';

export {
  ModelPoseLink,
  type ModelPoseLinkData,
  type ModelPoseLinkState,
  type ModelPoseLinkLimits,
} from './model-pose-link';

export type {SceneActivityFacts} from './defs';
