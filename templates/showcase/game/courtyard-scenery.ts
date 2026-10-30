// The courtyard's stonework, built once from the forms and the palette (a helper file: no default export), in two
// meshes: the ground (which casts no shadow) and everything standing (which does). The lanterns are point lights in
// the scene; the meshes have only a faint glow, the water's light and the lit windows baked into their colours.
// Collision is the scene's own Solid entities; the glass, water and gate door are the scene's own shapes.
import {createSaveableRng} from '@engine';
import {
  bake,
  bakeLight,
  box,
  face,
  prism,
  ring,
  rock,
  roof,
  toMesh,
  tree,
  type Bake,
  type BakedLight,
  type V3,
} from './forms';
import {palette as P} from './look';

/** Half the courtyard's width: the walls stand at ±HALF. */
export const HALF = 10;
/** Lantern posts (x, z); their glass is at LANTERN_Y. */
export const POSTS: [number, number][] = [
  [-6, -6],
  [6, -6],
  [-6, 4.5],
  [6, 4.5],
];
export const LANTERN_Y = 2.35;
/** Street lamps outside the low south wall (x, z). */
export const STREET_LAMPS: [number, number][] = [
  [-4.5, HALF + 3],
  [4.5, HALF + 3],
];
/** Wall lamps either side of the gate, and where the lit windows are: [x, y, z]. */
export const SCONCES: V3[] = [
  [-2.2, 2.5, -HALF + 0.42],
  [2.2, 2.5, -HALF + 0.42],
];
export const WINDOWS: {at: V3; ry: number}[] = [
  {at: [-HALF + 0.06, 1.7, -3], ry: Math.PI / 2},
  {at: [HALF - 0.06, 1.7, -3], ry: -Math.PI / 2},
  {at: [-HALF + 0.06, 1.7, 2.5], ry: Math.PI / 2},
  {at: [HALF - 0.06, 1.7, 2.5], ry: -Math.PI / 2},
];
export const PLANTERS: [number, number][] = [
  [-8, -8],
  [8, -8],
  [-8.2, 7.4],
  [8.2, 7.4],
];
export const BENCHES: {at: V3; ry: number}[] = [
  {at: [0, 0, -4.1], ry: 0},
  {at: [-4.1, 0, 0], ry: Math.PI / 2},
  {at: [4.1, 0, 0], ry: -Math.PI / 2},
];
export const FOUNTAIN_R = 2.2;

/** The light baked into the stonework. The lanterns themselves are point lights in the scene; the bake adds only a
 *  faint warm glow round each (so a light preset with fewer light slots never leaves a lantern lighting nothing), the
 *  water's glow and the lit windows, which need no slot at all. */
export const LIGHTS: BakedLight[] = [
  ...[...POSTS, ...STREET_LAMPS].map(([x, z]): BakedLight => ({
    at: [x, LANTERN_Y, z],
    color: P.lantern,
    intensity: 0.5,
    range: 4,
  })),
  ...SCONCES.map((at): BakedLight => ({at, color: P.lantern, intensity: 0.4, range: 3})),
  {at: [0, 0.7, 0], color: P.water, intensity: 1.4, range: 3.6},
  ...WINDOWS.map(({at, ry}): BakedLight => ({
    at: [at[0] + Math.sin(ry) * 0.6, at[1], at[2] + Math.cos(ry) * 0.6],
    color: P.lantern,
    intensity: 1.1,
    range: 4,
  })),
];

/** A wall of stone blocks facing +z before turning by `ry`, from x0 to x1 along its run, `height` tall. Blocks are
 *  courses of varied lengths, each a slightly different shade and depth; dark mortar shows in the joints. */
