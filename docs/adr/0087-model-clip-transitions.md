# ADR 0087: model clip transitions through the existing model owner

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Author API / Animation presentation
- **Tracking:** issue to be linked in the pull request

## Context

`Model` switches skeletal clips with a hard cut: when `clip`, `revision` or `loop`
changes, the scene model owner stops every action and starts the new one from its
first frame. Skinned models therefore pop between one clip's pose and the next. The
animation kit offers pose-array blending and IK, and a pending pose inertializer
works on pose arrays, but none of them is connected to glTF playback, so a creator
using `Model` had no way to avoid the pop short of re-implementing playback.

A common console-era technique hides the switch with a short presentation-only
blend: snapshot the pose on screen, start the new clip immediately and weight the
snapshot down to zero over a creator-chosen number of frames. Interrupting a blend
snapshots the already-blended pose, so repeated switches stay continuous.

## Decision

Add an optional `Model.transition` field (seconds, `[0, 2]`, default `0`). The
existing `createSceneModels` owner remains the only playback owner; no new system,
scheduler or mixer is introduced.

- On a playback-key change with `transition > 0` (and a previous key, so the first
  clip after loading never blends in from the bind pose), the owner captures the
  displayed position, rotation and scale of every node any of the model's clips
  animates, switches the mixer as before, records the new evaluation as the base,
  and for each later sync writes `mix(snapshot, evaluated, smoothstep(t))`.
- Before each evaluation the owner restores the base, so nodes the new clip does
  not drive return to their original values and nothing is blended twice.
- Pose overrides still apply last; paused playback holds the blend; clip speed
  does not scale it.
- Bounds: 512 animated nodes per model (the node list is built once, on first
  use); a larger rig reports once and keeps cutting. Two snapshot buffers and one
  base buffer are reused per model instance; no per-frame allocation.
- Cancellation: a new key change discards the running blend after capturing the
  displayed pose. Retirement and scene disposal drop the state with the slot.
- Recovery: an unknown clip still reports and cuts, as before.

## Consequences

Presentation only: animation markers, root motion, the actor `Transform`, game
timing and saves never observe a transition. Morph-target, material and other
non-transform tracks still change at once. The blend is a pose crossfade, so joint
velocity can change at its ends (the pending inertializer addresses that for pose
arrays). The outgoing clip is frozen, not kept playing. Evidence is headless node
tests against the real three.js mixer; no browser, visual-quality or device
acceptance is claimed.
