# Formulas

Optional kit (`formulas()`, no dependencies, no systems, no rendering). It turns stat and damage arithmetic into
validated data: expressions, ordered formula sheets, modifier stacking stages and a damage model. The creator owns
every rule, constant and table; the kit owns validation, evaluation order, determinism and bounds.

```ts
import {createDamageModel, defineFormulaSheet, defineStacking, formulaPresets} from '@kits/formulas';

const sheet = defineFormulaSheet({
  inputs: ['attack', 'defense', 'critRate'],
  constants: {critMultiplier: 1.5},
  steps: [
    {id: 'crit', expr: {text: 'chance(critRate)'}},
    {id: 'amount', expr: {text: 'max(1, attack - defense) * if(crit, critMultiplier, 1)'}},
  ],
});
const model = createDamageModel({
  sheet,
  criticalStep: 'crit',
  stacking: defineStacking([
    {id: 'flat', apply: 'add', combine: 'sum'},
    {id: 'empower', apply: 'multiply', combine: 'max'}, // strongest buff only
    {id: 'surge', apply: 'multiply', combine: 'sum', max: 0.5}, // additive, capped at +50%
  ]),
  resistance: {min: -1, max: 0.9, immuneAt: 1},
  rounding: 'floor',
  minimum: 1,
});
// In a fixed system: ctx.random is the run's seeded stream, so `?seed=` replays the same rolls.
const hit = model.resolve(
  {inputs: {attack: 40, defense: 12, critRate: 0.1}, contributions: [{stage: 'empower', value: 0.25, source: 'banner'}],
   resistance: resistTable[type] ?? 0},
  ctx.random,
);
```

## Inputs and outputs

- **Expressions** are JSON: a finite number, a variable name, or `[operator, ...arguments]`. `parseFormula(text)`
  turns the text form (`a + b * c`, `a // b` truncating division, `a ^ b`, `&&`, `||`, `!`, comparisons, and any
  operator as a function: `min`, `max`, `clamp`, `floor`, `ceil`, `round` (half away from zero), `trunc`, `abs`,
  `sqrt`, `pow`, `exp`, `log`, `if`, `rand()`, `roll(n)`, `chance(p)`) into the same data. Store either form.
- **Sheets** (`defineFormulaSheet`) list inputs, named constants and ordered steps. A step reads inputs, constants and
  earlier steps only; unknown names, forward/self references and duplicates are refused when the sheet is defined.
  `evaluateSheet(sheet, inputs, {random, trace})` returns every step value, the last value, the draw count and,
  with `trace`, each step's value and draws.
- **Stacking** (`defineStacking`, `applyStacking`) runs stages in declared order. `add` stages add the combined term;
  `multiply` stages multiply by `1 + term`. Combine rules: `sum`, `max`, `min` (strongest/weakest only) and
  `product` (independent multipliers, `Π(1+v) − 1`). Each stage clamps its term to `[min, max]`; a multiply factor
  never goes below zero. Contributions combine in (source, supplied) order, so the same set gives the same bits.
- **Damage model** (`createDamageModel`): sheet → miss check (`hitStep` 0 means miss) → stacking → resistance
  (the caller supplies the defender's fraction for this damage type; `immuneAt` resolves to `immune`, negative is
  weakness) → rounding → `[minimum, maximum]`. The result keeps the base, every stage trace and the sheet result.
  `criticalStep` is reported; fold the critical multiplier into the sheet so its order is explicit.

## Composition with existing owners

- Stats come from the capabilities kit: pass `createModifiers(...).values()` (or timed contributions' values) as
  sheet inputs. This kit does not own stat sources; it evaluates them.
- Use a model inside combat's `resolveAction`: `mitigate: amount => model.resolve({inputs: {...stats, attack:
  amount}}, ctx.random).amount` (respect `resolveAction`'s rule that mitigation never exceeds the amount).
- Status effects and equipment can contribute stacking rows with their own `source` ids.

## Determinism and bounds

Only correctly rounded IEEE operations, `Math.sqrt` and the engine's deterministic `dmath` (`pow`, `exp`, `log`) are
used, so equal inputs and draws give equal bits in every conforming engine. Every intermediate value must be finite;
division or modulo by zero, roots/logs of out-of-domain values and non-integer powers of negatives throw
`FormulaError`. Random draws come only from the supplied source (use `ctx.random` or a `createSaveableRng` stream and
save its state); `if`, `&&` and `||` short-circuit, so only the branch taken draws, and `sheet.maxDraws` is the
bound. A failing evaluation does not return draws it already took: save the stream state first if a retry must not
advance it.

Bounds: 512 nodes and depth 32 per expression by default (up to 4,096 / 64), 64 steps and 64 inputs/constants per
sheet (up to 1,024), formula text 4,096 characters, 64 arguments per operator, 256 stacking contributions per call
(up to 4,096) and 32 stages. One evaluation does at most `sheet.nodes` operations; there is no loop or recursion in
the language. Inputs are captured as plain data (accessors and symbols are refused); compiled sheets are frozen.
Names that equal an operator (`min`, `max`, `if`, …) cannot be variables.

## Presets

`formulaPresets` holds plain sheet inputs to copy and tune: `arcadeSubtract`, `ratio` (sim-lite),
`armorPercent`, `collectibleRpg` (level-scaled integer damage with critical and 217–255/255 variance) and the
named `jadeCocoonDamage`, a transcription of Jade Cocoon (1998) ordinary HP damage as documented by a community
clean-room reconstruction. The named preset takes the game's own raw rolls as inputs; its README comment lists what is
not reproduced (drain, reflection, status application, 32-bit overflow). Its test checks the transcription against an
independent transliteration over 2,000 seeded cases; parity with the original executable is the reconstruction's
claim, not verified here.

## Cost and limitations

Zero draws/triangles and no idle work. Evaluation is a tree walk that allocates small arrays for variadic operators;
it is meant for per-action resolution, not thousands of evaluations per frame (measure before using it in a hot loop).
It is not a scripting language: no loops, strings, tables or side effects. Lookup tables (type charts, resistances)
stay creator data that the caller reads into inputs. No browser, game or device acceptance is claimed.
