/**
 * Optional example generator: per-layer cellular automaton (random fill, then Moore-neighbourhood smoothing).
 * Value 1 is solid, 0 is open. One familiar way to produce cave-like or blob-like masks; not a required style.
 * Parameters `[fill, steps, birth, survive]`: fill probability 0..1, smoothing steps 0..16, and neighbour counts
 * 0..9 (9 = never) for an open cell to become solid / a solid cell to stay solid. Cells outside the grid count
 * as solid. Each y layer draws from its own sub-stream `derive('layer', y)`, so a layer does not depend on cellsY.
 */
import { createRng } from '../../core/rng';
import { createGridGenerationJob, type GridCells, type GridContext, type GridGenerator, type GridParameter } from './grid-job';

const valid = (p: unknown): boolean => Array.isArray(p) && p.length === 4
  && typeof p[0] === 'number' && p[0] >= 0 && p[0] <= 1
  && [p[1], p[2], p[3]].every(n => Number.isSafeInteger(n)) && p[1] >= 0 && p[1] <= 16
  && p[2] >= 0 && p[2] <= 9 && p[3] >= 0 && p[3] <= 9;

export const cellularGenerator: GridGenerator = Object.freeze({
  version: 1, maxValue: 1, scratchBytesPerCell: 2,
  validate: valid,
  *generate(cells: GridCells, context: GridContext, parameters: GridParameter) {
    const [fill, steps, birth, survive] = parameters as readonly number[];
    const { cellsX: w, cellsY: h, cellsZ: d, values } = cells;
    let a = new Uint8Array(w * d), b = new Uint8Array(w * d);
    const solid = (x: number, z: number) => x < 0 || z < 0 || x >= w || z >= d ? 1 : a[z * w + x]!;
    for (let y = 0; y < h; y++) {
      const random = createRng(context.derive('layer', y));
      for (let z = 0; z < d; z++) { for (let x = 0; x < w; x++) a[z * w + x] = random.next() < fill! ? 1 : 0; yield; }
      for (let s = 0; s < steps!; s++) {
        for (let z = 0; z < d; z++) {
          for (let x = 0; x < w; x++) {
            let n = 0;
            for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dz) n += solid(x + dx, z + dz);
            b[z * w + x] = a[z * w + x] ? (n >= survive! ? 1 : 0) : (n >= birth! ? 1 : 0);
          }
          yield;
        }
        [a, b] = [b, a];
      }
      values.set(a, y * w * d);
    }
  },
});
/** Registered row `job.kits.procgen.cellular`. */
export const cellularGridJob = createGridGenerationJob('job.kits.procgen.cellular', cellularGenerator);
export const prepareCellularGrid = cellularGridJob.prepare;
