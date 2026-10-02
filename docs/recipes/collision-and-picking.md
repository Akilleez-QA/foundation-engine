# Recipe: collision and picking

There is no physics engine (see the README's "Not here yet"). Three simple tools cover most small games:

- **Overlap**: a system compares positions and reacts (collect, hit, trigger).
- **Blocking**: the character kit moves an entity and slides it along `Walls` (a rectangle it stays inside) and `Solid`s (boxes or circles it cannot enter).
- **Picking**: `pointerOnGround(ctx)` turns a click or tap into a point on the ground; `viewRay` gives the full ray for your own tests.

All of it works on the ground plane (x and z); height is yours to manage.

## 1. Kits and words

```ts
// game/game.ts (excerpt)
import { camera } from '@kits/camera';
import { character } from '@kits/character';
import { ui } from '@kits/ui';
// in defineGame({ … }):
  kits: [ui(), camera(), character()],
  strings: { en: { 'game.hud.collected': 'Collected {n} of {total}', 'game.collected-all': 'All collected!' } },
```

The character kit brings its own movement actions, `character-x` and `character-z` (WASD, arrows, left stick, d-pad).

## 2. The scene

Generate it (`npm run new -- scene collect`), then:

```ts
// game/collect.ts
// Move with the character kit (blocked by Walls and Solids), collect things by overlap, and pick them with the pointer.
import { defineComponent, defineScene, defineSystem, Name, pointerOnGround, Shape, Transform } from '@engine';
import { cameraSystem } from '@kits/camera';
import { Character, characterSystem, Solid, Walls } from '@kits/character';
import { hud } from '@kits/ui';

/** Something to collect; `radius` is how close the player's centre must come, in metres. */
export const Pickup = defineComponent('pickup', { radius: 0.6 });
const TOTAL = 3, PICKED = 0xffffff, GEM = 0x5bc0be;

const gem = (x: number, z: number) => [Transform({ x, y: 0.4, z }), Shape({ kind: 'sphere', size: [0.5, 0.5, 0.5], color: GEM }), Pickup()];
const block = (x: number, z: number) => [Transform({ x, y: 0.5, z }), Shape({ kind: 'box', size: [2, 1, 1], color: 0x8a8f98 }), Solid({ halfX: 1, halfZ: 0.5 })];

// Overlap: a distance check on the ground plane, in a fixed-step system.
export const collectOnTouch = defineSystem({
  id: 'collect-on-touch',
  run(ctx) {
    const e = ctx.named('player'), me = e === undefined ? undefined : ctx.world.get(e, Transform);
    if (!me) return;
    for (const [thing, tr, pickup] of ctx.world.query(Transform, Pickup)) {
      if (Math.hypot(tr.x - me.x, tr.z - me.z) > pickup.radius) continue;
      ctx.world.despawn(thing);
      ctx.state.collected = (ctx.state.collected as number) + 1;
      ctx.play('ui.success');
    }
  },
});

// Picking: where a click or tap meets the ground, then the nearest pickup to that point.
export const pickWithPointer = defineSystem({
  id: 'pick-with-pointer',
  run(ctx) {
    if (!ctx.input.pointer.pressed) return;
    const hit = pointerOnGround(ctx);
    if (!hit) return;
    for (const [, tr, , shape] of ctx.world.query(Transform, Pickup, Shape)) {
      shape.color = Math.hypot(tr.x - hit.x, tr.z - hit.z) < 0.8 ? PICKED : GEM;
    }
  },
});

export const showHud = defineSystem({
  id: 'collect-hud', phase: 'frame',
  run(ctx) {
    const n = ctx.state.collected as number;
    hud(ctx).line('collected', ctx.text('game.hud.collected', { n, total: TOTAL }));
    hud(ctx).banner(n === TOTAL ? ctx.text('game.collected-all') : null);
  },
});

export default defineScene({
  id: 'collect', title: 'Collect', type: 'scene',
  view: { camera: { position: [0, 9, 8], target: [0, 0, 0], minWidthFov: 55 }, background: 0x141a24 },
  entities: [
    [Name({ name: 'floor' }), Transform(), Shape({ kind: 'plane', size: [12, 0, 12], color: 0x2a3342 })],
    [Walls({ minX: -5.5, maxX: 5.5, minZ: -5.5, maxZ: 5.5 })],
    block(-2, -1), block(2, 2),
    gem(-3, -3), gem(3, -2), gem(0, 3),
    [Name({ name: 'player' }), Transform({ y: 0.7 }), Shape({ kind: 'capsule', size: [0.6, 1.4, 0.6], color: 0xf2c14e }), Character({ speed: 4 })],
  ],
  systems: [characterSystem({ pointer: false }), collectOnTouch, pickWithPointer, cameraSystem('orbit', { distance: 10, pitch: 0.9 }), showHud],
  enter(ctx) { ctx.state.collected = 0; },
});
```

- **Overlap** (`collectOnTouch`): `Math.hypot` on x and z against a radius is a circle test. For boxes, compare `Math.abs(dx) < halfWidth && Math.abs(dz) < halfDepth` (the `arcade` template's `collide` system does this). Despawning inside the loop is safe here; the query already yielded the entity.
- **Blocking**: `Walls({ minX, maxX, minZ, maxZ })` keeps characters inside the rectangle. `Solid({ halfX, halfZ })` is a box, `Solid({ r })` a circle; both block only entities with `Character`. Other entities pass through each other unless your systems say otherwise.
- **Moving**: `characterSystem()` reads the movement actions; by default "up" is away from the camera, and holding the pointer on the ground steers the character towards it. Here `pointer: false` turns pointer steering off, so clicks are free for picking.
- **Picking** (`pickWithPointer`): `ctx.input.pointer.pressed` is true in the step the pointer went down; `pointerOnGround(ctx, y)` intersects the camera ray with the horizontal plane at height `y` (default 0) and returns `{ x, z }`, or `null` above the horizon. To test against something that is not on the ground, use `viewRay(ctx.view, ctx.input.pointer)`, which returns `{ origin, dir }`, with your own sphere or box test.
- Changing a `Shape`'s `color` or a `Transform` in place is enough; the renderer notices.

## 3. Test it

Set positions directly and run a step; hold an action for a while to move:

```ts
// game/collect.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testScene, Transform } from '@engine';
import game from './game';
import collect, { Pickup } from './collect';

test('touching a pickup collects it once', async () => {
  const t = await testScene(collect, { game });
  const me = t.world.get(t.ctx.named('player')!, Transform)!;
  me.x = -3; me.z = -3;                     // put the player on the first pickup
  t.run(1 / 60);
  assert.equal(t.ctx.state.collected, 1);
  assert.equal([...t.world.query(Pickup)].length, 2);
  assert.deepEqual(t.cues, ['ui.success']);
});

test('a Solid stops the player', async () => {
  const t = await testScene(collect, { game });
  const me = t.world.get(t.ctx.named('player')!, Transform)!;
  me.x = -2; me.z = 2;                      // south of the block at (-2, -1)
  t.hold('character-z', -1); t.run(2);      // hold "forward" (towards -z) for two seconds
  assert.ok(me.z > -0.5, `stopped at the block's face, z = ${me.z}`);
});
```

## 4. Look at it

```
npm run check
npm run play:snap -- --scene collect
```

`play:snap` holds the arrow keys briefly, so the probe's `named.player` position shows that the character moved.

## Going further

- Uneven ground: `characterSystem({ ground: (x, z) => ({ height }) })` keeps the character on a surface; the `terrain` template does this with exact ground queries and pointer picking against the terrain itself.
- Many solids or many movers cost one check per pair each step. Keep counts small, or split the world into areas yourself.
- Gravity, jumping and bouncing: keep a vertical speed in a component, and in a fixed-step system add it to `Transform.y`, subtract gravity from it, and stop at the ground. Fixed-step systems run at 60 Hz on every machine, so the motion is the same everywhere.
- More: the [character kit README](../../src/kits/character/README.md), the `explorer` template (walls, solids and things to use) and the `arcade` template (box overlap).
