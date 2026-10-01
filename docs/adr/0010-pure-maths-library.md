# ADR 0010: Pure maths imports nothing

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Domain

## Context

Numerical code that imports the kernel or the DOM cannot run in a worker or a plain test, and cannot be shared by physics and presentation.

## Decision

- `domain/math/` imports nothing (lint: `math-pure`).
- Hot paths are allocation-free.
- Integration (`ode.ts`) and vectors (`vec.ts`) are the shared primitives.

## Consequences

- The same maths runs in workers, tests and the main thread with identical results.
