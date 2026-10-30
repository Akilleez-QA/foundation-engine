import type {FormulaSheetInput} from './sheet';

/**
 * Starting points, not rules. Each preset is plain data: copy it, change the constants or steps, and pass it to
 * `defineFormulaSheet`. Generic archetypes come first; named presets reproduce one published game's arithmetic as
 * documented by a clean-room reconstruction and say what is and is not reproduced.
 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

export const formulaPresets = deepFreeze({
  /** Arcade: attack minus defense, never below a floor. */
  arcadeSubtract: Object.freeze({
    inputs: ['attack', 'defense'],
    constants: {minimum: 1},
    steps: [{id: 'amount', expr: {text: 'max(minimum, attack - defense)'}}],
  }) satisfies FormulaSheetInput,

  /** Sim-lite ratio: attack² / (attack + defense); smooth, never zero for positive attack. */
  ratio: Object.freeze({
    inputs: ['attack', 'defense'],
    steps: [{id: 'amount', expr: {text: 'attack * attack / max(attack + defense, 1)'}}],
  }) satisfies FormulaSheetInput,

  /** Percentage armor: armor A keeps armorScale / (armorScale + A) of the power (A = armorScale halves it). */
  armorPercent: Object.freeze({
    inputs: ['power', 'armor'],
    constants: {armorScale: 100},
    steps: [{id: 'amount', expr: {text: 'power * armorScale / (armorScale + max(armor, 0))'}}],
  }) satisfies FormulaSheetInput,

  /**
   * Collectible-RPG archetype: level-scaled integer damage with a critical chance that doubles the level term and a
   * uniform 217–255 / 255 variance. Inputs: level, power (move strength), attack, defense, critRate (0–1),
   * bonus (one combined multiplier such as same-type × effectiveness, floored once; games that floor after each
   * factor need one step per factor). `roll(n)` draws an integer in 0..n−1.
   */
  collectibleRpg: Object.freeze({
    inputs: ['level', 'power', 'attack', 'defense', 'critRate', 'bonus'],
    constants: {varianceLow: 217, varianceSpan: 39, varianceScale: 255},
    steps: [
      {id: 'crit', expr: {text: 'chance(critRate)'}},
      {id: 'levelTerm', expr: {text: '(2 * level * (1 + crit)) // 5 + 2'}},
      {id: 'raw', expr: {text: '((levelTerm * power * attack) // max(defense, 1)) // 50 + 2'}},
      {id: 'scaled', expr: {text: 'floor(raw * bonus)'}},
      // A zero bonus (an immunity) stays zero; otherwise a landed hit deals at least 1.
      {
        id: 'amount',
        expr: {text: 'if(scaled == 0, 0, max(1, (scaled * (varianceLow + roll(varianceSpan))) // varianceScale))'},
      },
    ],
  }) satisfies FormulaSheetInput,

  /**
   * Named: Jade Cocoon (1998) ordinary HP damage, transcribed from the arithmetic that the community reconstruction
   * github.com/phoenixfire808/jade-cocoon-rust-engine (revision 91b5741, `src/retail.rs`, function `damage`) recovered
   * from the original executable. No code was copied; this is the same arithmetic written as formula data. Inputs are
   * the game's already-processed combat stats; `magic` and `sleep` are 0/1; `parity` is a non-negative integer
   * (an unsigned value in the original). `hitRoll` and `critRoll` are the raw draws of the game's own generator:
   * supply them to reproduce a recorded fight; drawing them from another generator keeps the rules, not the stream.
   * Reproduced: hit check, attack/defense ratio, critical ×7×0.25, elemental affinity, modifier, 1/32 scale, a zero
   * result raised to 1 and the parity bonus. A negative `modifier` yields a negative amount as in the original; to
   * keep it, create the model with `minimum: -Number.MAX_VALUE` (the model's default minimum is 0). Not reproduced:
   * drain, reflection, status application and 32-bit integer overflow.
   * Use `hitStep: 'hit'` and `criticalStep: 'crit'` with `createDamageModel`.
   */
  jadeCocoonDamage: Object.freeze({
    inputs: [
      'attack',
      'defense',
      'level',
      'power',
      'accuracy',
      'evasion',
      'critical',
      'antiCritical',
      'parity',
      'element',
      'affinity',
      'modifier',
      'magic',
      'sleep',
      'hitRoll',
      'critRoll',
    ],
    steps: [
      {id: 'acc', expr: {text: 'if(magic, 100 - (modifier < 0), accuracy - if(modifier < 0, 1, evasion))'}},
      {id: 'hit', expr: {text: '!(hitRoll % 100 > acc) || sleep'}},
      {id: 'ratio', expr: {text: '(100 * attack) // if(modifier < 0, 1, max(defense, 1))'}},
      {id: 'v1', expr: {text: 'attack * (level + 3) * sqrt(ratio) / 10 * power / 100 / 20'}},
      {id: 'crit', expr: {text: '!magic && critRoll % 100 < critical - antiCritical'}},
      {id: 'v2', expr: {text: 'if(crit, v1 * 7 * 0.25, v1)'}},
      {id: 'v3', expr: {text: 'if(element < 4, v2 * (sqrt(sqrt(1250 * affinity)) / 10), v2)'}},
      {id: 'v4', expr: {text: 'trunc(v3 * modifier * (1 / 32))'}},
      {id: 'amount', expr: {text: 'if(v4 == 0, 1, v4 + parity % 2)'}},
    ],
  }) satisfies FormulaSheetInput,
});
