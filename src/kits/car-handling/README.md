# Optional car handling

`@kits/car-handling` is a fixed-step handling controller for a wheeled car: ray-cast
suspension against a ground the creator supplies, engine, brake and steering curves,
tyre slip with a peak-then-slide grip curve, a handbrake that breaks rear grip for
drifts, downforce, air control, and a reset for a car stuck upside down. It is a
pure helper: no kit registration, physics world, clock, input service or collision
data. The creator owns the ground, the controls mapping, the car's identity and what
any result means; the vehicles kit keeps seating, the control kit keeps who drives,
the camera kit keeps the view.

```ts
import {carConfig, carHandlingSystem, createCarHandling, planeGround} from '@kits/car-handling';

const car = createCarHandling(carConfig('arcade', {engine: {topSpeed: 38}}), {math: 'deterministic'});
car.place({x: 0, y: 1, z: 0, yaw: 0});

// Pure use, inside the creator's own fixed-step system:
const result = car.step(dt, {throttle: 1, steer: 0.3}, planeGround());
const pose = car.pose(); // x, y, z, rx, ry, rz for a Transform ('XYZ' Euler)

// Or the optional adapter, which writes the named entity's Transform each fixed tick:
carHandlingSystem({
  car,
  target: 'car',
  ground: planeGround(),
  controls: ctx => ({
    throttle: ctx.input.held('accelerate') ? 1 : 0,
    brake: ctx.input.held('brake') ? 1 : 0,
    steer: ctx.input.axis('steer'),
    handbrake: ctx.input.held('handbrake') ? 1 : 0,
  }),
  when: () => fleet.hasRider(playerId), // otherwise it coasts with neutral controls
});
```

## Creator requirement and seams

A driving game needs a car that feels a chosen way, steps the same on every machine,
and can be rewound for rollback or replay. The vehicles kit deliberately covers only
seating and ownership, and the character and locomotion kits move actors on height
fields. This kit adds the motion model and reuses:

- the fixed-step lane (`core/ecs/systems.ts`) through `carHandlingSystem`, or any
  creator system that calls `step` once per tick;
- `scalarMath` from the author API: `math: 'deterministic'` uses `dmath`, the same
  bits in every conforming JavaScript engine;
- the terrain kit's `Surface.sample` through `sampledGround`, or any ray query the
  creator writes (for example a sphere sweep with the volume-query kit, when that kit
  is available, for curb-hugging wheels);
- the rollback kit's save/load/step ports through `snapshot`/`restore`
  (`consumers.test.ts` runs its sync test);
- the control kit's `owns` or the vehicles kit's `hasRider` as the adapter's `when`.

## Inputs and outputs

