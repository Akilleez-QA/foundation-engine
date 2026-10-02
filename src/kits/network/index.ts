/** Optional transport-neutral intake; constructs no socket, clock, loop, or global service. */
export { createNetworkIntake } from './intake';
export type { ConnectionHandle, NetworkLimits, NetworkPorts, NetworkContext, NetworkStaleContext, NetworkReason,
  NetworkRefusal, NetworkPeerState, NetworkStats, NetworkPumpResult, NetworkIntake } from './types';
export { createViewReceiver } from './view-receiver';
export { createViewPublisher } from './view-publisher';
export type { ViewLimits, ViewEntity, ViewFrame, ViewUnavailableFrame, ViewReceiveResult,
  ViewReceiverState, ViewReceiver, ViewPublisherPorts, ViewPublisherState, ViewPumpResult, ViewPublisher } from './view-types';

export { createDurableAuthority, createAuthorityGenesis } from './authority';
export type { AuthorityLimits, AuthorityReceipt, AuthorityStream, AuthorityEnvelope,
  AuthorityStorage, AuthorityValidation, AuthorityCommand, AuthorityReduction,
  AuthorityOptions, AuthoritySubmitOptions, AuthorityStatus, AuthorityOutcome, AuthoritySnapshot } from './authority-types';
export { createPrediction } from './prediction';
export type { Prediction, PredictionBaseline, PredictionInput, PredictionLimits,
  PredictionOptions, PredictionSnapshot, PredictionValue, PredictionRefusal } from './prediction-types';
export { createRetrySchedule } from './retry-schedule';
export type { RetrySchedule, RetryScheduleLimits, RetryScheduleOptions, RetryScheduleNext,
  RetryScheduleState } from './retry-schedule';
export { createRateAdmission } from './rate-admission';
export type { RateKey, RateLease, RateAdmission, RateAdmissionLimits, RateAdmissionResult,
  RateRefusalReason, RateKeyState, RateAdmissionStats } from './rate-admission';
export { createClosePolicy, DEFAULT_TERMINAL_CLOSE_REASONS, DEFAULT_TERMINAL_CLOSE_CODES,
  MAX_CLOSE_POLICY_ENTRIES } from './close-policy';
export type { ClosePolicy, ClosePolicyOptions, CloseClass } from './close-policy';
export { createConnectionDrain, createDrainFollower, DRAIN_CLOSE_CODE, MAX_DRAIN_KEYS,
  MAX_DRAIN_WINDOW_MS } from './drain';
export type { ConnectionDrain, ConnectionDrainLimits, ConnectionDrainOptions, ConnectionDrainState,
  ConnectionLifetimeLimits, DrainAction, DrainCause, DrainKey, DrainNotice, DrainStartResult, DrainTrackResult,
  DrainFollower, DrainFollowerLimits, DrainFollowerState, DrainNoticeResult, DrainCloseResult } from './drain';
export { createIntegrity, integrityOk, integrityReject, integrityFlag, integrityRules, INTEGRITY_CLOSE_REASON,
  INTEGRITY_AUDIT_FORMAT, MAX_INTEGRITY_RULES, MAX_INTEGRITY_WEIGHT } from './integrity';
export type { Integrity, IntegrityOptions, IntegrityLimits, IntegrityRule, IntegrityRuleBase, IntegrityInput,
  IntegrityVerdict, IntegrityFinding, IntegrityAssessment, IntegrityDecision, IntegrityRef, IntegrityMode,
  IntegrityAuditEntry, IntegrityKeyState, IntegrityStats, IntegrityRefusalReason, IntegrityTickClaim } from './integrity';
export { assertDisclosure, findDisclosureLeaks, MAX_DISCLOSURE_LEAKS } from './disclosure';
export type { DisclosureLeak, DisclosurePredicate } from './disclosure';
