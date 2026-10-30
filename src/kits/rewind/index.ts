/** Optional bounded sample history for time-addressed queries; live state, hit tests and policy stay creator-owned. */
export {createRewindHistory, chooseRewindTime} from './history';
export type {
  RewindBlend,
  RewindHistory,
  RewindLimits,
  RewindOptions,
  RewindRecordStatus,
  RewindSampleResult,
  RewindStats,
  RewindSubject,
  RewindTime,
  RewindTimeRequest,
} from './history';
