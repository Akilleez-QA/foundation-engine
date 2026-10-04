# Runtime pose chains: design note

Status: research and recommendation only. Nothing here is built.

**Question.** Should the engine also interpolate key poses at runtime, straight from data (`poses.json`
plus `animations.json`), with no Blender step?

**Recommendation: no, not now.** Keep baked GLB clips as the single playback path. Revisit when a
creator requirement needs one of the triggers listed at the end.

## What exists today

The [pose-to-pose pipeline](../recipes/animate-pose-to-pose.md) bakes key poses into one GLB clip per
definition entry, and the stock `Model` plays it through three.js's `AnimationMixer`. The animation kit
already has most of the pieces a runtime path would use:

- `definePoseClip` and `createPoseSampler` (in `@kits/animation`): immutable joint tracks, at most 128
  tracks and 4,096 keys per clip, binary-search key lookup, linear translation and shortest-arc
  quaternion slerp, clamped or looping time.
- `blendPoseLayers`: up to eight masked layers.
- `Model.pose`: per-entity position and rotation overrides applied after the clip.
- `createRootMotion` and `createMarkerTrack`: root motion and events, which the pipeline's manifest
  already feeds.

A runtime pose chain would compile the definition into a `PoseClip`: the key poses become keys at
segment boundaries, easing becomes extra keys sampled along each easing curve, mirroring and
`repeatMirrored` expand ahead of time, and loops get the closing key. It would sample that clip every
frame and write the result through `Model.pose`.

## What it would cost

| Area | Cost |
| --- | --- |
| **Engine changes** | `Model.pose` has no scale, so the impact exaggeration in the definition (`scale` keys) would need a new field. The definition's poses are relative to the rest pose, while `Model.pose` sets absolute local transforms, so a loader step must multiply by each joint's rest transform from the GLB. Easing needs either the sampler extended with per-key curves or pre-sampled keys. |
| **Per-frame CPU** | Measured on this machine (Node 22): one `createPoseSampler.sample` of 24 tracks with 9 keys each takes about 4.6 µs, allocating new arrays every call. Applying the result through `Model.pose` was **not measured**. Today it replaces a component array, triggers change detection and compares a pose signature, which is fine for a few actors and unknown for crowds. Mixer playback avoids all of this. |
| **Download size** | The one clear gain. In the robot example, animation accessors are 78 KB of a 185 KB GLB, and its key poses are 4 KB of JSON. The creature: 52 KB of 137 KB, against 6.5 KB. |
| **Determinism and replay** | Poses are presentation, so replay is unaffected while gameplay never reads bone positions. If a game reads sockets for gameplay (hit volumes, attachment authority), the sampler's three.js slerp is not bit-identical across JavaScript engines. It would need the deterministic `dmath` mode that `createRootMotion` already offers. |
| **Budgets** | No change to draws, triangles or textures. It adds CPU and garbage-collection work per animated actor per frame, which no budget row measures today. It would need a per-scene limit on active chains, like the existing bounded owners. |
| **Verification** | Two paths that must agree: easing, mirroring, loop closure and timing would be implemented twice (the generator in Python, the runtime in TypeScript). `definition.mjs` already mirrors the generator's expansion and could be shared. The validator's foot-slide and seam checks would need runtime equivalents. |
| **Creator workflow** | Live tuning and procedural variation (stride scaled per character, noise per instance) without a Blender round trip. Loss: what plays is no longer the file that was verified and approved, unless the runtime path gets the same review gate. |

## How it would fit, if built

- An optional `definePoseChain` in `@kits/animation`, compiled to a `PoseClip` and cached per asset, not
  a new core system.
- One bounded playback owner per scene that writes joint transforms directly, in place of
  per-frame `Model.pose` array churn. It would have a configured limit on active chains, an explicit
  overload policy (refuse new chains past the limit) and cancellation on scene exit.
- Root motion and events from the same compiled chain, through the existing `createRootMotion` and
  `createMarkerTrack`.
- The same review gate: an approved chain freezes its sample hash, as baked clips do now.

## Why not now

No current creator requirement needs it. The baked path already covers the decided design: the
person poses, the agent bakes, verifies and validates, and the engine plays a checked file. A runtime
path would add a second animation owner, needs engine changes (`Model.pose` scale, a cheap write
path), and splits verification. Its benefits (smaller downloads, live variation) are real but
optional. The [creator contract](../CREATOR-CONTRACT.md) treats an absent feature as a choice, not
a defect.

## Revisit when

- animation bytes dominate a game's download or memory budget (many characters, many clips);
- a game needs per-instance variation of the same motion (crowds with varied gait or stride);
- a creator wants to tune key poses live in the running game;
- or several actors need pose blending that the mixer's one-clip-per-entity `Model` cannot express.

Then measure the `Model.pose` write path with many actors first, and build the owner described above
only if that measurement shows the gap.
