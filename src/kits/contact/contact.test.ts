import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, defineSystem, Name, testScene, Transform} from '../../author';
import {contact, createContactLayer, type BodyInput, type ContactShape} from './index';

const PLAYER = 1,
  PICKUP = 2,
  ENEMY = 4,
  WALL = 8;
const cyl = (radius = 0.5, height = 2): ContactShape => ({kind: 'cylinder', radius, height});
const body = (x: number, layer: number, mask: number, shape: ContactShape = cyl(), y = 0, z = 0): BodyInput => ({
  shape,
  position: [x, y, z],
  layer,
  mask,
});

test('enter, stay and exit follow overlap over successive updates', () => {
  const c = createContactLayer({maxBodies: 8, maxPairs: 8});
  c.set(10, body(0, PLAYER, PICKUP | ENEMY));
  c.set(20, body(3, PICKUP, 0));
  assert.deepEqual(c.update().events, []);
  c.move(20, [0.9, 0, 0]);
  assert.deepEqual(c.update().events, [{kind: 'enter', a: 10, b: 20, aSenses: true, bSenses: false}]);
  assert.deepEqual(c.update().events, [{kind: 'stay', a: 10, b: 20, aSenses: true, bSenses: false}]);
  assert.deepEqual(c.touching(10), [20]);
  c.move(20, [1, 0, 0]);
  assert.deepEqual(
    c.update().events,
    [{kind: 'exit', a: 10, b: 20, aSenses: true, bSenses: false, removed: false}],
    'touching surfaces (distance == r1 + r2) are not a contact',
  );
});

test('layers and masks: a pair forms when either side senses the other', () => {
  const c = createContactLayer({maxBodies: 8, maxPairs: 8});
  c.set(1, body(0, PLAYER, ENEMY));
  c.set(2, body(0.2, ENEMY, 0));
  c.set(3, body(0.4, WALL, 0));
  c.set(4, body(0.6, PICKUP, PLAYER));
  const events = c.update().events;
  assert.deepEqual(
    events.map(e => [e.a, e.b, e.aSenses, e.bSenses]),
    [
      [1, 2, true, false],
      [1, 4, false, true],
    ],
    'the wall senses nothing and is sensed by nobody; other unsensed pairs are skipped',
  );
});

test('exact shapes: cylinders need overlapping height, spheres and boxes use true distance', () => {
  const c = createContactLayer({maxBodies: 8, maxPairs: 8});
  c.set(1, body(0, 1, 1, cyl(0.5, 2)));
  c.set(2, body(0, 1, 1, cyl(0.5, 1), 2.5));
  assert.equal(c.update().pairs, 0, 'stacked cylinders with a vertical gap do not touch');
  c.move(2, [0, 1.5, 0]);
  assert.equal(c.update().pairs, 1);
  const s = createContactLayer({maxBodies: 8, maxPairs: 8});
  s.set(1, body(0, 1, 1, {kind: 'box', halfExtents: [1, 1, 1]}));
  // Sphere near the box corner: the AABB overlaps but the true distance does not.
  s.set(2, body(1.6, 1, 1, {kind: 'sphere', radius: 0.8}, 1.6, 1.6));
  assert.equal(s.update().pairs, 0);
  s.move(2, [1.3, 1.3, 1.3]);
  assert.equal(s.update().pairs, 1);
  const k = createContactLayer({maxBodies: 8, maxPairs: 8});
  k.set(1, body(0, 1, 1, cyl(1, 1)));
  k.set(2, body(0, 1, 1, {kind: 'sphere', radius: 0.5}, 1.4));
  assert.equal(k.update().pairs, 1, 'a sphere just above the cylinder top');
  k.move(2, [0, 1.6, 0]);
  assert.equal(k.update().pairs, 0);
  k.set(3, body(1.2, 1, 1, {kind: 'box', halfExtents: [0.3, 0.3, 0.3]}, 0.5));
  assert.deepEqual(k.touching(3), []);
  assert.equal(k.update().pairs, 1, 'cylinder and box overlap on the rim');
});

test('removal and intangibility produce exits marked removed; re-enabling re-enters', () => {
  const c = createContactLayer({maxBodies: 8, maxPairs: 8});
  c.set(1, body(0, 1, 1));
  c.set(2, body(0.5, 1, 1));
  c.set(3, body(-0.5, 1, 1));
  c.update();
  c.setEnabled(2, false);
  c.remove(3);
  assert.deepEqual(
    c
      .update()
      .events.filter(e => e.kind === 'exit')
      .map(e => [e.a, e.b, e.removed]),
    [
      [1, 2, true],
      [1, 3, true],
    ],
  );
  c.setEnabled(2, true);
  assert.deepEqual(
    c.update().events.map(e => e.kind),
    ['enter'],
  );
});

