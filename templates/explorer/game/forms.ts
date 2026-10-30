// Low-poly forms for scenery (a helper file: no default export). Each builder adds flat-shaded triangles to a Bake;
// toMesh turns the whole Bake into one Mesh, so a garden of rocks, trees and hedges is a single draw.
// Every triangle owns its three vertices, so each face is lit on its own: the faceted low-poly look.
import {createSaveableRng, defineMesh} from '@engine';

export type V3 = [number, number, number];
export interface Bake {
  positions: number[];
  indices: number[];
  colors: number[];
  /** Faces darken towards y = 0 and reach full brightness this many metres up; 0 turns that off (flat decals). */
  occlusion: number;
}
export const bake = (occlusion = 0.8): Bake => ({positions: [], indices: [], colors: [], occlusion});

/** A packed sRGB colour (0xrrggbb) as the linear [r, g, b] a Mesh's vertex colours take, times brightness `k`. */
export function linear(hex: number, k = 1): V3 {
  const c = (v: number) => {
    const s = v / 255;
    return Math.min(1, k * (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4));
  };
  return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)];
}

/** Darker near the ground, full brightness from `reach` metres up: ambient occlusion baked into the colours. */
const occlusion = (y: number, reach: number) => (reach > 0 ? 0.55 + 0.45 * Math.min(1, Math.max(0, y / reach)) : 1);

/** A flat convex polygon, wound to face away from `centre` (so builders need not care about vertex order). */
export function face(b: Bake, points: V3[], hex: number, k: number, centre: V3): void {
  const [a, p, q] = points as [V3, V3, V3];
  const n = cross(sub(p, a), sub(q, a));
  const mid = points.reduce<V3>(
    (m, v) => [m[0] + v[0] / points.length, m[1] + v[1] / points.length, m[2] + v[2] / points.length],
    [0, 0, 0],
  );
  const order = dot(n, sub(mid, centre)) < 0 ? [...points].reverse() : points;
  const base = b.positions.length / 3;
  for (const v of order) {
    b.positions.push(...v);
    b.colors.push(...linear(hex, k * occlusion(v[1], b.occlusion)));
  }
  for (let i = 1; i + 1 < order.length; i++) b.indices.push(base, base + i, base + i + 1);
}

/** A rock (or, with a leaf colour, a bush): a jittered icosahedron, squashed, sitting at `at`. 20 triangles. */
export function rock(b: Bake, o: {at: V3; size: number; seed: string; color: number; squash?: number}): void {
  const r = createSaveableRng(o.seed),
    squash = o.squash ?? 0.6;
  const v = ICO_V.map(([x, y, z]): V3 => {
    const s = o.size * r.range(0.78, 1.15);
    return [o.at[0] + x * s, o.at[1] + y * s * squash, o.at[2] + z * s];
  });
  for (const [i, j, k] of ICO_F) face(b, [v[i]!, v[j]!, v[k]!], o.color, r.range(0.9, 1.08), o.at);
}

/** A frustum with `sides` faces from `at` (the base centre) up `height`; `top: 0` makes a cone. */
export function prism(
  b: Bake,
  o: {
    at: V3;
    radius: number;
    height: number;
    color: number;
    sides?: number;
    top?: number;
    turn?: number;
    lean?: V3;
    k?: number;
  },
): void {
  const n = o.sides ?? 6,
    top = o.top ?? o.radius,
    lean = o.lean ?? [0, 0, 0],
    turn = o.turn ?? 0;
  const ring = (radius: number, y: number, shift: number) =>
    Array.from({length: n}, (_, i): V3 => {
      const a = turn + (i / n) * Math.PI * 2;
      return [
        o.at[0] + Math.cos(a) * radius + lean[0] * shift,
        o.at[1] + y,
        o.at[2] + Math.sin(a) * radius + lean[2] * shift,
      ];
    });
  const low = ring(o.radius, 0, 0),
    high = ring(top, o.height, 1),
    centre: V3 = [o.at[0] + lean[0] / 2, o.at[1] + o.height / 2, o.at[2] + lean[2] / 2];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n,
      k = (o.k ?? 1) * (0.92 + 0.08 * Math.cos((i / n) * Math.PI * 2));
    if (top > 0) face(b, [low[i]!, low[j]!, high[j]!, high[i]!], o.color, k, centre);
    else face(b, [low[i]!, low[j]!, [o.at[0] + lean[0], o.at[1] + o.height, o.at[2] + lean[2]]], o.color, k, centre);
  }
  if (top > 0) face(b, high, o.color, (o.k ?? 1) * 1.05, centre);
}