function blockWall(
  b: Bake,
  o: {origin: V3; ry: number; length: number; height: number; seed: string; skip?: (x: number, y: number) => boolean},
) {
  const r = createSaveableRng(o.seed),
    c = Math.cos(o.ry),
    s = Math.sin(o.ry);
  const at = (x: number, y: number, z: number): V3 => [
    o.origin[0] + x * c + z * s,
    o.origin[1] + y,
    o.origin[2] - x * s + z * c,
  ];
  const behind = at(0, o.height / 2, -2);
  face(
    b,
    [at(0, 0, -0.06), at(o.length, 0, -0.06), at(o.length, o.height, -0.06), at(0, o.height, -0.06)],
    P.stoneDark,
    0.45,
    behind,
  );
  const rows = Math.round(o.height / 0.48);
  for (let row = 0; row < rows; row++) {
    const y0 = (row * o.height) / rows + 0.02,
      y1 = ((row + 1) * o.height) / rows - 0.02;
    for (let x = row % 2 ? -0.4 : 0; x < o.length;) {
      const w = r.range(0.7, 1.25),
        x0 = Math.max(0, x) + 0.02,
        x1 = Math.min(o.length, x + w) - 0.02,
        z = r.range(0, 0.05),
        k = r.range(0.82, 1.05);
      x += w;
      if (x1 - x0 < 0.15 || o.skip?.((x0 + x1) / 2, (y0 + y1) / 2)) continue;
      face(b, [at(x0, y0, z), at(x1, y0, z), at(x1, y1, z), at(x0, y1, z)], P.stone, k, behind);
      face(
        b,
        [at(x0, y1, z), at(x1, y1, z), at(x1, y1, -0.06), at(x0, y1, -0.06)],
        P.stone,
        k * 1.08,
        at((x0 + x1) / 2, y0, -1),
      );
    }
  }
  // Coping stones along the top.
  for (let x = 0; x < o.length; x += 1.2) {
    const x1 = Math.min(o.length, x + 1.18),
      y = o.height;
    for (const [q, k] of [
      [[at(x, y, 0.12), at(x1, y, 0.12), at(x1, y + 0.14, 0.12), at(x, y + 0.14, 0.12)], 0.9],
      [[at(x, y + 0.14, 0.12), at(x1, y + 0.14, 0.12), at(x1, y + 0.14, -0.4), at(x, y + 0.14, -0.4)], 1.05],
    ] as [V3[], number][])
      face(b, q, P.stoneDark, k * 1.25, at((x + x1) / 2, y + 0.07, -0.14));
  }
}

/** A lantern post: footing, post, a cross arm and the cap above the glass (the glass is a glowing shape). */
function lanternPost(b: Bake, x: number, z: number) {
  prism(b, {at: [x, 0, z], radius: 0.24, top: 0.18, height: 0.3, sides: 6, color: P.iron});
  prism(b, {at: [x, 0.3, z], radius: 0.07, height: 1.75, sides: 6, color: P.iron});
  prism(b, {at: [x, 2.05, z], radius: 0.22, top: 0.26, height: 0.08, sides: 4, turn: Math.PI / 4, color: P.iron});
  prism(b, {
    at: [x, LANTERN_Y + 0.24, z],
    radius: 0.36,
    top: 0,
    height: 0.3,
    sides: 4,
    turn: Math.PI / 4,
    color: P.iron,
  });
  prism(b, {at: [x, LANTERN_Y + 0.54, z], radius: 0.05, top: 0, height: 0.18, sides: 4, color: P.iron});
}

function bench(b: Bake, at: V3, ry: number) {
  const c = Math.cos(ry),
    s = Math.sin(ry),
    p = (x: number, y: number, z: number): V3 => [at[0] + x * c + z * s, at[1] + y, at[2] - x * s + z * c];
  for (const z of [-0.16, 0, 0.16]) box(b, {at: p(0, 0.42, z), size: [1.8, 0.06, 0.15], ry, color: P.wood});
  for (const x of [-0.75, 0.75]) box(b, {at: p(x, 0, 0), size: [0.12, 0.42, 0.46], ry, color: P.stoneDark});
}

/** The ground and everything outside the walls: flagstones, the street, the hedge in front, the trees and roofs of
 *  the town. Its entity casts no shadow (a floor needs none), so the shadow passes draw only `courtyardStone`. */
