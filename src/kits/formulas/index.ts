import {defineKit, type KitDefinition} from '../../author';

/** Optional data-defined formulas: expressions, formula sheets, modifier stacking and a damage model. No systems. */
export function formulas(): KitDefinition {
  return defineKit({id: 'formulas', requires: [], defs: [], modules: []});
}
export {
  compileExpression,
  evaluateExpression,
  isFormulaName,
  FormulaError,
  FORMULA_OPERATORS,
  DEFAULT_EXPRESSION_LIMITS,
  type Expr,
  type RandomSource,
  type ExpressionLimits,
  type CompiledExpression,
  type Scope,
} from './expression';
export {parseFormula} from './parse';
export {
  defineFormulaSheet,
  evaluateSheet,
  type FormulaSheet,
  type FormulaSheetInput,
  type FormulaStep,
  type FormulaStepInput,
  type FormulaResult,
  type FormulaTraceRow,
} from './sheet';
export {
  defineStacking,
  applyStacking,
  createDamageModel,
  type Stacking,
  type StackingStage,
  type StackingStageInput,
  type Contribution,
  type StageTrace,
  type DamageModel,
  type DamageModelInput,
  type DamageRequest,
  type DamageResult,
} from './damage';
export {formulaPresets} from './presets';
