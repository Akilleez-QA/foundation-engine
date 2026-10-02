# Blank

<!-- The brief (game/build.brief.ts) is the contract; this block mirrors it. Change the brief first, then this block,
     then add a changelog row. Budgets are re-derived from the brief and only fall without a Perf-Budget trailer. -->

## Brief

| | |
|---|---|
| **Goal** | A starting point: one scene, one entity, one input, ready to grow into any game. |
| **Pitch** | A cube that turns a quarter when you press Space, tap, or press the pad's A button. |
| **Audience** | Neutral (`kids: false`); policy `default` |
| **Genre** | blank |
| **Core loop** | press the turn action → watch the cube turn a quarter → press again |
| **Devices** | targets desktop, laptop, tablet, phone; minimum **phone**; input keyboard, pointer, touch, gamepad |
| **Performance** | 60 fps; per scene at most 100 draws, 150 000 triangles, 64 MiB textures (phone tier); first-load JS ≤ 704 KiB |
| **Modes** | play |

### Success criteria

| Id | Check | How |
|---|---|---|
| S1 | pressing turn rotates the cube a quarter turn within half a second | test: `game/main.test.ts` |
| S2 | the main scene stays inside its budgets.json counts on the gate | gate |
| S3 | a still scene draws no frames while idle (render on change) | gate |

## What is in it

| File | What |
|---|---|
| `game/game.ts` | `defineGame`: id `blank`, first scene `main` |
| `game/main.ts` | the scene: a floor, a cube (`Transform`, `Shape`, `Turning`) and the `spin` system |
| `game/turn.ts` | the `turn` input: Space, pad A, or a tap |
| `game/main.test.ts` | S1, and a still-world check, with `testScene` |
| `game/budgets.json` | the measured budgets of `main` |

## Milestones

1. **Vertical slice**: the scene, the input, the tests and the budget pass the gate. *(done)*
2. Replace the cube with your game's first mechanic; keep one scene until it is fun.
3. Optional engine extension for the creator's industrial-world integration: dynamic dimensional inventory candidate transforms, with bounded admission and independent custody tests. No change to the blank scene or its device/budget contract; composed consumer and integration gates pending.
4. Compose finite reserves, accepted manufacturing plans and constructed machine process custody in the same optional stock candidate; validate interruption and expansion reference cases before a downstream scene consumer.

## Changelog

| Date | Change | Budgets |
|---|---|---|
| 2026-10-01 | Shared input adapters retire held contacts on window resize; fresh gesture required. Independent regression evidence in `docs/verification/input-resize-20261001`. No template gameplay change. | Unchanged |
| 2026-09-28 | Template created | `main` measured on software GL |
| 2026-09-30 | Add optional pure dimensional inventory candidate reducer for authorized industrial systems | Unchanged |
| 2026-09-30 | Compose bounded industrial stock candidates and multi-output work recovery | Unchanged |

## Engine delivery milestone

- 2026-09-30: Optional pure kit delivery for independent consumers. Preserve existing kit registration imports while shipping bounded data owners and declarations without Foundation runtime or Three.js. Acceptance: isolated packed-package consumer, declaration compilation, dependency-closure rejection, deterministic immutable artifact, and existing kit regressions. See [pure package contract](../../docs/guides/pure-package.md). This does not change the starter brief or certify downstream game integration.

- 2026-09-30: Add bounded ephemeral industrial candidate chains for independently scheduled work. Validate once, retain isolated private state, publish detached snapshots through the existing enclosing world transaction. Acceptance: standalone parity, failed-step atomicity, retirement/reentrancy, bounded schema-only command admission, installed package conformance and consumer timing evidence. No brief or performance budget change.

- 2026-09-30: Optional pure crafting contracts for creator-authored material selection, finite deterministic experiments and conserved repeat-manufacturing manifests. Existing dimensional stock and enclosing durable owner remain authoritative. Acceptance: exact slot resolution/overbooking, bounded transcript and output reconstruction, powered repeat output, native packed consumer; Application-specific operational calibration remains separate downstream work. No starter brief or budget changes.

- 2026-09-30: Optional bounded ordered transfer batches extend the existing industrial candidate for the creator's local logistics consumer. Retain finite custody, intermediate capacity/phase limits, atomic failure and external clock/save ownership; measure reachable downstream workload. See [batch contract](../../docs/guides/industry-transfer-batches.md). No starter brief or budget change.

## Program preparation milestone

- 2026-10-01: Validate submitted and later program links through the renderer pool,
  prepare the author runtime before activation, and retain owned failure recovery.
  Acceptance requires adversarial tests, native shader failure checks and all
  template gates. No game-content, device or budget change.

## Dependency preparation milestone

- 2026-10-01: M2 cooperative dependency preparation extends the existing closure owner with cancellable real task yields and required-closure slot reservation. Optional work uses spare concurrency. Baseline task starvation and optional-blocked critical admission reproduced before changes; CPU regressions checked, native/browser and integration gate pending. No starter brief or budget changes.
