/**
 * kits/sequence: bounded multi-track cue sequences with barriers, held cues, exactly-once effect intents, skip,
 * cancellation and save-section snapshots. Pure data and functions: no draws, no system, no timers; the caller
 * advances it from its own fixed-step system. Cost: O(transitions × tracks) per advance, bounded per call.
 */
import {defineKit, type KitDefinition} from '../../author';
export {
  createSequence,
  defineSequence,
  parseSequenceState,
  SEQUENCE_LIMITS,
  type AdvanceResult,
  type SequenceActive,
  type SequenceCue,
  type SequenceDefinition,
  type SequenceDefinitionInput,
  type SequenceEvent,
  type SequenceRunner,
  type SequenceState,
  type SequenceStatus,
  type SequenceTrack,
} from './sequence';
export {defineSequenceSection, type SequenceRecord} from './section';

/** The kit: nothing to register; use the helpers from a system you own. */
export function sequence(): KitDefinition {
  return defineKit({id: 'sequence'});
}
export {
  createCast,
  defineCast,
  CAST_LIMITS,
  type Cast,
  type CastDefinition,
  type CastRole,
  type CastStart,
} from './cast';
export {
  createSequenceGraph,
  defineSequenceGraph,
  parseSequenceGraphState,
  GRAPH_LIMITS,
  type SequenceBranch,
  type SequenceGraph,
  type SequenceGraphInput,
  type SequenceGraphRunner,
  type SequenceGraphState,
} from './graph';
export {createEventArbiter, ARBITER_LIMITS, type ArbiterSource, type Claim, type EventArbiter} from './arbiter';
