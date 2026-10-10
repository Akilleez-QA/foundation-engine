# Optional board traversal

`@kits/board-traversal` is a fixed-step controller for riding a board: push, coast,
brake and carve over a ground the creator supplies, charge and pop an ollie, spin in
the air, catch authored rails and grind them with balance, hold manuals, judge
landings by the board's angle to its travel, bail and recover. It is a pure helper: no
kit registration, physics world, clock, input mapping, trick catalogue or scoring. The
creator owns the ground, the rails, the walls, what each event is worth and how the
rider looks; the character kit can supply walls, the camera kit follows the rider.

```ts
import {boardConfig, boardSystem, createBoard, defineRails, sampledBoardGround} from '@kits/board-traversal';

const board = createBoard(boardConfig('arcade', {grind: {snapRadius: 0.4}}), {math: 'deterministic'});
board.place({x: 0, y: 0, z: 0, yaw: 0});
const rails = defineRails({
  revision: 1,
  maxSegments: 256,
  rails: [{id: 'plaza-ledge', points: [[2, 0.45, 4], [2, 0.45, 16]]}],
});

boardSystem({
  board,
  target: 'rider',
  ground: sampledBoardGround((x, z) => surface.sample(x, z)), // terrain kit surface, or the creator's own query
  rails: () => rails,
  walls: {radius: 0.3}, // the character kit's Walls and Solid entities block the board
  controls: ctx => ({
    push: ctx.input.held('push'),
    brake: ctx.input.held('brake') ? 1 : 0,
    steer: ctx.input.axis('steer'),
    ollie: ctx.input.held('ollie'),
    manual: ctx.input.held('manual') ? 1 : 0,
  }),
  after: result => score(result.events), // creator scoring, sounds, camera
});
```

## Creator requirement and seams

A board game needs traversal that feels a chosen way, steps identically on every
machine and can be rewound. The locomotion kit's jump controller is a vertical
controller for walking actors, and the character kit moves a circle over walls; neither
carries momentum along slopes, rails or landings judged by orientation. This kit adds
that motion model and reuses:

- the fixed-step lane through `boardSystem`, or any creator system that calls `step`
  once per tick;
- `scalarMath`: `math: 'deterministic'` uses `dmath` for every sine, cosine and arctangent;
- the character kit's `Walls`/`Solid`s (or any `Area`) as the wall port, through
  `characterSlide(worldOrArea, radius, board.math)`, which splits each move into pieces
  of at most half the board radius and evaluates solids with the board's arithmetic;
- the terrain kit's `Surface.sample` through `sampledBoardGround`;
- the rollback kit's save/load/step ports through `snapshot`/`restore`
  (`consumers.test.ts` runs its sync test through pushes, grinds, tricks and bails);
- the control kit's `owns` (or any predicate) as the adapter's `when`.

## Inputs and outputs

**Configuration.** `boardConfig(preset | config, patch?)` merges a patch one level deep
and returns a validated, frozen `BoardConfig`; `createBoard` validates again. A value
outside its bounds throws `RangeError` naming it. Yaw follows the engine frame: yaw 0
travels +z, and positive yaw turns toward +x.

**Controls, per step.** `push` (held: one kick per `push.interval` below
`push.maxSpeed`), `brake` [0, 1], `steer` [-1, 1] (positive right: carves on the
ground, spins the board in the air, corrects balance on rails and in manuals),
`ollie` (held charges; the release pops on the ground, in a manual or on a rail),
`manual` (-1 nose, 0, 1; held), and `trick` [0, 10] s (starts a creator-defined trick
timer while airborne and idle). Missing fields are neutral; anything else throws before
the rider changes.

**Ports, per step (`BoardWorld`).**

| Port | Contract |
|---|---|
| `ground(x, z, below, out)` | Highest walkable surface at (x, z) at or below `below`: writes `height` and an upward normal (`ny` > 0), returns true; false for none. Surfaces above the query are ignored, so they are one-way. Must be deterministic and side-effect free. |
| `rails` | A `defineRails` snapshot, or undefined. A lookalike object throws. |
| `slide(x, z, dx, dz, out)` | Optional walls: where a planar move ends, never further than the move. |

