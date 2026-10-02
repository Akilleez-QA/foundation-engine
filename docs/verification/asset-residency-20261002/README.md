# Asset residency (RES-01) evidence

Runtime revision: `024c24888e1f8f3616fad8de749c28f3075deeb0` (branch
`feat/res01-asset-residency`). Candidate at that revision; later integrated in v0.2.0 (PR #22).

## Native texture fixture

`scripts/play/asset-residency-check.mjs` served
`scripts/play/fixtures/asset-residency-entry.mjs` to an isolated, muted Chromium
152 using SwiftShader (ANGLE/Vulkan software) WebGL2. The retained
[report](native-texture-residency.json) passed:

| Step | Observation |
|---|---|
| Live draw | 3 library textures, `renderer.info.memory.textures` = 3, red center pixel |
| Estimate | 256²: 349,525 vs 349,524 exact mip-chain bytes; 512²: 1,398,101 vs 1,398,100; 300×200: 320,000 vs 319,840 (+0.05%) |
| Scene exit | 0 textures on the GPU after an empty frame; pinned texture retained CPU-side (`pinnedMiB` 0.333); 2 unpinned disposed; 0 evictions counted |
| Re-acquire | `loads` stayed 3 (no fetch or decode); 1 upload counted by the next draw; red pixel |
| Actual loss/restore | `WEBGL_lose_context` loss and restore in separate tasks; redraw red with 1 texture; `loads` still 3 |
| Teardown | the pinned texture retired through the library dispose path; resident 0 |

This is a software renderer. It checks ownership, counts and the estimate formula
for RGBA8 uploads, not driver allocation, compressed formats, physical-device
memory, thermal behavior or timing.

## Composed runtime probe (not retained as a file)

With a temporary, uncommitted `residency` row in the mechanics template
(texture ceiling 1,024 bytes, model ceiling 64 MiB, `lab-beacon` pinned), the
composed dev build in isolated Chromium reported through `engine.probe`:
six live sky textures (1,365 estimated bytes), one `pressure` transition, the
module log warning and the creator hook call, no evictions, the model loaded
once, and no page errors. The template change was reverted; no template ships a
residency policy, so template gates and snapshots exercise only the default.
