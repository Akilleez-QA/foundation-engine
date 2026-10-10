/**
 * Optional rollback kit: speculative execution with per-frame snapshots, rollback/resimulation and confirmed-state
 * checksums for deterministic fixed-step simulations, plus a local sync test. Constructs no transport, clock, loop
 * or global service; installs no definitions. See README.md.
 */
import {defineKit, type KitDefinition} from '../../author';

export {createRollbackSession} from './session';
export {createRollbackSyncTest} from './sync-test';
export {captureRollbackLimits, rollbackChecksum, ROLLBACK_LIMIT_RANGES} from './limits';
export {ROLLBACK_EXTENSION_RANGES} from './extensions';
export {createRollbackExchange} from './exchange';
export type {
  RollbackExchange,
  RollbackExchangeLimits,
  RollbackExchangeOptions,
  RollbackMessage,
  RollbackDepartureReport,
  RollbackReceiveResult,
  RollbackPacing,
} from './exchange';
export {createRollbackSpectator} from './spectator';
export type {RollbackSpectator, RollbackSpectatorOptions, RollbackSpectatorAdvance} from './spectator';
export {recommendInputDelay, recommendPacing} from './pacing';
export type {DelayRecommendationInput} from './pacing';
export {createDesyncEvidenceStore} from './evidence';
export type {
  DesyncEvidenceStore,
  DesyncEvidenceStoreOptions,
  DesyncEvidenceAdd,
  DesyncEvidenceComparison,
} from './evidence';
/** Test utility (any kit's tests may import it): a seeded, caller-driven lossy link. */
export {createLossyLink} from './lossy-link';
export type {LossyLink, LossyLinkOptions, LossyLinkStats} from './lossy-link';
export type {
  RollbackLimits,
  RollbackPorts,
  RollbackOptions,
  RollbackStatus,
  RollbackRefusal,
  RollbackChecksum,
  RollbackDesync,
  RollbackLocalResult,
  RollbackRemoteResult,
  RollbackChecksumResult,
  RollbackAdvanceResult,
  RollbackStats,
  RollbackSnapshot,
  RollbackConfirmedState,
  RollbackSession,
  SyncTestOptions,
  SyncTestResult,
  SyncTest,
  RollbackDelayPolicy,
  RollbackDelayChange,
  RollbackDelayResult,
  RollbackDeparturePolicy,
  RollbackDeparture,
  RollbackDepartureResult,
  RollbackStart,
  RollbackEvidencePolicy,
  RollbackEvidenceChunk,
  RollbackEvidence,
  RollbackWireInput,
  RollbackHistoryResult,
} from './types';

/** Declares the kit in `defineGame({ kits })`; it contributes no definitions or modules. */
export function rollback(): KitDefinition {
  return defineKit({id: 'rollback'});
}
