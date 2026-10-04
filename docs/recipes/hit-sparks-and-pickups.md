# Recipe: hit sparks, pickups, trails and smoke

An `Emitter` on an entity with a `Transform` throws out small camera-facing quads: sparks when something is hit, a
glitter on a pickup and a burst when it is collected, a trail behind something moving, smoke from a chimney. Each
emitter is **one draw** however many particles it has, and costs nothing while it has none alive.

## Turn particles on for a scene

A scene draws emitters only when it says so, with its particle limits. Games and scenes without it carry none of the
particle code.

```ts
import { defineScene, sceneParticles } from '@engine';

export const level = defineScene({ id: 'level', title: 'Level',
  particles: sceneParticles(),   // or sceneParticles({ emitters: 8, max: 1024 })
  // entities, systems, view …
});
```

## Hit sparks: a burst that cleans up after itself

```ts
// game/fx.ts
import { defineEmitter, defineEntity } from '@engine';

/** Spawn with a Transform where the hit happened; it fires once and removes itself when its sparks are gone. */
export const hitSparks = defineEntity({ id: 'hit-sparks', components: [
  defineEmitter({
    mode: 'burst', count: 24, bursts: 1, max: 24,   // one burst of 24, on spawn
    lifetime: [.25, .5], speed: [3, 6], spread: Math.PI / 2, direction: [0, 1, 0],
    gravity: [0, -12, 0], drag: 1,
    size: [.12, .02], color: [0xfff4b0, 0xff8a1a, 0x7a1e00], opacity: [1, 0],
    despawn: true,
  }),
] });
```

```ts
// in a fixed system, when a hit happens at (x, y, z)
import { Transform } from '@engine';
import { hitSparks } from './fx';

ctx.spawn(hitSparks, Transform({ x, y, z }));
```

Give the prefab no `Transform` of its own and pass one to `ctx.spawn`, so every hit gets its own position.
`despawn: true` removes the entity once the burst has fired and its longest lifetime (`lifetime[1]`) has passed.

## A pickup that glitters, then bursts when collected

```ts
import { burst, defineEmitter, defineEntity, defineSystem, Name, Shape, Transform } from '@engine';

export const coin = defineEntity({ id: 'coin', components: [
  Name({ name: 'coin' }), Transform({ y: .6 }), Shape({ kind: 'cylinder', size: [.5, .08, .5], color: 0xffd23a }),
  // A slow glitter while it waits.
  defineEmitter({ mode: 'continuous', rate: 6, max: 12, lifetime: [.6, 1], speed: [.2, .5], spread: Math.PI,
    size: [.08, 0], color: [0xffffff, 0xffe27a], opacity: [.9, 0] }),
] });

export const collect = defineSystem({ id: 'collect', run(ctx) {
  const e = ctx.named('coin');
  if (e === undefined || !ctx.input.pressed('use')) return;
  ctx.spawn(pickupBurst, Transform({ ...ctx.world.get(e, Transform)! }));
  ctx.world.despawn(e);
} });

/** Spawned where the pickup was: a ring of sparkles. */
export const pickupBurst = defineEntity({ id: 'pickup-burst', components: [
  defineEmitter({ mode: 'burst', count: 32, bursts: 1, max: 32, lifetime: [.4, .7], speed: [1.5, 2.5], spread: Math.PI / 2,
    direction: [0, 1, 0], gravity: [0, -3, 0], size: [.14, .02], color: [0xffffff, 0xffd23a], opacity: [1, 0], despawn: true }),
] });
```

