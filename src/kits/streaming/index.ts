/**
 * kits/streaming: optional on-demand streaming queue with byte and concurrency budgets, priorities, cancellation and
 * retry, composed with existing owners through ports (pure helper; no system, loader, cache or registration). Cost: no
 * draws; pump is O(running + waiting + starts × log queued).
 */
export {
  createStreamQueue,
  createStreamResult,
  STREAM_CEILING,
  type StreamEventKind,
  type StreamLimits,
  type StreamPoll,
  type StreamPort,
  type StreamPumpResult,
  type StreamPumpStatus,
  type StreamQueue,
  type StreamRequest,
  type StreamRequestStatus,
  type StreamState,
  type StreamStats,
  type StreamWork,
} from './queue';
export {
  leasePort,
  modelPort,
  promisePort,
  type ModelPortHost,
  type PromisePortOptions,
  type StreamValue,
} from './ports';
