import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, Transform} from './defs';
import {Model} from './model';
import {ModelPoseLink} from './model-pose-link';
import {testScene} from './testing';

test('weighted scene admission remains opt-in and snapshots creator limits', () => {
  const ordinary = defineScene({id: 'ordinary', title: 'Ordinary'});
  assert.equal(ordinary.modelPoseLinks, undefined);
  const input = {maxLinks: 2, maxSkinVerticesPerModel: 99};
  const weighted = defineScene({id: 'weighted', title: 'Weighted', modelPoseLinks: input});
  input.maxLinks = 90;
  assert.equal(weighted.modelPoseLinks?.maxLinks, 2);
  assert.equal(weighted.modelPoseLinks?.maxSkinVerticesPerModel, 99);
  assert.ok(Object.isFrozen(weighted.modelPoseLinks));
  assert.throws(() => defineScene({id: 'bad', title: 'Bad', modelPoseLinks: {maxLinks: -1}}));
});
test('headless pose-link observations remain unresolved without renderer adoption and retire with visit', async () => {
  const visit = await testScene(defineScene({id: 'weighted', title: 'Weighted', modelPoseLinks: {}}));
  const source = visit.world.spawn(Transform(), Model({asset: 'source'}));
  const target = visit.world.spawn(Transform(), Model({asset: 'target'}));
  assert.equal(visit.ctx.modelPoseLinkState(target).status, 'unlinked');
  visit.world.add(target, ModelPoseLink({source, nodes: [{source: 'a', target: 'a'}], inheritVisibility: true}));
  assert.equal(visit.ctx.modelPoseLinkState(target).status, 'unresolved');
  visit.run(0.1);
  assert.equal(visit.ctx.modelPoseLinkState(target).status, 'unresolved');
  visit.dispose();
  assert.equal(visit.ctx.modelPoseLinkState(target).status, 'absent');
});
