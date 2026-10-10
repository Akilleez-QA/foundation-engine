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
  `sqrt`, `pow`, `exp`, `log`, `if`, `rand()` in [0,1), `roll(n)` an integer in 0..n−1 (add 1 for dice), `chance(p)`
  1 or 0) into the same data. Runs of `+`, `*`, `&&` and `||` become one variadic node (up to 64 arguments, still
  evaluated left to right), so long sums stay shallow. Store either form. Evaluation takes a `compileExpression` result,
  and `evaluateSheet`/`applyStacking`/`createDamageModel` accept only objects their own `define…` functions returned.
- **Sheets** (`defineFormulaSheet`) list inputs, named constants and ordered steps. A step reads inputs, constants and
  earlier steps only; unknown names, forward/self references and duplicates are refused when the sheet is defined.
  `evaluateSheet(sheet, inputs, {random, trace})` returns every step value, the last value, the draw count and,
  with `trace`, each step's value and draws.
- **Stacking** (`defineStacking`, `applyStacking`) runs stages in declared order. `add` stages add the combined term;
  `multiply` stages multiply by `1 + term`. Combine rules: `sum`, `max`, `min` (strongest/weakest only) and
  `product` (independent multipliers, `Π(1+v) − 1`). Each stage clamps its term to `[min, max]`; a multiply factor
  never goes below zero; bounds apply only to stages that received contributions. Contributions combine in (source,
  value) order, so the same set of rows gives the same bits whatever order they are supplied in.
- **Damage model** (`createDamageModel`): sheet → miss check (`hitStep` 0 means miss) → immunity (the caller
  supplies the defender's resistance fraction for this damage type; at or above `immuneAt` resolves to `immune`
  before any modifier arithmetic) → stacking → resistance (clamped to `[min, max]`, negative is weakness) → rounding
  → `[minimum, maximum]`. `immuneAt` must exceed the minimum resistance, or be null for no immunity. The result keeps the base, every stage trace and the sheet result.
  `criticalStep` is reported; fold the critical multiplier into the sheet so its order is explicit.

## Composition with existing owners

- Stats come from the capabilities kit: pass `createModifiers(...).values()` (or timed contributions' values) as
  sheet inputs. This kit does not own stat sources; it evaluates them.
- Use a model inside combat's `resolveAction`: `mitigate: amount => Math.min(amount, model.resolve({inputs:
  {...stats, attack: amount}}, ctx.random).amount)`. `resolveAction` refuses mitigation above the amount, and a
  model can exceed it (buffs, weakness, a minimum of 1); the clamp keeps that contract. `resolveAction` has its own
  `hit` rule: either decide hits there and leave `hitStep` unset, or make `rules.hit` return true and let the sheet
  decide, never both.
- Status effects and equipment can contribute stacking rows with their own `source` ids.

## Determinism and bounds

Arithmetic uses correctly rounded IEEE operations, `Math.sqrt` (formally implementation-approximated in ECMAScript;
the engine's dmath golden vectors and browser check rely on it being the correctly rounded square root) and the
deterministic `dmath` (`pow`, `exp`, `log`), so equal inputs and draws give equal bits. Zero results are normalised to
+0. Every intermediate value must be finite;
division or modulo by zero, roots/logs of out-of-domain values and non-integer powers of negatives throw
`FormulaError`. Random draws come only from the supplied source (use `ctx.random` or a `createSaveableRng` stream and
save its state); `if`, `&&` and `||` short-circuit, so only the branch taken draws, and `sheet.maxDraws` is the
bound. A failing evaluation does not return draws it already took: save the stream state first if a retry must not
advance it.

Bounds: 512 nodes and depth 32 per expression by default (up to 4,096 / 64), 64 steps, 64 inputs and 64 constants per
sheet by default (`maxSteps`/`maxInputs` up to 1,024; `maxInputs` bounds inputs and constants separately), formula text 4,096 characters, 64 arguments per operator, 256 stacking contributions per call
(up to 4,096) and 32 stages. One evaluation does at most `sheet.nodes` operations; there is no loop or recursion in
the language. Inputs are captured as plain data (accessors and symbols are refused); compiled sheets are frozen.
Names are dot-separated identifiers of at most 64 characters; operator names (`min`, `max`, `if`, …) and
`__proto__`/`constructor`/`prototype` cannot be variables. Literals that underflow to zero are refused. Presets are
deeply frozen: copy one (`structuredClone`) before changing it.

## Presets

`formulaPresets` holds plain sheet inputs to copy and tune: `arcadeSubtract`, `ratio` (sim-lite),
`armorPercent`, `collectibleRpg` (level-scaled integer damage with critical and 217–255/255 variance) and the
named `jadeCocoonDamage`, a transcription of Jade Cocoon (1998) ordinary HP damage from the arithmetic recovered by
the community reconstruction github.com/phoenixfire808/jade-cocoon-rust-engine (revision 91b5741, `src/retail.rs`).
No code is included. The preset takes the game's own raw rolls as inputs; its doc comment lists what is not
reproduced (drain, reflection, status application, 32-bit overflow) and the model `minimum` that keeps negative
amounts. Its test compares the formula data against a direct TypeScript transliteration of the same function over
2,000 seeded cases (including negative modifiers): that checks this kit's evaluation of the transcription, not the
reconstruction's fidelity to the original executable, which is its own claim.

## Importing spreadsheet data

Creators often keep balance in a spreadsheet, or recover tables (level curves, type charts, item lists) from an
original game's data or a published reference. `npm run formulas:import -- <file.csv|tsv> <out.json> --kind
sheet|table|matrix` turns the export into JSON to commit; the same checks run in the command and when the game
loads the file, and every refusal names the line (and column) of the export; blank lines and all-empty `,,` rows
are skipped. Input is UTF-8 (BOM optional) or UTF-16 with a BOM; invalid bytes are refused.

- `sheet`: rows `kind,id,value` with `input` (no value), `constant` (a number) or `step` (formula text). Load with
  `defineFormulaSheet(json)`.
- `table`: a header (`key`, then column names), one row per key (`1`, `2`, `12`, `sword`): load with
  `defineFormulaTable(json)`, read with `tableValue(table, row, column)` or pass `tableRow(table, row, prefix,
  columns)` as sheet inputs. Column names must be formula names; row keys are any short text.
- `matrix`: a header of column keys (first cell ignored), one row per row key: a type chart, read with `tableValue`.

Numbers are plain decimal or exponent notation (no hex, thousands separators or locale commas), finite, and not
underflowing to zero. The output keeps `meta`: `source` (default the file name), `sourceSha256` of the input, and
`--author`, `--licence`, `--note`, so a recovered table stays attributable. In code, `parseDelimited`,
`importFormulaSheet` and `importFormulaTable` do the same without files. Bounds: 4,096 rows, 256 columns,
4,096-character cells (all adjustable in code), 16 MiB of input. Tables are frozen; the lookups refuse unknown rows
and columns (a missing type in a chart is a data bug, not zero). [ADR 0132](../../../docs/adr/0132-formula-data-import.md).

## Cost and limitations

Zero draws/triangles and no idle work. Evaluation is a tree walk that allocates small arrays for variadic operators;
it is meant for per-action resolution, not thousands of evaluations per frame (measure before using it in a hot loop).
It is not a scripting language: no loops, strings, tables or side effects inside expressions. Lookup tables (type
charts, resistances, level curves) are separate frozen data (`defineFormulaTable`, see Importing spreadsheet data)
that the caller reads into inputs. No browser, game or device acceptance is claimed.
