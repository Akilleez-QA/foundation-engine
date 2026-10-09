# Character pipeline lessons: retargeting, weights, LOD, resampling and clip QA

Lessons from building a skinned, mocap-driven character test game in a lab (see [labs](labs.md)). Each item is a
**practice**: what went wrong, why, and what fixed it. None of them is an engine feature unless the item names one
that ships on `main` (checked against [capabilities](../capabilities.md)); where the engine has no such step, the item
says so. The numbers are the lab's own measurements on its own assets, given as examples of scale, not as targets
or budgets.

What the engine ships for this pipeline today:

- `Model` plays one glTF clip per entity, with no blending between clips ([load a model](../recipes/load-a-model.md)).
- `@kits/animation` evaluates clips with shortest-arc quaternion interpolation (`createPoseSampler`), blends up to
  eight masked pose layers (`blendPoseLayers`), inertializes pose switches (`createInertializer`, #182) and solves
  two-bone IK (`solveTwoBone`); it does not import glTF or skin meshes
  ([kit README](../../src/kits/animation/README.md)).
- `npm run asset:verify` checks a GLB against its [model contract](model-contracts.md), including the optional
  `skin` limits: joints per skin, at most 1 to 4 non-zero influences per vertex, weights summing to 1.
- The [pose-to-pose pipeline](../recipes/animate-pose-to-pose.md) rigs and interpolates key poses you author and
  validates loop seams and influence limits for those clips.

The engine has no retargeting, mocap import, foot-lock, LOD generation or clip-quality tool. Those steps live in the
game's own asset pipeline (headless Blender scripts, for example), and their checks are build evidence for that game.

## Retargeting onto a different skeleton

**Align rest poses on limb chains only, parent-first.** The usual world-space delta,
`Qt = Qs(t) · Qs_rest⁻¹ · A⁻¹ · Qt_rest`, needs an alignment `A` when source and target rest poses differ (an A-pose
against a T-pose). Computing `A` independently for every bone as the shortest arc between rest bone directions
treats *bone-placement conventions* as pose differences. In the lab, two rigs disagreed by 40° at the pelvis, 30° at
the clavicles and 10° at the neck while both stood upright; "correcting" those produced a hunched torso, raised
shoulders and a crease across the belly.

- Use the shortest-arc alignment on arm, leg and finger chains, where the rest difference is a real pose
  difference, and compute it **chained**: start from the parent's accumulated alignment and add the child's
  residual, so twist is inherited down the chain rather than invented per bone.
- Use identity alignment (a pure world-space delta) on pelvis, spine, clavicles, neck and head.
- Translate the hips by `targetRest + K · (source(t) − sourceRest)`, with `K` the ratio of hip heights. Do not copy
  absolute hip positions, and keep every other joint's translation at the target's rest so proportions survive.
- Make sign continuity explicit: negate a key's quaternion when its dot product with the previous key's is negative.

**Check it with a rest-identity test.** Retarget the source's own rest pose: the torso must come out at exactly the
target rest (0° deviation) and the limbs in the source's pose. Any torso deviation means a convention difference is
being aligned. For aligned bones, the angle between source and target bone directions should be zero on every
frame; a frame-to-frame spread is a bug.

**Mocap with a calibration frame.** Some mocap conversions store a T-pose on their first frame while the file's
skeleton rest is something else (splayed legs, a tilted neck). Take the source reference from the calibration
frame, and capture it before re-orienting the source onto the target's forward axis; capturing it afterwards twisted
the lab's torso 90° against the legs. Hip height measured from a hip joint that sits above the thigh heads floats
the feet; map hip *deltas*, scaled by leg length.

Rotation transfer keeps style but not contacts: hands meant to touch a prop or the body, and feet on the floor,
need a contact pass after the retarget.

## Feet on the floor

**Plant heel, then flat, then ball.** A foot lock that pins only the ball of the foot through stance leaves the heel
3 to 7 cm under the floor at heel-strike, and one that pins only the ankle fights toe-off. Lock in phases: the
ankle from heel-strike until the ball lands, the whole sole while flat, then pivot about the ball until toe-off.
Blend each lock in and out over a few frames instead of switching it, use a knee pole target, and soften full
extension so the knee never snaps straight. When grounding a clip, put the *higher* stance foot on the floor and let
IK lift the lower one: a fully extended chain cannot reach down.

**Measure foot slide before trusting a lock.** Per foot, in root-motion space: stance frames, mean and peak
horizontal speed, total travel per stance and stance sole height. The lab's lock cut one clip's stance slide from
7 and 34 cm to 5 and 7 cm, which was still above its own 3 cm per stance target, and a shuffling clip defeated its
contact detector entirely. A single transition frame can read as a huge speed spike when the ball leaves the
contact band during the heel roll; give the detector hysteresis or split heel and ball contact.

**Gate gait clips.** Reject a gait clip that fails left/right symmetry (stride time and length, stance knee bend) or
a minimum stance-knee bend. One shared mocap walk cycle with 29 % knee asymmetry, played by most of a crowd, made the
whole crowd limp in step; it was the most visible defect in the lab. Give a crowd several gait clips, a seeded
per-person rate spread and random start phases.

`@kits/animation`'s `solveTwoBone` is the analytic two-bone solver a runtime foot or hand plant can call; it is a
single solver, not a foot-placement system, and the engine ships no contact detector or foot lock.

## Skin weights and LOD

**Re-clean weights on every LOD.** Decimating a skinned mesh after weight cleanup reintroduces tiny weights and more
than four influences per vertex, because the collapse blends the weights of merged vertices. Run the cleanup again on
each level: prune weights below a small threshold, limit to four influences, normalise to 1. Then check every level:
a model contract's `skin` limits (`influences: 4`) make `npm run asset:verify` fail a GLB whose weights drifted.

- Keep the eyes (and any other small parts the face reads by) in the reduced levels; a decimator happily drops
  them, and a face without eyes is obvious long before a 50 % triangle cut is.
- Hide body faces that are always covered by clothing. They cost triangles and skinning in every pass and poke
  through the cloth at bends (armpits, knees). Delete them per outfit, or mask the covered zones, rather than pushing
  the cloth outward.
- Build at least three levels for a crowd character and switch by projected screen height rather than metres, with
  hysteresis so a person on the boundary does not flicker between levels.

The engine does not generate LOD levels. `@kits/animation`'s socket rig validates that named sockets match across a
model's skeleton LODs; choosing and swapping levels is the game's own code.

## Resampling and loops

**Assert evenly spaced keys.** A resampler that assumes uniform key spacing silently stretches a clip whose source
keys are not uniform. Check the spacing before and after.

**Align quaternion hemispheres before filtering or resampling.** Smoothing or spline-fitting `q` and `−q` as if they
were different values produces spins. Align each key with its predecessor first, renormalise afterwards.

**A loop can end sign-flipped.** A looping track that turns a full 360° ends on `−q` of its first key (or the same
orientation after a whole turn). Joining the seam naively spins the bone backwards through the whole turn. Handle the
seam explicitly: compare orientations, not raw components, and carry the turn through the wrap.

**Close loops in pose and velocity.** Spreading the end-pose error linearly across the cycle removes the pose step at
the seam but can leave a velocity step; the lab added a smooth correction that also removes the wrap's velocity
step. Keep the duplicated last key equal to the first.

**Re-key at a higher rate when rotations are interpolated linearly.** Runtime quaternion interpolation between keys
is linear (slerp), so a 30 keys/s clip changes velocity in steps every 33 ms. Re-keying the lab's clips at 60 keys/s
through a C1 spline (wrapped tangents for loops, clamped for one-shots) cut one character's 60 Hz jerk RMS from about
1,000 to about 370, at a cost of about 40 % more file size per character.

**Take loop flags from data.** Decide whether a clip loops from a field in the clip's data, not from its name (a
`_Loop` suffix or a prefix convention); renamed or new clips otherwise loop wrongly. The engine's `Model.loop` and the
pose-to-pose definition's `playback` are both explicit fields.

