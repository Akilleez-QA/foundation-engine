// The shed's room, built once from the forms and the palette (a helper file: no default export): plank walls, a
// window frame, a shelf of jars, a workbench, barrels and a rug, in one mesh (one draw). The floor, the window glass
// and the crate are shapes in the scene; collision stays on the scene's Walls.
import {createSaveableRng} from '@engine';
import {bake, box, prism, rock, toMesh, type Bake, type V3} from './forms';
import {palette as P} from './look';

/** A wall of vertical boards from `from` to `to`, `height` tall: each board its own shade. */
function boards(b: Bake, from: V3, to: V3, height: number, seed: string) {
  const r = createSaveableRng(seed),
    length = Math.hypot(to[0] - from[0], to[2] - from[2]),
    n = Math.round(length / 0.45),
    ry = Math.atan2(-(to[2] - from[2]), to[0] - from[0]);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    box(b, {
      at: [from[0] + (to[0] - from[0]) * t, 0, from[2] + (to[2] - from[2]) * t],
      size: [length / n - 0.02, height * r.range(0.985, 1), 0.12],
      ry,
      color: P.slate,
      k: r.range(0.78, 0.95),
    });
  }
}

export function shedRoom() {
  const b = bake();
  // Walls: a full back wall, low cut-away side walls so the camera sees in, and a stub either side of the doorway.
  boards(b, [-3.9, 0, -3.4], [3.9, 0, -3.4], 2.6, 'shed/back');
  boards(b, [-3.9, 0, -3.3], [-3.9, 0, 3.3], 1.1, 'shed/west');
  boards(b, [3.9, 0, -3.3], [3.9, 0, 3.3], 1.1, 'shed/east');
  boards(b, [-3.9, 0, 3.3], [-0.8, 0, 3.3], 0.35, 'shed/front-w');
  boards(b, [0.8, 0, 3.3], [3.9, 0, 3.3], 0.35, 'shed/front-e');
  for (const x of [-3.9, 3.9]) box(b, {at: [x, 0, -3.4], size: [0.22, 2.7, 0.22], color: P.woodDark});
  box(b, {at: [0, 2.55, -3.4], size: [8, 0.16, 0.24], color: P.woodDark});
  // The window frame and sill (the glass is a glowing shape in the scene).
  box(b, {at: [1.6, 1.05, -3.33], size: [1.3, 1.0, 0.06], color: P.cream});
  box(b, {at: [1.6, 1.12, -3.27], size: [0.06, 0.86, 0.03], color: P.cream});
  box(b, {at: [1.6, 1.53, -3.27], size: [1.1, 0.05, 0.03], color: P.cream});
  box(b, {at: [1.6, 0.98, -3.25], size: [1.4, 0.06, 0.2], color: P.cream});
  // A shelf of jars on the back wall.
  box(b, {at: [-1.9, 1.35, -3.22], size: [2.2, 0.06, 0.28], color: P.woodDark});
  const r = createSaveableRng('shed/jars');
  for (let i = 0; i < 6; i++)
    prism(b, {
      at: [-2.8 + i * 0.36, 1.41, -3.22],
      radius: r.range(0.07, 0.11),
      height: r.range(0.18, 0.32),
      sides: 6,
      color: r.pick([P.bloom, P.accent, P.leaf, P.cream]),
    });
  // A workbench along the east wall, with a pot and a plant on it.
  box(b, {at: [3.62, 0.78, 0.4], size: [0.5, 0.08, 1.8], color: P.wood});
  for (const z of [-0.4, 1.2]) box(b, {at: [3.62, 0, z], size: [0.4, 0.78, 0.08], color: P.woodDark});
  prism(b, {at: [3.62, 0.86, 1.0], radius: 0.13, top: 0.17, height: 0.22, sides: 7, color: P.roof});
  rock(b, {at: [3.62, 1.2, 1.0], size: 0.2, squash: 1, seed: 'shed/plant', color: P.leaf});
  // Barrels in the back corners.
  for (const at of [
    [3.45, 0, -2.95],
    [-3.45, 0, -2.9],
    [-3.5, 0, -2.2],
  ] as V3[]) {
    prism(b, {at, radius: 0.3, top: 0.34, height: 0.45, sides: 9, color: P.wood});
    prism(b, {at: [at[0], 0.45, at[2]], radius: 0.34, top: 0.3, height: 0.45, sides: 9, color: P.wood});
    for (const y of [0.12, 0.72])
      prism(b, {at: [at[0], y, at[2]], radius: 0.335, height: 0.05, sides: 9, color: P.iron});
  }
  // The lamp's cord and shade, hanging over the middle of the room.
  box(b, {at: [0, 2.2, -0.6], size: [0.02, 0.5, 0.02], color: P.iron});
  prism(b, {at: [0, 1.95, -0.6], radius: 0.32, top: 0.08, height: 0.25, sides: 8, color: P.roof});
  // A rug in the middle of the floor: flat, so no darkening towards the floor.
  b.occlusion = 0;
  box(b, {at: [0, 0, 0.2], size: [3.2, 0.02, 2.2], color: P.cream});
  box(b, {at: [0, 0, 0.2], size: [3.0, 0.03, 2.0], color: P.bloom, k: 0.85});
  box(b, {at: [0, 0, 0.2], size: [2.2, 0.035, 1.2], color: P.accent, k: 0.9});
  return toMesh(b);
}
