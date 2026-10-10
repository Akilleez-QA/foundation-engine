# Optional input assist

`@kits/input-assist` holds two helpers that work on **action values**, never devices:

- **Aim assist** (`createAimAssist`): target selection in a cone, magnetism (pull) and
  friction (slowdown) over one frame's raw aim delta.
- **Flick detection** (`createFlickDetector`): fast excursions of a 2D value (a stick
  pair of axis actions or a pointer position) with direction, magnitude and time.

Both are pure or small bounded state. They own no system, clock, device reader, timer
or registration, and a game can omit the kit. Scripted input playback lives next to
the recorder in [`@kits/input-history`](../input-history/README.md#scripted-playback).
The ADR is [0119](../../../docs/adr/0119-input-assist.md).

## Creator requirement and seam

The creator wants analog aim to feel forgiving on sticks and touch: aim settles on a
target when the user aims near it, and slows over it so small corrections are easy.
The creator also wants a quick stick flick read as a gesture (a dodge direction, a
menu page, a target switch), not as held movement. The seam is the action layer. A
system reads `ctx.input.axis(...)`, `ctx.input.pointer` and `ctx.time` as usual, turns
them into an aim delta or a sample, and calls these helpers. The result goes wherever
the game keeps its aim: the camera kit's orbit `yaw`/`pitch`, a turret component, the
character kit's facing. The helpers never write the view, the world or the input.

## Aim assist

```ts
import { createAimAssist } from '@kits/input-assist';

const assist = createAimAssist({
  coneHalfAngle: 0.25, range: 40,            // radians, world units
  magnetism: 0.5, pullRate: 0.6,             // strength, rad/s at full strength and full input
  friction: 0.4, frictionMargin: 0.05,       // strength, angular margin around each target
  stickiness: 0.3,                           // favour last frame's target
});
defineSystem({ id: 'my-game-aim', run(ctx, dt) {
  const r = assist.evaluate({
    origin: eye, yaw: aim.yaw, pitch: aim.pitch,
    delta: { yaw: ctx.input.axis('look-x') * turn * dt, pitch: ctx.input.axis('look-y') * turn * dt },
    dt, candidates, previous: aim.target,
  });
  aim.yaw += r.delta.yaw; aim.pitch += r.delta.pitch; aim.target = r.target;
} });
```

These are example values, not recommended tuning.

**Angles** follow the camera kit: yaw about +Y, yaw 0 along +Z, pitch up. `aimDirection`
and `aimAngles` convert to and from 3D vectors. `planar: true` ignores height and
pitch, for top-down or twin-stick aim; the raw pitch delta passes through unchanged.

| Part | Behaviour |
|---|---|
| Selection | A candidate qualifies when its centre is within `range` and its bounding sphere reaches into the cone (angle to the sphere's edge ≤ `coneHalfAngle`). A candidate centred exactly on the origin has no direction and is ignored; with the origin inside a sphere the edge angle is 0. The order is highest `priority` first, then lowest score, then smallest `id` (code units). Score = `(angleWeight·edge/cone + distanceWeight·dist/range) / weight`. `previous`'s score is multiplied by `1 − stickiness`. |
| Friction | Uses the smallest edge angle over every candidate in range, inside the cone or not. Scale = `1 − friction·(1 − frictionFloor)·(1 − edge/frictionMargin)`, clamped to the margin. Over a target (edge 0) the raw delta is scaled by `1 − friction·(1 − frictionFloor)`. Beyond the margin it is untouched. `frictionFloor > 0`, so aim can always leave. |
| Magnetism | The aim after the scaled raw delta moves toward the selected target's centre. It moves along the yaw/pitch offset by at most `magnetism·pullRate·activity·dt` and never past the target **in yaw/pitch space**: each component moves toward the target's and stops at it (fraction ≤ 1 of the offset). `activity = max(idlePull, min(1, inputSpeed / fullInputSpeed))`, where `inputSpeed` is the raw angular speed. With no aim input and `idlePull` 0, aim never moves. |
| Identity | With `friction` 0 and either `magnetism` 0 or no selected target, `delta` is exactly the raw delta (same numbers, no arithmetic). |

The result is frozen: `delta`, `target`, `friction` (the scale), `pull` and `activity`.
The helper is stateless; the caller carries `previous`. `math: 'deterministic'` uses
`dmath` so a log replays across JavaScript engines.

**Bounds and overload:**
- `maxCandidates` is 1–256 (default 32). A longer list throws `RangeError`; nothing is
  answered from part of the list. Pre-filter with the spatial kit or volume queries.
- `coneHalfAngle` is in (0, π/2] and `range` in (0, 10⁶].
- `pullRate` is in (0, 4π] rad/s.
- `dt` is clamped to 0.25 s, so a hitch cannot snap aim across the screen.
- Candidate ids are 1–64 characters and unique. `weight` is in (0, 100], `priority` an
  integer in [−1000, 1000], and `radius` ≥ 0.
- Any non-finite value throws `RangeError`, and so does a `pitch` outside [−π/2, π/2]
  (planar mode ignores pitch). The output delta is not clamped; the caller clamps its
  resulting pitch.
- Frame and candidate fields are each read once into locals, and the candidate list is
  walked by index over its captured length, so a getter, proxy or custom iterator
  cannot pass validation and then change the answer.
- Work is O(candidates). The only allocations are a `Set` for duplicate ids and the result.

**Limits:**
- Pull works in yaw/pitch space and is weighted by `cos(pitch)`. Near straight up or
  down it is less uniform, and at high pitch a straight yaw/pitch step can briefly
  increase the true angle to the target before closing it (it is not a great-circle
  step). "Never overshoots" is guaranteed per yaw and pitch component.
- There is no line-of-sight test (the caller filters candidates), no target-velocity
  tracking ("rotational" assist that follows a moving target), no input-direction
  gating (pulling only when aiming toward a target) and no per-device tuning. The
  caller can pass different options per input kind; that choice is a creator decision.
- Today's engine axis actions read −1, 0 or 1 from digital bindings. Analog stick
  magnitude reaches these helpers only through a creator-provided source or pointer
  movement.

## Flick detection

```ts
import { createFlickDetector, FLICK_DIRECTIONS_8 } from '@kits/input-assist';

const flicks = createFlickDetector({ threshold: 0.85, maxDuration: 0.12 });
defineSystem({ id: 'my-game-flick', run(ctx) {
  const r = flicks.sample(ctx.time.t, ctx.input.axis('stick-x'), ctx.input.axis('stick-y'));
  if (r.status === 'flick') dodge(FLICK_DIRECTIONS_8[r.flick.dir8]);
} });
```

A flick has three parts:
1. The value leaves `centreRadius`.
2. It reaches `threshold` within `maxDuration` of the last centre sample.
3. With `confirm: 'release'` (the default), it returns inside `releaseRadius` within
   `maxHold` of the crossing. `confirm: 'cross'` reports at the crossing instead: lower
   latency, but a push-and-hold also reports.

A slow drag, a held push and every reported flick disarm the detector. It re-arms only
inside `rearmRadius` (hysteresis), so noise near the centre cannot re-trigger and one
excursion reports at most once.

A flick reports:
- `angle` of the peak sample (0 = +x, counter-clockwise, +y up; flip y for a y-down source);
- `dir4` and `dir8` indices into `FLICK_DIRECTIONS_4` and `FLICK_DIRECTIONS_8`;
- the peak `magnitude`, `speed`, and the `start`, `crossed` and report times `t`.

`angle` is in (−π, π]: a peak at y = −0 to the left reads π, and −0 reads 0; `dir4` and
`dir8` are never −0. `speed` is `Infinity` when the centre sample and the crossing
share a timestamp; clamp it before use.

| Option | Default | Range |
|---|---|---|
| `centreRadius` | 0.3 | (0, threshold) |
| `threshold` | 0.85 | (centreRadius, 1.5] |
| `maxDuration` | 0.12 s | (0, 5] |
| `releaseRadius` | centreRadius | (0, threshold) |
| `maxHold` | 0.25 s | (0, 5] |
| `rearmRadius` | 0.8 × centreRadius | [0, centreRadius] |
| `historySize` | 8 | 1–256 recent flicks |

**Samples and overload:** samples are processed online in O(1); only the recent flicks
are kept. A sample earlier than the last one is refused as `stale`, and a non-finite
one or one with |x| or |y| > 2 as `invalid`. A refused sample changes nothing. Sparse
samples count conservatively: the clock starts at the last sample seen inside the
centre. A digital axis jumps straight to the edge, so its quick tap reads as a flick.

## Cancellation and recovery

The aim assist holds no state. The flick detector is a plain value owned by its scene
visit. Call `reset()` on scene entry, resume or control transfer, so an excursion in
progress is not finished by the next owner's input. Nothing here listens, schedules
or survives its owner.

## Evidence (this candidate)

Checked (headless, `src/kits/input-assist/*.test.ts`, 18 tests):
- option and frame refusals;
- an exact identity at zero strengths over 500 seeded frames in three configurations;
- selection by cone and range to the bounding sphere, priority, weight, stickiness and
  an order-independent tie by id;
- no pull without input, and pull with `idlePull`;
- no overshoot over 500 seeded frames; convergence onto the target;
- friction over, part-way and beyond the margin, and out of range;
- frame-rate independence: the same pull within 0.002 rad over one second at 30, 60
  and 120 Hz, and landing on the target at every rate;
- planar mode, the direction round trip and deterministic arithmetic;
- flicks in all 8 directions with 8-way and 4-way quantisation;
- non-flicks: a slow drag, a held push, under-threshold, sparse samples;
- cross mode; re-arm hysteresis; stale and invalid refusals; bounded history; the same
  classification at 30, 60 and 120 Hz;
- two `testScene` consumers reading axis actions in a fixed system;
- review regressions (below).

An independent review of the first candidate (`92665854`) found these issues, each now fixed with a regression
test:
- frame fields read twice, so a getter could change between check and use;
- the candidate bound could be bypassed through a custom iterator;
- no pitch range check;
- a candidate centred on the origin applied friction;
- −0 direction indices, and an angle of −π for a peak at y = −0.

It also found the yaw/pitch pull caveat (now documented above) and a header that said range was measured to the
sphere (it is centre distance; now corrected).

Not established:
- tuning or feel on any device, physical sticks, touch or mice;
- browser or device runs and a template consumer;
- hosted CI, and a re-review of the fixes.
