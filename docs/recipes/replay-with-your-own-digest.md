# Recipe: replay a scene with your own digest

A replay records what each fixed tick read from `ctx.input` and checks that the
same seed and input give the same state. By default "the same state" means the
world's resources and every entity's `Transform`. That is wrong for a scene whose
presentation moves entities on frame time (a bobbing pickup, a swaying camera
rig, particles): the frame grouping is not in the log, so the replay reports
`diverged` from the first tick even though the game logic is exact.

Tell the replay which state matters, and ask it to name what differed.
The contract and limits are in the [replay guide](../guides/replay-divergence.md#choose-what-a-replay-must-reproduce-sim-02).

## 1. Tag the cosmetic entities

```ts
// game/components.ts
import { defineComponent } from '@engine';

/** Presentation only: moved on frame time, never read by a fixed system. */
export const Cosmetic = defineComponent('cosmetic', {});
export const Score = defineComponent('score', { value: 0 });
```

Spawn the decorative entities with `Cosmetic()`. Keep them cosmetic: if a fixed
system reads their position, the game depends on frame timing and no digest can
make the replay exact.

## 2. Give the scene a digest

```ts
// game/arena.ts
import { defineScene, Transform } from '@engine';
import { replayDigest } from '@kits/replay';
import { Cosmetic, Score } from './components';

export default defineScene({
  id: 'arena', title: 'Arena',
  // Every Transform and Score, the resources, and nothing tagged Cosmetic.
  replay: { digest: replayDigest({ id: 'arena-v1', components: [Transform, Score], exclude: [Cosmetic] }) },
  entities: [/* … */],
  systems: [/* … */],
});
```

The id is part of every log's identity. Change it when you change what the digest
covers, so an old log is refused rather than compared against different state.
For state that is not in components, write the digest yourself:
`{ id: 'arena-rules-v1', state: world => ({ score: world.resources.score, lives: world.resources.lives }) }`.
`state` returns a plain JSON value; the replay canonicalises and hashes it.

## 3. Record and replay with detail

Open the scene with a seed (`npm run play`, then `?seed=7`) and, in the browser
console or a play script:

```js
await engine.replay.start({ mode: 'record', detail: true });
// … play for a while …
const { log } = engine.replay.read();
engine.replay.stop();

await engine.replay.start({ mode: 'replay', log });
// once engine.replay.read().status is 'complete':
const { comparison, divergence } = engine.replay.read();
```

`comparison.status` is `equal` when the selected state replayed exactly. When it
is `diverged`, `divergence` names the first difference at that tick, for example
`{status: 'found', tick: 42, entity: 1, component: 'score', field: 'value', a: '1', b: '7'}`:
`a` is the recording, `b` the replay. `{status: 'unavailable', reason: 'no-detail'}`
means the log kept no detail for that tick; record again with
`detail: { from: <tick - 5>, to: <tick + 5> }`.

Without a scene digest you can pass one to both calls instead:
`engine.replay.start({ mode: 'record', digest: { exclude: ['cosmetic'] }, detail: true })`
and `engine.replay.start({ mode: 'replay', log, digest: { exclude: ['cosmetic'] } })`.
A replay under a different digest is refused (`incompatible-digest`).

## 4. Check it headlessly

```ts
// game/arena.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { recordSceneRun, replaySceneLog } from '@kits/replay';
import arena from './arena';
import steer from './steer';

test('the arena replays exactly from its tick-input log', async () => {
  const limits = { maxTicks: 600, maxBytes: 65536, input: { maxBytes: 512, maxNodes: 32, maxDepth: 4 } };
  const trace = { every: 1, maxEntries: 600, maxDigestLength: 16, detail: { from: 0, to: 600, maxChars: 1 << 20 } };
  const inputs = [steer];
  const recorded = await recordSceneRun(arena, { inputs, seed: 7, ticks: 600, limits, trace,
    script: tick => ({ axes: { steer: tick < 300 ? 1 : -1 } }) });
  const replayed = await replaySceneLog(arena, { inputs, log: recorded.log, trace,
    limits: { ...limits, log: { maxBytes: 1 << 22, maxNodes: 1 << 18, maxDepth: 8 } } });
  assert.equal(replayed.status === 'replayed' && replayed.comparison?.status, 'equal',
    JSON.stringify(replayed.status === 'replayed' && replayed.divergence));
});
```

Headless runs use the scene's digest automatically. A headless run steps frames
at exactly 60 Hz, so it does not reproduce a browser's frame grouping; the
browser replay is the check for frame-phase effects.

## Limits

- A digest only covers what it selects. Excluded state can change unnoticed.
- The report names the first difference in sorted-key order at the first divergent
  sample. The cause may be earlier, or outside the digest.
- Floating-point results can differ between browsers and JavaScript engines; a
  browser log replayed in Node can diverge for that reason alone (see the guide).
