# `kits/replay`: optional replay log and divergence detector (SIM-01)

Pure verification helpers: a bounded tick-input recorder and player, periodic state digests with a first-divergence
comparator, headless scene record/replay through `testScene`, and a prediction-versus-authority agreement check over
the network kit's existing owners. No clock, loop, timer, storage, network or global service; nothing is registered
with a game. A game or test imports what it needs from `@kits/replay`; the engine runs without it. The dev/test-only
`engine.replay` surface (`src/dev/replay.ts`) uses this kit and is never in production builds.

The contract (inputs, outputs, owner, bounds, overload, cancellation, recovery, limitations and evidence) is in
[docs/guides/replay-divergence.md](../../../docs/guides/replay-divergence.md). In short:

```ts
import { createReplayRecorder, openReplay, createDigestTrace, compareDigests } from '@kits/replay';

const header = { build: 'my-game@1.0.0', config: 'probe-v1', seed: 7, step: 0.01 };
const limits = { maxTicks: 10_000, maxBytes: 64 << 10, input: { maxBytes: 256, maxNodes: 16, maxDepth: 4 } };
const recorder = createReplayRecorder({ header, limits });
const recorded = createDigestTrace({ identity: 'probe-v1', every: 10, maxEntries: 1000, maxDigestLength: 16 });
host.advance(dt, tick => {                       // the existing fixed-step host asks for each tick's input
  recorded.observe(tick, () => myDigest(host.sim.state));
  const input = liveInput(tick);
  recorder.record(tick, JSON.stringify(input));  // 'recorded' | 'truncated' | 'failed'
  return input;
});
const opened = openReplay(recorder.export(recorded.read()), { ...limits, log: { maxBytes: 1 << 20, maxNodes: 1 << 16, maxDepth: 8 } },
  { build: header.build, config: header.config, step: header.step });
// opened.status: 'ready' | 'unsupported-version' | 'corrupt' | 'incompatible'; replay with opened.player.input(tick),
// observe a second trace, then compareDigests(opened.player.digests!, replayed.read()).
```

Status: integrated in v0.2.0 (PR #17). Two limits catch most first users:

- **Keep anything that must replay in fixed-step systems.** The default digest fingerprints every entity's
  `Transform`. A `phase: 'frame'` system that moves an entity (a bob or spin driven by `ctx.time`) makes every replay
  report `diverged`, usually at tick 0, even in the same browser. Move that motion to a fixed system on the tick, or
  pass a `digest(ctx)` that leaves cosmetic state out.
- **Same-browser replay is exact; a browser log replayed headlessly (Node) is not, once the simulation uses
  `Math.sin`, `Math.cos`, `Math.atan2`, `Math.exp` or `Math.pow`.** Browser and Node engines differ in the last bits of
  these functions. The character kit calls `Math.atan2` (camera-relative input, facing), so most character-kit games
  cannot replay a browser log headlessly.

Floating-point results are not guaranteed identical across devices, browsers or JavaScript engines; this kit detects
such divergence, it does not prevent it. Typical cost: one creator digest per sampled tick; the recorder is O(1) per
tick except a canonical parse of that tick's input.
