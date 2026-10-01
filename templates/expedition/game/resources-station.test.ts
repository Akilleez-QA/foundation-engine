import test from 'node:test';
import assert from 'node:assert/strict';
import { testScene } from '@engine';
import { createProduction } from '@kits/resources';
import field from './field';
import game from './game';
import { resourceStationSave, productionOptions, fieldDeposit } from './resources-station';
const state = (t: Awaited<ReturnType<typeof testScene>>) => t.ctx.state.resources as { stage: string; ore: number; plates: number; reserve: number };
test('S7: survey, finite collection and crafting resume after exit without duplicate materials', async () => {
  const t = await testScene(field, { game });
  for(let i=0;i<8;i++){t.run(1/60);for(let j=0;j<5;j++)await Promise.resolve();}
  for (let i = 0; i < 3; i++) { t.press('expedition-next'); t.run(7); }
  t.press('expedition-next'); t.run(1 / 60); assert.equal(state(t).stage, 'scanning');
  t.press('expedition-cancel'); t.run(1 / 60); assert.equal(state(t).stage, 'ready');
  t.run(1); assert.equal(state(t).stage, 'ready', 'cancelled survey cannot publish');
  t.press('expedition-next'); t.run(0.2); assert.equal(state(t).stage, 'surveyed');
  t.press('expedition-next'); t.run(1 / 60);
  assert.equal(state(t).stage, 'extracting'); assert.equal(state(t).ore, 1);
  const savedCursor = t.ctx.save(resourceStationSave).get().production.jobs['field-extractor']!.tick;
  field.exit!(t.ctx); t.run(1);
  assert.equal(t.ctx.save(resourceStationSave).get().production.jobs['field-extractor']!.tick, savedCursor);
  field.enter!(t.ctx);
  t.press('expedition-next'); t.run(0.2);
  assert.equal(state(t).stage, 'harvested'); assert.equal(state(t).ore, 4); assert.equal(state(t).reserve, 4);
  t.press('expedition-next'); t.run(0.2);
  assert.equal(state(t).stage, 'complete'); assert.equal(state(t).plates, 1); assert.equal(state(t).ore, 2);
  const snapshot = resourceStationSave.section.parse(t.ctx.save(resourceStationSave).get());
  assert.equal(snapshot.production.epoch, 2); assert.equal(snapshot.production.commands.length, 0);
  const restored = createProduction(productionOptions, snapshot.production);
  assert.equal(restored.material('field-plate-v1')!.properties.suitability, 70);
  assert.equal(restored.quantity('hopper', fieldDeposit.batch.id) + 2 * restored.quantity('products', 'field-plate-v1') + snapshot.production.remaining[fieldDeposit.id]!, 8);
  field.exit!(t.ctx); field.enter!(t.ctx); t.press('expedition-next'); t.run(1);
  assert.equal(state(t).plates, 1); assert.equal(state(t).ore, 2); field.exit!(t.ctx);
});
test('resource completion cannot load without the corresponding output in the same snapshot', async () => {
  const { initialResourceStation } = await import('./resources-station');
  const bad = initialResourceStation(); bad.stage = 'complete';
  assert.throws(() => resourceStationSave.section.parse(bad));
});
