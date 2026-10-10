# ADR 0095: optional region activation from observer positions

- Status: Proposed for this implementation; integration is gated by full CI.
- Date: 2026-10-09
- Discussion: issue linked from the pull request
- Area: Optional kits / simulation scale

## Context

Large worlds commonly simulate only the area near observers. The recurring shape is: wake regions near observers,
keep them while observers stay within a wider radius, let them linger briefly, then sleep; allow keep-alive
exceptions; spread costly transitions over several updates; and let a waking region catch up. Foundation's spatial
grid and interest sets decide what an observer is sent, and terrain residency decides what is resident for
presentation, but no owner decides which regions the simulation runs. Games were left to hand-roll that policy,
including its hysteresis, budget and stale-load cases.

## Decision

Add `@kits/region-activation`, a pure bounded helper. Uniform square regions over a creator rectangle; observers with
positions; activate and release radii; update-count linger; refcounted pins; per-update activation and deactivation
budgets; a hard `maxActive`; per-region epochs for stale asynchronous work; `dormantFor` for catch-up. No system,
clock, loader, persistence, ECS access or registration is installed. The creator decides what a region simulates,
loads and saves, and composes existing owners (ECS systems, chunk store, worker host, interest sets).

## Alternatives and consequences

A streaming world manager that loads, spawns and saves regions would prescribe content and persistence choices and
duplicate the chunk store and residency owners. Gating per entity instead of per region scales with entity count
rather than observers. The chosen helper keeps those choices explicit; its state is transient and rebuilt from
observers and pins after a reload. It is 2D with Euclidean distance; portal or path distance must be expressed through
observer positions and pins.

## Evidence

Eight unit tests including a 3,000-step comparison with an independent brute-force model, and two consumer tests
(ECS fixed-step gating with catch-up; chunk-store load/save with epoch refusal of a late load). Headless only.