**Configuration.** `carConfig(preset | config, patch?)` merges a patch one level deep
(whole `wheels` and curves replace) and returns a validated, frozen `CarConfig`;
`createCarHandling` validates again. Anything outside its bounds throws `RangeError`
naming the field. Units are SI. Body coordinates: +z forward, +y up, +x to the car's
left (the engine's right-handed y-up frame, where yaw `ry` turns +z toward +x).

**Controls, per step.** `throttle`, `brake`, `handbrake` in [0, 1]; `steer`, `pitch`,
`roll` in [-1, 1]; missing fields are 0. Positive steer turns right; `pitch` (+ nose
up) and `roll` (+ right side down) act only with no wheel down; `steer` also yaws in
the air. Throttle while rolling backwards faster than `brakes.reverseSpeed` brakes;
with `brakes.brakeToReverse`, brake with no throttle below that speed drives
backwards. Out-of-range controls throw before anything changes.

**Ground port.** `ground(ox, oy, oz, dx, dy, dz, maxDistance, out)` casts a ray along a
unit direction and writes the nearest hit into `out` (`distance`, normal `nx/ny/nz`,
surface `grip` [0, 4] and extra `rolling` [0, 1]), returning true, or returns false.
The kit resets `out` to defaults (grip 1, rolling 0) before every query, so a port that
writes only some fields never inherits an earlier answer. Each wheel casts along the
body's down axis from one wheel radius plus the sub-step's travel (`|v| × h`) above its
mount; with `body.contacts`, each of the eight body-box corners casts straight down from
half the body height plus the same travel above it. Reaching back by the travel means a
fast body cannot pass a surface between two casts. A
hit with a distance outside [0, maxDistance], a non-finite or zero normal, or grip or
rolling outside their ranges throws. A surface facing away from a wheel ray is ignored.
`planeGround` (exact, optionally sloped) and `sampledGround` (a height field, see
Method) are supplied.

**Outputs.** `step` returns a frozen `{substeps, queries, grounded, airborne, landed,
flipped, reset, clamped}`. Getters `forwardSpeed`, `speed` and `grounded` read
without allocating; `read()` returns a frozen full state with per-wheel
`grounded`, `compression`, `load`, signed `slip` angle, `spin` (for wheel visuals) and
`steer`; `pose(out?)` writes a Transform-shaped pose.

## Tuning

Both presets are generic starting points, not any particular game's values.
`arcade` is forgiving and quick; `sim-lite` is the same body with plainer physics.

| Field | Bounds | arcade | sim-lite | Effect |
|---|---|---|---|---|
| `mass` | [50, 50000] kg | 1200 | 1350 | Body mass |
| `halfExtents` | each (0, 20] m | 0.9, 0.55, 2.1 | 0.9, 0.45, 2.2 | Box for inertia and body contacts; keep its bottom above the wheels' resting contact |
| `inertiaScale` | [0.1, 10] | 1 | 1.2 | Multiplies box inertia: higher turns and rolls more lazily |
| `gravity` | [0, 100] m/s² | 9.81 | 9.81 | Along world -y |
| `wheels[i].position` | each ±20 m | ±0.8, -0.1, 1.3 / -1.25 | ±0.78, -0.1, 1.35 / -1.3 | Suspension top relative to the centre of mass |
| `wheels[i].steer` | [-1, 1] | 1 front, 0 rear | same | Share of the steering angle; negative steers the other way |
| `wheels[i].drive` / `handbrake` / `front` | boolean | rear drive, rear handbrake | same | Engine force split, handbrake wheels, foot-brake axle |
| `suspension.restLength` | (0, 5] m | 0.3 | 0.25 | Travel to the bump stop |
| `suspension.radius` | (0, 3] m | 0.34 | 0.33 | Wheel radius |
| `suspension.frequency` | [0.2, 20] Hz, and 2π·f·maxSubstep ≤ 0.35 | 2.2 | 1.6 | Corner natural frequency with its mass share; sets the spring rate |
| `suspension.damping` | [0, 5], and 2·ζ·2π·f·maxSubstep ≤ 1 | 0.7 | 0.45 | Damping ratio (1 is critical) |
| `suspension.maxForce` | [1, 100] × static load | 6 | 6 | Ceiling of one corner's spring and damper force |
| `suspension.bumpStop` | [1, 1000] × spring, and 2π·f·√bumpStop·maxSubstep ≤ 1 | 10 | 12 | Stiffness beyond full travel |
| `tyre.grip` | (0, 5] | 1.5 | 1.05 | Peak lateral friction coefficient |
| `tyre.driveGrip` | (0, 5] | 1.4 | 1.0 | Peak longitudinal coefficient (drive, brake) |
| `tyre.peakSlip` | [0.01, 1] rad | 0.14 | 0.1 | Slip angle of peak lateral grip |
| `tyre.slideGrip` | [0, 1] | 0.85 | 0.7 | Grip at twice the peak slip and beyond, as a share of the peak |
| `tyre.lowSpeed` | [0.05, 10] m/s | 1 | 1 | Slip angles are softened below this speed |
| `tyre.rolling` | [0, 1] | 0.015 | 0.013 | Rolling resistance coefficient |
| `tyre.forceHeight` | [0, 1] | 0.7 | 0.3 | Tyre forces act from the patch (0) to the centre-of-mass height (1): higher means less body roll and pitch |
| `engine.force` | [0, 1e6] N | 9000 | 6500 | Peak drive force at the wheels |
| `engine.topSpeed` | (0, 200] m/s | 45 | 55 | Speed at curve x = 1 |
| `engine.reverseForce` / `reverseTopSpeed` | N / m/s | 5000 / 12 | 4000 / 10 | Reverse drive |
| `engine.curve` | 2–16 points, x [0, 2], y [0, 1] | 1 → 0.85 at 0.6 → 0 at 1 | 0.8 → 1 at 0.3 → 0.7 at 0.8 → 0 at 1 | Drive share by speed / top speed |
| `brakes.force` | [0, 1e6] N | 15000 | 11000 | Total foot brake |
| `brakes.bias` | [0, 1] | 0.6 | 0.65 | Front share of the foot brake |
| `brakes.handbrakeForce` | [0, 1e6] N | 4000 | 3000 | Total handbrake force |
| `brakes.brakeToReverse` / `reverseSpeed` | boolean / [0, 20] m/s | true / 1 | true / 0.5 | Brake near standstill drives backwards |
| `steering.maxAngle` | 1–16 points, rad [0, 1.2] by m/s | 0.6 → 0.3 at 15 → 0.12 at 45 | 0.55 → 0.2 at 20 → 0.07 at 55 | Largest wheel angle by speed |
| `steering.rate` / `returnRate` | (0, 50] rad/s | 4 / 6 | 2.5 / 3.5 | Wheel angle slew toward input / back to centre |
| `drift.handbrakeGrip` | [0, 1] | 0.3 | 0.5 | Lateral grip share of handbrake wheels at full handbrake |
| `drift.recoveryTime` | [0, 10] s | 0.6 | 1.2 | Time for that grip to return after release |
| `aero.drag` | [0, 100] N·s²/m² | 0.35 | 0.42 | Quadratic drag |
| `aero.downforce` / `maxDownforce` | N·s²/m² / N | 3 / 8000 | 1.2 / 4000 | Downforce along body -y while any wheel is down |
| `aero.angularDamping` | [0, 50] 1/s | 0.5 | 0.1 | Always-on angular damping |
| `air.pitch` / `roll` / `yaw` | [0, 100] rad/s² | 6 / 6 / 4 | 0 / 0 / 0 | Air control angular acceleration at full input |
| `air.levelling` | [0, 100] | 3 | 0 | Pull toward upright with no wheel down, in rad/s² per unit sine of tilt (none at exactly upside down) |
| `air.damping` | [0, 50] 1/s | 1 | 0 | Extra angular damping while airborne |
| `reset.auto` | boolean | true | true | Act on a flip, or only report it |
| `reset.upDot` / `maxSpeed` / `delay` / `lift` | [-1, 0.9] / m/s / s / m | 0.2 / 2 / 1.5 / 1 | 0.2 / 1 / 3 / 1 | Upside down: up · world up below `upDot` and speed below `maxSpeed` for `delay`; the reset raises by `lift` |
| `body.contacts` / `friction` | boolean / [0, 2] | true / 0.6 | true / 0.5 | Keep the body corners out of the ground |
| `limits.maxSubstep` | [1/1000, 1/15] s | 1/120 | 1/120 | Longest sub-step |
| `limits.maxSubsteps` | integer [1, 16] | 8 | 8 | A step needing more is refused |
| `limits.maxSpeed` / `maxAngularSpeed` | m/s / rad/s | 200 / 50 | 200 / 50 | Clamps, reported as `clamped` |
| `limits.extent` | (0, 1e7] m | 1e6 | 1e6 | A step leaving this box is refused |

Measured on flat ground at 60 Hz with the stock presets (headless, `car.test.ts`
assertions and a local run): arcade reaches 100 km/h in about 4.2 s and tops out near
42.8 m/s; sim-lite in about 6.8 s, near 51.6 m/s. These are properties of the presets,
not targets.

## Method

Each step of `dt` in (0, 0.25] s is split into `ceil(dt / maxSubstep)` equal sub-steps.
A sub-step: (1) slews the steering angle and handbrake grip loss; (2) casts each
wheel's suspension ray; compression is the spring length lost, the spring
(`k = m_w (2πf)²`, `m_w` = mass / wheels) and damper (`2ζ m_w 2πf`, on the mount's
velocity along the body up axis) push along body up, clamped to [0, maxForce × static
load]; (3) at each grounded wheel, splits the drive force over grounded driven wheels,
adds foot brake by axle bias, handbrake and rolling resistance, and computes a lateral
force from the slip angle `atan2(|v_side|, max(|v_long|, lowSpeed))` through a curve
rising linearly to the peak, falling to `slideGrip` at twice the peak; brake, rolling
and lateral forces can stop but never reverse the patch's motion (each grounded wheel
may remove at most its share of the body's momentum, predicted after this sub-step's
gravity, spring and aerodynamic forces, so a car at rest does not creep and a braked
car holds on a slope); an axle with no wheels hands its foot-brake share to the other;
the pair is scaled into the friction ellipse of `grip`
and `driveGrip` times load and surface grip (drag and downforce were added before the
tyres); (4)-(5)
integrates velocities semi-implicitly with world-frame box inertia, applies air
control, levelling and damping with no wheel down; (6) with `body.contacts`, removes
approach velocity at each penetrating body corner with an impulse and Coulomb friction
and pushes the body out along the deepest normal; (7) clamps speeds and integrates
position and the unit quaternion. After the sub-steps the upside-down watch runs once.

