# Recipe: camera and lighting

Make the camera follow the player, switch camera modes, and set the light, sky colour and haze of a scene.

## 1. The camera

Every scene starts from `view.camera` (`position`, `target`, vertical `fov` in degrees, and `minWidthFov`, which widens the view on a narrow portrait screen so a phone still sees the play area). Systems may move `ctx.view.camera` themselves; the camera kit does it for you:

| `cameraSystem(mode, options)` | What it does | Useful options |
|---|---|---|
| `'follow'` | behind the target, turning with it | `distance`, `height` |
| `'orbit'` | around the target at a fixed angle | `distance`, `pitch`, `yaw` (radians) |
| `'first-person'` | at the target's eyes, looking where it faces | `eye` |
| `'top-down'` | straight above | `height` |
| `'side-scroll'` | from the side, for 2.5D | `distance`, `height` |
| `'fixed'` | a fixed spot; `track: true` keeps looking at the target | `position`, `lookAt`, `track` |

Common options: `target` (the `Name` to follow, default `'player'`), `smooth` (seconds of easing, default 0.12; 0 snaps), and `options: ctx => ({ … })` to change the pose every frame (for example a `yaw` you turn with an axis action). The camera system is a frame system; the scene only redraws while the camera is still moving.

## 2. Light, sky colour and haze

Without `view.environment` a scene gets default lights and the plain `background` colour. With `defineEnvironment` you choose them:

- `background`: the sky colour;
- `ambient`: a sky colour, a ground colour and an intensity (soft light from everywhere);
- `directional`: a colour, an intensity and a `position` the sunlight comes from;
- `haze`: a colour and `near` / `far` distances (fog), or `null`;
- `points` and `pointSize`: small decorative dots on the sky (directions), for example a few stars;
- `cube`: an optional sky box from six texture assets (the `mechanics` template has one).

To change it while playing, assign a new environment to `ctx.view.environment`; the renderer picks it up next frame.

### Tone mapping and exposure

Bright light clips without tone mapping: an emissive lantern at intensity 6 becomes a flat yellow patch. Opt a scene in
with `view.output`, and keep emissive values between about 2 and 6:

```ts
view: { environment: night, output: { toneMapping: 'aces', exposure: 1 } },
```