/** A ring wall, open at the top: an outer wall, an inner wall facing in, and a flat top between them. A basin, a well,
 *  a planter's rim. */
export function ring(
  b: Bake,
  o: {at: V3; inner: number; outer: number; height: number; color: number; sides?: number; k?: number},
): void {
  const n = o.sides ?? 8,
    k = o.k ?? 1,
    [x, y, z] = o.at;
  const p = (radius: number, i: number, h: number): V3 => {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    return [x + Math.cos(a) * radius, y + h, z + Math.sin(a) * radius];
  };
  for (let i = 0; i < n; i++) {
    const j = i + 1,
      mid = (radius: number, h: number) => p(radius, i + 0.5, h);
    face(b, [p(o.outer, i, 0), p(o.outer, j, 0), p(o.outer, j, o.height), p(o.outer, i, o.height)], o.color, k * 0.9, [
      x,
      y + o.height / 2,
      z,
    ]);
    face(
      b,
      [p(o.inner, i, 0), p(o.inner, j, 0), p(o.inner, j, o.height), p(o.inner, i, o.height)],
      o.color,
      k * 0.8,
      mid(o.inner * 2, o.height / 2),
    );
    face(
      b,
      [p(o.inner, i, o.height), p(o.inner, j, o.height), p(o.outer, j, o.height), p(o.outer, i, o.height)],
      o.color,
      k * 1.05,
      [x, y - 1, z],
    );
  }
}

/** A tree: a tapered trunk and either three stacked cones ('pine') or two leafy blobs ('round'). */
export function tree(
  b: Bake,
  o: {at: V3; height: number; seed: string; leaf: number; bark: number; kind?: 'pine' | 'round'},
): void {
  const r = createSaveableRng(o.seed),
    h = o.height,
    [x, y, z] = o.at;
  const lean: V3 = [r.range(-0.08, 0.08) * h, 0, r.range(-0.08, 0.08) * h];
  prism(b, {at: o.at, radius: h * 0.05, top: h * 0.03, height: h * 0.45, sides: 5, color: o.bark, lean});
  if ((o.kind ?? 'pine') === 'pine')
    for (let i = 0; i < 3; i++)
      prism(b, {
        at: [x + lean[0] * (0.8 + i * 0.2), y + h * (0.25 + i * 0.22), z + lean[2] * (0.8 + i * 0.2)],
        radius: h * (0.32 - i * 0.08),
        top: 0,
        height: h * (0.42 - i * 0.06),
        sides: 7,
        turn: r.range(0, 1),
        color: o.leaf,
      });
  else {
    rock(b, {
      at: [x + lean[0], y + h * 0.62, z + lean[2]],
      size: h * 0.34,
      squash: 0.85,
      seed: `${o.seed}/a`,
      color: o.leaf,
    });
    rock(b, {
      at: [x + lean[0] + h * r.range(-0.18, 0.18), y + h * 0.82, z + lean[2] + h * r.range(-0.12, 0.12)],
      size: h * 0.22,
      squash: 0.9,
      seed: `${o.seed}/b`,
      color: o.leaf,
    });
  }
}

