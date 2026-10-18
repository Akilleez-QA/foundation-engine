# Secondary motion from skeleton motion: skelebones and partwise motion matching

Research pass: 2026-10-18. Status: study and proposal only; nothing adopted, no code copied.

Source studied: *GaussiAnimate: Reconstruct and Rig Animatable Categories with Level of Dynamics*
(Wang, Lyu, Cai, Dou, Lin, Chen, Xiu; SIGGRAPH Asia 2026; [arXiv 2604.08547](https://arxiv.org/abs/2604.08547);
[project page](https://cookmaker.cn/gaussianimate/); [code](https://github.com/Net-Maker/GaussiAnimate), core
packages MIT, inspected at commit `77e3568`). The repository's curve-skeleton tool is GPL-3.0 (CGAL) and one
research backend has unclear redistribution rights; neither is a candidate for reuse.

## Problem it addresses

Skinned characters with loose garments (long coats, skirts, capes) or soft parts deform rigidly with the body
bones: hems follow the legs, cloth pokes through, nothing swings. Runtime cloth simulation is expensive and hard to
make deterministic. The study offers a middle path: capture non-rigid motion once, compress it into a small set of
rigid "outer" bones, and drive those bones from the ordinary skeleton at runtime by retrieval.

## The method

Input is any temporally registered point sequence (tracked mesh vertices, simulated cloth, or the means of a 4D
Gaussian reconstruction). Output is a "skelebone":

| Layer | Representation | Role |
|---|---|---|
| Outer bones | Smooth skinning decomposition with rigid bones (SSDR): B rigid transforms per frame and N×B weights, B ≤ 50 by recursive motion clustering | reproduce observed non-rigid motion compactly |
| Inner skeleton | Curve skeleton of the canonical shape; joints where projected skinning-weight gradients exceed 0.3; tree from the joint nearest the centre of mass; per-frame IK | interpretable, editable control |
| Binding | Partwise motion matching (PartMM) | derive outer-bone motion for a new inner pose |

PartMM, the part relevant to an engine runtime:

- **Database:** sliding windows of 7 frames over the source motion. Keys are inner local rotations; values are outer
  bone transforms.
- **Parts:** the skeleton is split into 5 overlapping parts. Outer bones are mapped to parts by influence centroid.
- **Retrieval:** per part and query window, take the 7 nearest windows by mean squared SO(3) geodesic angle.
  Ties break by start index, and the blend weights are a softmax with temperature 0.1.
- **Blend:** align the retrieved transforms rigidly to the query part, blend them in bone-centre space, then refine
  over a 5-level temporal pyramid (blend factor 0.7).
- **Fallback:** gate each part between the retrieval result and plain skinning on validation error.

Reported: 13.5 ms per frame online (Python). Cloth RMSE fell from 33.7 to 17.4 mm on a T-shirt benchmark and from
52.2 to 36.7 mm on a dress; unseen-pose PSNR rose 4–8 dB over skinning baselines on human capture datasets. Limits:
kinematics only (no collision or thin-shell mechanics, so frozen wrinkles and penetration remain possible),
quality bounded by database coverage, ambiguous joints under skirts, holes in splat renders at novel poses.

## Fit with Foundation

Existing owners: the animation kit (pose sampler, pose layers, inertialized transitions, look-at), glTF models
with baked clips, crowd level-of-detail tiers, and the physics adapter kit (rigid bodies only, no cloth).

Candidate, not yet authorised:

1. **Offline tool:** turn a simulated or captured garment sequence into extra "secondary bones" baked into a
   model's clips (SSDR over the vertex sequence; Dem Bones is MIT-licensed). Known clips then replay the captured
   motion with no runtime cost beyond a few more joints.
2. **Optional runtime helper:** retrieval for poses that were never captured (speed blends, layered gestures,
   transitions). Inputs are per-clip windows of skeleton local quaternions plus secondary-bone transforms; the query
   is the current pose window. The output is secondary-bone transforms. It needs a bounded database, a
   deterministic tie-break, per-part fallback to skinning, a cost cap per character, and use only on near
   level-of-detail tiers.
3. **Later:** rigging captured Gaussian-splat actors or rig-less props and creatures from a moving point sequence.

## Acceptance a prototype would need

- One long-coat character over a locomotion clip and an idle clip. Compare hem swing and body penetration against plain
  skinning in a lineup view.
- Retrieval cost per character per frame on the reference desktop.
- Determinism across replay.
- Graceful fallback outside database coverage.

Physical-device performance would remain unverified until measured.
