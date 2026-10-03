# Recipe: test a scene

`testScene` runs one scene without a browser, for a game's own unit tests (`game/*.test.ts`). It spawns the scene's
entities into a real world, runs `prepare` and `enter`, and then runs the scene's real systems on the real 60 Hz fixed
step when you call `run`. Input is scripted, saves live in memory, and nothing is drawn or heard. What a test sees is
what a player's frame computes, minus the drawing.

## 1. A scene and its test

```ts
// game/door.ts
import { defineInput, defineScene, defineSystem } from '@engine';

export const open = defineInput({ id: 'open', label: 'Open', keys: ['KeyE'], pad: ['a'] });

const doors = defineSystem({ id: 'doors', run(ctx) {
  if (!ctx.input.pressed('open')) return;
  ctx.play('ui.success', { volume: .8 });
  ctx.scene.goto('hall', { from: 'door' });
} });

export default defineScene({ id: 'door', title: 'Door', systems: [doors],
  enter(ctx) { ctx.state.from = ctx.scene.params.from ?? 'start'; } });
```

```ts
// game/door.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testScene } from '@engine';
import door, { open } from './door';

test('S3: opening the door chimes and goes to the hall', async () => {
  const t = await testScene(door, { inputs: [open], params: { from: 'porch' }, seed: 1 });
  assert.equal(t.ctx.state.from, 'porch');                 // enter has run
  t.press('open'); t.run(1 / 60);                         // one frame with the press
  assert.deepEqual(t.plays, [{ id: 'ui.success', options: { volume: .8 } }]);
  assert.deepEqual(t.went, ['hall']);                     // the scene asked to go; it is still this scene
  t.dispose();
});
```

Name a test after the success criterion it checks (`S3: …`) so `npm run play:criteria` finds it.

## 2. Options

`testScene(scene, options)` returns a promise (await it). Every option is optional.

