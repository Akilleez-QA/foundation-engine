# ADR 0099: optional strict numeric modes

- Status: Proposed for this implementation; integration is gated by full CI.
- Date: 2026-10-09
- Area: Optional kits / Time and determinism

## Context

STD-SIM-10 and STD-SIM-17 make a simulation's arithmetic part of its definition. `dmath` (W1-2) made double-precision
transcendental functions identical across engines, which suffices for most lockstep, rollback and replay uses. It
does not cover simulations whose numbers are integers by design: a recreation of a fixed-point or single-precision
original, state that a server or tool in another language must reproduce bit for bit, wrap or saturate semantics, or
compact integer snapshots. The creator reversed an earlier rejection of such "fidelity" techniques and asked for them
as determinism and interoperability tools.

## Decision

Add `@kits/numeric`, a pure optional kit:

- `createFixed` (signed 2–32-bit words in a `number`) and `createWideFixed` (2–128 bits in a `bigint`), each with a
  creator-chosen `rounding` (`nearest` half-up, `floor`, `trunc`) and `overflow` (`throw` default, `wrap`, `saturate`).
  Exact integer arithmetic with one rounding; a `BigInt` fallback wherever a `number` intermediate could reach 2^53.
- `createFixedTrig`: binary-angle `sin`, `cos`, `atan2` from tables built lazily with `dmath` and rounded to the format.
- `createPrecision` with `f32` (exactly `Math.fround`) and `pc24` (24-bit significands, double exponent range): one
  ties-to-even rounding of the double result, capped at 25 significand bits so double rounding stays innocuous.

The kit composes with `dmath`, `@kits/rollback` and `@kits/replay`; it adds no clock, scheduler, persistence owner or
registration. Its golden vectors join the existing cross-engine browser check rather than a new CI job.

## Alternatives and consequences

- Extending `dmath` in core: rejected; fixed-point formats are a creator choice, not every game's arithmetic, so they
  belong in an optional kit. `dmath` is reused, not duplicated.
- A WebAssembly integer kernel: rejected for now; plain integer arithmetic below 2^53 is already exact and portable.
- Consequences: a changed golden file is a contract change (`npm run numeric:golden -- --write`). `pc24` matches x87
  single-precision mode only inside the double exponent range. Wide formats allocate. No physical-device or non-Chromium
  browser evidence exists yet.
