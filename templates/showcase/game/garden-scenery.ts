// The garden's scenery, built once from the forms and the palette (a helper file: no default export). Two meshes, two
// draws: the ground (grass, path stones, flowers; coloured per vertex with soft contact shadows) and everything that
// stands on it (hedges, shed, bench, lamp post, sundial, fence, the trees and rocks beyond the hedge). Collision stays on the
// scene's own Solid entities; nothing here blocks the player.
import {createSaveableRng} from '@engine';
import {bake, box, ground, linear, prism, rock, roof, toMesh, tree, type V3} from './forms';
import {palette as P} from './look';

/** Smooth value noise in [0, 1]: low-frequency colour variation for the grass. */
function noise(x: number, z: number): number {
  const h = (i: number, j: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(x),
    j = Math.floor(z),
    u = x - i,
    v = z - j,
    su = u * u * (3 - 2 * u),
    sv = v * v * (3 - 2 * v);
  const a = h(i, j) + (h(i + 1, j) - h(i, j)) * su,
    b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * su;
  return a + (b - a) * sv;
}

/** Distance from (x, z) to an axis-aligned rectangle [x0, x1] × [z0, z1]; 0 inside. */
const toRect = (x: number, z: number, x0: number, x1: number, z0: number, z1: number) =>
  Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));

/** What casts a contact shadow on the grass: rectangles [x0, x1, z0, z1] and circles [x, z, r]. */
const BLOCKS: [number, number, number, number][] = [
  [-7.6, -6.4, -7.6, 6.6],
  [6.4, 7.6, -7.6, 6.6],
  [-7.6, 7.6, -7.6, -6.4],
  [2.4, 5.6, -5.8, -3.2],
  [-3.95, -2.05, -2.35, -1.7],
];
const TREES: {at: V3; height: number; kind: 'pine' | 'round'}[] = [];
const ROCKS: {at: V3; size: number}[] = [];
{
  const r = createSaveableRng('garden/beyond');
  for (let i = 0; i < 26; i++) {
    const a = r.range(Math.PI * 0.95, Math.PI * 2.05),
      d = r.range(9, 18);
    const at: V3 = [Math.cos(a) * d * 1.1, 0, Math.sin(a) * d];
    if (Math.abs(at[0]) < 8.5 && at[2] > -8.5) continue;
    TREES.push({at, height: r.range(2.6, 4.6), kind: r.next() < 0.6 ? 'pine' : 'round'});
  }
  for (const at of [
    [-8.6, 0, -2],
    [8.4, 0, 1.5],
    [-8.2, 0, 5.2],
    [8.9, 0, -5.8],
    [-2.5, 0, -8.6],
    [6.2, 0, 6.2],
    [-5.2, 0, 9.4],
    [3.8, 0, 10.6],
    [9.6, 0, 8.8],
    [-6.1, 0, -5.9],
  ] as V3[])
    ROCKS.push({at, size: 0.45 + Math.abs(at[0] * at[2]) * 0.003});
}

/** Where the sundial stands (x, z). */
export const SUNDIAL: [number, number] = [-2, 2.2];

/** Stepping stones from the front of the garden to the shed door. */
const PATH: [number, number][] = [
  [0.2, 6],
  [0.6, 4.9],
  [1.2, 3.9],
  [1.9, 2.9],
  [2.6, 1.8],
  [3.2, 0.6],
  [3.6, -0.6],
  [3.9, -1.7],
  [4, -2.7],
];

function groundColor(x: number, z: number): V3 {
  const inside = Math.abs(x) < 7 && z > -7 && z < 7.5,
    meadow = z > 7.5;
  const n = noise(x * 0.35, z * 0.35) * 0.65 + noise(x * 1.3, z * 1.3) * 0.35;
  let c = inside || meadow ? linear(P.grass, (meadow ? 0.72 : 0.82) + 0.3 * n) : linear(P.grassDark, 0.8 + 0.4 * n);
  // Contact shadows: darker grass right against everything that stands on it.
  let shade = 1;
  for (const [x0, x1, z0, z1] of BLOCKS) shade *= 1 - 0.45 * Math.exp(-toRect(x, z, x0, x1, z0, z1) / 0.7);
  for (const t of TREES) shade *= 1 - 0.4 * Math.exp(-Math.hypot(x - t.at[0], z - t.at[2]) / (t.height * 0.25));
  for (const s of ROCKS) shade *= 1 - 0.3 * Math.exp(-Math.hypot(x - s.at[0], z - s.at[2]) / s.size);
  shade *= 1 - 0.35 * Math.exp(-Math.hypot(x + 4, z - 3) / 0.5);
  shade *= 1 - 0.35 * Math.exp(-Math.hypot(x - SUNDIAL[0], z - SUNDIAL[1]) / 0.6);
  c = c.map(v => v * shade) as V3;
  return c;
}

