/**
 * kits/turns: deterministic command logs for turn-based, tactics and card rules, with undo, redo,
 * preview, replay, save snapshots and an adapter for the durable command authority.
 * Cost: no draws and no per-frame work; work happens only when a command, undo, redo or replay is called.
 */
import {defineKit, type KitDefinition} from '../../author';

export {createTurnLog, restoreTurnLog} from './log';
export type {
  TurnRules,
  TurnReduction,
  TurnLog,
  TurnLogLimits,
  TurnLogOptions,
  TurnLogSnapshot,
  TurnLogView,
  TurnSubmitResult,
  TurnPreviewResult,
  TurnMoveResult,
} from './log';
export {turnAuthorityPolicies, type TurnAuthorityResult} from './authority';

/** Headless helpers only: listing the kit records the choice; nothing is installed. */
export function turns(): KitDefinition {
  return defineKit({id: 'turns'});
}
