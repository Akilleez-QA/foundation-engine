import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, Name, testScene, Transform} from '../../author';
import {Character, characterSystem, type CharacterOptions} from './index';

const setup = (options: CharacterOptions = {}) =>
  testScene(
    defineScene({
      id: 'surface-motion',
      title: 'Surface motion',
      entities: [[Name({name: 'player'}), Transform({y: 12}), Character({speed: 4})]],
      systems: [characterSystem({relative: 'world', pointer: false, ...options})],
    }),
  );
const position = (t: Awaited<ReturnType<typeof setup>>) => t.world.get(t.ctx.named('player')!, Transform)!;

test('character surface: walks up and down a ramp at the queried height plus body offset', async () => {
  const t = await setup({ground: (x, z) => ({height: 2 + x * 0.5 + z * 0.25}), groundOffset: 0.8});
  t.hold('character-x', 1);
  t.run(0.5);
  assert.ok(position(t).x > 1);
  assert.equal(position(t).y, 2.8 + position(t).x * 0.5);
  t.hold('character-x', -1);
  t.run(1);
  assert.ok(position(t).x < 0);
  assert.ok(Math.abs(position(t).y - (2.8 + position(t).x * 0.5)) < 1e-12);
});

test('character surface: grounds idle spawn and external teleport without movement input', async () => {
  const t = await setup({ground: (x, z) => ({height: x + z}), groundOffset: 0.5});
  t.run(0.02);
  assert.equal(position(t).y, 0.5);
  Object.assign(position(t), {x: 3, y: 100, z: 4});
  t.run(0.02);
  assert.equal(position(t).y, 7.5);
});

test('character surface: stops at finite coverage and can move back from the edge', async () => {
  const t = await setup({ground: x => (Math.abs(x) <= 1 ? {height: 8} : null)});
  t.hold('character-x', 1);
  t.run(2);
  assert.ok(position(t).x <= 1 && position(t).x > 0.9);
  assert.equal(position(t).y, 8);
  t.hold('character-x', -1);
  t.run(0.2);
  assert.ok(position(t).x < 0.8, 'blocked movement did not retain outward velocity');
});

test('character surface: missing or invalid samples do not snap an idle actor to zero', async () => {
  for (const ground of [() => null, () => ({height: Number.NaN})]) {
    const t = await setup({ground});
    t.hold('character-x', 1);
    t.run(0.5);
    assert.equal(position(t).x, 0);
    assert.equal(position(t).y, 12);
  }
});

test('character surface: no query retains existing free plane movement and vertical position', async () => {
  const t = await setup();
  t.hold('character-x', 1);
  t.run(0.5);
  assert.ok(position(t).x > 1);
  assert.equal(position(t).y, 12);
});

test('character surface: pointer requires an explicit picker and a missed pick does not fall back', async () => {
  const t = await setup({pointer: true, ground: () => ({height: 2})});
  Object.assign(t.ctx.input.pointer, {down: true});
  t.run(0.5);
  assert.equal(position(t).x, 0);
  assert.equal(position(t).z, 0);
  let target: {x: number; z: number} | null = null;
  const picked = await setup({pointer: true, ground: () => ({height: 2}), pointerTarget: () => target});
  Object.assign(picked.ctx.input.pointer, {down: true});
  picked.run(0.5);
  assert.equal(position(picked).x, 0);
  target = {x: 3, z: 0};
  picked.run(0.5);
  assert.ok(position(picked).x > 1);
  assert.equal(position(picked).y, 2);
});
