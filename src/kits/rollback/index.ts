/**
 * Optional rollback kit: speculative execution with per-frame snapshots, rollback/resimulation and confirmed-state
 * checksums for deterministic fixed-step simulations, plus a local sync test. Constructs no transport, clock, loop
 * or global service; installs no definitions. See README.md.
 */
import { defineKit, type KitDefinition } from '../../author';

export { createRollbackSession } from './session';
export { createRollbackSyncTest } from './sync-test';
export { captureRollbackLimits, rollbackChecksum, ROLLBACK_LIMIT_RANGES } from './limits';
export type {
  RollbackLimits, RollbackPorts, RollbackOptions, RollbackStatus, RollbackRefusal, RollbackChecksum, RollbackDesync,
  RollbackLocalResult, RollbackRemoteResult, RollbackChecksumResult, RollbackAdvanceResult, RollbackStats,
  RollbackSnapshot, RollbackConfirmedState, RollbackSession, SyncTestOptions, SyncTestResult, SyncTest,
} from './types';

/** Declares the kit in `defineGame({ kits })`; it contributes no definitions or modules. */
export function rollback(): KitDefinition {
  return defineKit({ id: 'rollback' });
}
