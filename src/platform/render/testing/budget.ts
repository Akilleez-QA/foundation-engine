import assert from 'node:assert/strict';
import * as T from 'three';

/** CPU construction counts, not renderer/GPU measurements. Hidden ancestors suppress draws. */
export function measureBuild(root: T.Object3D) {
  const result = {meshes: 0, draws: 0, casters: 0, triangles: 0, materials: 0, textures: 0, texturePixels: 0};
  const materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  root.traverse(o => {
    if (!(o instanceof T.Mesh)) return;
    result.meshes++;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m);
      for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
    }
    let visible = true;
    for (let p: T.Object3D | null = o; p; p = p.parent) visible &&= p.visible;
    if (!visible) return;
    // A BatchedMesh needs its instance adapter; fail closed rather than undercount it.
    assert.ok(!(o as T.BatchedMesh).isBatchedMesh, 'measureBuild requires a batch instance counter for BatchedMesh');
    const size = o.geometry.index?.count ?? o.geometry.getAttribute('position')?.count ?? 0;
    const range = o.geometry.drawRange;
    const groups = Array.isArray(o.material) ? o.geometry.groups : [{start: 0, count: size, materialIndex: 0}];
    for (const g of groups) {
      const m = Array.isArray(o.material) ? o.material[g.materialIndex ?? 0] : o.material;
      if (!m?.visible) continue;
      const count = Math.max(
        0,
        Math.min(size, g.start + g.count, range.start + range.count) - Math.max(g.start, range.start),
      );
      if (!count) continue;
      const passes = m.transparent && m.side === T.DoubleSide && !m.forceSinglePass ? 2 : 1;
      result.draws += passes;
      if (o.castShadow) result.casters++;
      result.triangles += (count / 3) * (o instanceof T.InstancedMesh ? o.count : 1) * passes;
    }
  });
  result.materials = materials.size;
  result.textures = textures.size;
  for (const t of textures) {
    const image = t.image as {width?: number; height?: number} | undefined;
    result.texturePixels += (image?.width ?? 0) * (image?.height ?? 0);
  }
  return result;
}

/** Builders own their cleanup policy (including leases); cleanup runs even when a budget fails. */
export function expectBuildBudget(
  build: () => T.Object3D,
  max: Partial<ReturnType<typeof measureBuild>>,
  opts: {dispose?: (root: T.Object3D) => void} = {},
) {
  const root = build();
  try {
    const counts = measureBuild(root);
    for (const [key, limit] of Object.entries(max)) {
      assert.ok(Number.isFinite(limit) && limit >= 0, `invalid ${key} budget`);
      assert.ok(
        counts[key as keyof typeof counts] <= limit,
        `${key}: ${counts[key as keyof typeof counts]} exceeds ${limit}`,
      );
    }
    return counts;
  } finally {
    opts.dispose?.(root);
  }
}