/** The ground mesh: 32 × 32 cells of coloured grass, the path's stones and the flower borders (no height shading). */
export function gardenGround() {
  const b = bake(0);
  ground(b, {size: 40, cells: 32, color: groundColor});
  const r = createSaveableRng('garden/path');
  for (const [x, z] of PATH)
    prism(b, {
      at: [x, 0, z],
      radius: r.range(0.24, 0.32),
      top: 0.22,
      height: 0.05,
      sides: 7,
      turn: r.range(0, 1),
      color: r.pick([P.stone, P.path]),
    });
  const f = createSaveableRng('garden/flowers');
  const colors = [P.bloom, P.cream, P.accent, P.bloom];
  const borders: [number, number, number, number][] = [
    [-6.25, -6.25, -6, 5.5],
    [6.25, 6.25, -2.5, 5.5],
    [-5.5, 1.8, -6.25, -6.25],
  ];
  for (const [x0, x1, z0, z1] of borders)
    for (let i = 0; i < 16; i++) {
      const t = (i + f.range(0, 0.6)) / 16,
        x = x0 + (x1 - x0) * t + f.range(-0.12, 0.12),
        z = z0 + (z1 - z0) * t + f.range(-0.12, 0.12);
      prism(b, {at: [x, 0, z], radius: 0.12, top: 0, height: 0.32, sides: 3, turn: f.range(0, 1), color: P.leafDark});
      prism(b, {
        at: [x, 0.25, z],
        radius: 0.09,
        top: 0,
        height: 0.1,
        sides: 4,
        turn: f.range(0, 1),
        color: f.pick(colors),
      });
    }
  // The meadow in front of the fence: clumps of tall grass with a few flowers, which frame the view without hiding
  // the player. Clumps, not single blades: grouped detail reads as texture, scattered detail as noise.
  for (let i = 0; i < 16; i++) {
    const cx = f.range(-12, 12),
      cz = f.range(8.2, 15);
    for (let k = 0; k < 6; k++) {
      const x = cx + f.range(-0.45, 0.45),
        z = cz + f.range(-0.35, 0.35);
      prism(b, {
        at: [x, 0, z],
        radius: f.range(0.1, 0.16),
        top: 0,
        height: f.range(0.35, 0.6),
        sides: 3,
        turn: f.range(0, 1),
        color: f.pick([P.leaf, P.grassDark]),
        lean: [f.range(-0.1, 0.1), 0, f.range(-0.1, 0.1)],
      });
    }
    if (i % 2) prism(b, {at: [cx + 0.2, 0.4, cz], radius: 0.1, top: 0, height: 0.1, sides: 4, color: f.pick(colors)});
  }
  return toMesh(b);
}

