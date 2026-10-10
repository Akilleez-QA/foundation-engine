/** Optional per-recipient replication: quantized field schema, byte-budgeted scheduling and an order-safe replica. */
export {defineFieldSchema, MAX_FIELDS} from './schema';
export type {FieldSchema, FieldSpec} from './schema';
export {createReplicationSchedule} from './schedule';
export type {
  BuildResult,
  BuildStatus,
  RelevantOptions,
  ReplicationEntityId,
  ReplicationLimits,
  ReplicationOptions,
  ReplicationSchedule,
  ReplicationStats,
} from './schedule';
export {createReplica} from './replica';
export type {Replica, ReplicaApplyResult, ReplicaLimits} from './replica';