To fire the same emitter again instead of spawning a new one, call `burst(ctx.world, entity)` (it raises the
emitter's `bursts` count; the next fixed step fires it). Despawning the coin removes its glitter at once; the burst
is a separate entity, so it plays out.

## A trail and smoke

```ts
// on a moving entity: spawns are spread along its path between steps, so the trail stays even at speed
defineEmitter({ mode: 'continuous', rate: 80, max: 96, lifetime: [.3, .5], speed: [0, .2], spread: Math.PI,
  size: [.2, .04], color: [0x8fd8ff, 0x2a4cff], opacity: [.8, 0] }),

// smoke: normal blending (it darkens, does not glow), rising, growing, fading
defineEmitter({ mode: 'continuous', rate: 12, max: 48, lifetime: [2, 3], speed: [.4, .8], spread: .3, direction: [0, 1, 0],
  gravity: [.3, .2, 0], drag: .4, size: [.3, 1.2], color: [0x8a8a8a, 0x5a5a5a], opacity: [.5, .3, 0], blending: 'normal' }),
```

Stop and start a continuous emitter with `ctx.world.get(e, Emitter)!.playing = false`. Particles already out finish
their lives.

## Animated effects with sprite sheets

A sprite sheet (flipbook) is one texture holding a grid of frames: a puff of smoke, a flame, an explosion, a magic
swirl. Give the emitter its `texture` and `frames`, and every particle plays the frames: still **one draw** per
emitter.

**1. Pack the frames.** Render or export the sequence as same-size PNG files (8-bit RGBA, transparent borders), then
pack them into one sheet with a JSON sidecar beside it:

```sh
npm run fx:pack -- --out game/public/textures/fx/smoke.png --fps 24 \
  --licence CC0-1.0 --author "Your name" --source "smoke.blend, frames 1-16" --tool blender --generator none \
  renders/smoke/
```

A directory is read in natural name order (`smoke_2` before `smoke_10`). The sheet is laid out left to right, then
down, frame 0 at the top left, at most 16 × 16 frames and 4096 × 4096 pixels. `smoke.json` records `cols`, `rows`,
`count`, `fps`, the frame and sheet sizes (including `gpuBytes`, what the sheet costs on the GPU before mipmaps), a
hash of every input frame and the provenance you passed. It runs offline with no extra dependency. Frames sit edge to
edge with no padding, so keep a few transparent pixels round each frame: filtering and mipmaps blend neighbouring
cells at their borders.

**2. Use the sheet.**

```ts
// game/fx.ts
import { defineAsset, defineEmitter, defineEntity, Transform } from '@engine';
import smokeSheet from './public/textures/fx/smoke.json';

export const smokeTexture = defineAsset({ id: 'smoke-sheet', type: 'texture', url: '/textures/fx/smoke.png',
  width: smokeSheet.atlas.width, height: smokeSheet.atlas.height,
  licence: 'CC0-1.0', author: 'Your name', source: 'smoke.blend, frames 1-16, packed with npm run fx:pack' });

/** A chimney: every puff plays the sheet once over its life. */
export const chimney = defineEntity({ id: 'chimney', components: [ Transform({ y: 3 }),
  defineEmitter({ mode: 'continuous', rate: 6, max: 24, lifetime: [2, 3], speed: [.4, .8], spread: .3,
    size: [.6, 1.6], opacity: [.8, 0], blending: 'normal', texture: 'smoke-sheet',
    frames: { cols: smokeSheet.cols, rows: smokeSheet.rows, count: smokeSheet.count, mode: 'over-life' } }),
] });
```

| `frames` field | Meaning |
|---|---|
| `cols`, `rows` | The grid, each 1…16. A bigger grid is refused with a message: split the sequence or drop frames. |
| `count` | Frames in use when the last row is not full (1…cols × rows); default cols × rows. |
| `mode` | `'over-life'`: each particle plays the sheet once across its life (`fps` ignored). `'loop'`: plays at `fps` from frame 0, wrapping. `'random-start'`: loops at `fps` from a random frame, so a cloud of flames does not flicker in step. |
| `fps` | Frames per second for `'loop'` and `'random-start'` (required there), up to 120. |

The start frame of `'random-start'` comes from the particles' own random stream, never `ctx.random()`, so a sheet
never changes your game's random numbers and `?seed=` replays it exactly. `'over-life'` and `'loop'` take no extra
random number: the same emitter moves exactly as it did without `frames`. Changing `cols` or `rows` at run time
restarts the emitter like a `texture` change; `count`, `fps` and `mode` may change every step.

**Where the frames come from, and the licence.** A sheet is an asset like any other: `defineAsset` needs a licence,
an author and a source, and the sidecar keeps the hashes of the frames it was packed from. Record the truth:

- Your own renders (a Blender simulation, a hand-drawn sequence): your licence; name the source file.
- Downloaded packs: keep the pack's licence text with your project and check it allows use in a published game and
  redistribution inside a web build (a texture shipped in a web game can be downloaded by anyone). CC0 needs no
  credit; CC BY needs the credit shown in the game.
- Generated with an AI tool or from an AI video clip: name the tool and model in `--tool` and `--generator`, and
  check the plan you generated it on grants you commercial rights and lets you keep the output private; free tiers of
  some services publish your outputs or keep their rights. Do not pack frames whose terms you cannot state.

## Fields

| Field | Default | Meaning |
|---|---|---|
| `mode` | `'burst'` | `'burst'`: `count` particles per requested burst. `'continuous'`: `rate` per second while `playing`. |
| `max` | `64` | The most alive at once (1…4096): the emitter's pool, allocated once. A spawn into a full pool is dropped. |
| `count`, `bursts` | `16` (at most `max`), `0` | Burst size (≤ `max`) and how many bursts were requested; `bursts: 1` fires on spawn. |
| `rate`, `playing` | `20`, `true` | Continuous particles per second (≤ 10,000) and whether it is emitting. |
| `lifetime` | `[.5, 1]` | Seconds each particle lives, `[min, max]`, up to 30. |
| `speed`, `direction`, `spread` | `[1, 3]`, `[0, 1, 0]`, `π/4` | Launch speed (m/s), direction (rotated by the entity's `Transform`) and cone half-angle (0 a jet, π all round). |
| `gravity`, `drag` | `[0, 0, 0]`, `0` | World acceleration (m/s²) and linear drag per second. |
| `size`, `color`, `opacity` | `[.2]`, `[0xffffff]`, `[1, 0]` | Curves over each particle's life: 1 to 8 keys, evenly spaced, blended linearly. Size in metres. |
| `texture` | `''` | A `defineAsset({ type: 'texture' })` id, tinted by `color`; `''` is a soft round dot. |
| `frames` | `null` | The texture is a sprite sheet: `{ cols, rows, count?, fps?, mode }` (see above; needs a `texture`). |
| `blending` | `'additive'` | `'additive'` glows and needs no sorting; `'normal'` covers what is behind (not sorted within the emitter). |
| `essential` | `false` | `true`: never thinned by the particle-density quality setting, and still shown (held still at the spawn point) under Calm; use it when particles carry meaning, such as a pickup's feedback. `false` emitters add no particle under Calm. |
| `despawn` | `false` | `true`: remove the entity once it has emitted and finished. |

`defineEmitter` checks the data and throws on a bad field; building the game fails when a scene's own entities, or a
prefab listed with the game's definitions, name a texture that is not a texture asset. Changing `max`, `texture`,
`blending` or the `frames` grid at run time restarts that emitter (its live particles are cleared; bursts already fired do not fire again);
every other field may change every step.

## Cost and limits

- **Draws:** one per emitter with live particles, two triangles per particle; both show in `play:snap` and the gate's
  per-scene counts. Idle emitters draw nothing and an idle scene renders no frames. The drawing code is a small
  separate file, fetched as a scene with `sceneParticles()` opens; until it arrives particles simulate but are not
  drawn.
- **Scene limits:** `sceneParticles()` admits 16 emitters reserving 4,096 particles in total (the sum of their
  `max`). Change them with `sceneParticles({ emitters, max })`. An emitter beyond them is not drawn and is
  counted (by cause: too many emitters, or too many reserved particles); the first refusal of each cause in a visit is
  reported in the console. A refused burst is dropped (it never fires late)
  and a refused `despawn: true` one-shot removes itself at once; a refused continuous emitter starts when another
  emitter is removed. In a scene without
  `sceneParticles()`, emitters are not simulated or drawn, and the first one is reported once.
- **Quality:** the Graphics knob `effects.particles` (registered, not yet shown on the Graphics screen) draws 100 % on
  reference and high, 75 % on medium and 50 % on low, and shrinks each pool to match. Lighter presets draw a fixed
  subset of the same particles; `essential: true` emitters are never thinned.
- **Determinism:** particles have their own random stream (derived from `?seed=` when given), never `ctx.random()`,
  so adding effects never changes your game's random numbers; they step on the fixed 60 Hz step, so `?seed=` replays
  them exactly, and are drawn at the latest step like shapes (so on a 120 or 144 Hz display they move at 60 Hz, as
  shapes moved by fixed systems do). Particles never change
  the world, except `despawn`, whose timing depends only on the data.

## Test it

`testScene` steps emitters as a running scene does (without drawing) and exposes their counters (`stats` is null
for a scene without `sceneParticles()`):

```ts
const t = await testScene(level, { seed: 1 });
t.ctx.spawn(hitSparks, Transform({ y: 1 }));
t.run(1 / 60);
assert.equal(t.particles.stats!.live, 24);
t.run(1);
assert.equal(t.world.count, before, 'the sparks removed themselves');
```

`t.particles.sample(entity)` describes one emitter: its live particles, spawn attempts and their bounds. For the
named tests every ability or status effect should pass (cancelled windups, single impacts, stacking, owner despawn,
pooled trails), see [test your effects' lifecycles](test-effect-lifecycles.md).

Look at it: `npm run play:snap` and check the draw count against the scene budget. More detail, including what is
not covered, is in the [particles guide](../guides/particles.md).
