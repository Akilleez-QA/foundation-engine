# ADR 0034: One WebGL2 render path

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Render

## Context

Two render back ends double the shader and effect work and split every performance measurement.

## Decision

- The renderer pool creates only `WebGLRenderer` (lint: `webgl-renderer`, `three-webgpu`).
- Effects are GLSL shader modules with declared uniforms and hooks, so a later port replaces one module at a time.
- A superseding ADR may revisit this only with named, measurable criteria (platform share, feature need).

## Consequences

- One set of budgets and one quality guard.