export function courtyardGround() {
  const b = bake(0);
  // Flagstones on dark mortar, each its own shade and a hair proud of its neighbours; none under the fountain.
  const r = createSaveableRng('courtyard/flags');
  prism(b, {
    at: [0, -0.02, 0],
    radius: HALF * Math.SQRT2,
    height: 0.02,
    sides: 4,
    turn: Math.PI / 4,
    color: P.stoneDark,
    k: 0.35,
  });
  for (let i = -HALF; i < HALF; i++)
    for (let j = -HALF; j < HALF; j++) {
      const x = i + 0.5,
        z = j + 0.5;
      if (Math.hypot(x, z) < FOUNTAIN_R + 1.6) continue;
      prism(b, {
        at: [x + r.range(-0.03, 0.03), 0, z + r.range(-0.03, 0.03)],
        radius: 0.66,
        top: 0.6,
        height: r.range(0.02, 0.06),
        sides: 4,
        turn: Math.PI / 4 + r.range(-0.04, 0.04),
        color: P.stone,
        k: r.range(0.72, 1.02),
      });
    }
  // Two rings of warmer paving round the fountain break the grid and lead the eye to the centre.
  for (const [r0, r1, n] of [
    [FOUNTAIN_R + 0.15, FOUNTAIN_R + 0.85, 16],
    [FOUNTAIN_R + 0.9, FOUNTAIN_R + 1.6, 22],
  ] as [number, number, number][])
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + 0.02,
        a1 = ((i + 1) / n) * Math.PI * 2 - 0.02,
        y = r.range(0.03, 0.05),
        at = (a: number, radius: number, h: number): V3 => [Math.cos(a) * radius, h, Math.sin(a) * radius],
        mid = (a0 + a1) / 2,
        centre = at(mid, (r0 + r1) / 2, -1),
        k = r.range(0.85, 1.05);
      face(
        b,
        [at(a0, r0 + 0.03, y), at(a1, r0 + 0.03, y), at(a1, r1 - 0.03, y), at(a0, r1 - 0.03, y)],
        P.path,
        k,
        centre,
      );
      face(b, [at(a0, r1 - 0.03, y), at(a1, r1 - 0.03, y), at(a1, r1, 0), at(a0, r1, 0)], P.path, k * 0.8, [0, y, 0]);
    }
  // Outside the walls: dark ground, a ring of pines and the roofs of the town, all fading into the night haze.
  prism(b, {at: [0, -0.03, 0], radius: 42, height: 0.01, sides: 4, turn: Math.PI / 4, color: P.grassDark, k: 0.3});
  const o = createSaveableRng('courtyard/outside');
  for (let i = 0; i < 22; i++) {
    const a = o.range(Math.PI * 1.05, Math.PI * 1.95),
      d = o.range(HALF + 3, HALF + 13);
    tree(b, {
      at: [Math.cos(a) * d * 1.3, 0, Math.sin(a) * d],
      height: o.range(4.5, 7.5),
      seed: `outside/${i}`,
      leaf: P.leafDark,
      bark: P.woodDark,
    });
  }
  // In front: a paved street with two lamps, then a low hedge, so a phone's tall view has something to look at.
  b.occlusion = 0;
  for (let i = -HALF - 2; i < HALF + 2; i++)
    for (let j = 0; j < 5; j++)
      prism(b, {
        at: [i + 0.5 + o.range(-0.03, 0.03), 0, HALF + 0.9 + j],
        radius: 0.66,
        top: 0.6,
        height: o.range(0.02, 0.05),
        sides: 4,
        turn: Math.PI / 4 + o.range(-0.04, 0.04),
        color: P.stoneDark,
        k: o.range(0.8, 1.1),
      });
  b.occlusion = 0.8;
  for (let i = 0; i < 30; i++) {
    const x = -HALF - 2 + i * ((2 * HALF + 4) / 29) + o.range(-0.3, 0.3);
    rock(b, {
      at: [x, 0.3, HALF + 6.4 + o.range(-0.2, 0.3)],
      size: o.range(0.55, 0.8),
      squash: 0.85,
      seed: `front/${i}`,
      color: i % 3 ? P.leafDark : P.leaf,
    });
  }
  for (const [x, z, w, h] of [
    [-6, -HALF - 3.4, 5, 4.2],
    [1.5, -HALF - 4.2, 4, 5],
    [7.5, -HALF - 3.2, 4.5, 4.4],
  ] as [number, number, number, number][]) {
    box(b, {at: [x, 0, z], size: [w, h, 4], color: P.stone, k: 0.7});
    roof(b, {at: [x, h, z], size: [w + 0.5, 2, 4.6], color: P.roof});
    box(b, {at: [x - w * 0.22, h * 0.55, z + 2.01], size: [0.6, 0.7, 0.04], color: 0xffd9a0});
  }
  // A faint glow round every lamp, the water and the windows, on top of the stone's own colours (white: no darkening).
  bakeLight(b, 0xffffff, LIGHTS);
  return toMesh(b);
}

