# ADR 0102: optional ballistic trajectory solves

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits

## Context

Throws, lobbed projectiles, launch pads, jump arcs onto ledges, aim previews and AI reachability checks all need the same closed-form question answered: which launch velocity reaches this point under gravity, given a chosen constraint? Studied game implementations solve it in a few lines, one constraint at a time. Where no solution exists they often substitute a magic fallback duration, which silently produces a wrong arc. Foundation's combat kit sweeps linear motion only; nothing solves or evaluates arcs.

## Decision

Add an optional pure `@kits/ballistics`. It offers six solves, each with an explicit `unreachable` result: duration, horizontal speed, vertical speed (with a crossing branch), apex height, fixed launch speed (low or high arc) and moving-target lead (bounded root bracketing and bisection). It also offers closed-form evaluation, apex, time at height and bounded samples. Trajectories are frozen plain values that callers evaluate by fixed-step age. It has no clock, world, entity or registration.

## Consequences

The creator keeps gravity, units, collision along the arc and every effect. Drag, wind and bounce are out of scope; a creator needing them integrates numerically under their own owner. Floating-point results are not claimed bit-identical across JavaScript engines.
