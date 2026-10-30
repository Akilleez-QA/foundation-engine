import {defineKit, type KitDefinition} from '../../author';

/** Optional flow economy: stock and storage, income/upkeep, production queues with prerequisites, reclaim. */
export function economy(): KitDefinition {
  return defineKit({id: 'economy', requires: [], defs: [], modules: []});
}
export {
  defineEconomyRules,
  isEconomyRules,
  EconomyError,
  MAX_AMOUNT,
  MAX_WORK,
  type Amounts,
  type EconomyRules,
  type EconomyRulesInput,
  type ResourceInput,
  type ItemInput,
  type Item,
} from './rules';
export {
  createEconomy,
  RATE_ONE,
  type Economy,
  type EconomyOptions,
  type EconomyEvent,
  type EconomySnapshot,
  type QueueState,
  type QueueView,
  type TickReport,
} from './economy';
export {economyPresets} from './presets';