**Rails.** `defineRails({revision, maxSegments, rails})` copies and validates
polylines (2–64 points, consecutive points at least 1 cm apart, coordinates within
±1e7, unique ids of at most 256 characters; at most 1,024 rails and `maxSegments` ≤
8,192 segments in total) and returns a frozen handle; rails are stored in id order. To
change rails, define a new snapshot with a new revision: a board grinding when the
revision changes drops off into the air rather than follow stale data.

**Outputs.** `step` returns a frozen `{mode, events, substeps, groundQueries,
railChecks}`. Events, in order: `push`, `pop`, `launch` (left the ground or a rail
without a pop), `land-clean`, `land-sketchy`, `switch` (rides away switched), `grind-start`,
`grind-end`, `manual-start`, `manual-end`, `trick-start`, `bail`, `recover`. `read()`
returns the full state (mode, position, velocity, speed, heading, board yaw, stance,
charge, balance, trick time left, air time, rail id, bail reason `angle | impact | trick
| balance | wall | manual`); `pose(out?)` writes `x, y, z, ry`; getters `mode` and `speed`
do not allocate. `rail` names the rail from the rails passed to the last step, so it is
null straight after `restore` until the next step. `cancelInput()` forgets a held ollie
and its charge without popping; the adapter calls it on ticks its `when` is false, so a
rider losing its controller mid-crouch does not pop.

## Behaviour

- **Rolling.** Speed lives along the ground tangent of the travel heading. Each
  sub-step: push, slope acceleration (`-g · tangent.y`), constant resistance plus brake
  (never reversing), quadratic drag, the speed clamp, carving at `carve.rate` scaled by
  speed up to `carve.fullSpeed`, the wall port, then ground following. The board steps
  onto a surface up to `landing.snap` higher and follows one up to `snap` lower; it
  leaves the ground when nothing is within `snap` below, or when holding the new
  surface would take a vertical speed change larger than `g·h + landing.stick` (a kicker
  lip, a crest taken fast). Leaving the ground is a `launch`. Against a wall, the board
  keeps the share of its move the wall port allowed and turns to travel along it, so
  grazing a wall costs speed once rather than every sub-step.
- **Ollie.** Holding charges to 1 over `ollie.chargeTime`; the release pops at
  `minPop + (maxPop - minPop) × charge` upward on top of the ground velocity.
- **Air.** An exact ballistic arc with terminal speed; `steer` spins the board yaw at
  `air.spinRate`; travel direction does not change. A nonzero `trick` starts a trick at
  most once per step, and only while none is running. Rails are tested before the ground.
  The ground is swept from the sub-step's start height, so a fast fall lands on any
  surface it crossed.
- **Landing.** The angle between the board's forward in its current stance (the nose,
  or the tail when riding switched) and horizontal travel is judged: up to `clean` lands
  clean, up to `sketchy` keeps `sketchyKeep` of the speed, beyond bails (`angle`). With
  `landing.allowFakie`, a landing nearer backwards than forwards is judged against the
  other end and rides away in the other stance (`switch`); a plain ollie while riding
  switched lands switched. A trick still running bails (`trick`); landing faster than
  `maxImpact` downward bails (`impact`). The rider rides away along the board with the
  speed the new surface keeps; a bail slides the way the board was travelling.
- **Grinds.** While falling or level and at least `grind.minSpeed` horizontally, the
  closest rail point within `snapRadius` horizontally catches the board when the board
  ends the sub-step no more than `snapAbove` above it and started no more than
  `snapBelow` below it, and travel is within `maxEntryAngle` of the rail (either
  direction). A running trick bails. On the rail: speed along it with gravity along
  its slope, friction and brake; it walks across segments; a pop leaves with the pop
  speed; leaving the end adds `exitHop` up; below `minSpeed` it drops off. The rail just
  left cannot be caught again for `recatchTime` of air time; landing clears that. The
  board's yaw is not aligned to the rail: an angled catch keeps its angle, and the exit
  landing is judged on it. When the rails passed to a step are not the ones the grind
  started on (another revision or segment count, or a rail or segment index outside
  them), the board leaves with its velocity along the rail (`grind-end`, `launch`).
