# ADR 0029: A Graphics screen of registered knobs; the reference preset is the design bar and the gated tier

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Render
- **Related:** [0017 Quality presets are the single performance governor](0017-quality-presets.md), [0030 Budgets gate structure in software GL at every integration; time and pixels on the reference GPU](0030-budget-gating-two-harnesses.md)

## Context

A single quality switch cannot express port choices, and designing for the weakest device caps the game.

## Decision

- Presets are `reference | high | medium | low` (`core/tiers.ts`).
- `reference` is the design bar and the only gated tier. The others are ports, built later.
- Device-dependent numbers are knobs with a value per preset, a measured cost and an apply mode. The quality profile is derived from resolved knobs only.
- Knobs declare content floors.
- Detection runs on a first run only and records its reasons.
- The governor is off by default and moves only resolution.
- Graphics settings are a device-scope section, and are never exported.
- Benches pin `?quality=reference`.

## Consequences

- `platform/render/quality*.ts`, `platform/ui/graphics-screen.ts`.
