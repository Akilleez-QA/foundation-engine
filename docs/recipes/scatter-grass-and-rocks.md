# Recipe: scatter grass, rocks and repeated props in one draw each

Every `Shape` entity is its own draw. A field of grass, a ring of rocks or a row of identical lantern posts drawn that
way costs one draw per copy and quickly breaks a scene's `draws` budget. A `Scatter` draws many copies of one primitive
shape or one `Mesh` as a single instanced draw. Placement is seeded and repeatable, and gameplay randomness is never
touched.

```ts
import { defineMaterial, defineMesh, defineScatter, defineScene, sceneScatter, Transform } from '@engine';

const rock = defineMesh({ positions: [0, .45, 0, .6, 0, 0, 0, 0, .6, -.6, 0, 0, 0, 0, -.6, 0, -.2, 0],
  indices: [0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4, 5, 1, 2, 5, 2, 3, 5, 3, 4, 5, 4, 1], color: 0x8a847c }).value;
const LANTERNS: [number, number][] = [[-9, -9], [9, -9], [-9, 9], [9, 9]];

export const courtyard = defineScene({
  id: 'courtyard',
  title: 'Courtyard',
  scatter: sceneScatter(),
  entities: [
    // Grass along the inside of the walls: 1,400 cones, one draw, each a little different.
    [Transform(), defineScatter({ shape: { kind: 'cone', size: [.12, .45, .12] }, color: 0x3f7a3c, colorJitter: [.03, .1, .08],
      area: { kind: 'edge', rect: [-11, -11, 11, 11], width: 2.2 }, count: 1400, seed: 3,
      y: .2, scale: [.6, 1.5], ry: 'random', tilt: .25 })],
    // Rocks in a ring around the fountain, flat-shaded through the entity's Material.
    [Transform(), defineScatter({ mesh: rock, area: { kind: 'ring', radius: [3, 6.5] }, count: 60, seed: 4,
      scale: [.4, 1.2], ry: 'random' }), defineMaterial({ shading: 'flat' })],
    // Lantern posts at exact positions; essential, so a lighter quality preset never drops one.
    [Transform({ y: 1.1 }), defineScatter({ shape: { kind: 'cylinder', size: [.14, 2.2, .14] }, color: 0x1c1f26,
      points: LANTERNS, essential: true }), defineMaterial({ metalness: .8, roughness: .4 })],
  ],
});
```

| Field | Default | Meaning |
|---|---|---|
| `shape` / `mesh` | — | Exactly one: a primitive `{ kind, size }` like `Shape`'s, or a `defineMesh(...).value`. |
| `points` | `[]` | Exact `[x, z]` positions. When given, `area` and `count` are ignored. |
| `area` + `count` | — | `{ kind: 'rect', rect: [minX, minZ, maxX, maxZ] }`, `{ kind: 'ring', radius: [inner, outer] }` or `{ kind: 'edge', rect, width }` (a band along the inside of the rect). `count` is 1…65,536. |
| `seed` | `1` | Another seed gives another layout. |
| `y`, `scale`, `ry`, `tilt` | `0`, `[1, 1]`, `0`, `0` | Height; uniform scale range; yaw in radians or `'random'`; largest random lean from upright. |
| `color`, `colorJitter` | white, `[0, 0, 0]` | Base colour, and per-copy [hue, saturation, lightness] variation. |
| `essential` | `false` | Never thinned by the quality preset, and admitted before other scatters. |
| `visible` | `true` | Hide the whole scatter. |

The entity's `Transform` is the scatter's origin: move, turn or scale it and the whole scatter follows, with no rebuild.
A `Material` on the same entity shades every copy, with every option including `shading`. Textures work on `shape`
scatters only.

## What the engine does

- **Owner:** the scene visit. The drawing code is a lazy chunk that only scenes with `sceneScatter()` download. Each
  admitted scatter is one `InstancedMesh`, built by the batching layer (`instanceStatic`). Its instance buffers are
  written once. Changing the scatter's data or its `Material`'s shading class rebuilds it once.
- **Placement** draws from a stream derived from the scene id, the scatter's `seed` and the run's `?seed=`, if any.
  It never draws from `ctx.random()`, so adding grass cannot change gameplay or an existing replay.
- **Bounds:** at most `sceneScatter({ max })` scatters (default 32, cap 256) and `instances` copies at once (default
  65,536, cap 262,144) per scene. A scatter that does not fit is refused, counted and reported once in the console.
  It is offered again when its data changes or another scatter lets go. Essential scatters are offered first.
- **Quality:** `effects.scatter-density` draws 100% of the copies on reference and high, 60% on medium and 35% on low.
  The kept copies are always a deterministic subset of the full layout, and essential scatters are never thinned.
- **Budgets:** one draw per scatter. Triangles are the drawn copies times the triangles of one copy, so a 1,400-cone
  field adds 1 draw and about 67,000 triangles. `npm run play:snap` lists each scatter's copies and triangles under
  `scatter` in `playtest/latest/probe.json`.
- **Leaving the scene** disposes every instance buffer and returns the shared geometry.

## Limits

- **No collision:** a scatter is presentation only. Posts that block the player still need `Solid` entities or a
  `Walls` row.
- **Static copies:** there is no per-copy animation (sway) and no per-copy despawn. To remove some copies, give the
  scatter new `points`.
- **No `Model` scatter yet:** glTF models cannot be scattered. Bake them, or use a `Mesh`.
- The copies do not cast shadows.

Check: unit tests and `npm run test:scatter-browser`. The browser check covers one draw per scatter, matching
triangles, thinning on low, the same layout on every visit, no redraw when idle and disposal on exit. It runs desktop
Chromium with software GL only, with no physical-device or GPU timing acceptance. See the [guide](../guides/scatter.md).
