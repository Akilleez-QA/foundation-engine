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
 *
 * Budgets are data in game/budgets.json (the ratchet compares them across revisions without running code).
 */
export { defineBuild, TIER, type BuildBrief, type BuildInput, type DeviceClass, type SuccessCriterion } from './build';
export {
  defineGame, defineScene, defineComponent, defineEntity, defineSystem, defineInput, defineSaveSection, defineAsset, defineMode, defineKit,
  shapeParser, Transform, Shape, Name,
  type AuthorDef, type GameDefinition, type SceneDefinition, type EntityDefinition, type SystemDefinition, type InputDefinition,
  type SaveSectionDef, type AssetDefinition, type ModeDefinition, type KitDefinition, type SceneContext, type SaveHandle, type InputState, type ActionHint,
  type ViewState, type ReadingSheet, type ReadingSheetOptions, type ScenePreparationContext, type Vec3, type SceneBody, type SceneInput, type ComponentType, type ComponentInit, type Entity, type World,
} from './defs';
export { testScene, createTestWorkerHost, type TestScene } from './testing';
export { effectiveFov, viewRay, pointerOnGround, projectToView } from './view-math';
export { Mesh, defineMesh, type MeshData, type MeshInput } from './mesh';
export type { CueVoice, CueVoiceOptions, CueFilter, SpatialCue, PanningModel, DistanceModel, AudioVector } from '../platform/audio/audio-output';
export { distanceGain, audibleGain } from '../platform/audio/audio-output';
export type { SpatialAudioOptions } from '../platform/audio/module';

export { defineEnvironment, type EnvironmentState } from './environment';

export { Model, validateModel, type ModelData, type ModelSocketPose } from './model';
export { RenderMask, validateRenderMask } from './render-mask';
export { createDependencyLease, type DependencyNode, type DependencyValue, type DependencyOptions } from '../platform/assets/dependency-lease';
export { createDependencyBudget, type DependencyBudget, type DependencyReservation } from '../platform/assets/dependency-budget';
export type { AssetResidencyInput, AssetResidencyBudget, AssetResidencyPressure } from '../platform/assets/residency';

export { measureUiOcclusion, UI_OCCLUSION_LIMITS, type OcclusionRect, type OcclusionMeasure, type UiOcclusionReport } from '../platform/ui/occlusion';

export type { SectionStatus } from '../core/save/section';

export type { ModelState } from './model-state';

export { ModelAttachment, type ModelAttachmentData, type ModelAttachmentState } from './model-attachment';

export { ModelPoseLink, type ModelPoseLinkData, type ModelPoseLinkState, type ModelPoseLinkLimits } from './model-pose-link';

export type { SceneActivityFacts } from './defs';
