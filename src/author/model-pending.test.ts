import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {World} from '../core/ecs/world';
import {Transform, defineEntity} from './defs';
import {Model} from './model';
import {ModelAttachment} from './model-attachment';
import {ModelPoseLink} from './model-pose-link';
import {bodyHasModel, pendingAttachmentState, pendingModelState, pendingPoseLinkState} from './model-pending';
import {createSceneModels} from './scene-model';
import {createModelLibrary} from '../platform/assets/models';

test('before the model chunk arrives, the scene answers as the model owner does for an entity not admitted yet', () => {
  const world = new World(),
    life = new AbortController();
  const library = createModelLibrary({
    def: id => ({
      id,
      kind: 'model',
      title: id,
      licence: 'original',
      provenance: {},
      variants: [{path: id, format: 'glb'}],
    }),
    fetchBytes: async () => new ArrayBuffer(16),
    parse: async () => ({scene: new T.Group(), animations: []}),
  });
  // The real owner before its first sync: nothing admitted, which is what a scene without the chunk has.
  const owner = createSceneModels({
    world,
    scene: new T.Scene(),
    library,
    signal: life.signal,
    invalidate() {},
    report() {},
  });
  const plain = world.spawn(Transform());
  const parent = world.spawn(Transform(), Model({asset: 'parent'}));
  const entities = [
    plain,
    world.spawn(Model({asset: 'no-transform'})),
    parent,
    world.spawn(
      Transform(),
      Model({asset: 'held'}),
      ModelAttachment({parent, socket: 'hand', unavailable: 'hide', inheritVisibility: true}),
    ),
    world.spawn(
      Transform(),
      Model({asset: 'linked'}),
      ModelPoseLink({source: parent, nodes: [{source: 'a', target: 'a'}], inheritVisibility: false}),
    ),
  ];
  for (const e of entities) {
    assert.deepEqual(pendingModelState(world, e, false, false), owner.state(e), `state ${e}`);
    assert.deepEqual(pendingAttachmentState(world, e, false), owner.attachmentState(e), `attachment ${e}`);
    assert.deepEqual(pendingPoseLinkState(world, e, false), owner.poseLinkState(e), `pose link ${e}`);
    assert.equal(owner.socket(e, 'hand'), null);
  }
  assert.equal(pendingModelState(world, parent, false, false).status, 'loading');
  assert.equal(pendingModelState(world, parent, false, true).status, 'failed', 'a chunk that failed to load');
  // A closed visit answers absent, like a disposed owner.
  owner.dispose();
  for (const e of entities) {
    assert.deepEqual(pendingModelState(world, e, true, false), owner.state(e));
    assert.deepEqual(pendingAttachmentState(world, e, true), owner.attachmentState(e));
    assert.deepEqual(pendingPoseLinkState(world, e, true), owner.poseLinkState(e));
  }
  life.abort();
});

test('a scene body that starts with a Model loads the chunk before its first frame; others do not', () => {
  assert.equal(bodyHasModel([[Transform(), Model({asset: 'crate'})]]), true);
  assert.equal(bodyHasModel([defineEntity({id: 'prop', components: [Transform(), Model({asset: 'crate'})]})]), true);
  assert.equal(bodyHasModel([[Transform()], defineEntity({id: 'empty', components: [Transform()]})]), false);
  assert.equal(bodyHasModel([]), false);
});
