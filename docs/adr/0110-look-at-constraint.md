# ADR 0110: bounded look-at constraint in the animation kit

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits / Animation
- **Tracking:** linked from the pull request

## Context

Characters, creatures and turrets often need a head or aim chain to face a point of
interest on top of their clip. The animation kit offers pose sampling, masked layers
and a two-bone IK solver, but no aim constraint; games otherwise hand-roll yaw/pitch
splitting, limits and smoothing, and commonly get chain composition wrong (separate
per-joint yaw-then-pitch rotations do not compose to the intended aim).

## Decision

Add `createLookAt` to the animation kit: a pure helper over a 1–8 joint chain. Each
joint has a share and yaw/pitch limits; overflow flows to later joints; per-joint
deltas are steps between cumulative aims and any residual is back-filled so the
composed chain aims exactly; a front cone of at most π/2 (yaw fading near vertical),
exponential smoothing and a speed cap in yaw/pitch space bound motion; optional parent
frames conjugate deltas into each joint's parent space. `apply` multiplies deltas onto
a base pose array. Target selection, clock and skeleton stay with the caller.

## Consequences

It composes after pose sampling, layers, pose transitions or inertialization
(pending elsewhere), and with glTF models only through pose arrays or for joints the
clip does not animate. No vergence, roll, full-body IK or idle-glance policy. Evidence
is headless tests; no visual or device acceptance.
