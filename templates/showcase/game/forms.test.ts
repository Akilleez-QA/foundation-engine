import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, Mesh, Name, testScene, Transform} from '@engine';
import {bake, bakeLight, box, crystal, linear, prism, ring, rock, toMesh, tree, type Bake, type V3} from './forms';
import {palette as P} from './look';

/** Every triangle's normal points away from `centre` (the faces are seen from outside). */
function facesOut(b: Bake, centre: V3): boolean {
  for (let t = 0; t < b.indices.length; t += 3) {
    const v = [0, 1, 2].map(k => b.positions.slice(b.indices[t + k]! * 3, b.indices[t + k]! * 3 + 3)) as V3[];
    const [a, p, q] = v as [V3, V3, V3];
    const u = [p[0] - a[0], p[1] - a[1], p[2] - a[2]],
      w = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const mid = [0, 1, 2].map(c => (a[c]! + p[c]! + q[c]!) / 3);
    if (n[0]! * (mid[0]! - centre[0]) + n[1]! * (mid[1]! - centre[1]) + n[2]! * (mid[2]! - centre[2]) <= 0)
      return false;
  }
  return true;
}

test('a rock is 20 outward faces, the same for the same seed, different for another', () => {
  const one = bake(),
    again = bake(),
    other = bake();
  rock(one, {at: [1, 0.5, 2], size: 0.6, seed: 'a', color: P.stone});
  rock(again, {at: [1, 0.5, 2], size: 0.6, seed: 'a', color: P.stone});
  rock(other, {at: [1, 0.5, 2], size: 0.6, seed: 'b', color: P.stone});
  assert.equal(one.indices.length / 3, 20);
  assert.ok(facesOut(one, [1, 0.5, 2]));
  assert.deepEqual(one, again);
  assert.notDeepEqual(one.positions, other.positions);
});

test('boxes, prisms and cones face outwards; a ring wall faces in and out', () => {
  const b = bake();
  box(b, {at: [0, 0, 0], size: [2, 1, 1], color: P.wood, ry: 0.4});
  assert.ok(facesOut(b, [0, 0.5, 0]));
  const c = bake();
  prism(c, {at: [0, 0, 0], radius: 1, top: 0, height: 2, sides: 7, color: P.leaf});
  assert.ok(facesOut(c, [0, 1, 0]));
  assert.equal(c.indices.length / 3, 7, 'a cone has no cap');
  const r = bake();
  ring(r, {at: [0, 0, 0], inner: 1.5, outer: 2, height: 0.5, color: P.stone});
  assert.equal(r.indices.length / 3, 8 * 6, 'eight sides: outer wall, inner wall and top, two triangles each');
});

test('ground near y = 0 is darker than the same colour higher up, unless occlusion is off', () => {
  const high = bake(),
    low = bake(),
    flat = bake(0);
  box(high, {at: [0, 2, 0], size: [1, 1, 1], color: P.stone});
  box(low, {at: [0, 0, 0], size: [1, 1, 1], color: P.stone});
  box(flat, {at: [0, 0, 0], size: [1, 1, 1], color: P.stone});
  const first = (b: Bake) => b.colors[0]!;
  assert.ok(first(low) < first(high));
  assert.ok(first(flat) > first(low));
});

test('trees and crystals build, and every colour stays a valid linear value', () => {
  const b = bake();
  tree(b, {at: [0, 0, 0], height: 3, seed: 'pine', leaf: P.leafDark, bark: P.woodDark});
  tree(b, {at: [3, 0, 0], height: 3, seed: 'round', leaf: P.leaf, bark: P.woodDark, kind: 'round'});
  crystal(b, {at: [6, 0, 0], height: 1.5, seed: 'gem', color: P.water});
  assert.ok(b.indices.length / 3 > 60);
  assert.ok(b.colors.every(c => c >= 0 && c <= 1));
});

test('bakeLight warms what is near a light and leaves the rest at the ambient colour', () => {
  const b = bake(0);
  box(b, {at: [0, 0, 0], size: [1, 0.1, 1], color: 0xffffff});
  box(b, {at: [20, 0, 0], size: [1, 0.1, 1], color: 0xffffff});
  const half = b.colors.length / 2,
    unlit = b.colors[half]!;
  bakeLight(b, 0x404040, [{at: [0, 2, 0], color: P.lantern, intensity: 3, range: 6}]);
  const [r0] = [b.colors[0]!],
    [r1] = [b.colors[half]!];
  assert.ok(r0 > 5 * linear(0x404040)[0], `near the lantern: ${r0}`);
  assert.ok(Math.abs(r1 - unlit * linear(0x404040)[0]) < 1e-9, `far away: ${r1}`);
});

test('a bake is one Mesh, drawn as one entity', async () => {
  const b = bake();
  for (let i = 0; i < 10; i++) rock(b, {at: [i, 0.3, 0], size: 0.4, seed: `r${i}`, color: P.stone});
  const scene = defineScene({id: 'rocks', title: 'Rocks', entities: [[Name({name: 'rocks'}), Transform(), toMesh(b)]]});
  const t = await testScene(scene);
  assert.equal(t.world.get(t.ctx.named('rocks')!, Mesh)!.indices.length / 3, 200);
  t.dispose();
});
