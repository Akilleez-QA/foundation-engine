import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, testScene, Name, Transform} from '../../author';
import {createSampledSurface} from '../terrain';
import {createRollbackSyncTest} from '../rollback';
import {carConfig, carHandlingSystem, createCarHandling, planeGround, sampledGround, type CarControls} from './index';

const scene = () =>
  defineScene({id: 'drive', title: 'drive', entities: [[Name({name: 'car'}), Transform({x: 0, y: 0, z: 0})]]});

test('car-handling consumer: the fixed-step adapter drives a named Transform and coasts while not owned', async () => {
  const car = createCarHandling(carConfig('arcade'));
  car.place({x: 0, y: 0.8, z: 0});
  let owned = true,
    steps = 0;
  const t = await testScene(scene(), {
    systems: [
      carHandlingSystem({
        car,
        ground: planeGround(),
        controls: () => ({throttle: 1}),
        when: () => owned,
        after: () => steps++,
      }),
    ],
  });
  const tr = t.world.get(t.ctx.named('car')!, Transform)!;
  t.run(3);
  assert.ok(steps > 0);
  assert.ok(tr.z > 10, `moved forward: ${tr.z}`);
  assert.ok(Math.abs(tr.y - car.read().position[1]) < 1e-12);
  const speed = car.forwardSpeed;
  owned = false;
  t.run(1);
  assert.ok(car.forwardSpeed < speed, 'neutral controls: it coasts down instead of freezing or accelerating');
  assert.ok(car.forwardSpeed > 0);
  t.dispose();
});

test('car-handling consumer: a failing ground query fails the tick without writing the Transform', async () => {
  const car = createCarHandling(carConfig('arcade'));
  car.place({x: 0, y: 0.8, z: 0});
  const flat = planeGround();
  let broken = false;
  const t = await testScene(scene(), {
    systems: [
      carHandlingSystem({
        car,
        ground: (...args) => {
          if (broken) throw new Error('collision data unavailable');
          return flat(...args);
        },
        controls: () => ({throttle: 1}),
      }),
    ],
  });
  const tr = t.world.get(t.ctx.named('car')!, Transform)!;
  t.run(1);
  const before = {...tr},
    snap = JSON.stringify(car.snapshot());
  broken = true;
  assert.throws(() => t.run(1 / 60));
  assert.deepEqual({...tr}, before);
  assert.equal(JSON.stringify(car.snapshot()), snap);
  t.dispose();
});

test('car-handling consumer: on a terrain-kit sampled surface the car rolls downhill and keeps its wheels down', () => {
  // A 64 m x 64 m ramp falling 0.15 m per metre toward +z.
  const cells = 32,
    spacing = 2;
  const heights: number[] = [];
  for (let z = 0; z <= cells; z++) for (let x = 0; x <= cells; x++) heights.push(10 - 0.15 * z * spacing);
  const surface = createSampledSurface({
    id: 'ramp',
    revision: 1,
    originX: -32,
    originZ: 0,
    spacing,
    cellsX: cells,
    cellsZ: cells,
    heights,
  });
  const ground = sampledGround((x, z) => surface.sample(x, z));
  const car = createCarHandling(carConfig('sim-lite', {brakes: {brakeToReverse: false}}));
  car.place({x: 0, y: 10 - 0.15 * 4 + 0.8, z: 4});
  let minGrounded = 4;
  for (let i = 0; i < 240; i++) {
    car.step(1 / 60, {}, ground);
    if (i > 60) minGrounded = Math.min(minGrounded, car.grounded);
  }
  assert.equal(minGrounded, 4);
  assert.ok(car.forwardSpeed > 2, `rolled downhill: ${car.forwardSpeed}`);
  // Held on the brake it stops and stays (static friction through predicted-velocity caps).
  for (let i = 0; i < 300; i++) car.step(1 / 60, {brake: 1}, ground);
  const z = car.read().position[2];
  for (let i = 0; i < 3600; i++) car.step(1 / 60, {brake: 1}, ground);
  assert.ok(Math.abs(car.read().position[2] - z) < 1e-3, 'holds on the slope for a minute');
});

test('car-handling consumer: the rollback kit sync test finds no hidden state across 600 frames', () => {
  const car = createCarHandling(carConfig('arcade'), {math: 'deterministic'});
  car.place({x: 0, y: 0.8, z: 0});
  const ground = sampledGround((x, z) => ({height: 0.2 * Math.sin(x / 5 + z / 9), normal: {x: 0, y: 1, z: 0}}));
  const decode = (text: string): CarControls => {
    const [throttle, brake, steer, handbrake] = text.split(',').map(Number);
    return {throttle: throttle!, brake: brake!, steer: steer!, handbrake: handbrake!};
  };
  const sync = createRollbackSyncTest({
    checkDistance: 8,
    maxStateBytes: 1 << 16,
    maxInputBytes: 64,
    players: 1,
    ports: {
      save: () => JSON.stringify(car.snapshot()),
      load: text => car.restore(JSON.parse(text)),
      step: inputs => void car.step(1 / 60, decode(inputs[0]!), ground),
    },
  });
  for (let f = 0; f < 600; f++) {
    const input = `${f % 180 < 100 ? 1 : 0},${f % 180 >= 140 ? 1 : 0},${((f % 97) / 48.5 - 1).toFixed(3)},${f % 250 > 220 ? 1 : 0}`;
    const r = sync.advance([input]);
    assert.equal(r.status, 'checked', JSON.stringify(r));
  }
  sync.dispose();
});
