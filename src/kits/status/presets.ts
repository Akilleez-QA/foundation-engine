import type {StatusDefinitionInput} from './rules';

/**
 * Starting points to copy and tune. Ticks assume the 60 Hz fixed step (60 ticks = 1 s). Keys, flags and tags are
 * example vocabulary; rename them to the game's.
 */
export const statusPresets = Object.freeze({
  /** Damage over time with independent stacks: each application lasts its own 5 s and pulses every second. */
  damageOverTime: Object.freeze([
    {id: 'poison', maxStacks: 5, duration: 300, policy: 'independent', period: 60, tags: ['debuff', 'toxin']},
  ] satisfies StatusDefinitionInput[]),

  /**
   * Build-up and transform: chill stacks slow the target, bleed away when not refreshed, and at 100 stacks become a
   * 3 s freeze that raises `immobile` and grants 2 s of immunity to both on its end. Burn stacks fire an `ignite`
   * trigger at 100 and are consumed; the game resolves the burst.
   */
  buildup: Object.freeze([
    {
      id: 'chill',
      maxStacks: 100,
      duration: 300,
      decay: {every: 12, stacks: 5},
      threshold: {stacks: 100, become: 'frozen'},
      tags: ['debuff', 'cold'],
      contributes: [{key: 'moveSpeed', value: -0.004, perStack: true}],
    },
    {
      id: 'frozen',
      duration: 180,
      flags: ['immobile', 'disarmed'],
      tags: ['debuff', 'cold', 'control'],
      contributes: [{key: 'damageTaken', value: 0.25}],
      afterImmunity: {ids: ['chill', 'frozen'], ticks: 120},
    },
    {
      id: 'burn',
      maxStacks: 100,
      duration: 240,
      decay: {every: 12, stacks: 5},
      period: 30,
      threshold: {stacks: 100, trigger: 'ignite'},
      tags: ['debuff', 'heat'],
    },
  ] satisfies StatusDefinitionInput[]),

  /** Collectible-RPG archetype: one major ailment at a time; a second is refused while one is active. */
  exclusiveAilments: Object.freeze([
    {id: 'asleep', duration: 240, group: 'major', flags: ['cannot-act'], tags: ['ailment']},
    {id: 'poisoned', group: 'major', period: 60, tags: ['ailment']},
    {id: 'burned', group: 'major', period: 60, contributes: [{key: 'attack', value: -0.5}], tags: ['ailment']},
    {id: 'paralyzed', group: 'major', contributes: [{key: 'speed', value: -0.75}], tags: ['ailment']},
    {id: 'frozen-solid', group: 'major', flags: ['cannot-act'], tags: ['ailment']},
  ] satisfies StatusDefinitionInput[]),

  /** Control with diminishing returns: a stun grants 5 s of stun immunity when it ends. */
  controlImmunity: Object.freeze([
    {
      id: 'stunned',
      duration: 90,
      flags: ['cannot-act'],
      tags: ['control'],
      afterImmunity: {ids: ['stunned'], ticks: 300},
    },
    {
      id: 'haste',
      duration: 600,
      policy: 'extend',
      maxDuration: 1200,
      contributes: [{key: 'speed', value: 0.3}],
      tags: ['buff'],
    },
  ] satisfies StatusDefinitionInput[]),
});
