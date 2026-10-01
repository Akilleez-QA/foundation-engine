# ADR 0017: Quality presets are the single performance governor

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Render
- **Related:** [0029 A Graphics screen of registered knobs; the reference preset is the design bar and the gated tier](0029-graphics-screen-reference-preset.md)

## Context

Per-feature device checks scattered through the code give inconsistent results and cannot be tuned by the player.

## Decision

- Players tune graphics in a generated Graphics screen: presets `reference`, `high`, `medium`, `low` plus per-knob controls; choices are saved per device.
- Automatic detection only picks the first preset; the player's choice always wins.
- Only the quality system reads device capability (lint: `calm-read` and the owned-capability table).

## Consequences

- Refined by ADR 0029 (knobs as rows, reference preset as design bar).