/** A crystal cluster: a few six-sided shards with pointed tips, leaning out from `at`. */
export function crystal(b: Bake, o: {at: V3; height: number; seed: string; color: number; shards?: number}): void {
  const r = createSaveableRng(o.seed);
  for (let i = 0, n = o.shards ?? 5; i < n; i++) {
    const h = o.height * (i === 0 ? 1 : r.range(0.45, 0.8)),
      a = r.range(0, Math.PI * 2),
      tilt = i === 0 ? 0.05 : r.range(0.25, 0.6),
      lean: V3 = [Math.cos(a) * tilt * h, 0, Math.sin(a) * tilt * h],
      radius = h * 0.16,
      at: V3 = [
        o.at[0] + Math.cos(a) * radius * 0.8 * Math.min(i, 1),
        o.at[1],
        o.at[2] + Math.sin(a) * radius * 0.8 * Math.min(i, 1),
      ];
    prism(b, {
      at,
      radius,
      top: radius * 0.9,
      height: h * 0.75,
      sides: 6,
      color: o.color,
      lean: [lean[0] * 0.75, 0, lean[2] * 0.75],
    });
    prism(b, {
      at: [at[0] + lean[0] * 0.75, at[1] + h * 0.75, at[2] + lean[2] * 0.75],
      radius: radius * 0.9,
      top: 0,
      height: h * 0.25,
      sides: 6,
      color: o.color,
      lean: [lean[0] * 0.25, 0, lean[2] * 0.25],
    });
  }
}

/** A box standing on `at` (its base centre), `size` [w, h, d], turned `ry` radians about the vertical. */
export function box(b: Bake, o: {at: V3; size: V3; color: number; ry?: number; k?: number}): void {
  const [w, h, d] = o.size,
    c = Math.cos(o.ry ?? 0),
    s = Math.sin(o.ry ?? 0);
  const p = (x: number, y: number, z: number): V3 => [o.at[0] + x * c + z * s, o.at[1] + y, o.at[2] - x * s + z * c];
  const v = [-1, 1].flatMap(x => [0, 1].flatMap(y => [-1, 1].map(z => p((x * w) / 2, y * h, (z * d) / 2))));
  const centre: V3 = [o.at[0], o.at[1] + h / 2, o.at[2]],
    k = o.k ?? 1;
  for (const [q, shade] of [
    [[0, 1, 3, 2], 0.9],
    [[4, 5, 7, 6], 0.9],
    [[2, 3, 7, 6], 1.05],
    [[0, 1, 5, 4], 0.8],
    [[0, 2, 6, 4], 0.95],
    [[1, 3, 7, 5], 0.95],
  ] as const)
    face(
      b,
      q.map(i => v[i]!),
      o.color,
      k * shade,
      centre,
    );
}

/** A gable roof whose ridge runs along x: `at` is the centre of the eaves, `size` [w, rise, d]. */
export function roof(b: Bake, o: {at: V3; size: V3; color: number}): void {
  const [w, h, d] = o.size,
    [x, y, z] = o.at;
  const e = (sx: number, sz: number): V3 => [x + (sx * w) / 2, y, z + (sz * d) / 2],
    r = (sx: number): V3 => [x + (sx * w) / 2, y + h, z];
  const centre: V3 = [x, y + h / 3, z];
  face(b, [e(-1, 1), e(1, 1), r(1), r(-1)], o.color, 1, centre);
  face(b, [e(-1, -1), e(1, -1), r(1), r(-1)], o.color, 0.85, centre);
  face(b, [e(-1, -1), e(-1, 1), r(-1)], o.color, 0.75, centre);
  face(b, [e(1, -1), e(1, 1), r(1)], o.color, 0.75, centre);
}

