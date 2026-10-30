# Pose-to-pose sample

## Brief

| Field | Value |
| --- | --- |
| Goal | Show pose-to-pose clips exported from Blender playing in the stock model loader. |
| Pitch | A robot walks by its declared stride and waves; a six-legged creature scuttles and strikes. |
| Genre | blank |
| Core loop | watch the clips loop → trigger the wave or the strike → watch them return |
| Devices | desktop minimum and target; keyboard and pointer |
| Performance | Declared desktop caps: 60 fps target, first-load JS at most 1024 KiB, scene at most 23 draws, 728 triangles, 0 MiB textures and 64 MiB heap. Caps are not measured performance acceptance. |

## Success criteria

| Id | Check | How |
| --- | --- | --- |
| S1 | Each exported GLB has every declared clip, closed loops and planted feet within tolerance. | test: `validate.test.mjs` |
| S2 | In the browser the clips play by name with their declared durations, loops have no seam pop and the strike event fires once at its time. | test: `browser.mjs` |

## Changelog

| Date | Change | Evidence |
| --- | --- | --- |
| 2026-10-03 | Pose-to-pose robot and creature in the stock loader, with root motion and clip events. | See `README.md` and the pose-to-pose verification receipt. No existing game budget was raised. |
