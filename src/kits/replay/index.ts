/**
 * Optional replay log and divergence detector (SIM-01). Pure helpers: no clock, loop, storage, network or global
 * service. A game or a test chooses them; the engine runs without them. See README.md.
 */
export {hashText, digestJson} from './hash';
export {createDigestTrace, compareDigests, checkDigestSnapshot, identityOk} from './digest';
export type {
  DigestTrace,
  DigestTraceOptions,
  DigestSnapshot,
  DigestEntry,
  DigestComparison,
  DigestDetailWindow,
  ObserveResult,
} from './digest';
export {REPLAY_FORMAT, REPLAY_VERSION, RUN_OVERHEAD_BYTES, createReplayRecorder, encodeReplay, openReplay} from './log';
export type {
  ReplayHeader,
  ReplayLimits,
  ReplayRecorder,
  RecorderState,
  RecordResult,
  ReplayLogData,
  OpenLimits,
  ReplayExpectation,
  ReplayPlayer,
  OpenResult,
} from './log';
export {
  SCENE_STEP,
  sceneReplayConfig,
  encodeSceneTick,
  createSceneInputTap,
  worldDigest,
  worldDigestText,
  WORLD_DIGEST_LIMITS,
  sceneTraceIdentity,
  sceneReplayDigest,
  recordSceneRun,
  replaySceneLog,
} from './scene';
export {
  replayDigest,
  selectWorldState,
  toReplayDigest,
  replayStateText,
  observeWorld,
  createDigestCoverage,
  SELECTION_LIMITS,
} from './state';
export type {WorldSelection, ReplayDigestInput, DigestCoverage, DigestCoverageTracker} from './state';
export {explainDivergence} from './explain';
export type {DivergenceExplanation, DivergenceExplainOptions, DivergenceKind} from './explain';
export type {SceneInputSpec, SceneTickFacts, SceneInputTap, SceneRunOptions, SceneReplayResult} from './scene';
export {checkPredictionAgreement} from './agreement';
export type {AgreementHost, AgreementOptions, AgreementReport} from './agreement';
