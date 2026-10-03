import assert from 'node:assert/strict';
import test from 'node:test';
import {World} from '../../src/core/ecs/world.ts';
import {Shape, Name} from '../../src/author/defs.ts';
import {createReplicaProjection, Replica} from './projection.mjs';
const row = (id, incarnation = 0, fields = {value: 1, private: 'own'}) => ({
  id,
  incarnation,
  fields,
});
const view = (...entities) => ({entities});

test('complete fields and entity omissions replace actual ECS facts, preserving local entities', () => {
  const world = new World(),
    local = world.spawn(Name({name: 'local'})),
    owner = createReplicaProjection(world);
  assert.equal(owner.replace(view(row('a'), row('b'))).status, 'projected');
  const old = world.first(Replica)[0];
  assert.equal(owner.replace(view(row('a', 0, {value: 2}))).status, 'projected');
  assert.deepEqual(
    [...world.query(Replica)].map(([id, facts]) => ({id, facts})),
    [{id: old, facts: {id: 'a', incarnation: 0, fields: {value: 2}}}],
  );
  assert.equal(world.exists(local), true);
  assert.equal(world.count, 2);
});
test('changed incarnation and same-incarnation reappearance retire delayed presentation authority', () => {
  const world = new World(),
    owner = createReplicaProjection(world);
  owner.replace(view(row('a')));
  const first = world.first(Replica)[0],
    old = owner.prepareDecoration('a');
  owner.replace(view(row('a', 1)));
  assert.notEqual(world.first(Replica)[0], first);
  assert.equal(old(), false);
  const current = world.first(Replica)[0],
    omitted = owner.prepareDecoration('a');
  owner.replace(view());
  owner.replace(view(row('a', 1)));
  assert.notEqual(world.first(Replica)[0], current);
  assert.equal(omitted(), false);
  const live = owner.prepareDecoration('a');
  assert.equal(live(), true);
  assert.equal(live(), false);
  assert.equal(world.first(Shape)[1].color, 0xd987df);
  const exited = owner.prepareDecoration('a');
  owner.dispose();
  assert.equal(exited(), false);
  assert.equal(world.count, 0);
});
test('failure after partial allocation clears all replica rows, never unrelated local state', () => {
  const world = new World(),
    local = world.spawn(Name({name: 'local'}));
  let fail = true;
  const owner = createReplicaProjection(world, {
    beforeWrite: (_id, index) => {
      if (fail && index === 1) throw Error('injected');
    },
  });
  assert.equal(owner.replace(view(row('a'), row('b'))).status, 'failed');
  assert.equal(world.count, 1);
  assert.equal(world.exists(local), true);
  fail = false;
  assert.equal(owner.replace(view(row('a'), row('b'))).status, 'projected');
  assert.equal(world.count, 3);
  assert.equal(owner.replace(view(row('a', 0, {private: 'x', unexpected: true}))).status, 'failed');
  assert.equal(world.count, 1);
});
test('reentrant retirement cannot publish a later row or revive a disposed projection', () => {
  const world = new World();
  let owner;
  owner = createReplicaProjection(world, {
    beforeWrite: (_id, index) => {
      if (index === 1) owner.dispose();
    },
  });
  assert.equal(owner.replace(view(row('a'), row('b'))).status, 'retired');
  assert.equal(world.count, 0);
  assert.equal(owner.replace(view(row('a'))).status, 'retired');
});
test('overbound or duplicate identities fail closed before exposing a partial replacement', () => {
  const world = new World(),
    owner = createReplicaProjection(world, {maxEntities: 1});
  owner.replace(view(row('a')));
  assert.equal(owner.replace(view(row('b'), row('c'))).status, 'failed');
  assert.equal(world.count, 0);
  const other = createReplicaProjection(world);
  assert.equal(other.replace(view(row('a'), row('a', 1))).status, 'failed');
  assert.equal(world.count, 0);
});

test('reentrant clear interrupts the whole replacement without publishing later rows', () => {
  const world = new World();
  let owner;
  owner = createReplicaProjection(world, {
    beforeWrite: (_id, index) => {
      if (index === 1) owner.clear();
    },
  });
  assert.equal(owner.replace(view(row('a'), row('b'))).status, 'failed');
  assert.equal(world.count, 0);
});
