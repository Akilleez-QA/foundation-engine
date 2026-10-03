import test from 'node:test';
import assert from 'node:assert/strict';
import {World, component} from '../../src/core/ecs/world.ts';
import {TargetState, createTargetAdapter, createPresentationAdapter} from './adapters.mjs';
const Transform = component('transform', {x: 0, y: 0, z: 0, scale: 1}),
  Shape = component('shape', {kind: 'box', size: [1, 1, 1], color: 0, visible: true});
function targets() {
  const world = new World(),
    adapter = createTargetAdapter({world, Transform});
  const entity = world.spawn(Transform(), TargetState());
  assert.equal(adapter.bind('target', entity).status, 'bound');
  return {world, adapter, entity};
}
test('S1 target captures actual component identity and relevant scalar state, ignoring cosmetic scale', () => {
  const {world, adapter, entity} = targets(),
    a = adapter.capture('target');
  assert.ok(adapter.same(a));
  world.get(entity, Transform).scale = 2;
  assert.ok(adapter.same(a));
  world.get(entity, Transform).x = 1;
  assert.equal(adapter.same(a), false);
  const b = adapter.capture('target');
  world.get(entity, TargetState).enabled = false;
  assert.equal(adapter.same(b), false);
  const c = adapter.capture('target');
  world.add(entity, TargetState({enabled: false}));
  assert.equal(adapter.same(c), false);
  const d = adapter.capture('target');
  world.add(entity, Transform({x: 1, scale: 2}));
  assert.equal(adapter.same(d), false);
  assert.equal(adapter.same({...adapter.capture('target')}), false);
});
test('S1 target rebind and same-label respawn never revive tokens; capacity and disposal explicit', () => {
  const {world, adapter, entity} = targets(),
    old = adapter.capture('target');
  adapter.bind('target', entity);
  assert.equal(adapter.same(old), false);
  const current = adapter.capture('target');
  world.despawn(entity);
  const replacement = world.spawn(Transform(), TargetState());
  adapter.bind('target', replacement);
  assert.equal(adapter.same(current), false);
  for (let i = 0; i < 3; i++)
    assert.equal(adapter.bind(`other${i}`, world.spawn(Transform(), TargetState())).status, 'bound');
  assert.equal(adapter.bind('overflow', world.spawn(Transform(), TargetState())).status, 'capacity');
  const live = adapter.capture('target');
  adapter.dispose();
  assert.equal(adapter.same(live), false);
  assert.equal(adapter.capture('target'), null);
  assert.equal(adapter.bind('new', replacement).status, 'retired');
});
test('S1 target required component removal and unsupported accessor facts reject authority', () => {
  const {world, adapter, entity} = targets();
  const captured = adapter.capture('target');
  world.remove(entity, TargetState);
  assert.equal(adapter.same(captured), false);
  assert.equal(adapter.capture('target'), null);
  world.add(entity, TargetState());
  Object.defineProperty(world.get(entity, TargetState), 'revision', {
    get() {
      adapter.dispose();
      return 0;
    },
  });
  assert.equal(adapter.capture('target'), null);
});
test('S1 marker presentation updates actual ECS cue, bounded overflow preserves cursor and seek skips cues', () => {
  const world = new World(),
    p = createPresentationAdapter({world, Transform, Shape});
  p.begin('action', {position: [1, 2, 3]});
  assert.equal(p.advance('action', 0.25).status, 'presented');
  let row = p.read('action');
  assert.equal(row.time, 0.25);
  assert.equal(row.emitted, 1);
  assert.ok(world.exists(row.entity));
  assert.equal(world.get(row.entity, Transform).x, 1);
  assert.equal(world.get(row.entity, Shape).kind, 'sphere');
  const before = world.version;
  assert.equal(p.advance('action', 0.25).events.length, 0);
  assert.equal(world.version, before);
  assert.equal(p.advance('action', 100).status, 'refused');
  assert.equal(p.read('action').time, 0.25);
  p.seek('action', 100);
  assert.equal(world.count, 0);
  assert.equal(p.read('action').emitted, 1);
  assert.equal(p.advance('action', 100.25).events.length, 1);
  p.dispose();
  assert.equal(world.count, 0);
});
test('S1 missing cue and cancelled retained callback never acquire consequence authority', () => {
  const world = new World(),
    p = createPresentationAdapter({world, Transform, Shape});
  p.begin('a', {available: false});
  assert.equal(p.advance('a', 0.25).status, 'skipped');
  assert.equal(world.count, 0);
  const late = p.captureAdvance('a');
  p.setAvailable('a', true);
  assert.equal(p.advance('a', 0.75).status, 'presented');
  const entity = p.read('a').entity;
  assert.ok(world.exists(entity));
  p.cancel('a');
  assert.equal(world.exists(entity), false);
  assert.equal(late(1.25).status, 'stale');
  assert.equal(p.begin('a').status, 'duplicate');
  p.dispose();
  assert.equal(late(2).status, 'retired');
});
test('S1 presentation retains terminal IDs within finite session capacity', () => {
  const world = new World(),
    p = createPresentationAdapter({world, Transform, Shape});
  for (let i = 0; i < 32; i++) {
    assert.equal(p.begin(String(i)).status, 'started');
    p.cancel(String(i));
  }
  assert.equal(p.begin('overflow').status, 'capacity');
  assert.equal(world.count, 0);
  p.dispose();
  assert.equal(p.begin('again').status, 'retired');
});

