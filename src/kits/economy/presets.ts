import type {EconomyRulesInput} from './rules';

/**
 * Starting points to copy and tune (plain data; `structuredClone` before editing). Amounts use 1,000 units per
 * displayed unit so per-tick incomes can be fractional; work is in 60 Hz ticks at normal rate.
 */
export const economyPresets = Object.freeze({
  /** Two flowing resources drawn as work progresses; every builder slows equally when stock runs short. */
  flowEconomy: {
    costModel: 'streamed',
    refundPercent: 100,
    resources: [
      {id: 'metal', capacity: 1_000_000, initial: 500_000},
      {id: 'energy', capacity: 1_000_000, initial: 1_000_000},
    ],
    items: [
      {id: 'extractor', cost: {metal: 50_000, energy: 500_000}, work: 300},
      {id: 'generator', cost: {metal: 150_000}, work: 240},
      {id: 'storage', cost: {metal: 200_000, energy: 1_000_000}, work: 480},
      {id: 'workshop', cost: {metal: 600_000, energy: 1_200_000}, work: 900, grants: ['workshop']},
      {id: 'lab', cost: {metal: 400_000, energy: 2_000_000}, work: 1200, requires: ['workshop'], grants: ['tier-2']},
      {id: 'light-unit', cost: {metal: 50_000, energy: 600_000}, work: 180, requires: ['workshop']},
      {id: 'heavy-unit', cost: {metal: 350_000, energy: 4_000_000}, work: 900, requires: ['workshop', 'tier-2']},
    ],
  } satisfies EconomyRulesInput,

  /** One currency paid in full before work starts; a queue waits until it can afford its head. */
  upfrontBuilder: {
    costModel: 'upfront',
    refundPercent: 75,
    resources: [{id: 'gold', capacity: 10_000, initial: 500}],
    items: [
      {id: 'house', cost: {gold: 100}, work: 600, grants: ['housing']},
      {id: 'market', cost: {gold: 400}, work: 1800, requires: ['housing'], grants: ['trade']},
      {id: 'caravan', cost: {gold: 150}, work: 900, requires: ['trade']},
    ],
  } satisfies EconomyRulesInput,
});