/** Everything standing in and around the garden, in one mesh. */
export function gardenScenery() {
  const b = bake();
  // Hedges: a row of leafy blobs along each Solid hedge.
  const hedge = (x0: number, z0: number, x1: number, z1: number, id: string) => {
    const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.62);
    for (let i = 0; i <= n; i++)
      rock(b, {
        at: [x0 + ((x1 - x0) * i) / n, 0.45, z0 + ((z1 - z0) * i) / n],
        size: 0.66,
        squash: 0.95,
        seed: `hedge/${id}/${i}`,
        color: i % 3 ? P.leaf : P.leafDark,
      });
  };
  hedge(-7, 6.6, -7, -7, 'west');
  hedge(7, 6.6, 7, -7, 'east');
  hedge(-6.4, -7, 6.4, -7, 'north');
  // The shed: stone footing, plank walls, a red gable roof, cream trim, a window with a flower box, a stove pipe.
  box(b, {at: [4, 0, -4.5], size: [3.15, 0.22, 2.55], color: P.stone});
  box(b, {at: [4, 0.2, -4.5], size: [3, 2, 2.4], color: P.wood});
  for (const x of [2.5, 5.5])
    for (const z of [-3.3, -5.7]) box(b, {at: [x, 0.2, z], size: [0.14, 2, 0.14], color: P.cream});
  for (let i = 0; i < 4; i++) {
    // Four courses of tiles, each a little proud of the one above and a shade lighter: the roof reads as tiled.
    const t = i / 4,
      lift = 0.04 * (4 - i);
    roof(b, {
      at: [4, 2.2 + 1.1 * t - lift, -4.5],
      size: [3.5 - i * 0.01, 1.1 * (1 - t) + lift, 3.1 * (1 - t)],
      color: P.roof,
    });
  }
  box(b, {at: [4, 3.24, -4.5], size: [3.6, 0.1, 0.14], color: P.roof, k: 0.8});
  box(b, {at: [4, 0.2, -3.28], size: [1.1, 1.85, 0.06], color: P.cream});
  box(b, {at: [5.02, 1.0, -3.29], size: [0.62, 0.58, 0.05], color: P.cream});
  box(b, {at: [5.02, 1.05, -3.27], size: [0.48, 0.46, 0.04], color: 0x2c3c58});
  box(b, {at: [5.02, 0.8, -3.18], size: [0.72, 0.16, 0.22], color: P.woodDark});
  for (const [i, dx] of [-0.24, -0.08, 0.08, 0.24].entries())
    rock(b, {
      at: [5.02 + dx, 1.0, -3.17],
      size: 0.08,
      squash: 0.8,
      seed: `box/${i}`,
      color: i % 2 ? P.accent : P.bloom,
    });
  prism(b, {at: [3.1, 2.6, -5.1], radius: 0.11, height: 1.0, sides: 6, color: P.iron});
  // The bench: three seat slats on four legs, two back slats.
  for (const z of [-2.18, -2, -1.82]) box(b, {at: [-3, 0.4, z], size: [1.8, 0.06, 0.16], color: P.wood});
  for (const x of [-3.78, -2.22])
    for (const z of [-2.2, -1.8]) box(b, {at: [x, 0, z], size: [0.08, 0.42, 0.08], color: P.woodDark});
  for (const x of [-3.78, -2.22]) box(b, {at: [x, 0.42, -2.26], size: [0.08, 0.5, 0.06], color: P.woodDark});
  for (const y of [0.58, 0.76]) box(b, {at: [-3, y, -2.27], size: [1.8, 0.12, 0.05], color: P.wood});
  // The lamp post: a footing, a thin iron post, a collar under the lamp and a hat above it.
  prism(b, {at: [-4, 0, 3], radius: 0.2, top: 0.15, height: 0.28, sides: 6, color: P.iron});
  prism(b, {at: [-4, 0.28, 3], radius: 0.06, height: 1.75, sides: 6, color: P.iron});
  prism(b, {at: [-4, 2.0, 3], radius: 0.16, top: 0.2, height: 0.08, sides: 6, color: P.iron});
  prism(b, {at: [-4, 2.56, 3], radius: 0.26, top: 0, height: 0.22, sides: 6, color: P.iron});
  // The sundial: an octagonal pedestal, a cream dial with hour marks and a slanted gnomon.
  const [sx, sz] = SUNDIAL;
  prism(b, {at: [sx, 0, sz], radius: 0.42, top: 0.34, height: 0.16, sides: 8, color: P.stone});
  prism(b, {at: [sx, 0.16, sz], radius: 0.22, top: 0.18, height: 0.7, sides: 8, color: P.stone});
  prism(b, {at: [sx, 0.86, sz], radius: 0.46, top: 0.46, height: 0.07, sides: 8, color: P.cream});
  for (let h = 0; h < 8; h++)
    box(b, {
      at: [sx + Math.cos((h / 8) * Math.PI * 2) * 0.36, 0.93, sz + Math.sin((h / 8) * Math.PI * 2) * 0.36],
      size: [0.05, 0.015, 0.05],
      color: P.woodDark,
    });
  prism(b, {at: [sx - 0.12, 0.93, sz], radius: 0.07, top: 0, height: 0.3, sides: 3, lean: [0.22, 0, 0], color: P.iron});
  // A low picket fence across the open front, with a gap where the path comes in.
  for (let x = -7.2; x <= 7.21; x += 0.45)
    if (Math.abs(x) > 0.7) box(b, {at: [x, 0, 7.2], size: [0.1, 0.62, 0.06], color: P.cream});
  for (const y of [0.18, 0.45])
    for (const side of [-1, 1]) box(b, {at: [side * 3.975, y, 7.17], size: [6.65, 0.07, 0.04], color: P.cream});
  // Two trees and a few bushes at the front corners frame the garden like a stage.
  tree(b, {at: [-10.5, 0, 11], height: 4.2, seed: 'front/left', leaf: P.leaf, bark: P.woodDark, kind: 'round'});
  tree(b, {at: [11, 0, 10], height: 3.6, seed: 'front/right', leaf: P.leafDark, bark: P.woodDark});
  for (const [i, [x, z]] of (
    [
      [-8.6, 9.6],
      [-9.4, 12.6],
      [9.2, 12.4],
      [8.4, 9.2],
    ] as [number, number][]
  ).entries())
    rock(b, {at: [x, 0.3, z], size: 0.75, squash: 0.8, seed: `front/bush/${i}`, color: i % 2 ? P.leaf : P.leafDark});
  // Beyond the hedge: trees and rocks that fade into the haze.
  for (const [i, t] of TREES.entries())
    tree(b, {...t, seed: `tree/${i}`, leaf: t.kind === 'pine' ? P.leafDark : P.leaf, bark: P.woodDark});
  for (const [i, s] of ROCKS.entries()) rock(b, {at: s.at, size: s.size, seed: `rock/${i}`, color: P.stone});
  return toMesh(b);
}
