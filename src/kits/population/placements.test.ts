import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlacementField,
  definePlacementSection,
  definePlacements,
  parsePlacementState,
  type PlacementInput,
  type PlacementState,
} from './index';
import {authorSaveHandle} from '../../author/save-handle';
import {createSaveStore} from '../../core/save/store';
import {MemoryBackend} from '../../core/save/storage-port';
import {World} from '../../core/ecs/world';
import {Transform} from '../../author';

const row: PlacementInput[] = [
  {id: 'crate-a', x: 10, z: 0, kind: 'crate', respawn: 'never'},
  {id: 'guard-b', x: 20, z: 0, kind: 'guard'},
  {id: 'coin-c', x: 30, z: 0, kind: 'coin', respawn: 'visit'},
  {id: 'far-d', x: 500, z: 0, kind: 'crate'},
];
const set = definePlacements({id: 'yard', placements: row});
const ids = (list: readonly {id: string}[]) => list.map(p => p.id);

test('placements spawn near an observer, despawn past the exit radius and come back', () => {
  const f = createPlacementField(set, {enterRadius: 15, exitRadius: 25});
  let u = f.update([{x: 0, z: 0}]);
  assert.deepEqual(ids(u.spawn), ['crate-a']);
  u = f.update([{x: 15, z: 0}]);
  assert.deepEqual(ids(u.spawn), ['guard-b', 'coin-c']);
  assert.deepEqual(f.live(), ['crate-a', 'guard-b', 'coin-c']);
  // Hysteresis: at x=36 crate-a is 26 away (beyond exit) but guard-b at 16 stays.
  u = f.update([{x: 36, z: 0}]);
  assert.deepEqual(u.despawn, ['crate-a']);
  assert.deepEqual(u.spawn, []);
  u = f.update([{x: 5, z: 0}]);
  assert.deepEqual(ids(u.spawn), ['crate-a']);
  assert.deepEqual(u.despawn, [], 'coin-c is 25 away: at the exit radius it stays');
});

test('destroyed placements follow their respawn policy; only never-depletion is persisted', () => {
  const f = createPlacementField(set, {enterRadius: 40});
  f.update([{x: 20, z: 0}]);
  assert.equal(f.destroyed('crate-a'), 'depleted');
  assert.equal(f.destroyed('guard-b'), 'waiting-to-leave');
  assert.equal(f.destroyed('coin-c'), 'gone-for-visit');
  assert.equal(f.destroyed('coin-c'), 'not-live');
  assert.deepEqual(f.update([{x: 20, z: 0}]).spawn, [], 'nothing returns while the observer stays');
  f.update([{x: 300, z: 0}]);
  assert.equal(f.status('guard-b'), 'dormant', 'released once every observer left');
  assert.deepEqual(ids(f.update([{x: 20, z: 0}]).spawn), ['guard-b']);
  assert.deepEqual(f.snapshot().depleted, ['crate-a']);
  const next = createPlacementField(set, {enterRadius: 40}, JSON.parse(JSON.stringify(f.snapshot())));
  assert.deepEqual(ids(next.update([{x: 20, z: 0}]).spawn), ['guard-b', 'coin-c'], 'visit depletion is not persisted');
  assert.equal(next.status('crate-a'), 'depleted');
  assert.equal(next.revive('crate-a'), 'dormant');
  assert.deepEqual(ids(next.update([{x: 20, z: 0}]).spawn), ['crate-a']);
});

test('caps defer work deterministically and returned placements retry', () => {
  const many = definePlacements({
    id: 'field',
    placements: Array.from({length: 40}, (_, i) => ({id: `p${i}`, x: i % 8, z: Math.floor(i / 8), kind: 'k'})),
  });
  const f = createPlacementField(many, {enterRadius: 100, maxLive: 10, maxSpawnsPerUpdate: 4, maxDespawnsPerUpdate: 3});
  const a = f.update([{x: 0, z: 0}]);
  assert.deepEqual(ids(a.spawn), ['p0', 'p1', 'p2', 'p3']);
  assert.equal(a.deferred, 36);
  f.update([{x: 0, z: 0}]);
  const c = f.update([{x: 0, z: 0}]);
  assert.equal(f.live().length, 10, 'live cap');
  assert.equal(c.spawn.length, 2);
  assert.equal(f.returned('p0'), 'dormant');
  assert.deepEqual(ids(f.update([{x: 0, z: 0}]).spawn), ['p0'], 'the lowest dormant placement retries first');
  const gone = f.update([{x: 9999, z: 9999}]);
  assert.deepEqual(gone.despawn, ['p0', 'p1', 'p2']);
  assert.equal(gone.deferred, 7);
});