`sampledGround(sample, {march, refine, surface})` answers a vertical ray exactly from
one sample and marches any other ray in `march` (default 8, ≤ 64) equal steps,
bisecting the first crossing `refine` (default 12, ≤ 40) times: at most
`march + refine + 2` samples per query. A crossing narrower than one march step can be
missed.

## Bounds, overload and failure

- Wheels 2–8; per step at most `(wheels + 8 if body.contacts) × maxSubsteps` ground
  queries (`maxQueriesPerStep`; 96 for the presets). Constant memory per car. The
  controller allocates nothing per sub-step or query; `step` allocates its result record.
  The cost of the ground port is the creator's.
- Configuration refuses unknown fields at every level and suspension tunings too stiff
  for the sub-step (the three suspension conditions in the tuning table). Those bounds
  are necessary for stable explicit integration, not sufficient for every combination:
  zero damping keeps oscillating, and very light or very soft cars settle slowly.
- A port that calls back into the same car (`step`, `place`, `reset`, `restore`) is
  refused, and the outer step fails whole.
- A step needing more than `maxSubsteps` is refused with `RangeError`; the creator's
  fixed-step host supplies steady steps, and a long frame should not be passed whole.
- A step is a transaction (`place`, `reset` and `restore` are too). It works on a copy of the state and commits only when every
  sub-step finished, every value is finite and the position is inside `limits.extent`.
  A throwing ground query, an invalid hit, invalid controls or a refused step leave the
  car exactly as before; the adapter then writes no Transform and the runner reports
  the throw.