**A channel a clip lacks.** When a pipeline drops channels that sit at rest (to save size), a runtime that fills a
missing channel from whatever value it first bound can hold another layer's pose on that bone. Reset bones to rest
before a new clip binds, or keep the channels.

## Clip QA before shipping

Run the same measurements on every baked clip, and on a recorded play session, before a clip ships:

| Check | What it catches |
|---|---|
| Pops | angular-acceleration spikes per bone, against a per-bone baseline percentile |
| Loop seam | pose step **and** velocity step at the wrap |
| Foot slide | horizontal travel of a planted foot, and soles under the floor |
| Self-penetration | hands into the body, limbs into each other (simple capsules are enough) |
| Holds | frozen or stepped frames, a pose that stops dead instead of settling |
| Jerk | end-joint jerk RMS and a high percentile, before and after any filter |

Commit the thresholds and a summary of each run (counts per clip, before and after) with the change, not just a
local contact sheet; a picture nobody else can regenerate is not evidence. A filter that removes pops should be
checked for new ones, and the pose-to-pose validator already rejects bad seams and NaN keys for clips it builds.

## Tooling hygiene

- **A headless tool can exit 0 after a failure.** A Blender script that raised an error still left Blender exiting
  with status 0, so the bake looked done and the previous GLB stayed in place. Make the script exit non-zero on any
  exception, and check the output's timestamp or hash.
- **Baked actions can vanish on save.** In recent Blender versions an action with no users is discarded when the file
  is saved; give baked actions a fake user and assign the action slot explicitly.
- **No personal paths in tool defaults.** A default that points at one person's home folder works for them and fails
  silently for everyone else. Take paths from arguments or the repository.
- **Record the provenance and licence of every clip source** alongside the asset ([asset provenance](asset-provenance.md)).
  Mocap datasets differ: some allow use inside a commercial game but not resale as a pack, some are non-commercial
  only, some need attribution.

See also [crowd and night rendering lessons](crowd-and-night-rendering-lessons.md) for the runtime side.
