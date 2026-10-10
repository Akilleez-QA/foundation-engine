# ADR 0160: turning-platform carry in the locomotion kit

- **Status:** Proposed
- **Date:** 2026-10-10
- **Area:** Locomotion kit
- **Tracking:** linked from the pull request

## Context

Creators who build rotating floors, turntables, swinging bridges or spinning decks need
actors to ride them. The moving-platform registry (MV-02, `createPlatforms`) already owns
platform poses, per-tick displacement, mean velocity, cuts and restarts. `jumpSystem`
already owns the rider: the carrier it rides, the pose it last moved with, carry that
slides against walls and solids, and velocity inherited on leaving. Both treated
footprints as axis-aligned, and neither knew about turning.

Creator requirement: a rider on a platform that turns about the vertical axis is carried
by both its translation and its turn. Its facing turns with it unless a camera-relative
game opts out. Support uses the turned footprint, and leaving keeps the tangential
velocity.

## Decision

Extend the two existing owners; add no new one.

- **Inputs.** `PlatformPose` gains an optional `yaw` (radians, the `Transform.ry`
  sense). A path returns it on every sample or on none. The pivot is the platform's
  top-centre pose. Without yaw, every result keeps its existing shape and value.
- **Outputs.** The registry adds `dyaw` to `delta`/`velocity` and `yaw` to `pose` for
  turning platforms. It adds `carry(id, x, z)`: the displacement and mean velocity of a
  point rigidly attached to the platform over the last tick. The point is turned about the
  previous pivot by the tick's yaw change, then moved with the pivot. `cos − 1` is formed
  as `−2·sin²(dyaw/2)` for precision. Footprint tests use the oriented rectangle.
  `platformSystem`'s `bind` writes `ry`.
- **Rider.** `jumpSystem` moves a carried actor by the `carry` of its current position.
  It records the platform yaw it last moved with, for the same continuity check as
  position: a cut, a restart or any unexplained turn detaches the actor with no velocity.
  It adds the yaw change to `Transform.ry` when `carryFacing` is true (the default),
  but only on ticks whose carry walls and solids let through in full. A blocked actor
  slides without spinning in place.
  Leaving with `add-velocity` keeps the carried point's mean velocity (pivot plus ω × r as
  a chord), the convention MV-02 already uses for translation.
- **Exact per-tick delta, not a stored local position.** Each tick's carry is computed
  from two path samples and the actor's current world position. A stored platform-local
  position would also avoid drift, but it would fight any other owner that moves the actor
  across the platform (a character controller moving it). Re-reading the world
  position composes with them. Rounding is per tick and does not compound in the tests
  (below 1e-9 m after 10,000 ticks).
- **Bounds.** `maxTurnRate` is in (0, 1000] rad/s, default 2π. A tick turn above it
  throws before any platform moves. Yaw is wrapped to the shortest turn, so wrapped paths
  cross ±π correctly. `advance(dt)` refuses `maxTurnRate · dt ≥ π` while a turning
  platform exists, because a half turn per tick is ambiguous. `maxSpeed` is checked at
  every footprint corner (pivot motion plus the corner's chord), which bounds the carry of
  every point on the platform and keeps the existing slide sub-step limit meaningful.
  `|yaw|` is at most 1e6. `wrapYaw` accepts finite |a| ≤ 1e9 and returns [−π, π).
- **Overload, cancellation and recovery** are unchanged. A refused `advance` moves
  nothing. A throwing adapter tick is rolled back, now including the stored carrier yaw
  and the facing. `cut`, `restart`, `remove` and `resetJump` behave as before.

## Consequences

Turning platforms need no new system or registry. Unturned platforms behave
identically: every MV-02 test runs unchanged. Pitch and roll are not modelled. The actor
keeps no spin in the air, and facing is not wrapped. A path that breaks its declared turn
rate by more than a half turn per tick can alias, because samples alone cannot detect
that. Evidence is headless only: unit tests at 30, 60 and 120 Hz and a 10,000-tick drift
run. There is no browser, template or device acceptance.

A carried actor with a non-finite x or z now makes the tick throw and roll back, where the
non-finite position used to pass through. `bind` overwrites `ry` on turning platforms.

An independent review of the first candidate (`ec1adde2`) found no critical or high
issues. It found:
- facing turned while walls blocked the carry;
- a NaN facing forced a write every tick;
- a double getter read;
- an unhelpful turn-rate error;
- `wrapYaw` had no domain;
- documentation inaccuracies.

All were fixed with regression tests or documented.

A re-review of `10c506bd` found the first wall fix compared summed sub-step positions with
a tolerance. Unobstructed carries with many sub-steps far from the origin then read as
blocked. The slide now reports real deflection per sub-step, with a regression test. A
blocked tick's facing lag is permanent.
