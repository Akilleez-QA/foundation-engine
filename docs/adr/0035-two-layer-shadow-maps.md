# ADR 0035: Two-layer shadow maps: static casters cached, moving casters redrawn

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Render
- **Related:** [0037 Static shadow depth is a versioned cache, never a full-pass copy](0037-shadow-cache-validity.md)

## Context

Redrawing every caster every frame costs the most in scenes where almost nothing moves.

## Decision

- Shadow maps are drawn by a scheduler (`platform/render/shadows.ts`). Static casters are cached, and moving casters are composed on top.
- The cache follows ADR 0037's validity rules.

## Consequences

- A still window shows zero shadow redraws (STD-REN-13).
