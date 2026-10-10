# Cellular WASM candidate evidence — 2026-10-08

The report records the base revision, dirty candidate identity, SHA-256 over
14 runtime/harness files and browser environment. Its source digest was unchanged
across the run. It is not evidence of a clean-main release.

- `npm run check`: passed; 35 tests across 7 affected suites, typecheck, changed-file
  formatting and the standard focused lints.
- `node tools/cellular-wasm/build.mjs --check` using the pinned scoped Rust
  toolchain: passed; 776-byte kernel.
- `node scripts/play/cellular-wasm-check.mjs`: passed on isolated Chromium
  141.0.7390.37. Two real workers, 40,960 exact comparisons, JavaScript fallback,
  task progress, abort/recovery, supersession, stale refusal, owner abort,
  disposal and zero terminal reservations.
- A separate agent reviewed the Rust source, build and TypeScript wrapper;
  no actionable findings. It also independently injected a shared compilation
  failure and verified retry. That review shares the implementation's sources
  and environment; it is not independent physical-device corroboration.

Initial browser startup attempts failed before page load because the local
`/tmp` quota was exhausted. The passing run selected available home scratch via
`TMPDIR`; isolation and launch behavior were unchanged. An initial focused check
failed because generated capabilities were stale; regenerating them resolved it.

Full hosted CI is pending. Physical phones/tablets, sustained thermal performance,
application timing and production delivery remain unverified. This test does
not establish an end-to-end performance improvement over JavaScript.

Prediction: the optional worker preserves exact grid output while bounded
work/checkpoints and owner cancellation prevent stale or partial publication.
The browser and unit oracles are the existing JavaScript generator, fixed ABI
bounds, and WorkerHost observable outcomes. Any parity, ownership or retirement
failure blocks this candidate. Creators can revert to the unchanged JavaScript
job without changing recipes or saved seeds.
