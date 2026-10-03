import test from 'node:test';
import assert from 'node:assert/strict';
import {slide, standable, type Area} from './collide';

const area: Area = {
  minX: -5,
  maxX: 5,
  minZ: -4,
  maxZ: 4,
  solids: [
    {id: 'crate', kind: 'box', x: -3, z: -2, halfX: 0.5, halfZ: 0.5},
    {id: 'post', kind: 'circle', x: 2, z: 0, r: 0.4},
  ],
};

test('collide: walls and solids block; a blocked step slides along the free axis', () => {
  assert.ok(standable(area, {x: 0, z: 0}));
  assert.ok(!standable(area, {x: 4.9, z: 0}), 'the wall less the body radius');
  assert.ok(!standable(area, {x: 2, z: 0.5}), 'a circle');
  assert.ok(!standable(area, {x: -3, z: -2}), 'a box');
  assert.deepEqual(slide(area, {x: 0, z: 0}, {x: 0.1, z: 0.2}), {x: 0.1, z: 0.2});
  assert.deepEqual(slide(area, {x: 4.6, z: 0}, {x: 0.2, z: 0.1}), {x: 4.6, z: 0.1}, 'slides along the wall');
  assert.deepEqual(slide(area, {x: 0, z: 0}, {x: Number.NaN, z: 0}), {x: 0, z: 0});
});