test('S1 presentation disposal during position or native cue construction leaves no admitted work', () => {
  const world = new World();
  let p = createPresentationAdapter({world, Transform, Shape});
  const point = [0, 0, 0];
  Object.defineProperty(point, 0, {
    get() {
      p.dispose();
      return 0;
    },
  });
  assert.equal(p.begin('late', {position: point}).status, 'retired');
  assert.equal(p.read('late'), null);
  const during = values => {
    p.dispose();
    return Transform(values);
  };
  p = createPresentationAdapter({world, Transform: during, Shape});
  p.begin('cue');
  assert.equal(p.advance('cue', 0.25).status, 'retired');
  assert.equal(world.count, 0);
});

test('S1 accessor-backed target facts cannot mutate earlier captured scalar or acquire authority', () => {
  const {world, adapter, entity} = targets(),
    captured = adapter.capture('target');
  let reads = 0;
  Object.defineProperty(world.get(entity, TargetState), 'enabled', {
    get() {
      reads++;
      world.get(entity, Transform).x = 99;
      return true;
    },
  });
  assert.equal(adapter.same(captured), false);
  assert.equal(adapter.capture('target'), null);
  assert.equal(reads, 0);
  assert.equal(world.get(entity, Transform).x, 0);
});
test('S1 recursive native cue advance and seek refuse without orphaning an entity or changing cursor', () => {
  const world = new World();
  let p,
    nested,
    seek,
    once = true;
  const Wrapped = Object.assign(
    values => {
      if (once) {
        once = false;
        nested = p.advance('a', 0.75);
        seek = p.seek('a', 10);
      }
      return Transform(values);
    },
    {id: Transform.id},
  );
  p = createPresentationAdapter({world, Transform: Wrapped, Shape});
  p.begin('a');
  assert.equal(p.advance('a', 0.25).status, 'presented');
  assert.equal(nested.status, 'refused');
  assert.equal(seek.status, 'refused');
  assert.equal(p.read('a').time, 0.25);
  assert.equal(p.read('a').emitted, 1);
  assert.equal(world.count, 1);
  p.dispose();
  assert.equal(world.count, 0);
});
test('S1 losing cue availability during native creation removes the just-created entity', () => {
  const world = new World();
  let p,
    once = true;
  const Wrapped = Object.assign(
    values => {
      if (once) {
        once = false;
        assert.equal(p.setAvailable('a', false).status, 'unavailable');
      }
      return Transform(values);
    },
    {id: Transform.id},
  );
  p = createPresentationAdapter({world, Transform: Wrapped, Shape});
  p.begin('a');
  assert.equal(p.advance('a', 0.25).status, 'skipped');
  assert.equal(p.read('a').available, false);
  assert.equal(p.read('a').entity, null);
  assert.equal(p.read('a').emitted, 0);
  assert.equal(world.count, 0);
  assert.equal(p.advance('a', 0.75).status, 'skipped');
  assert.equal(world.count, 0);
  p.setAvailable('a', true);
  assert.equal(p.advance('a', 1.25).status, 'presented');
  assert.equal(world.count, 1);
  p.dispose();
  assert.equal(world.count, 0);
});
