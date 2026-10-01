import test from 'node:test';
import assert from 'node:assert/strict';
import { defineScene, Transform } from './defs';
import { Model } from './model';
import { testScene } from './testing';

test('headless model state reports requested data without pretending to load or render', async () => {
  const scene = defineScene({ id: 'model-state-test', title: 'Model state', entities: [[Transform(), Model({ asset: 'example' })]] });
  const visit = await testScene(scene);
  const entity = [...visit.world.query(Model)][0][0];
  const state = visit.ctx.modelState(entity);
  assert.deepEqual(state, { status: 'loading', requestedAsset: 'example', adoptedAsset: null });
  assert.ok(Object.isFrozen(state));
  visit.run(1); assert.deepEqual(visit.ctx.modelState(entity), state);
  visit.dispose();
  assert.equal(visit.ctx.modelState(entity).status, 'absent');
});
