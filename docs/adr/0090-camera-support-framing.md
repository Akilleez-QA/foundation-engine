# ADR 0090: support-anchored vertical camera framing

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Camera kit
- **Tracking:** issue to be linked in the pull request

## Context

Every camera mode derives its position and look target from the target's height.
When the target jumps, the view moves up and down with every arc. A long-standing
third-person technique frames the support under the target instead: the vertical
offset between support and target is scaled (often slightly less for the look
target than for the position) and clamped, so short hops leave the view still and
large drops are still followed.

## Decision

Add optional `support`, `supportWeight`, `supportTargetWeight` and `supportLimit`
to `cameraSystem`. The existing system remains the only camera owner. The creator
supplies the support query; the kit validates weights in `[0, 1]` and the limit in
`(0, 1e6]` at construction and refuses non-finite heights per frame before any
publication. The mode's pose is re-evaluated at the anchored heights
(`support * w + y * (1 - w)` inside the limit, so weight 1 is exact and a still
support never perturbs the pose). A fixed camera keeps its position and applies support
to a tracked look target only. Teleport detection keeps comparing the unanchored
target, so support changes ease rather than snap. `null` support means no offset.

## Consequences

Without `support` nothing changes. The kit does not infer ground, water or
platforms, add a separate vertical lag, look-ahead, frustum fitting or occlusion
steering; those remain open camera candidates. Evidence is headless scene tests;
no browser, visual or device acceptance is claimed.
