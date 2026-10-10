# Animation events and attachments

Optional `animation()` kit. Provides explicit presentation contracts without taking over simulation movement or installing a frame system.

## Clip markers

`defineMarkerClip({ id, duration, markers: [{ id, at }] })` validates positive finite duration, unique marker identities and timestamps in `[0, duration)`, then snapshots and freezes the definition. `createMarkerTrack(clip, { action, loop, maxEvents })` creates an independently owned action instance. Use a unique `action` ID for each actor/action invocation; event keys include that identity, the loop cycle and the marker ID.

`advance(absoluteElapsedSeconds)` emits crossings in `(previous, next]`, sorted by time and marker identity. A marker at zero fires at loop boundaries, not automatically on construction. Register consumers before advancing. Repeated time emits nothing. Non-looping tracks clamp at clip end. `seek(time)` explicitly changes time without generating intervening markers, for teleport, replay scrubbing or discontinuity. Rewinding requires `seek`; replay after seek intentionally reuses the corresponding occurrence keys so consumers can decide whether to suppress previously observed presentation. `cancel()` permanently suppresses future events.

`maxEvents` bounds one advance (64 default). A huge time jump exceeding the budget throws before changing the cursor; the caller can split advancement or explicitly seek when presentation catch-up is unwanted. No events are silently discarded. Marker delivery is independent of locomotion/pose priority. Never use footstep or contact markers as the sole authority for inventory transfer, crafting completion or rewards.

## Socket attachments

`createSocketRig([{ id: 'high', sockets: { hand: matrix } }, ...], maxAttachments)` validates identical named sockets across all retained LODs and snapshots finite affine column-major matrices. `attach(childId, socketId, localMatrix?)` establishes one owner record per child; duplicate attachment or capacity overflow is rejected. `sample(childId, lodId, { id: coordinateFrameId, matrix: parentMatrix })` computes parent × socket × local and returns the stable child and coordinate-frame identities with a frozen matrix. No decomposition loses rotation/scale information.

`detach(childId)` returns the ownership record. The caller explicitly restores independent world simulation and decides disposal ownership. `clear()` returns all removed records. This helper does not reparent a renderer object, infer world/vehicle/interior frame equivalence, move entities, own their lifetime or perform skeletal skinning. The caller applies sampled matrices through its scene adapter and handles culling extents.

## Evidence and costs

The kit separates pose priority from event priority, guards listener initialization against races, and validates named attachments across skeleton LODs with explicit update ownership. Each contract is implemented and tested independently.

No renderer objects, draws, triangles or timers. Marker advance is O(marker count + emitted events log emitted events), bounded emissions; attachment sampling uses constant-size matrix operations. Stored attachment count is bounded; asset clip/LOD definition size is caller-controlled. Skeletal playback and skinning belong to the model adapter; collision belongs to the locomotion adapter. Bounded pose blending, authored root-motion sampling and analytic IK are described below.

`createPoseSampler` adds bounded immutable local-joint clip evaluation (128 tracks, 4,096 total keys), binary-search key selection, clamped/looped time, linear translation and shortest-arc quaternion interpolation. It returns joint poses for the application's rig adapter and never overwrites simulation movement. `gaitPhase` derives a normalized phase from actual travelled distance so blocked movement does not continue advancing steps. The sampler evaluates clips; it does not import glTF, perform skinning or move entities.

## Bounded authored motion and pose layers

`createRootMotion` samples explicit planar translation/unwrapped-yaw keys, composes
loop cycles as rigid transforms, and returns local deltas. `seek` resets its
cursor without movement. This is separate from glTF playback and does not infer
root tracks from imported clips. The locomotion kit applies deltas through the
existing character collision resolver under a single control owner.

`blendPoseLayers` applies up to eight ordered masks over at most 128 local joints,
using translation interpolation and quaternion slerp. Layers do not own markers
or movement. `solveTwoBone` supplies rotations for two +Y rest-axis links with
bounded lengths, a pole target, deterministic collinearity fallback and reach
clamping. It is a small analytic solver, not a full-body IK/foot-placement graph.

The diagnostic model consumes both through author `Model.pose` overrides after
its real glTF clip. Removing an override restores the underlying clip/bind pose.
Per-transform priority blending keeps masks separate from locomotion authority;
the IK solver is independently implemented mathematics.

## Look-at constraint

`createLookAt({ joints, ignoreBeyond?, smoothing?, maxSpeed? })` aims a chain of 1–8
joints (root-most first, for example spine, neck, head) at a direction given in the
chain's root frame (+Z forward, +Y up). Each joint has a `share` of the turn it tries
to take first and its own yaw/pitch limits within ±π/2; remaining turn flows to the
next joint, so a head reaches farther once the neck is at its limit. An optional
`parentFrame` quaternion gives the joint's parent rest orientation relative to the
root when it is not aligned. Per-joint deltas are steps between cumulative aims, so
the composed chain points exactly at the clamped aim.

`update(dt, direction | null)` returns frozen state `{yaw, pitch, engaged, joints}`.
Targets outside a front cone (`ignoreBeyond`, default 2 rad), null or zero-length
targets relax the chain to rest. Motion is an exponential approach (`smoothing`,
default 0.15 s; 0 snaps) capped by `maxSpeed` (default 6 rad/s); `reset()` jumps to
rest. `apply(base, state)` multiplies each joint's delta onto a base pose array
(`delta × base`) and refuses a base that lacks a chain joint.

Composition: run it after whatever produces the base pose, such as `createPoseSampler`,
`blendPoseLayers` or a pose transition, and before writing the pose. For a glTF
`Model`, write `state.joints[i].rotation × restRotation` into `Model.pose` only for
joints the playing clip does not animate (pose overrides replace the clip value for
that node); otherwise sample the pose array yourself. The caller owns target
selection (which target, when to switch or stop), the clock and the skeleton.
Validation throws `RangeError` before any state changes. Cost: O(joints) per update
with small per-call allocations; no renderer work. Not provided: eye vergence, roll,
full-body IK, aim offsets for non-forward axes (rotate the target into the joint
frame first), or automatic idle glances.