/** Everything standing in the courtyard: walls, gate, windows, fountain, lamp posts, planters, benches, barrels. */
export function courtyardStone() {
  const b = bake();
  for (const [x, z] of STREET_LAMPS) lanternPost(b, x, z);
  // Walls: north with the arched gate, west and east with lit windows, and a low parapet across the front.
  const gate = (x: number, y: number) =>
    Math.abs(x - HALF) < 1.35 && y < 2.2 + Math.sqrt(Math.max(0, 1.35 ** 2 - (x - HALF) ** 2)) * 0.9;
  blockWall(b, {origin: [-HALF, 0, -HALF], ry: 0, length: 2 * HALF, height: 3.4, seed: 'wall/north', skip: gate});
  blockWall(b, {
    origin: [-HALF, 0, HALF],
    ry: Math.PI / 2,
    length: 2 * HALF,
    height: 3.4,
    seed: 'wall/west',
    skip: (x, y) => WINDOWS.some(w => w.ry > 0 && Math.abs(x - (HALF - w.at[2])) < 0.6 && Math.abs(y - w.at[1]) < 0.6),
  });
  blockWall(b, {
    origin: [HALF, 0, -HALF],
    ry: -Math.PI / 2,
    length: 2 * HALF,
    height: 3.4,
    seed: 'wall/east',
    skip: (x, y) => WINDOWS.some(w => w.ry < 0 && Math.abs(x - (HALF + w.at[2])) < 0.6 && Math.abs(y - w.at[1]) < 0.6),
  });
  blockWall(b, {origin: [HALF, 0, HALF], ry: Math.PI, length: 2 * HALF, height: 0.75, seed: 'wall/south'});
  // The gate's arch: wedge stones round the opening.
  for (let i = 0; i < 9; i++) {
    const a0 = (i / 9) * Math.PI,
      a1 = ((i + 1) / 9) * Math.PI - 0.03,
      ring = (a: number, radius: number, z: number): V3 => [
        Math.cos(a) * radius,
        2.2 + Math.sin(a) * radius * 0.9,
        -HALF + z,
      ];
    const q = [ring(a0, 1.3, 0.1), ring(a1, 1.3, 0.1), ring(a1, 1.8, 0.1), ring(a0, 1.8, 0.1)];
    face(b, q, P.stone, i % 2 ? 1.1 : 0.95, [0, 2.2, -HALF - 1]);
  }
  for (const x of [-1.5, 1.5]) box(b, {at: [x, 0, -HALF + 0.05], size: [0.4, 2.2, 0.2], color: P.stone, k: 1.05});
  // The arch above the door is filled with boards, fanned like the door's top.
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI,
      a1 = ((i + 1) / 8) * Math.PI,
      p = (a: number): V3 => [Math.cos(a) * 1.32, 2.2 + Math.sin(a) * 1.32 * 0.9, -HALF + 0.02];
    face(b, [[0, 2.2, -HALF + 0.02], p(a0), p(a1)], P.wood, i % 2 ? 0.75 : 0.65, [0, 2.2, -HALF - 1]);
  }
  // Windows: a frame, warm glass that reads as lit rooms, a sill and a box of flowers.
  for (const [i, w] of WINDOWS.entries()) {
    const c = Math.cos(w.ry),
      s = Math.sin(w.ry),
      p = (x: number, y: number, z: number): V3 => [w.at[0] + x * c + z * s, y, w.at[2] - x * s + z * c];
    box(b, {at: p(0, w.at[1] - 0.6, 0), size: [1.2, 1.25, 0.1], ry: w.ry, color: P.woodDark});
    box(b, {at: p(0, w.at[1] - 0.5, 0.03), size: [1.0, 1.05, 0.06], ry: w.ry, color: 0xffd9a0});
    box(b, {at: p(0, w.at[1] - 0.5, 0.08), size: [0.06, 1.05, 0.03], ry: w.ry, color: P.woodDark});
    box(b, {at: p(0, w.at[1] + 0.02, 0.08), size: [1.0, 0.05, 0.03], ry: w.ry, color: P.woodDark});
    box(b, {at: p(0, w.at[1] - 0.72, 0.12), size: [1.3, 0.14, 0.26], ry: w.ry, color: P.wood});
    for (let f = 0; f < 5; f++)
      rock(b, {
        at: p(-0.48 + f * 0.24, w.at[1] - 0.52, 0.14),
        size: 0.13,
        squash: 0.85,
        seed: `window/${i}/${f}`,
        color: f % 2 ? P.leaf : P.bloom,
      });
  }
  // The fountain: an octagonal basin with a rim, a pedestal and a bowl (the water and its spray are separate).
  ring(b, {at: [0, 0, 0], inner: FOUNTAIN_R - 0.25, outer: FOUNTAIN_R, height: 0.55, color: P.stone});
  ring(b, {at: [0, 0.55, 0], inner: FOUNTAIN_R - 0.3, outer: FOUNTAIN_R + 0.08, height: 0.1, color: P.cream});
  prism(b, {
    at: [0, 0, 0],
    radius: FOUNTAIN_R - 0.2,
    height: 0.1,
    sides: 8,
    turn: Math.PI / 8,
    color: P.stoneDark,
    k: 0.6,
  });
  prism(b, {at: [0, 0.3, 0], radius: 0.32, top: 0.22, height: 1.0, sides: 8, color: P.stone});
  prism(b, {at: [0, 1.3, 0], radius: 0.25, top: 0.8, height: 0.28, sides: 8, color: P.cream});
  prism(b, {at: [0, 1.58, 0], radius: 0.8, top: 0.7, height: 0.06, sides: 8, color: P.cream});
  // Lantern posts and wall lamps.
  for (const [x, z] of POSTS) lanternPost(b, x, z);
  for (const [x, y, z] of SCONCES) {
    box(b, {at: [x, y - 0.5, z - 0.2], size: [0.08, 0.08, 0.5], color: P.iron});
    prism(b, {at: [x, y + 0.2, z], radius: 0.3, top: 0, height: 0.24, sides: 4, turn: Math.PI / 4, color: P.iron});
  }
  // Planters with trees, benches, barrels and climbing plants along the walls.
  for (const [i, [x, z]] of PLANTERS.entries()) {
    box(b, {at: [x, 0, z], size: [1.5, 0.6, 1.5], color: P.stone});
    box(b, {at: [x, 0.6, z], size: [1.3, 0.04, 1.3], color: P.woodDark});
    tree(b, {at: [x, 0.6, z], height: 3.4, seed: `planter/${i}`, leaf: P.leaf, bark: P.woodDark, kind: 'round'});
  }
  for (const {at, ry} of BENCHES) bench(b, at, ry);
  for (const [x, z] of [
    [-9.2, -2],
    [-9.2, -1.2],
    [9.25, 1],
  ] as [number, number][]) {
    prism(b, {at: [x, 0, z], radius: 0.32, top: 0.36, height: 0.45, sides: 9, color: P.wood});
    prism(b, {at: [x, 0.45, z], radius: 0.36, top: 0.32, height: 0.45, sides: 9, color: P.wood});
    for (const y of [0.12, 0.72]) prism(b, {at: [x, y, z], radius: 0.355, height: 0.05, sides: 9, color: P.iron});
  }
  const v = createSaveableRng('courtyard/vines');
  for (const [x0, z0, x1, z1] of [
    [-HALF + 0.3, -HALF + 0.3, -3.5, -HALF + 0.3],
    [3.5, -HALF + 0.3, HALF - 0.3, -HALF + 0.3],
    [-HALF + 0.3, 5, -HALF + 0.3, 9],
    [HALF - 0.3, -9, HALF - 0.3, -6],
  ] as [number, number, number, number][])
    for (let i = 0; i < 9; i++) {
      const t = i / 8,
        x = x0 + (x1 - x0) * t,
        z = z0 + (z1 - z0) * t;
      rock(b, {
        at: [x, v.range(2.6, 3.3), z],
        size: v.range(0.35, 0.55),
        squash: 0.8,
        seed: `vine/${x0}/${i}`,
        color: i % 3 ? P.leaf : P.leafDark,
      });
      if (i % 2)
        rock(b, {
          at: [x, v.range(1.6, 2.4), z],
          size: v.range(0.2, 0.35),
          squash: 1.2,
          seed: `vine/${x0}/${i}/low`,
          color: P.leafDark,
        });
    }
  // A faint glow round every lamp, the water and the windows, on top of the stone's own colours (white: no darkening).
  bakeLight(b, 0xffffff, LIGHTS);
  return toMesh(b);
}
