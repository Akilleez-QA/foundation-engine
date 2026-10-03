import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Ray, Vector3} from 'three';
import {createSurface} from './surface';
import {must} from '../../testing/must';
const surface = createSurface({
  id: 'rays',
  revision: 0,
  seed: 9,
  originX: -8,
  originZ: -8,
  spacing: 0.5,
  cellsX: 32,
  cellsZ: 32,
  baseHeight: 0,
  layers: [
    {kind: 'noise', amplitude: 2, frequency: 0.3},
    {kind: 'radial', x: 0, z: 0, radius: 5, height: 3},
  ],
});
const mesh = surface.mesh();
function brute(from: Vector3, direction: Vector3, max: number) {
  const ray = new Ray(from, direction.clone().normalize()),
    out = new Vector3();
  let nearest = Infinity;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const vertices = mesh.indices.slice(i, i + 3).map(n => new Vector3().fromArray(mesh.positions, n * 3));
    const hit = ray.intersectTriangle(must(vertices[0]), must(vertices[1]), must(vertices[2]), false, out);
    if (hit) nearest = Math.min(nearest, from.distanceTo(hit));
  }
  return nearest <= max ? nearest : null;
}
test('grid traversal matches independent full triangle oracle for oblique rays and finite ranges', () => {
  let seed = 17;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let n = 0; n < 250; n++) {
    const from = new Vector3(random() * 40 - 20, random() * 15 - 3, random() * 40 - 20),
      dir = new Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1),
      max = n % 3 === 0 ? 5 : 100;
    const expected = brute(from, dir, max),
      hit = surface.raycast(from, dir, max);
    assert.equal(hit === null, expected === null, `ray ${n}`);
    if (hit && expected !== null) assert.ok(Math.abs(hit.distance - expected) < 1e-7, `distance ${n}`);
  }
});
test('vertical, edge, diagonal, outward and zero-range contacts remain exact', () => {
  for (const x of [-8, -4, 0, 8])
    for (const z of [-8, 0, 4, 8]) {
      const h = surface.sample(x, z)!.height;
      const hit = surface.raycast({x, y: 20, z}, {x: 0, y: -1, z: 0});
      assert.ok(hit);
      assert.ok(Math.abs(hit.y - h) < 1e-8);
      assert.ok(surface.raycast({x, y: h, z}, {x: 0, y: -1, z: 0}, 0));
    }
  assert.equal(surface.raycast({x: 9, y: 1, z: 0}, {x: 0, y: -1, z: 0}), null);
});
