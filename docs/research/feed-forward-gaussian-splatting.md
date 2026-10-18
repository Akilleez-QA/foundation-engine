# Feed-forward 3D Gaussian splatting

Research pass: 2026-10-18. Status: survey and proposal only; nothing adopted, no code copied. Licences were read
from the repositories and model cards on that date. Re-check them before any use.

## What changes with "feed-forward"

Classic 3D Gaussian splatting (3DGS) optimises a scene for minutes per capture from posed photos (SfM poses
first). Feed-forward methods train a network once, then predict Gaussians for a new capture in one pass, in
sub-second to seconds. Many no longer need poses or intrinsics. The trade: less detail than per-scene optimisation,
and failures under heavy occlusion, missing coverage or extreme sparsity.

## Families (representative, not exhaustive)

| Family | Input → output | Examples (code licence) | Notes |
|---|---|---|---|
| Posed sparse-view, pixel-aligned | 2–4 posed images → one Gaussian per pixel | pixelSplat, MVSplat (MIT), GS-LRM (no official code; MIT reimplementations), Long-LRM (Apache code, research-licensed weights) | GS-LRM reported 0.23 s on one A100 for 2–4 views |
| Pose-free | unposed images → Gaussians + cameras | NoPoSplat (MIT), AnySplat (MIT; 1 to hundreds of views, VGGT-supervised, voxelised to scale), FLARE, SelfSplat | AnySplat matches pose-aware baselines on sparse and dense views (its claim) |
| Geometry foundation models | images → depth, cameras, point maps; some emit Gaussians | VGGT (code commercial-friendly; only the `VGGT-1B-Commercial` checkpoint allows commercial use, gated), Depth Anything 3 (Apache code; giant/large checkpoints CC BY-NC, check smaller ones), MapAnything (Apache code; an Apache-licensed checkpoint variant) | the backbone most 2025–26 splatters build on |
| Object generators | 1 image or text → object Gaussians or mesh | LGM (MIT, 2024), TRELLIS / TRELLIS.2 (MIT code and model; nvdiffrast/nvdiffrec dependencies have their own licences) | asset creation rather than capture |
| 2026 directions | — | token-decoupled Gaussian counts (TokenGS), predictive densification (F4Splat), compact or adaptive distributions (CompactSplat, ATSplat), streaming and on-the-fly (StreamSplat, OF³GS), recurrent refinement (ReSplat), dense-view scaling (AVSplat), anti-aliasing (AA-Splat), feed-forward compression (GenSplatCodec), 4D driving scenes | most are papers first; code and licences vary |

A maintained index: [Awesome-Feed-Forward-3D](https://github.com/ziplab/Awesome-Feed-Forward-3D) (MIT). Survey:
*Advances in Feed-Forward 3D Reconstruction and View Synthesis* ([arXiv 2507.14501](https://arxiv.org/abs/2507.14501)).

## Browser runtime side (what a game would ship)

| Piece | Licence | Role |
|---|---|---|
| [Spark](https://github.com/sparkjsdev/spark) | MIT | three.js-native splat renderer, actively maintained |
| [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) | MIT | earlier three.js splat viewer |
| [SPZ](https://github.com/nianticlabs/spz) | MIT | compressed splat file format |
| [splat-transform](https://github.com/playcanvas/splat-transform) | MIT | offline conversion, filtering and compression of splat files |

## Fit with Foundation

Existing owners: `@kits/three` (custom render overrides, own passes), model and texture residency accounting,
per-scene draw and triangle budgets, the streaming queue, and the asset converter toolchain with provenance
receipts.

Candidates, not authorised:

1. **Offline capture tool:** photos or a short video go through a pose-free feed-forward model (run outside the
   browser on a creator GPU) and become a splat file. A converter step compresses it (SPZ or similar) and writes a
   provenance receipt naming the model and checkpoint licence. Non-commercial checkpoints must be refused or
   flagged by the receipt lint.
2. **Optional splat rendering kit:** composes a maintained three.js splat renderer with the scene. It needs
   explicit budgets (splat count, sort cost per frame, GPU memory), level of detail or culling, depth composition
   with meshes, residency accounting through the existing owners, and a fallback when the device cannot meet the
   budget.
3. **Ties to other studies:** captured characters could be rigged with skelebones (see
   [secondary motion matching](secondary-motion-matching.md)). Object generators could seed props that are then
   converted to meshes for physics and collision.

## Acceptance a prototype would need

- One captured environment and one prop rendered in a template scene beside meshes, with correct depth.
- Frame time, sort time and memory on the reference desktop and the minimum supported device.
- A converter receipt that passes provenance lint.
- A visual comparison against a per-scene-optimised 3DGS of the same capture.

Physical-device performance and licence status of any specific checkpoint remain unverified until checked.