test('bounded admission: continuing pairs keep priority and the rest are refused, deterministically', () => {
  const c = createContactLayer({maxBodies: 16, maxPairs: 3, maxPerBody: 2});
  c.set(0, body(0, 1, 2, cyl(5)));
  for (let i = 1; i <= 4; i++) c.set(i, body(i * 0.1, 2, 0, cyl(0.01)));
  const first = c.update();
  assert.deepEqual(
    first.events.map(e => e.b),
    [1, 2],
    'body 0 may hold two contacts: the lowest ids win',
  );
  assert.equal(first.refused, 2);
  c.set(9, body(-0.2, 2, 0, cyl(0.01)));
  const second = c.update();
  assert.deepEqual(
    second.events.map(e => [e.kind, e.b]),
    [
      ['stay', 1],
      ['stay', 2],
    ],
    'an existing contact is never displaced by a newcomer',
  );
  // Order is independent of insertion order.
  const other = createContactLayer({maxBodies: 16, maxPairs: 3, maxPerBody: 2});
  for (const i of [4, 2, 3, 1]) other.set(i, body(i * 0.1, 2, 0, cyl(0.01)));
  other.set(0, body(0, 1, 2, cyl(5)));
  assert.deepEqual(other.update().events, first.events);
});

test('event groups are exits, then enters, then stays, each ordered by (a, b)', () => {
  const c = createContactLayer({maxBodies: 8, maxPairs: 8});
  c.set(5, body(0, 1, 1));
  c.set(3, body(0.3, 1, 1));
  c.set(7, body(10, 1, 1));
  c.update();
  c.move(7, [0.2, 0, 0]);
  c.move(3, [20, 0, 0]);
  assert.deepEqual(
    c.update().events.map(e => [e.kind, e.a, e.b]),
    [
      ['exit', 3, 5],
      ['enter', 5, 7],
    ],
  );
});

test('snapshots restore identical future events and are validated', () => {
  const c = createContactLayer({maxBodies: 8, maxPairs: 8});
  c.set(1, body(0, 1, 1));
  c.set(2, body(0.5, 1, 1));
  c.update();
  const snap = JSON.parse(JSON.stringify(c.snapshot()));
  const d = createContactLayer({maxBodies: 8, maxPairs: 8});
  d.restore(snap);
  c.move(2, [5, 0, 0]);
  d.move(2, [5, 0, 0]);
  assert.deepEqual(d.update(), c.update());
  for (const bad of [
    {...snap, v: 2},
    {...snap, pairs: [{a: 2, b: 1, aSenses: true, bSenses: true}]},
    {...snap, pairs: [{a: 1, b: 9, aSenses: true, bSenses: true}]},
    {...snap, bodies: [{...snap.bodies[0], layer: -1}]},
  ])
    assert.throws(() => d.restore(bad), RangeError);
});

test('inputs are validated', () => {
  assert.throws(() => createContactLayer({maxBodies: 0, maxPairs: 1}), RangeError);
  assert.throws(() => createContactLayer({maxBodies: 1, maxPairs: 1, maxPerBody: 0}), RangeError);
  const c = createContactLayer({maxBodies: 1, maxPairs: 1});
  assert.throws(() => c.set(1, body(NaN, 1, 1)), RangeError);
  assert.throws(() => c.set(1, {...body(0, 1, 1), shape: {kind: 'cone'} as never}), RangeError);
  assert.throws(() => c.set(1, body(0, 1, 1, cyl(0))), RangeError);
  c.set(1, body(0, 1, 1));
  assert.throws(() => c.set(2, body(0, 1, 1)), RangeError, 'capacity');
  assert.throws(() => c.move(5, [0, 0, 0]), RangeError);
  assert.equal(contact().id, 'contact');
});

test('composition: a fixed-step scene collects pickups exactly once and dispatch survives removal', async () => {
  const layer = createContactLayer({maxBodies: 16, maxPairs: 16});
  const collected: number[] = [];
  const scene = defineScene({
    id: 'pickups',
    title: 'Pickups',
    entities: [[Name({name: 'player'}), Transform()]],
    systems: [
      defineSystem({
        id: 'walk',
        run(ctx) {
          ctx.world.get(ctx.named('player')!, Transform)!.x += 0.1;
        },
      }),
      defineSystem({
        id: 'contacts',
        run(ctx) {
          const tr = ctx.world.get(ctx.named('player')!, Transform)!;
          if (!layer.has(0)) {
            layer.set(0, body(tr.x, PLAYER, PICKUP));
            for (let i = 1; i <= 3; i++) layer.set(i, body(i, PICKUP, 0, cyl(0.2)));
          }
          layer.move(0, [tr.x, tr.y, tr.z]);
          for (const e of layer.update().events) {
            if (e.kind !== 'enter' || !layer.has(e.b)) continue;
            collected.push(e.b);
            layer.remove(e.b);
          }
        },
      }),
    ],
  });
  const t = await testScene(scene);
  t.run(1);
  assert.deepEqual(collected, [1, 2, 3]);
});