test('definitions and snapshots are validated; edits and forged depletion are refused', () => {
  assert.throws(() => definePlacements({id: 'x', placements: []}), RangeError);
  assert.throws(() => definePlacements({id: 'x', placements: [row[0]!, row[0]!]}), RangeError);
  assert.throws(() => definePlacements({id: 'x', placements: [{...row[0]!, x: Number.NaN}]}), RangeError);
  assert.throws(
    () => definePlacements({id: 'x', placements: [{...row[0]!, respawn: 'sometimes' as never}]}),
    RangeError,
  );
  assert.throws(() => createPlacementField(set, {enterRadius: 10, exitRadius: 5}), RangeError);
  assert.throws(() => createPlacementField(set, {enterRadius: 10, maxLive: 0}), RangeError);
  const good = {version: 1, definition: 'yard', fingerprint: set.fingerprint, depleted: ['crate-a']};
  assert.deepEqual(parsePlacementState(set, good).depleted, ['crate-a']);
  const edited = definePlacements({id: 'yard', placements: [{...row[0]!, x: 11}, ...row.slice(1)]});
  assert.notEqual(edited.fingerprint, set.fingerprint);
  for (const bad of [
    {...good, fingerprint: edited.fingerprint},
    {...good, depleted: ['guard-b']},
    {...good, depleted: ['crate-a', 'crate-a']},
    {...good, depleted: ['nope']},
    {...good, extra: true},
    {...good, version: 2},
  ])
    assert.throws(() => parsePlacementState(set, bad), RangeError);
  const f = createPlacementField(set, {enterRadius: 10});
  assert.throws(() => f.update(Array.from({length: 9}, () => ({x: 0, z: 0}))), RangeError);
  assert.throws(() => f.update([{x: Infinity, z: 0}]), RangeError);
  assert.throws(() => f.destroyed('nope'), RangeError);
  f.dispose();
  assert.throws(() => f.update([]), /disposed/);
});

test('an ECS consumer spawns entities from intents and depletion survives a real save store reload', () => {
  const section = definePlacementSection('population.yard', set, {scope: 'device'});
  const backend = new MemoryBackend();
  const store = (tab: number) =>
    createSaveStore({
      local: backend.port(tab),
      session: new MemoryBackend().port(tab, 'session'),
      namespace: 'population-test',
      build: 'test',
      timers: {set: () => 0, clear: () => {}, now: () => 0},
    });
  const visit = (restored: PlacementState | null) => {
    const world = new World(),
      field = createPlacementField(set, {enterRadius: 40}, restored),
      entityOf = new Map<string, number>();
    const sync = (x: number) => {
      const u = field.update([{x, z: 0}]);
      for (const id of u.despawn) {
        world.despawn(entityOf.get(id)!);
        entityOf.delete(id);
      }
      for (const p of u.spawn) entityOf.set(p.id, world.spawn(Transform({x: p.x, z: p.z})));
    };
    return {world, field, entityOf, sync};
  };
  const first = visit(null);
  first.sync(20);
  assert.equal(first.entityOf.size, 3);
  first.world.despawn(first.entityOf.get('crate-a')!);
  first.entityOf.delete('crate-a');
  first.field.destroyed('crate-a');
  const s1 = store(0);
  assert.equal(
    authorSaveHandle(s1, section).update(r => void (r.state = first.field.snapshot()), {now: true}),
    'saved',
  );
  s1.dispose();
  const s2 = store(1);
  const second = visit(authorSaveHandle(s2, section).get().state);
  second.sync(20);
  assert.deepEqual([...second.entityOf.keys()], ['guard-b', 'coin-c']);
  s2.dispose();
  assert.throws(() => section.section.parse({state: {...first.field.snapshot(), depleted: ['guard-b']}}), RangeError);
});

test('sparse definitions are refused, large radii get a bounded default exit, dispose leaves nothing live', () => {
  const sparse: PlacementInput[] = [];
  sparse[1] = {id: 'a', x: 0, z: 0, kind: 'k'};
  assert.throws(() => definePlacements({id: 's', placements: sparse}), RangeError);
  const f = createPlacementField(set, {enterRadius: 9e5});
  f.update([{x: 0, z: 0}]);
  assert.equal(f.status('crate-a'), 'live');
  f.dispose();
  assert.equal(f.status('crate-a'), 'dormant');
  assert.deepEqual(f.live(), []);
});
