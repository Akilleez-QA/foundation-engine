/**
 * Optional input-history kit: frame-exact action history with press/release edges, buffered queries, opposite-action
 * cleaning, sequence matching and rollback-safe snapshots. Constructs no device reader, clock or global service and
 * installs no definitions. See README.md.
 */
import {defineKit, type KitDefinition} from '../../author';
import type {InputHistory} from './types';

export {createInputHistory, INPUT_HISTORY_LIMITS} from './history';
export {createInputPlayback, timelineFromHistory, PLAYBACK_LIMITS} from './playback';
export type {InputPlayback, PlaybackEvent, PlaybackOptions, PlaybackStatus, PlaybackStep} from './playback';
export type {
  OppositePolicy,
  InputHistoryOptions,
  RecordResult,
  SequenceStep,
  InputSequence,
  MatchOptions,
  EdgeKind,
  InputHistorySnapshot,
  InputHistory,
} from './types';

/**
 * Sample this tick's actions through the action layer (`ctx.input`), never raw devices: `held` from `held(id)` and
 * `taps` from `pressed(id)`, so a press released within the same tick is still recorded for one frame.
 */
export function sampleActions(
  input: {held(id: string): boolean; pressed(id: string): boolean},
  history: Pick<InputHistory, 'actions'>,
): {held: number; taps: number} {
  let held = 0,
    taps = 0;
  history.actions.forEach((id, i) => {
    if (input.held(id)) held = (held | (1 << i)) >>> 0;
    if (input.pressed(id)) taps = (taps | (1 << i)) >>> 0;
  });
  return {held, taps};
}

/** Declares the kit in `defineGame({ kits })`; it contributes no definitions or modules. */
export function inputHistory(): KitDefinition {
  return defineKit({id: 'input-history'});
}
