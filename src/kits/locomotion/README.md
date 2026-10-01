# Authored motion through character collision

`applyRootMotion(ctx, actor, delta, { owns })` accepts a planar delta from the
animation kit's explicit authored root track. It transforms local displacement
into the actor's current heading, resolves it through the existing character
walls/solids, and only then commits the actor transform. Yaw can change without
translation. The authority callback is checked before evaluation and publication.
A rejected authority change leaves the actor untouched.

Distance is subdivided into steps no larger than half the body radius; the
default limit is 128 steps, with a hard configurable maximum of 1,024. Oversized
requests reject before mutation. Optional ground sampling can stop movement at a
missing surface. Resolved displacement is returned for gait/feedback decisions.
The caller must disable other movement controllers while this owner is active.
There is no frame loop, renderer, network authority, or collision world duplication.

The mechanics diagnostic model uses an animation control owner, a two-second
motion track and an invisible blocker. Existing tests cover the actual collision
adapter, authority refusal, missing ground, budget rejection and turn-in-place.
Root motion is authored data; arbitrary glTF locomotion extraction is not provided.

Locomotion authority is selected separately from skeletal appearance. Rotation
is applied even when translation is zero, and pure turning is tested on its own.