/** A flat ground grid, `size` metres square in `cells` × `cells`, coloured per vertex by `color(x, z)` (linear RGB). */
export function ground(b: Bake, o: {size: number; cells: number; color: (x: number, z: number) => V3}): void {
  const n = o.cells,
    base = b.positions.length / 3;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      const x = (j / n - 0.5) * o.size,
        z = (i / n - 0.5) * o.size;
      b.positions.push(x, 0, z);
      b.colors.push(...o.color(x, z));
    }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const a = base + i * (n + 1) + j;
      b.indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
}

/** A light baked into vertex colours: it costs nothing when drawn, and lights only what was baked with it. */
export interface BakedLight {
  at: V3;
  color: number;
  /** Brightness at the light; 1 doubles a surface's colour right next to it (colours stop at full). */
  intensity: number;
  /** Metres to where its light has faded out. */
  range: number;
}

/** Multiply every vertex colour by the `ambient` colour plus each light that reaches it, fading with distance and
 *  with how far the surface turns away. Call once, after building and before toMesh. */
export function bakeLight(b: Bake, ambient: number, lights: readonly BakedLight[]): void {
  const p = b.positions,
    normals = new Array<number>(p.length).fill(0);
  for (let t = 0; t < b.indices.length; t += 3) {
    const [i, j, k] = [b.indices[t]! * 3, b.indices[t + 1]! * 3, b.indices[t + 2]! * 3];
    const at = (o: number): V3 => [p[o]!, p[o + 1]!, p[o + 2]!];
    const n = cross(sub(at(j), at(i)), sub(at(k), at(i)));
    for (const o of [i, j, k]) for (let c = 0; c < 3; c++) normals[o + c]! += n[c]!;
  }
  const base = linear(ambient),
    tints = lights.map(l => linear(l.color).map(c => c * l.intensity));
  for (let o = 0; o < p.length; o += 3) {
    const n: V3 = [normals[o]!, normals[o + 1]!, normals[o + 2]!],
      length = Math.hypot(...n) || 1,
      light: V3 = [...base];
    for (const [i, l] of lights.entries()) {
      const d: V3 = [l.at[0] - p[o]!, l.at[1] - p[o + 1]!, l.at[2] - p[o + 2]!],
        distance = Math.hypot(...d) || 1,
        fade = Math.max(0, 1 - distance / l.range) ** 2,
        facing = 0.3 + 0.7 * Math.max(0, dot(n, d) / (length * distance));
      for (let c = 0; c < 3; c++) light[c]! += tints[i]![c]! * fade * facing;
    }
    for (let c = 0; c < 3; c++) b.colors[o + c] = Math.min(1, b.colors[o + c]! * light[c]!);
  }
}

/** A blob for a scatter: an icosahedron (12 vertices, 20 faces), `size` across and squashed in height. Give its
 *  entity `defineMaterial({shading: 'flat'})` to keep the facets. */
export function blobMesh(size: number, squash = 1) {
  const v = ICO_V.map(([x, y, z]): V3 => [x * size, y * size * squash, z * size]);
  const indices = ICO_F.flatMap(([i, j, k]) => {
    const n = cross(sub(v[j]!, v[i]!), sub(v[k]!, v[i]!));
    return dot(n, v[i]!) > 0 ? [i, j, k] : [i, k, j];
  });
  return defineMesh({positions: v.flat(), indices}).value;
}

/** The finished Bake as one Mesh component: one draw. */
export const toMesh = (b: Bake) => defineMesh({positions: b.positions, indices: b.indices, colors: b.colors});

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const T = (1 + Math.sqrt(5)) / 2;
const ICO_V: V3[] = (
  [
    [-1, T, 0],
    [1, T, 0],
    [-1, -T, 0],
    [1, -T, 0],
    [0, -1, T],
    [0, 1, T],
    [0, -1, -T],
    [0, 1, -T],
    [T, 0, -1],
    [T, 0, 1],
    [-T, 0, -1],
    [-T, 0, 1],
  ] as V3[]
).map(v => v.map(c => c / Math.hypot(1, T)) as V3);
const ICO_F = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
] as const;
