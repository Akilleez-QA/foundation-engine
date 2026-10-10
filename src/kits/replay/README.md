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

Choosing the replayed state (SIM-02): `replayDigest({components, exclude, resources, count, id})` builds a named digest
over selected components without excluded (cosmetic) entities; a scene declares one as `defineScene({replay: {digest}})`.
The digest id joins the trace identity. With a detail window the canonical state text is kept per tick, and
`explainDivergence` names the first differing entity, component and field. See the guide and
[the recipe](../../../docs/recipes/replay-with-your-own-digest.md).

Floating-point results are not guaranteed identical across devices, browsers or JavaScript engines; this kit detects
such divergence, it does not prevent it. To replay a browser log in Node, keep `Math` transcendental functions out of fixed
systems: use `dmath` from `@engine` and the kits' `math: 'deterministic'` option ([deterministic maths](../../../docs/guides/deterministic-math.md)). Typical cost: one creator digest per sampled tick; the recorder is O(1) per
tick except a canonical parse of that tick's input.

World and selected-state digests reject non-finite numeric JSON values instead of
coercing them to null. A rejected sample fails the trace and cannot compare equal.
Excluded state remains outside the digest; creator state projections and ordinary
JSON serialization semantics are unchanged. Finite values retain canonical v1
encoding, including negative zero normalizing to zero. Existing JSON byte, node
and depth limits still apply during capture; creator callbacks and serialization
are not a sandbox or a CPU deadline.

## Differential shadow runner and snapshot anchors (`shadow.ts`)

Checks that two implementations of the same deterministic step (a reference and an optimised one, old and new code)
produce the same state for the same inputs, and names the first step where they do not.

```ts
import { createShadowRunner, replayInputs, nearestAnchor } from '@kits/replay';

const runner = createShadowRunner({
  a: reference,                 // { save, load, step, view? }: the rollback kit's port contract
  b: candidate,
  inputs: replayInputs(player), // or any (step) => readonly string[] | undefined
  limits: { maxSteps: 50_000, anchorEvery: 256, maxAnchors: 16, maxDiffPaths: 16 },
});
const report = runner.run();    // or runner.step() / runner.run(slice) to drive it in caller-sized pieces
// report.status: 'agree' | 'diverged' | 'over-budget' | 'cancelled' | 'failed' ('running' between slices)
// report.divergence: { kind: 'state', step, inputs, differences: [{ path: 'x[1]', kind, a, b }], lastAgreed, anchor }
// Replay just the divergence from the nearest retained anchor instead of from step 0:
createShadowRunner({ a: freshReference, b: freshCandidate, inputs, from: report.divergence.anchor }).run();
```

- **Inputs.** Two sides, each `save(): string`, `load(text)` and `step(inputs, step)` (the same ports as
  `createRollbackSyncTest`), plus an optional `view(): string` that returns the JSON state to compare when the full
  saved state contains scratch fields that may legitimately differ. Inputs are a function of the step index;
  `replayInputs(player)` adapts an opened replay log (one canonical JSON input per step). An optional `from` anchor and
  an optional `AbortSignal`.
- **Outputs.** A frozen report: `status`, `from`, `next`, `steps` (steps both sides completed and agreed),
  `anchorsTaken`, `anchorsEvicted`, `divergence`, `reason`; and `anchors()`, the retained anchors oldest first. An anchor
  is `{step, digest, a, b}`: both sides' saved state before step `step`, at a boundary where they agreed.
- **Comparison.** After every step both sides are saved, each `view` (default: the saved text) is parsed with the
  network kit's canonical JSON capture (sorted keys, normalised numbers) under the state bounds, and digested with
  `hashText`. The starting boundary is compared too. On a digest difference `listDifferences` (in `explain.ts`, the same
  depth-first order as `explainDivergence`, so the first entry is its first difference) lists up to `maxDiffPaths`
  paths with bounded value previews.
- **Divergence kinds.** `state` (with `step: null` when the sides already differ at the start); `threw` (side `a`, `b`
  or `both`; phase `step`, `save`, `view` or `load`; a 200-character message); `unreadable` (a saved or compared state
  that is not a string, not JSON or over the state bounds); `anchor-mismatch` (after `load(anchor.a|b)` a side's digest
  is not the anchor's: an incomplete `load` or state outside `save`). Every kind except `anchor-mismatch` carries the
  step's inputs, `lastAgreed` (the agreeing state just before the step, itself usable as `from`) and the nearest
  retained `anchor`.
- **Owner.** The caller owns the runner, both sides and the input source. Nothing is global or scheduled; no clock is
  read. The runner never disposes the sides.
- **Bounds (defaults; ranges in `SHADOW_LIMIT_RANGES`).** `maxSteps` 100,000 per runner; `anchorEvery` 256 (an anchor
  at the first boundary and at every multiple); `maxAnchors` 16, a ring that evicts the oldest anchor first (counted in
  `anchorsEvicted`); `maxDiffPaths` 16; `maxInputBytes` 4096 UTF-8 bytes per input and `maxInputsPerStep` 8; `state`
  1 MiB, 2^16 nodes, depth 32 for each saved and compared text (at most 16 MiB); `maxValueChars` 160. Memory is at most
  `maxAnchors` × 2 saved states plus the last agreeing pair. Work per step: two `step`, two `save` (and two `view`),
  two canonical parses and two hashes; a divergence adds one bounded parse of both views.
- **Overload.** Reaching `maxSteps` while the source still has inputs ends with `over-budget`, keeping `next`,
  `steps`, the last agreeing state and the anchors; a log of exactly `maxSteps` steps is `agree`. A state over its
  bounds is an `unreadable` divergence. An input source that throws or returns an invalid input (empty, too many,
  not strings, over `maxInputBytes`) ends with `failed` and a reason; no side is stepped with it.
- **Cancellation.** `cancel()`, an aborted signal (checked before each step) or simply not calling again; `run(slice)`
  returns `running` after `slice` steps so the caller can spread work across frames or ticks. Progress and anchors stay
  readable after cancellation. A side that calls the runner re-entrantly is reported as `threw`.
- **Recovery.** A finished runner is final. Replay from `divergence.anchor` or `divergence.lastAgreed` with fresh
  sides; `nearestAnchor(anchors, step)` picks the newest retained anchor at or before a step, so a long log can be
  bisected from anchors rather than from the start.
- **Limits.** Comparison is of what `save`/`view` return: state outside them is not seen. The digest is a
  non-cryptographic 64-bit hash, so a collision could hide a difference (not a forged-input defence). Both sides run in
  one JavaScript engine, so this finds implementation differences, not cross-browser or cross-device floating-point
  differences. Anchors are retained only in memory and only as the newest `maxAnchors`; there is no anchor file format.
  Side callbacks are not sandboxed and have no CPU deadline. `listDifferences` is generic JSON paths, without the entity
  and component naming of `explainDivergence`.
- **Evidence.** Headless node tests (`shadow.test.ts`): equal implementations agree; an off-by-one at step 37 and a
  floating-point summation-order change are reported at exactly their step and path; replay from the nearest anchor and
  from the last agreeing state reproduces the same divergence; composition with a recorded and reopened replay log and
  the rollback kit's test simulation and ports; thrown steps, saves and loads; anchor mismatch; every bound; abort,
  cancel and slices; invalid configuration. No browser or device evidence. [ADR 0118](../../../docs/adr/0118-shadow-runner.md).
