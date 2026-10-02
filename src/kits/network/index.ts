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
