# Blender export sample

## Brief

| Field | Value |
| --- | --- |
| Goal | Demonstrate a reproducible original Blender asset in the stock model loader. |
| Pitch | A metre block rests on its base pivot and turns on input. |
| Genre | blank |
| Core loop | inspect the block → turn it → inspect the base pivot |
| Devices | desktop minimum and target; keyboard and pointer |
| Performance | Declared desktop caps: 60 fps target, first-load JS at most 1024 KiB, scene at most 3 draws, 14 triangles, 0 MiB textures and 64 MiB heap. Caps are not measured performance acceptance. |

## Success criteria

| Id | Check | How |
| --- | --- | --- |
| S1 | The exported GLB has the declared scale, pivot, material and geometry bounds. | test: `verify.test.mjs` |

## Changelog

| Date | Change | Evidence |
| --- | --- | --- |
| 2026-10-03 | Original Blender static export consumer with explicit brief and budget declaration. | See `README.md` and the scoped verification receipt. No existing game budget was raised. |
