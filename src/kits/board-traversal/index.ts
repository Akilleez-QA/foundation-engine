/**
 * kits/board-traversal: optional board traversal (push, carve, ollie, authored-rail grinds, manuals, landing judgement
 * and bails) as a pure controller plus an optional fixed-step adapter; no registration. Cost per rider per step: at
 * most `maxSubsteps` ground queries and `maxSubsteps x rail segments` rail checks, constant memory, no draws.
 */
export {
  createBoard,
  type BailReason,
  type Board,
  type BoardControls,
  type BoardEvent,
  type BoardGround,
  type BoardGroundHit,
  type BoardMode,
  type BoardPose,
  type BoardSlide,
  type BoardSnapshot,
  type BoardState,
  type BoardStepResult,
  type BoardWorld,
} from './board';
export {
  BOARD_PRESETS,
  boardConfig,
  boardConfigFingerprint,
  validateBoardConfig,
  type BoardConfig,
  type BoardConfigPatch,
} from './config';
export {defineRails, RAIL_MAX_POINTS, RAIL_MAX_RAILS, RAIL_MAX_SEGMENTS, type RailInput, type Rails} from './rails';
export {sampledBoardGround, type BoardGroundSample} from './ground';
export {boardSystem, characterSlide, type BoardSystemOptions} from './system';
