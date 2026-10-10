- **Differential shadow runner (optional, replay kit).** `createShadowRunner` steps two implementations of one
  deterministic step (reference and optimised, old and new) in lockstep with the same recorded inputs, compares
  canonical states exactly after every step and stops at the first divergence with its step, input, a bounded list of
  differing paths (`listDifferences`) and the last agreeing state. Periodic snapshot anchors in a bounded ring let a
  divergence be replayed from the nearest anchor; a restore that does not reproduce its anchor is reported as
  `anchor-mismatch` (optionally checked as each anchor is taken), a throwing side as `threw`. Sides use the rollback kit's `save`/`load`/`step` ports; inputs can
  come from a replay log through `replayInputs`. Step budget (`over-budget`), cancellation and caller-sized slices.
  Headless tests only. See the [kit README](src/kits/replay/README.md) and [ADR 0118](docs/adr/0118-shadow-runner.md).