| Option | What it does |
|---|---|
| `game` | The game definition: `ctx.text` reads its English strings and its kits' strings (without it, `ctx.text` returns the key). |
| `inputs` | The game's `defineInput` rows: their labels become `game.input.<id>` strings and `ctx.input.describe` hints. |
| `brief` | The build brief, as `ctx.brief` (kits read `policy`, for example). |
| `params` | `ctx.scene.params`, as a `goto(id, params)` or `#scene/<id>?a=b` would give. Default `{}`. |
| `seed` | Seeds `ctx.random()` (default 1). The same seed replays the same run. |
| `calm` | `ctx.time.calm` (the player's reduced-motion setting). Default false. |
| `systems` | Extra systems run after the scene's own, for example a probe a test adds. |
| `services` | Engine or kit services the scene reads with `ctx.service(key)`; `save` replaces the helper's own save store (the injected store stays yours to dispose). |
| `input` | A caller-owned `InputSource` (a replay log, say). `press`, `hold` and `release` then throw. |
| `audioClock` | A function from `ctx.time.now` (ms) to an audio clock reading, for `ctx.audioClock()` ([sync to music](sync-gameplay-to-music.md)). |
| `particleScale` | The `effects.particles` quality knob (default 1, the reference preset). |
| `sounds` | Extra ids `ctx.play` / `ctx.playVoice` may use besides the built-in cues and the scene's `sounds` (see 4). |

## 3. What the result exposes

| Field | What it is | How to assert on it |
|---|---|---|
| `ctx` | The scene's `SceneContext`, the same object its systems get. `ctx.state` is the scene state, `ctx.named(name)` finds an entity, `ctx.save(section)` reads and writes a save section. | `assert.equal(t.ctx.state.score, 3)` |
| `world` | The ECS world. | `t.world.get(t.ctx.named('player')!, Transform)!.x`, `[...t.world.query(Coin)].length`, `t.world.count` |
| `run(seconds)` | Runs `seconds × 60` fixed frames (rounded). A system that throws fails the call with `system <id> failed: …`. | `t.run(1 / 60)` is one frame. |
| `press(action)` | Presses a button action for the next frame only. | `t.press('jump'); t.run(1 / 60)` |
| `hold(action, axis?)` / `release(action)` | Holds a button, or sets an axis (-1…1), until released. | `t.hold('steer', -1); t.run(.5); t.release('steer')` |
| `went` | Scene ids the scene asked for with `ctx.scene.goto` or `restart`, in order. Only the id is recorded (not the params), and the scene keeps running: `testScene` never changes scene. | `assert.deepEqual(t.went, ['hall'])` |
| `plays` | Every `ctx.play`, in order: `{ id, options? }`, options copied and checked as the browser checks them. | `assert.deepEqual(t.plays, [{ id: 'ui.bump' }])` |
| `cues` | The ids of every `ctx.play` and `ctx.playVoice`, in order. | `assert.ok(t.cues.includes('ui.success'))` |
| `voices` | Every `ctx.playVoice`: `{ id, options? }`, options normalised as the audio output normalises them (no `onEnded`). `playVoice` returns null. | `assert.equal(t.voices[0].options?.gain, .5)` |
| `music` | Every `ctx.playMusic`: `{ id, options? }`. Nothing plays: it returns null and `loadMusic` resolves false. | `assert.deepEqual(t.music.map(m => m.id), ['theme'])` |
| `particles` | `stats`: the particle field's counters (null without `sceneParticles()`); `reports`: every particle problem reported. | `assert.deepEqual(t.particles.reports, [])` ([particles](hit-sparks-and-pickups.md)) |
| `setActivity(facts)` / `activityErrors` | Changes the scene's activity facts (`coverage`, `documentHidden`) and lists errors its `activity` listener threw ([scene activity](../guides/scene-activity.md)). | `t.setActivity({ coverage: 'opaque', documentHidden: false })` |
| `dispose()` | Runs the scene's `exit` once and disposes the helper's own save store. A second call does nothing; `run`, `press`, `hold`, `release` and `setActivity` then throw `testScene: disposed`. | Call it at the end of each test. |

Saves: without `services.save`, each `testScene` has its own empty in-memory save store, and a second `testScene`
does not see the first one's saves. Writes stay pending until `{ now: true }` or `ctx.service('save').flush()`
([save sections](add-a-save-section.md#5-test-the-same-save-path)).

`testScene` always runs `prepare` and `enter` before the first frame and never changes scene. Check scene changes,
reloads, layout and drawing in a browser with `npm run play:snap` and `npm run play:script`.

## 4. Cue and sound ids are checked

`ctx.play` and `ctx.playVoice` accept a built-in cue id ([the list](play-your-own-sounds.md#built-in-cues), also
`BUILT_IN_CUES` from `@engine`) or a sound id of your game ([play your own sounds](play-your-own-sounds.md)). In a
browser an unknown id only warns `no cue or sound '<id>'` in the console and plays nothing. In `testScene` it throws, so
the test that reaches it fails, naming the id and the built-in cues:

```text
system lose failed: Error: testScene: ctx.play('ui.fail'): no cue or sound 'ui.fail' in scene field. Built-in cues: ui.click, ui.success, ui.arrive, ui.count, ui.bump. A game sound needs defineAsset({ type: 'audio' }) and the scene's sounds (or testScene's sounds option).
```

`testScene` accepts the built-in cues, the scene's own `sounds: [...]`, and the ids in its `sounds` option. List a sound
in the scene's `sounds` (it then loads with the scene, so its first play is on time); use the option only for an id the
scene plays without listing, such as a cue a module the test composes registers. A refused play is not recorded.

## Limits

- No drawing, layout, audio output, browser storage or scene change: those need the browser tools.
- `went` records ids only; assert a `goto`'s params by reading what the target scene would read, in its own test.
- Only `ctx.play` and `ctx.playVoice` ids are checked; `ctx.playMusic` ids are recorded as given.
