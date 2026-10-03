import { defineSaveSection, defineSystem, type SceneContext } from '@engine';
import { defineDeposit, createSurvey, createProduction, type ProductionOptions, type ProductionSnapshot } from '@kits/resources';

export const fieldDeposit = defineDeposit({ id: 'field-ore', revision: 1, seed: 741, cellSize: 4, expiresTick: 1000, reserve: 8,
  batch: { id: 'field-ore-v1', material: 'ore', properties: { conductivity: 40, strength: 80 } } });
export const productionOptions: ProductionOptions = {
  capacities: { hopper: 20, products: 5 }, deposits: [fieldDeposit],
  recipes: [{ id: 'field-plate', inputs: [{ batchId: fieldDeposit.batch.id, quantity: 2 }],
    output: { batch: { id: 'field-plate-v1', material: 'plate', properties: {} }, quantity: 1 },
    suitability: { weights: { conductivity: 1, strength: 3 }, property: 'suitability' } }],
  jobs: [
    { kind: 'harvester', id: 'field-extractor', depositId: fieldDeposit.id, x: 5, z: -2, container: 'hopper', startTick: 0, periodTicks: 1, powered: true },
    { kind: 'factory', id: 'field-press', recipeId: 'field-plate', inputContainer: 'hopper', outputContainer: 'products', startTick: 0, periodTicks: 10, powered: true, limit: 1 },
  ],
};
export interface ResourceStationSave { stage: 'ready' | 'surveyed' | 'harvested' | 'complete'; production: ProductionSnapshot }
export function initialResourceStation(): ResourceStationSave { return { stage: 'ready', production: createProduction(productionOptions).snapshot() }; }
export const resourceStationSave = defineSaveSection({ id: 'expedition.resources', initial: initialResourceStation(), parse(raw: unknown): ResourceStationSave {
  const value = raw as ResourceStationSave;
  if (!value || !['ready', 'surveyed', 'harvested', 'complete'].includes(value.stage)) throw Error('Invalid resource station');
  const model = createProduction(productionOptions, value.production);
  if (value.stage === 'complete' && model.quantity('products', 'field-plate-v1') !== 1) throw Error('Resource completion requires plate');
  return { stage: value.stage, production: model.snapshot() };
} });
export default resourceStationSave;
type Survey = ReturnType<typeof createSurvey>;
interface Owner { survey?: Survey | undefined; model: ReturnType<typeof createProduction>; active?: 'harvest' | 'craft' | undefined; changed(): void }
const owners = new WeakMap<SceneContext['world'], Owner>();
export function enterResources(ctx: SceneContext, changed: () => void): void {
  owners.set(ctx.world, { model: createProduction(productionOptions, ctx.save(resourceStationSave).get().production), changed });
  resourceView(ctx);
}
export function cancelResources(ctx: SceneContext): void {
  const owner = owners.get(ctx.world); if (!owner) return;
  owner.survey?.cancel(); owner.survey = undefined; owner.active = undefined; owner.changed();
}
export function exitResources(ctx: SceneContext): void { owners.get(ctx.world)?.survey?.cancel(); owners.delete(ctx.world); }
export function resourceView(ctx: SceneContext) {
  const owner = owners.get(ctx.world), saved = ctx.save(resourceStationSave).get();
  const model = owner?.model ?? createProduction(productionOptions, saved.production);
  const stage = owner?.survey ? 'scanning' : owner?.active === 'harvest' ? 'extracting' : owner?.active === 'craft' ? 'crafting' : saved.stage;
  const ore = model.quantity('hopper', fieldDeposit.batch.id), plates = model.quantity('products', 'field-plate-v1');
  ctx.state.resources = { stage, ore, plates, reserve: model.snapshot().remaining[fieldDeposit.id], revision: fieldDeposit.revision };
  return { message: `expedition.resource.${stage}`, action: `expedition.resource.action.${saved.stage}`, disabled: !!owner?.survey || !!owner?.active || saved.stage === 'complete', ore, plates };
}
export function actResources(ctx: SceneContext): void {
  const owner = owners.get(ctx.world); if (!owner || owner.survey || owner.active) return;
  const stage = ctx.save(resourceStationSave).get().stage;
  if (stage === 'ready') owner.survey = createSurvey(fieldDeposit, { x: 3, z: -4, columns: 5, rows: 5, spacing: 1 });
  else if (stage === 'surveyed') owner.active = 'harvest';
  else if (stage === 'harvested') owner.active = 'craft';
  owner.changed();
}
export const resourceStationSystem = defineSystem({ id: 'expedition-resource-station', phase: 'frame', run(ctx) {
  const owner = owners.get(ctx.world); if (!owner) return;
  if (owner.survey) {
    const result = owner.survey.step(4, fieldDeposit.revision).result;
    if (result.status === 'complete') {
      ctx.save(resourceStationSave).update(d => { d.stage = 'surveyed'; });
      owner.survey = undefined; owner.changed();
    }
  } else if (owner.active) {
    const jobId = owner.active === 'harvest' ? 'field-extractor' : 'field-press', target = owner.active === 'harvest' ? 8 : 10;
    const tick = owner.model.snapshot().jobs[jobId]!.tick;
    const result = owner.model.apply({ kind: 'advance', id: `${jobId}:${tick}:${target}`, jobId, toTick: target, maxTicks: 2, maxCycles: 1 }, owner.model.epoch);
    if (!result.ok) throw Error(`Resource station production: ${result.reason}`);
    const complete = !result.pending;
    if (complete) owner.model.checkpoint();
    ctx.save(resourceStationSave).update(d => { d.production = owner.model.snapshot(); if (complete) d.stage = owner.active === 'harvest' ? 'harvested' : 'complete'; });
    if (complete) owner.active = undefined;
    owner.changed();
  }
} });
