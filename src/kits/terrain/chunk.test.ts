import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurface, type SurfaceMesh } from './surface';
import { buildSurfaceChunk } from './chunk';
const surface = () => createSurface({ id: 'chunks', revision: 1, originX: -8, originZ: -8, cellsX: 16, cellsZ: 16, spacing: 1, baseHeight: 0, seed: 32, layers: [{ kind: 'noise', amplitude: 3, frequency: 0.2 }, { kind: 'radial', x: -4, z: -4, radius: 5, height: 6 }] });
function edge(mesh: SurfaceMesh, axis: 0 | 2, coordinate: number): number[][] {
  const vertices: number[][] = [];
  for (let n = 0; n < mesh.positions.length; n += 3) if (mesh.positions[n + axis] === coordinate) vertices.push(mesh.positions.slice(n, n + 3));
  return vertices.sort((a, b) => a[axis === 0 ? 2 : 0]! - b[axis === 0 ? 2 : 0]!);
}
function projectedArea(mesh: SurfaceMesh): number {
  let area = 0;
  for (let n = 0; n < mesh.indices.length; n += 3) {
    const a = mesh.indices[n]! * 3, b = mesh.indices[n + 1]! * 3, c = mesh.indices[n + 2]! * 3;
    const ax = mesh.positions[a]!, az = mesh.positions[a + 2]!, bx = mesh.positions[b]!, bz = mesh.positions[b + 2]!, cx = mesh.positions[c]!, cz = mesh.positions[c + 2]!;
    const twice = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    assert.ok(twice > 0, 'every triangle must have positive area and upward winding'); area += twice / 2;
  }
  return area;
}
test('mixed-stride neighbors retain identical complete edges at negative world origins', () => {
  const s = surface();
  for (const strideA of [1, 2, 4] as const) for (const strideB of [1, 2, 4] as const) {
    const a = buildSurfaceChunk(s, { startX: 0, startZ: 0, cellsX: 8, cellsZ: 8, stride: strideA });
    const b = buildSurfaceChunk(s, { startX: 8, startZ: 0, cellsX: 8, cellsZ: 8, stride: strideB });
    assert.deepEqual(edge(a.mesh, 0, 0), edge(b.mesh, 0, 0)); assert.equal(edge(a.mesh, 0, 0).length, 9);
    const c = buildSurfaceChunk(s, { startX: 0, startZ: 8, cellsX: 8, cellsZ: 8, stride: strideB });
    assert.deepEqual(edge(a.mesh, 2, 0), edge(c.mesh, 2, 0));
  }
});
test('all fan triangles wind upward and cover the tile without missing area', () => {
  for (const stride of [1, 2, 4] as const) {
    const chunk = buildSurfaceChunk(surface(), { startX: 1, startZ: 3, cellsX: 8, cellsZ: 12, stride });
    assert.equal(projectedArea(chunk.mesh), 96);
    assert.equal(chunk.bounds.min.x, -7); assert.equal(chunk.bounds.max.x, 1);
    assert.equal(chunk.bounds.min.z, -5); assert.equal(chunk.bounds.max.z, 7);
    for (let i = 1; i < chunk.mesh.positions.length; i += 3) assert.ok(chunk.mesh.positions[i]! >= chunk.bounds.min.y && chunk.mesh.positions[i]! <= chunk.bounds.max.y);
  }
});
test('coarse blocks reduce triangles while bounded fallback exactly restores canonical triangles', () => {
  const s = surface(), base = { startX: 0, startZ: 0, cellsX: 8, cellsZ: 8 };
  const coarse = buildSurfaceChunk(s, { ...base, stride: 4 }), fine = buildSurfaceChunk(s, { ...base, stride: 1 });
  assert.ok(coarse.mesh.indices.length < fine.mesh.indices.length);
  assert.ok(coarse.maxError > 0); assert.equal(coarse.stride, 4);
  const fallback = buildSurfaceChunk(s, { ...base, stride: 4, maxError: 0 });
  assert.equal(fallback.stride, 1); assert.equal(fallback.maxError, 0); assert.deepEqual(fallback.mesh, fine.mesh);
  const accepted = buildSurfaceChunk(s, { ...base, stride: 4, maxError: coarse.maxError });
  assert.equal(accepted.stride, 4);
});
test('flat coarse mesh has zero conservative error', () => {
  const s = createSurface({ id: 'flat', revision: 0, originX: -1, originZ: -1, spacing: 0.5, cellsX: 8, cellsZ: 8, seed: 0, baseHeight: 7 });
  const chunk = buildSurfaceChunk(s, { startX: 0, startZ: 0, cellsX: 8, cellsZ: 8, stride: 4, maxError: 0 });
  assert.equal(chunk.stride, 4); assert.equal(chunk.maxError, 0); assert.equal(projectedArea(chunk.mesh), 16);
});
test('range, stride and error validation reject malformed requests', () => {
  const s = surface(), base = { startX: 0, startZ: 0, cellsX: 8, cellsZ: 8, stride: 2 as const };
  for (const patch of [{ startX: -1 }, { startZ: 0.5 }, { cellsX: 0 }, { cellsZ: 18 }, { startX: 12 }, { cellsX: 7 }, { maxError: -1 }, { maxError: Infinity }, { startX: NaN }]) assert.throws(() => buildSurfaceChunk(s, { ...base, ...patch }));
  assert.throws(() => buildSurfaceChunk(s, { ...base, stride: 3 as 2 }));
});
test('chunk meshes are detached from each other and canonical surface', () => {
  const s = surface(), o = { startX: 0, startZ: 0, cellsX: 8, cellsZ: 8, stride: 4 as const }, before = s.mesh();
  const chunk = buildSurfaceChunk(s, o), expected = buildSurfaceChunk(s, o);
  chunk.mesh.positions.fill(99); chunk.mesh.indices.fill(0);
  assert.deepEqual(s.mesh(), before); assert.deepEqual(buildSurfaceChunk(s, o), expected);
});
test('reported conservative error contains sampled coarse-to-canonical differences', () => {
  const s = surface();
  for (const stride of [2, 4] as const) {
    const chunk = buildSurfaceChunk(s, { startX: 0, startZ: 0, cellsX: 16, cellsZ: 16, stride });
    // Sample barycentric points in every rendered triangle, including edges. The
    // oracle uses the canonical surface query, not the coarse chunk algorithm.
    for (let i = 0; i < chunk.mesh.indices.length; i += 3) {
      const a = chunk.mesh.indices[i]! * 3, b = chunk.mesh.indices[i + 1]! * 3, c = chunk.mesh.indices[i + 2]! * 3;
      for (let u = 0; u <= 4; u++) for (let v = 0; v <= 4 - u; v++) {
        const weights = [u / 4, v / 4, 1 - (u + v) / 4];
        const p = [0, 1, 2].map(axis => [a, b, c].reduce((sum, n, k) => sum + chunk.mesh.positions[n + axis]! * weights[k]!, 0));
        const canonical = s.sample(p[0]!, p[2]!);
        assert.ok(canonical);
        assert.ok(Math.abs(p[1]! - canonical.height) <= chunk.maxError + 1e-10);
      }
    }
  }
});
