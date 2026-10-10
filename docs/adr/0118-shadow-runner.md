# ADR 0118: differential shadow runner with snapshot anchors

- **Status:** Proposed
- **Date:** 2026-10-10
- **Area:** Optional kits / Replay and determinism
- **Tracking:** linked from the pull request

## Context

Creator requirement: when a creator replaces a deterministic step with another implementation (an optimised version of
a reference, a rewrite, a port to deterministic maths), they need to know whether the two produce the same state for
the same inputs and, if not, the first step and the state paths where they part, without replaying a long recording
from the start each time.

Existing seams and owners:

- the replay kit records tick inputs (`createReplayRecorder`, `openReplay` and its tick-addressed player), digests state
  (`hashText`, the network kit's canonical JSON capture), compares digest traces (`compareDigests`) and explains the
  first difference between two detail texts (`explainDivergence`);
- the rollback kit defines the `save`/`load`/`step` port contract and its sync test resimulates one implementation from
  saved states to find non-determinism;
- `checkPredictionAgreement` compares prediction against authority over the network kit's owners.

None runs two implementations side by side. `compareDigests` compares traces recorded separately and finds only the
first sampled difference; the sync test compares one implementation with itself; `explainDivergence` names one path in
the world-selection shape.

## Decision

Add `shadow.ts` to the replay kit rather than a new kit, because it is a verification helper over the replay kit's
inputs, digests and explanations:

- `createShadowRunner({a, b, inputs, limits, from, signal})` steps both sides with the same frozen inputs, saves both,
  digests each compared view (default: the saved text) through canonical JSON and `hashText`, and stops at the first
  `state`, `threw`, `unreadable` or `anchor-mismatch` divergence. It is a step-by-step driver (`step`, `run(slice)`,
  `cancel`, an optional `AbortSignal`) with no clock.
- Sides are the rollback kit's port contract (`Pick<RollbackPorts, 'save' | 'load' | 'step'>`) plus an optional `view`
  that leaves scratch fields out of the comparison. No second snapshot contract is introduced.
- Anchors are both sides' saved states at agreeing boundaries (the first boundary and every `anchorEvery`), held in a
  ring of `maxAnchors` that evicts the oldest. A runner started `from` an anchor loads it into both sides and verifies
  each side's digest against it before stepping; `verifyAnchors` (default off) does the same for every anchor as it is
  taken. The check sees only what `save`/`view` return, so it finds an incomplete `load`, not state kept outside
  `save` (the rollback sync test looks for that). `nearestAnchor` picks the newest retained anchor at or before a step.
- Cancellation from inside a side during a step takes effect after that step's comparison and never hides its
  divergence.
- `replayInputs(player)` adapts an opened replay log as the input source.
- `explain.ts` gains `listDifferences`, a bounded list of differing JSON paths that shares the first-difference search
  with `explainDivergence` (refactored into one collector; its results are unchanged).

Bounds and defaults: `maxSteps` 100,000 (`over-budget` with progress beyond it), `anchorEvery` 256, `maxAnchors` 16,
`maxDiffPaths` 16, `maxInputBytes` 4096, `maxInputsPerStep` 8, state texts 1 MiB / 2^16 nodes / depth 32 (at most
16 MiB), previews 160 characters (at most 4096), `verifyAnchors` false. Invalid configuration throws `RangeError`; an input source that breaks its contract
ends the run as `failed`.

## Consequences

Creators can compare two implementations headlessly and replay a divergence from an anchor. Comparison covers only
what `save`/`view` return, in one JavaScript engine; it does not detect cross-device floating-point differences. The
per-step verdict is exact; anchor checks use the 64-bit digest, which is not collision-resistant against forgery.
Without a `view`, `save` must return JSON, narrower than the rollback ports. Anchors live in memory only; there is no anchor file
format, no dev-surface (`engine.replay`) integration and no world-specific path naming in `listDifferences`. Side
callbacks are not sandboxed. Evidence is headless node tests; no browser or device acceptance, and independent review
and hosted CI remain required.

## Review

An independent review of the first candidate (`c755328b`) found: inputs validated and then re-read (a getter or
Proxy could pass a different value to the sides); documentation that claimed anchor checks detect state outside
`save`; a side cancelling during a diverging step produced status `diverged` with reason `cancelled`; the anchor ring
copied on every agreeing step; anchor fields and side functions read more than once (a throwing `view` getter
escaped `step()`); whole-string encoding before byte checks; a both-sides anchor mismatch reporting one digest;
per-step equality by 64-bit digest; `listDifferences` swallowing invalid limits; and an untested "every bound" claim
plus unclear `unreadable` wording. All were fixed in the following commit with regression tests (inputs read once,
`verifyAnchors`, the cancellation rule, read-once fields and functions, both digests, exact canonical comparison,
`RangeError` for invalid diff options, node and depth bounds) and the documentation corrected.
