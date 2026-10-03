import {defineEntity, defineMesh, Mesh, Name, Transform, type SceneContext} from '@engine';
import {createSurfaceScatter, type Surface} from '@kits/terrain';
/** Sixteen finite candidates, one shared low-poly mesh and no extra frame owner. */
export function scatterMesh(surface: Surface) {
  const query = createSurfaceScatter(surface, {
    seed: 741,
    layer: 'yard-rock',
    startX: -2,
    startZ: -2,
    columns: 4,
    rows: 4,
    cellSize: 5,
    minNormalY: 0.8,
  });
  const result = query.step(16),
    positions: number[] = [],
    indices: number[] = [];
  for (const p of result.points) {
    const i = positions.length / 3;
    positions.push(p.x - 0.16, p.y, p.z - 0.12, p.x + 0.16, p.y, p.z - 0.12, p.x, p.y, p.z + 0.18, p.x, p.y + 0.3, p.z);
    indices.push(i, i + 1, i + 3, i + 1, i + 2, i + 3, i + 2, i, i + 3, i, i + 2, i + 1);
  }
  return {points: result.points, mesh: defineMesh({positions, indices, color: 0x697675}).value};
}
export function enterScatter(ctx: SceneContext, surface: Surface) {
  const data = scatterMesh(surface);
  ctx.spawn(
    defineEntity({id: 'terrain-scatter', components: [Name({name: 'surface-scatter'}), Transform(), Mesh(data.mesh)]}),
  );
  ctx.state.scatter = data.points;
}