- `place` puts the car at rest (wheels extended); `reset(pose?)` sets it upright at rest
  at its position raised by `reset.lift` (keeping its heading), or at `pose`. There is
  nothing to cancel: a step runs to completion synchronously and owns no timers.

## Determinism, snapshot and rollback

Identical configuration, start, `dt` sequence, controls and ground answers give
identical state. With `math: 'deterministic'` the only transcendental calls (steering
and slip trigonometry, the pose's Euler angles) go through `dmath`; the rest is +, -,
×, ÷ and square root. The ground query is part of that contract: it must be
deterministic too. The default `platform` mode uses `Math.*` and can differ between
JavaScript engines.

`snapshot()` returns a frozen, JSON-safe `{kind, version: 1, fingerprint, wheels,
values}`; every write to the state turns -0 into 0, so `JSON.stringify` round-trips it
bit for bit. `restore` refuses a snapshot from another configuration (FNV-1a fingerprint
of the validated configuration), a wrong length, non-finite values, a non-unit
quaternion, a position outside `limits.extent`, and contact, grounded, compression, load,
spin, slip, steering, drift and timer fields outside their ranges, and changes nothing
when it refuses. A four-wheel snapshot is
39 numbers, about 0.7 KB as JSON text; it is not a save format with migrations.
For a saved game, store the creator's own pose and re-`place` the car.

## Limits

No gearbox, clutch, engine speed or wheel spin dynamics: drive is a force curve over
road speed and slip ratio is not modelled; wheels are rays (or whatever the ground
port casts), so a wheel can drop through a gap narrower than its radius; no
anti-roll bars, differential, aerodynamic balance or tyre temperature; body contact is
eight corners against the ground port only, not walls, props or other cars (use the
volume-query or combat kits' sweeps for the body and apply the result); no car-to-car
contact, traffic, damage or audio; render interpolation between ticks is the
creator's. Camera, seating, ownership and network authority stay with their kits.

Ray reach-back covers a fall up to `limits.maxSpeed`, but only against surfaces the
ground port reports from above; a car that does end below a one-sided surface (for
example placed there) is not recovered. A car resting on its roof or side has no wheel
down, so it counts as airborne: air control, levelling and air damping act, `airTime`
grows, and arcade levelling can right a car lying on its side. With the presets'
`brakes.brakeToReverse`, brake alone at standstill drives backwards; to hold on a slope
with the brake, turn it off or hold a little throttle. A braked car on a steep (24°)
slope still slides a few millimetres per minute. The adapter skips stepping while its
target entity is missing, so simulated time pauses with it; an `after` callback that
throws fails the tick after the step and Transform were already written.

## Evidence

`car.test.ts` (24 tests): for both presets, settling to the static spring compression
with under 1 µm of creep in a minute, straight-line acceleration under the curve's top speed, braking without
reversing then brake-to-reverse, right-turn sign and speed-widened turns, handbrake
slip and grip recovery; downforce load; a ledge with airborne, air pitch, levelling
and landing; an upside-down car resting on its body and auto-reset after the delay (and
report-only reset); the sampled height field against the exact plane; configuration
refusal and freezing; transactional refusal of bad steps and bad ground answers; the
query bound and speed clamps; identical bits across repeated runs and after a JSON
snapshot round trip in both math modes; snapshot refusal; no tunnelling from a 199 m/s
fall; a braked hold within 1 mm per minute on a 15 % slope with brake-to-reverse off;
refusal of unknown fields and unstable suspension; brake hand-off from an empty axle; no
-0, no state leaked through the hit record across a restore, refused re-entry and
refused unusable restores. `consumers.test.ts` (4
tests): the adapter on the ECS fixed-step runner (Transform written, neutral coasting
while not owned, no write on a failing tick), a terrain-kit sampled ramp (rolls
downhill on four wheels, then holds on the brake within 1 mm for a minute) and the rollback kit's sync test over 600
frames with no hidden state. A local micro-measurement on one desktop CPU (Node 26)
gave about 2.2 µs per 60 Hz step of the arcade preset on a plane (2.7 µs with dmath):
an order-of-magnitude indication only. These are headless contract tests: no
template, browser, feel, controller or physical-device acceptance is claimed.