- **Balance** (grinds and manuals): `rate += (instability × balance + disturbance ×
  side − control × steer) · h`, `balance += rate · h`, starting at 0. `side` is the
  rail entry side (which way the board points across the rail) or the manual direction.
  Reaching |balance| ≥ 1 bails on a rail (`balance`), and in a manual either drops back
  to rolling or bails (`manual.fail`); after a manual fall the manual input must be
  released before another starts. With instability and disturbance 0 only steering moves
  the balance.
- **Bail.** The rider slides (or falls, then slides) to a stop at `bail.decel`, and
  after `bail.time` counted on the ground recovers to rolling. Being stopped by a wall
  faster than `bail.wallSpeed` (the speed lost perpendicular to what the wall allowed)
  bails (`wall`; a manual ends first); slower contact slides along the wall.

## Tuning

Both presets are generic starting points, not any particular game's values.

| Field | Bounds | arcade | sim-lite |
|---|---|---|---|
| `gravity` | [0, 100] m/s² | 18 | 9.81 |
| `push.impulse` / `interval` / `maxSpeed` | [0, 20] m/s / [0.05, 5] s / [0, 50] m/s | 2 / 0.45 / 9 | 1.5 / 0.65 / 7 |
| `rolling.resistance` / `drag` / `brake` / `maxSpeed` | m/s² / 1/m / m/s² / m/s | 0.25 / 0.002 / 6 / 25 | 0.35 / 0.004 / 4.5 / 20 |
| `carve.rate` / `fullSpeed` | [0, 20] rad/s / (0, 50] m/s | 2.6 / 3 | 1.8 / 4 |
| `ollie.minPop` / `maxPop` / `chargeTime` | m/s / m/s / [0, 5] s | 5 / 7.5 / 0.3 | 2.8 / 4.2 / 0.35 |
| `air.spinRate` / `maxFall` | rad/s / m/s | 7 / 40 | 5 / 50 |
| `landing.clean` / `sketchy` | rad, [0, π/2] | 0.5 / 1.1 | 0.3 / 0.75 |
| `landing.sketchyKeep` / `maxImpact` / `allowFakie` | [0, 1] / m/s / boolean | 0.7 / 25 / true | 0.55 / 9 / true |
| `landing.snap` / `stick` | [0, 1] m / [0, 20] m/s | 0.08 / 1.5 | 0.05 / 1 |
| `grind.snapRadius` / `snapAbove` / `snapBelow` | [0, 2] m | 0.5 / 0.35 / 0.15 | 0.3 / 0.2 / 0.08 |
| `grind.maxEntryAngle` / `minSpeed` / `friction` | rad / m/s / m/s² | 0.9 / 1 / 0.6 | 0.6 / 1.5 / 1.2 |
| `grind.exitHop` / `recatchTime` | m/s / s | 1 / 0.3 | 0.3 / 0.4 |
| `grind.instability` / `disturbance` / `control` | [0, 100] | 1.5 / 0.4 / 6 | 4 / 1 / 7 |
| `manual.friction` / `minSpeed` | m/s² / m/s | 0.4 / 1 | 0.8 / 1.5 |
| `manual.instability` / `disturbance` / `control` / `fail` | [0, 100] / `roll` or `bail` | 1.5 / 0.5 / 6 / roll | 4 / 1.2 / 7 / bail |
| `bail.time` / `decel` / `wallSpeed` | s / m/s² / m/s | 1.2 / 8 / 8 | 2 / 10 / 5 |
| `limits.maxSubstep` / `maxSubsteps` / `extent` | [1/1000, 1/15] s / [1, 16] / m | 1/120 / 8 / 1e6 | 1/120 / 8 / 1e6 |

With the stock presets on flat ground at 60 Hz (headless): arcade pushes reach 9 m/s,
a tap pops about 0.7 m and a full charge about 1.6 m; sim-lite reaches 7 m/s and pops
about 0.4 m and 0.9 m. Properties of the presets, not targets.

## Bounds, overload and failure

