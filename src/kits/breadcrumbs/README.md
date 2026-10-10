# Breadcrumb trails

`@kits/breadcrumbs` lets followers retrace a leader's exact path. Typical uses are a companion that walks
where the player walked, a party line, an escort, a train of carriages, or a partner that copies a delayed
input history. The leader records crumbs into a bounded ring. Followers read either a crumb lag ("where the
leader was N crumbs ago") or a distance along the recorded path. The kit is pure: it has no clock, entity,
renderer or scheduler, and registering it installs nothing.

```ts
import { createBreadcrumbTrail, nextFollowerLag } from '@kits/breadcrumbs';

const trail = createBreadcrumbTrail({ capacity: 64, record: { mode: 'moved', minDistance: 0.25 } });
// fixed-step system, after the leader moves:
const recorded = trail.record({ x: tr.x, y: tr.y, z: tr.z, heading: tr.ry, flags: swimming ? 1 : 0 }) === 'recorded';
// a spaced train: each carriage 2 units further back along the same path
for (const [i, car] of cars.entries()) place(car, trail.along(2 * (i + 1)));
// a classic party follower: a crumb lag that waits, keeps pace and catches up when the leader stops
lag = nextFollowerLag(lag, { recorded, movingLag: 15, idleLag: 9, catchUpEvery: 4, tick });
place(companion, trail.behind(lag));
// after a teleport or respawn: never slide across the gap
trail.cut();
```

## Inputs and outputs

- **Crumbs:** `{x, y, z, heading, flags?}`. `flags` is a creator bit set (unsigned 32-bit) that a follower
  replays, for example swimming, hanging or layer.
- **Record policies:**
  - `every-tick` records every call, so a lag of N is exactly N ticks behind. Use it for input-delay
    partners.
  - `moved` records only after the leader has moved `minDistance` from the last crumb, so followers wait
    while the leader stands still.
- **Lookups:**
  - `behind(lag)` returns the exact recorded crumb, clamped to the oldest crumb of the current segment.
  - `along(distance)` interpolates along the recorded polyline. Heading blends along the shorter arc;
    flags come from the older crumb of the pair. At distance 0 it is the newest crumb, so a leader that turns
    in place is followed exactly. It is clamped the same way. Followers retrace corners
    and never take shortcuts.
- **Segments:** `cut()` starts a new segment, and lookups never reach back across a cut. `clear()` drops
  everything.
- **Persistence and rollback:** `snapshot()` returns plain detached data, and
  `createBreadcrumbTrail(options, snapshot)` restores an identical trail. The snapshot is validated
  (version, capacity, finite crumbs, segment range).
- **`nextFollowerLag`:** a pure lag controller.
  - While crumbs are recorded, a follower closer than `movingLag` waits on its crumb, one at
    `movingLag` steps forward with the leader, and one farther back closes in one crumb per tick.
  - While nothing is recorded, it closes in one crumb every `catchUpEvery` ticks down to `idleLag`.

## Companion recovery

`createCompanionRecovery(trail, options)` decides, once per fixed step for each follower, whether a companion that
retraces the trail has fallen behind or is stranded.

```ts
const recovery = createCompanionRecovery(trail, { catchUpDistance: 2, teleportDistance: 12, landing: [3, 5, 8], stuckSeconds: 3 });
const want = trail.along(spacing);
const d = recovery.update(buddy, {
  position: [tr.x, tr.y, tr.z],
  desired: want && [want.x, want.y, want.z],
  now: ctx.time.t,
  canLand: p => free(p) && !onScreen(p),   // land somewhere safe and out of view
});
if (d.kind === 'teleport') place(buddy, d.to);
else move(buddy, toward(want), speed * (d.kind === 'follow' ? 1 : d.boost));
```

The `kind` of the result:

- **`follow`:** within `catchUpDistance` of the desired point.
- **`catch-up`:** farther away. `boost` rises linearly from 1 at `catchUpDistance` to `maxBoost` (default 2) at
  `teleportDistance`.
- **`teleport`:** the follower is stranded, and a landing point passed `canLand`. The landing point is the first trail
  point at the given `landing` distances behind the newest crumb. A follower is stranded in either case:
  - it is beyond `teleportDistance` (reason `distance`);
  - it has stayed beyond `catchUpDistance` for `stuckSeconds` without progress (reason `stuck`), for example walking
    into a wall or falling into a pit. Progress means either advancing `minProgress` toward where it was heading
    when the window began, or the gap closing by `minProgress` from its largest value in the window. A follower that
    is chasing, including one a faster leader is pulling away from, is therefore never stuck; only
    `teleportDistance` recovers it. Choose `minProgress` (default 0.25, must be positive) larger than any jitter a
    blocked follower makes against a wall.

  Landing points never cross a segment cut. Repeated points (the trail clamps to its oldest crumb) are skipped, as
  are points no closer to the desired point than the follower, or still beyond `teleportDistance` from it, so a
  recovery never lands in place or loops. `canLand` must return `true` exactly; anything else, or a throw, refuses.
  A `cooldown` (default 2 s) separates the teleports of one follower; `remove(id)` forgets it, cooldown included.
  A landing distance of 0 is the newest crumb, on the leader.
- **`stranded`:** stranded, but no landing point is allowed yet (or the cooldown is running). It keeps the boost.
  Try again later.

Bounds and failure:

- At most `maxFollowers` followers (default 16) and 32 landing distances.
- Time must not go backwards for a follower.
- Malformed input throws `RangeError`.
- `remove(id)` forgets a follower.

The kit does not choose visibility or placement. `canLand` is where the creator checks collision, camera view and
area.

## Owner, bounds and failure

- The caller owns the trail and calls `record` from its fixed-step system, so replays are identical.
- Capacity is 2–65536 crumbs, and older crumbs are overwritten.
- `record` and `behind` are O(1). `along` is O(crumbs in the segment).
- Coordinates must be finite with magnitude at most 1e9. A malformed crumb, lag or distance throws
  `RangeError` and changes nothing.
- `revision` counts accepted changes.
- Nothing is scheduled, so there is nothing to cancel.

## Limits

- Followers are placed, not simulated. Collision against geometry the leader passed through (or that
  moved since) is the creator's choice.
- Interpolation is linear between crumbs. With `moved`, a leader can be up to `minDistance` ahead of
  its newest crumb.
- One trail per leader. Several followers share it at different lags or distances.

## Evidence

`recovery.test.ts` covers follow, catch-up boost, distance and stuck teleports, the landing order with `canLand`, cooldown, refusals (including a throwing `canLand` and an empty trail), validation, and a `testScene` companion that falls into a pit and is put back on the trail behind the leader.

`breadcrumbs.test.ts` covers:

- tick-exact lag lookups and ring bounds;
- moved-policy skipping;
- exact corner retracing, distance clamping and flags;
- cuts after a teleport;
- snapshot round-trip and validation, including sparse and hostile arrays and the revision ceiling;
- stationary crumbs and an over-long lag (independent review regressions);
- input validation;
- the wait, keep-pace and catch-up controller;
- a `testScene` composition where a follower stays on the leader's recorded polyline around a corner.

These are headless tests only. No template uses the kit yet.
