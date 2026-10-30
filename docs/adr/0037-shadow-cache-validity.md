# ADR 0037: Static shadow depth is a versioned cache, never a full-pass copy

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Render
- **Related:** [0035 Two-layer shadow maps: static casters cached, moving casters redrawn](0035-two-layer-shadow-maps.md), [0056 Change trackers observe batches and skeletons](0056-trackers-observe.md)

## Context

A shadow cache that misses an input shows stale shadows. One that defaults to redraw never saves anything.

## Decision

- A valid cache contains only declared static casters, in the exact light projection used to sample it.
- The generation key covers the light's view and projection, map size and format, caster membership, world transforms, geometry and depth-affecting material state. Context restore invalidates it.
- Unknown or unproved inputs count as changing.
- A failed or unsupported path renders the conventional full pass that frame, at identical quality.

## Consequences

- `platform/render/shadow-cache*.ts` with mutation tests.