- Per step at most `maxSubsteps` ground queries (`maxWorkPerStep(segments)`), and in the
  air at most `segments` rail checks per sub-step (each segment is rejected first by its
  bounding box). Constant memory per rider; the controller allocates its result and event
  list per step and nothing per sub-step. The ports' costs are their own: the adapter
  reads the character kit's walls once per tick, and its `slide` allocates a point per
  piece; `characterSlide` refuses a move longer than 32 radii in one sub-step.
- Configuration refuses unknown fields at every level. A port that calls back into the
  same board (`step`, `place`, `restore`, `cancelInput`) is refused and the outer step
  fails whole. For thousands of rails, build smaller snapshots for the area around the rider
  (for example from the spatial kit) instead of one large set.
- A step needing more than `maxSubsteps` is refused with `RangeError`.
- A step is a transaction: it works on a copy and commits only when every sub-step
  finished, every value is finite and the rider is inside `limits.extent`. A throwing
  port, an invalid ground answer (above the query, non-finite, `ny` ≤ 0), a slide past
  the requested move, invalid controls or a refused step leave the rider exactly as
  before; the adapter then writes no Transform and the runner reports the throw.
- `place` puts the rider at rest, rolling, regular stance. Nothing is asynchronous, so
  there is nothing to cancel.

## Determinism, snapshot and rollback

Identical configuration, start, `dt` sequence, controls and port answers give identical
state. With `math: 'deterministic'` every transcendental goes through `dmath`; rail
lengths use square root. The default `platform` mode can differ between JavaScript
engines. The ports must be deterministic too.

`snapshot()` is a frozen, JSON-safe `{kind, version: 1, fingerprint, values}` (34
numbers, under 1 KB as JSON); every write to the state turns -0 into 0, so it round-trips
bit for bit. `restore` refuses another configuration's snapshot, a wrong length,
non-finite values, a position outside `limits.extent`, a non-unit or downward ground
normal, unwrapped angles, and out-of-range mode, rail, stance, charge, timer and flag
fields, and changes nothing when it refuses. A grinding snapshot refers to a rail by
index in the rail snapshot it was taken with; stepping it with other rails makes the
board leave the rail (see Grinds), never fail.
Snapshots are not a save format with migrations.

## Limits

The rider is a point on the ground plus an optional wall circle: no body shape,
ceilings, or collisions with other riders. The ground port is one-way from above, so a
raised box is only a wall if the wall port says so. Rails are authored polylines only
(no automatic edge detection, no wall rides, vert ramps or lip tricks); manual and
grind balance is one scalar; trick catalogues, flips, grab animation, combo scoring and
camera are creator code built on the events. Render interpolation between ticks is the
creator's.

## Evidence

`board.test.ts` (22 tests): for both presets, discrete pushes to the cap with coasting
and braking, tap versus charged ollie heights against `v²/2g`, landing judgement (clean,
sketchy with speed loss, angle bail, switched); trick and impact bails and recovery;
catching a two-segment rail, grinding to its end and landing, with no re-catch;
alignment and catch-window refusals; balance falling without correction and holding with
it; rail revision changes mid-grind; manual start, release, fall and re-entry rule; a
kicker launch, slope acceleration against the expected rate, wall slide and wall bail;
configuration and rail refusal; transactional refusal of bad steps and port answers and
the work bound; identical bits across runs and JSON snapshot round trips in both math
modes; a plain ollie while switched; a landing bail sliding along the travel; changed,
same-revision and out-of-range rails never wedging a grind; the re-catch delay cleared by
landing; one trick start per step; a manual ending before a wall bail; wall grazing
independent of the sub-step; no pop after losing control; huge normals, -0, re-entry,
bad restores and unknown fields. `consumers.test.ts` (3 tests): the adapter on the ECS fixed-step runner with the
character kit's `Walls` and a `Solid` (Transform written, no pushes while not owned, a
fast rider bails at the box and never passes it), a terrain-kit sampled hill (rolls,
pops, lands on the surface) and the rollback kit's sync test over 900 frames through
pushes, grinds, tricks and bails. A local micro-measurement on one desktop CPU (Node 26)
gave about 0.6 µs per rolling 60 Hz step and about 9–10 µs per step on average while
popping repeatedly over a set of 4,095 rail segments (an order-of-magnitude indication
only). These are headless contract tests: no template, browser, feel, controller or
physical-device acceptance is claimed.