`toneMapping` is `'none'` (the default), `'aces'`, `'agx'` or `'neutral'`; `exposure` is in (0, 16]. Replace
`ctx.view.output` to change it while playing (`ctx.view.output = { ...ctx.view.output, exposure: 1.3 }`); the scene
redraws once. A scene without `output` looks exactly as before. Details: the
[scene look guide](../guides/scene-look.md#output-tone-mapping-and-exposure).

## 3. The scene

An input to switch views (a key and a pad button; the right shoulder button, `rb`, is free in a new game):

```ts
// game/switch-view.ts
import { defineInput } from '@engine';

export default defineInput({ id: 'switch-view', label: 'Switch view', keys: ['code:KeyV'], pad: ['rb'] });
```

Generate the scene (`npm run new -- scene look`; the game needs `camera()` and `character()` in its `kits`), then:

```ts
// game/look.ts
// Two camera modes and two lighting setups, switched with V or the right shoulder button. Move with WASD, arrows, the stick, or drag.
import { defineEnvironment, defineScene, defineSystem, Name, Shape, Transform } from '@engine';
import { cameraSystem } from '@kits/camera';
import { Character, characterSystem, Walls } from '@kits/character';

export const day = defineEnvironment({
  background: 0x9cc7e4,
  ambient: { sky: 0xffffff, ground: 0x556644, intensity: 1.6 },
  directional: { color: 0xfff1d6, intensity: 2.2, position: [4, 10, 6] },
  haze: { color: 0x9cc7e4, near: 12, far: 40 },
  points: [], pointSize: 1,
});

export const night = defineEnvironment({
  background: 0x0b1020,
  ambient: { sky: 0x334477, ground: 0x111122, intensity: 1 },
  directional: { color: 0x9fb4ff, intensity: 0.8, position: [-4, 8, -2] },
  haze: { color: 0x0b1020, near: 8, far: 30 },
  points: [{ direction: [0.2, 1, -0.4], color: 0xffffff }, { direction: [-0.5, 0.8, -0.3], color: 0xffffff }, { direction: [0.6, 0.7, -0.6], color: 0xffeecc }],
  pointSize: 2,
});

// Camera systems are frame systems; this one hands each frame to whichever mode is chosen.
const follow = cameraSystem('follow', { distance: 6, height: 3.5, smooth: 0.2 });
const above = cameraSystem('top-down', { height: 16 });

export const switchView = defineSystem({
  id: 'switch-view',
  run(ctx) {
    if (!ctx.input.pressed('switch-view')) return;
    ctx.state.night = !ctx.state.night;
    ctx.view.environment = ctx.state.night ? night : day;   // replace the value to change the lighting
  },
});

export const lookCamera = defineSystem({
  id: 'look-camera', phase: 'frame',
  run(ctx, dt) { (ctx.state.night ? above : follow).run(ctx, dt); },
});

export default defineScene({
  id: 'look', title: 'Look', type: 'scene',
  view: { camera: { position: [0, 4, 7], target: [0, 0, 0], fov: 55, minWidthFov: 60 }, background: day.background, environment: day },
  entities: [
    [Name({ name: 'floor' }), Transform(), Shape({ kind: 'plane', size: [30, 0, 30], color: 0x6fa05a })],
    [Walls({ minX: -14, maxX: 14, minZ: -14, maxZ: 14 })],
    [Transform({ x: 3, y: 1, z: 5 }), Shape({ kind: 'box', size: [2, 2, 2], color: 0xb08a5a })],
    [Transform({ x: -4, y: 1.5, z: 8 }), Shape({ kind: 'cone', size: [2, 3, 2], color: 0x2f6b3a })],
    [Name({ name: 'player' }), Transform({ y: 0.7 }), Shape({ kind: 'capsule', size: [0.6, 1.4, 0.6], color: 0xf2c14e }), Character()],
  ],
  systems: [characterSystem({ relative: 'world' }), switchView, lookCamera],
  enter(ctx) { ctx.state.night = false; },
});
```

`cameraSystem(...)` returns an ordinary system, so a scene can hold two and run whichever it wants each frame, as `lookCamera` does. `characterSystem({ relative: 'world' })` makes "up" always mean −z, which keeps controls steady while a follow camera turns. Touch players move by holding a point on the ground; to give them the switch too, add `tap: true` to the action or a button from [HUD text and buttons](hud-and-buttons.md).

## 4. Test it

```ts
// game/look.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testScene } from '@engine';
import game from './game';
import look, { night } from './look';

test('switch-view swaps the lighting and moves the camera above the player', async () => {
  const t = await testScene(look, { game });
  t.run(0.5);
  const behind = t.ctx.view.camera.position[1];
  t.press('switch-view'); t.run(2);
  assert.equal(t.ctx.view.environment, night);
  assert.ok(t.ctx.view.camera.position[1] > behind + 5, 'the top-down camera is high above');
});
```

## 5. Look at it

```
npm run check
npm run play:snap -- --scene look --mobile
```

Light changes are easy to overdo; compare the desktop and phone screenshots, and check that what matters is still readable in the darker setup.

More: the [camera kit README](../../src/kits/camera/README.md) (camera clearance around obstacles), the `explorer` template (orbit) and the `expedition` template (environment with decorative stars).

## When the author API is not enough

`defineEnvironment` has one directional light and one ambient, no local lights, shadows or bloom yet. Reach for
three.js only when the author API cannot express the look: a game that opts into `@kits/three` gets point and spot
lights, shadows, an EffectComposer with bloom and custom shaders, and owns that code across three.js upgrades. See
[use three.js directly](use-three-directly.md).
