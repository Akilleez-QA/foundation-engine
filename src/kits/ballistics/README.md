# Ballistic trajectories

`@kits/ballistics` solves and evaluates drag-free arcs under constant gravity along -y. It is a set of pure
functions. It has no clock, entity, physics world or scheduler, and registering the kit installs nothing. The
creator chooses units, gravity and what an arc means: a throw, a jump onto a ledge, a launch pad, an aim
preview, or an AI reachability test.

```ts
import { solveByLaunchSpeed, solveByApexHeight, positionAt, samplePoints, solveLead } from '@kits/ballistics';

const shot = solveByLaunchSpeed(hand, target, 18, 9.81, 'high');      // lob over a wall
if (shot.status === 'solved') {
  const preview = samplePoints(shot.trajectory, 24, scratch);         // 24 points for an aim line
  // each fixed tick: projectile.position = positionAt(shot.trajectory, age)
}
const pad = solveByApexHeight(padTop, landing, 2.5, 9.81);            // a launch pad that clears 2.5 m
const lead = solveLead(muzzle, enemyPos, enemyVel, 30, 9.81);         // hit a moving target
```

## Inputs and outputs

| Solve | Fixed by the caller | Notes |
|---|---|---|
| `solveByDuration(from, to, duration, g)` | Flight time | Solvable unless the launch velocity leaves the 1e9 domain |
| `solveByHorizontalSpeed(from, to, speed, g)` | Ground speed | `unreachable` with no horizontal distance |
| `solveByVerticalSpeed(from, to, vy, g, branch)` | Launch vertical speed | `descending` (default) or `ascending` crossing of the target height; `unreachable` above the apex or before launch |
| `solveByApexHeight(from, to, height, g)` | Peak height above the higher endpoint | Closed form (rise plus fall time); comes down onto the target |
| `solveByLaunchSpeed(from, to, speed, g, arc)` | Total launch speed | `low` (flat) or `high` (lob); `unreachable` out of range. Straight above or below: `low` is direct, `high` goes up and falls back |
| `solveLead(from, target, targetVelocity, speed, g, {arc, samples, tolerance})` | Launch speed, constant target velocity | Brackets the flight time on `samples` (8–4096, default 256) log-spaced times, then bisects to `tolerance` seconds. Earliest root for `low`, latest for `high`. Two roots closer than one sample interval, or a tangent root, can be missed and reported `unreachable` |

Every solve returns either `{status: 'solved', trajectory}` with a frozen `{origin, velocity, gravity, duration}`,
or `{status: 'unreachable', reason}`. There is no hidden fallback duration. A solved trajectory always has a duration and velocity within the 1e9 domain, so the evaluators accept it. Height crossings use a cancellation-free root form. Evaluation helpers:

- `positionAt(t)` and `velocityAt(t)`: closed form.
- `apex()`: the time and position of the top of the parabola.
- `timeAtHeight(y, crossing)`: when the arc crosses a height, or null.
- `samplePoints(count, out?)`: `count` evenly spaced points including both ends, written into a reusable
  `Float64Array` when given.

## Owner, bounds and failure

- The caller owns every trajectory value. Store it with the projectile and evaluate it from the fixed-step age.
  This keeps the arc identical on every machine regardless of frame rate. It does not integrate per frame.
- Inputs must be finite with magnitude at most 1e9. Durations, speeds and gravity must be positive. A bad input
  throws `RangeError` before any work.
- `samplePoints` takes 2–4096 points and allocates nothing when given `out`. `solveLead` evaluates at most `samples` + 200 bisection steps.
- Every call is O(1), except `samplePoints` (O(count)) and `solveLead` (O(samples)).
- Evaluators read each trajectory field once. `positionAt` and `velocityAt` return new mutable arrays; solve results and `apex` are frozen.
- Nothing is retained, scheduled or cancelled.

## Limits

- No drag, wind, spin, bounce or collision along the arc. To find the first hit on the way, sweep the sampled
  segments with the creator's collision query, for example `@kits/combat` `sweep` or a volume query.
- Gravity is constant and along -y only.
- Positions are floating point. Bit-identical results across different JavaScript engines are not claimed;
  use the deterministic math helpers for lockstep.

## Evidence

`ballistics.test.ts` covers:

- every solve landing exactly on its target;
- the constraint of each mode;
- apex, time at height and sample correctness;
- the maximum-range 45° boundary;
- vertical shots;
- unreachable cases;
- lead solutions against moving targets (randomized, both arcs, including targets approaching the shooter);
- domain-safe results;
- cancellation-free crossings;
- regressions from the independent review;
- input validation.

These are unit tests only. No template uses the kit yet.
