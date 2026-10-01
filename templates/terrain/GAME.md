# Terrain yard

## Brief

Goal: Walk over an authored surface whose rendered triangles and ground queries agree.

Pitch: A ridge, a basin and a level pad share one terrain snapshot.

Genre: terrain. Neutral audience. Devices: desktop, laptop, tablet, phone; minimum phone. Inputs: keyboard, pointer, touch, gamepad. Core loop: choose a destination → walk over the landforms → inspect the level pad.

## Success criteria

| Id | Check | How |
|---|---|---|
| S1 | the moving character remains exactly one foot offset above the sampled surface | test: `game/yard.test.ts` |
| S2 | the pad marker stands on the level pad and the pad excludes scatter | test: `game/yard.test.ts` |
| S3 | pointer picking intersects terrain triangles instead of the zero height plane | test: `game/yard.test.ts` |
| S5 | surface revision swaps render, contact and navigation epoch together | test: `game/yard.test.ts` |
| S4 | the terrain yard stays within its measured scene budgets | gate |

## Milestones

1. Fixed-resolution authored surface, render/contact agreement, accurate touch destination and measured demonstration.
2. Four seam-compatible 24×24-cell tiles, exact near detail, bounded far-mesh replacement and scene cleanup.

Controls: WASD/arrows or left stick/d-pad; hold a point on the terrain to walk there with mouse or touch. The fixed camera keeps all landforms in view. This is an engine diagnostic. No slopes are rejected and there is no gravity, jumping, cave or full rigid-body collision simulation yet.

## Changelog

| Date | Change | Budgets |
|---|---|---|
| 2026-09-30 | First terrain engine slice and playable example | 3 draws / 5,036 triangles observed; derived caps in game/budgets.json |

| 2026-09-30 | Four finite tiles, 10m/13m detail hysteresis, 0.35m conservative far tolerance; at most one replacement per frame | 6 draws / 5,036 triangles at initial full detail; existing caps unchanged |

The scripted revision hook (`R` or pad `Y`) prepares a raised surface one tile per frame, retains the old complete view, then switches all four tiles and contact in one publication. The authored pad remains level. Navigation consumers subscribe to its new epoch and cancel cached paths. This is a finite revision demonstration, not planet streaming.


### Terrain attribute and local-edit upgrade

The finite yard now shades chunk seams with canonical vertex normals, selects detail from camera-projected error, and preserves material boundaries through exact tile fallback. Sixteen seeded rock candidates share one mesh and avoid excluded pad samples. R/Y raises a bounded ridge patch: unaffected chunk payloads are reused and collision/render/navigation publish in one epoch. Unit tests cover dependency margins, deterministic scatter, material topology and camera hysteresis; existing scene budgets and S1–S5 remain unchanged. Runtime patch preparation uses the existing application worker host with row-bounded slices and the same bounded fallback; it remains a finite yard, not planetary streaming.

| Date | Change |
|---|---|
| 2026-09-30 | Extend the existing finite terrain slice with shared shading, local edit reuse, seeded scatter and camera-driven detail; retain current budgets. |
