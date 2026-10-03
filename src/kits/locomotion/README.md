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

## Tunable jump feel (MV-01)

Recipe: [add and tune a jump](../../../docs/recipes/tune-a-jump.md).

`createJumpFeel(config)` is a pure vertical controller for one actor. The creator
chooses every value; the defaults are a starting point, not a prescribed feel.
`jumpSystem(options)` is an optional fixed-step adapter that drives it from a game
action and a creator-supplied support query. Status: integrated in v0.2.0 (MV-01, PR #34).

**Inputs.** Per fixed tick: `pressed` (true on exactly one tick per physical press),
`held`, and `grounded` (the caller's support result for the previous motion).
Configuration (validated, `RangeError` outside the bounds):

| Field | Bounds | Default | Effect |
|---|---|---|---|
| `height`, `timeToApex` | (0, 1000] m, [0.02, 10] s | required | Exact apex height and rise time with the action held |
| `fallGravityScale` | [1, 10] | 1.5 | Heavier descent |
| `releaseGravityScale` | [1, 20] | 2 | Variable height: heavier gravity while rising after release; 1 disables |
| `apexBand`, `apexGravityScale` | [0, 0.9] of launch speed, [0.1, 1] | 0, 1 | Lighter gravity near the apex while held; off by default |
| `maxFallSpeed` | (0, 1000] m/s | 1000 | Terminal descent speed |
| `coyoteTime` | [0, 1] s | 0.1 | A press shortly after losing support still jumps; 0 disables |
| `bufferTime` | [0, 1] s | 0.1 | A press shortly before support jumps on arrival; 0 keeps it for its own tick |
| `maxDt` | (0, 0.25] s | 0.25 | Longest accepted step |

`deriveJump(config)` reports the launch speed and each gravity. With apex
modulation on, the derivation still makes `height` and `timeToApex` exact.

**Outputs.** `step(dt, input)` returns `dy` (displacement), `vy`, `peak` (highest
displacement inside the step, for ceiling tests) and `jumped`. Gravity is integrated
exactly in pieces split where its regime changes, so the arc does not depend on the
tick length. Only input and contact timing are quantised to ticks. Coyote and buffer
windows share one convention: an event (the last supported tick, a press) is honoured
while the time elapsed since its tick is at most the window, compared with a 1e-9 s
tolerance, so a fixed rate admits exactly floor(window × rate) ticks after the event
(a press always counts on its own tick; a zero coyote window admits none). `vy` reads
the velocity without building the frozen `state` snapshot.

**Owner and adapter.** The caller owns collision and support; the controller owns
only vertical velocity, press age and time since support. `jumpSystem({ action,
config, ground, target?, groundOffset?, stepHeight?, snapDistance?, when? })` writes
only the target's `Transform.y`. `ground(x, z, below)` returns the highest walkable
height at or below `below`, or null. The adapter passes the start-of-tick foot height,
so surfaces above the feet are one-way. A descending tick queries from its highest
point (`peak`, so an apex inside the tick counts) down to its end, so a fall finds every
surface it crossed at any speed. Run it after the horizontal mover, for example `characterSystem()` without
its own `ground` option; never run two writers of `y`. Define the action with
`defineInput({ …, hold: true })` so `ctx.input.held` observes the release; a tap
presses without holding, so touch taps give the released (short) jump.

**Bounds and overload.** Constant state per actor; at most five integration pieces
per step and no allocation besides the returned step record; two support queries per
adapter tick. The adapter keeps state only for its current target and drops it when
that actor is despawned or renamed (`jumpStateCount(world)` reports it). Invalid steps and facts
throw before the controller changes. The adapter tick is a transaction: it saves the controller
(`save()`) and its own state, and if anything in the tick throws (a ground or platform query, an
invalid ground answer, a limit) it restores both (`restore()`) and leaves the Transform unwritten,
so the actor ends exactly as if that tick had not run. The runner reports the throw.
Presses are used as the input layer reports them. The stock runtime's press latch
(STD-SIM-12, PR #19) shows each press to exactly one fixed tick, including through
frames that run no tick, so the adapter adds no filter of its own: presses on adjacent
ticks are two presses. A custom input source must keep that exactly-once contract.

**Cancellation and recovery.** `cancelPress()` drops a pending press (`when` returning
false does this). `reset()` clears everything; `resetJump(world, entity?)` does it for
the adapter, for example from the control kit's `resetMotion` port or after a teleport.
`save()` and `restore()` keep and return to one copy of the whole controller state (no
allocation), which the adapter uses to roll back a failed tick. `ceiling()` drops upward velocity; `setVelocity(v)` applies an external launch that
release gravity does not cut.

**Limitations.** No moving-platform velocity carry, wall contact, corner correction,
slope limits or lateral blocking (lateral collision stays with `Walls`/`Solid`s). The
support query is a height field per (x, z) at the actor centre, not a swept body.
The adapter never calls `step(0)`; a caller of the pure controller may use `dt = 0` to
record a press during a frame that runs no tick. Evidence: unit tests at 30, 60, 120, 144, 165 and
240 Hz ticks and display rates, including exact apex and identical fixed-step samples;
no browser, device or template consumer yet.

## Moving platforms (MV-02)

Recipe: [add moving platforms](../../../docs/recipes/add-moving-platforms.md). Status:
implemented, candidate (PR #53).

`createPlatforms({ maxPlatforms?, maxSpeed? })` is a pure, bounded registry of moving
support surfaces. Each platform is an axis-aligned footprint (`halfX`, `halfZ`). Its
top-centre pose is a creator function of simulation time, `path(t)`.

`platformSystem(platforms, { bind? })` advances the registry once per fixed tick. It can
also write each pose to a named entity's Transform for rendering. Run it before
`jumpSystem` in the same fixed lane. `jumpSystem({ …, platforms, onLeave?, radius? })`
rides, leaves and catches platforms.

| Input | Bounds | Default |
|---|---|---|
| `maxPlatforms` | integer [1, 1024] | 64 |
| `maxSpeed` | (0, 1000] m/s | 100 |
| `halfX`, `halfZ` | (0, 1000] m | required |
| `path(t)` | finite x, y, z within ±1e7 | required |
| `onLeave` | `'add-velocity'`, `'add-upward'`, `'none'` | `'add-velocity'` |
| `radius` (carried motion vs walls) | (0, 10] m | 0.35 |

**Riding.**
- An actor on a platform moves by that platform's exact displacement each tick (the
  difference of two path samples), so it follows the path exactly at any tick rate.
- An actor resting exactly on a platform's previous top rides from that tick on,
  including one placed there at scene start.
- The adapter remembers the platform pose it last rode with. If the platform has not
  advanced since (a missing, stopped or later-ordered `platformSystem`), the actor stays
  put; no stale displacement is replayed. Ordered after `jumpSystem`, riding lags one
  tick.
- These all detach the actor with no velocity, so it is neither teleported nor flung:
  any other change (`cut`, `restart`, a removal and re-add) and an actor moved
  vertically by another owner.
- On a riding tick, static ground (with `stepHeight`) and every platform's one-way catch
  are swept from the old feet to the new top, and the highest surface wins; an exact tie
  keeps the carrier. A lift descending through a floor therefore leaves its actor on the
  floor, a carried actor steps onto a low ledge, and an overtaking platform takes over.
- While `when` returns false, a carried actor keeps riding. Presses are dropped and
  nothing else simulates.

**Leaving** (by jumping, or by no longer being over the footprint) applies `onLeave`,
after Godot's `platform_on_leave`:
- `add-velocity` keeps the platform's mean velocity over its last tick. Horizontally it
  continues while airborne, including the jump tick's ride. Vertically it is a launch
  boost on a jump, or the initial velocity when moving off.
- `add-upward` keeps only an upward vertical part; `none` keeps nothing.
- A jump's vertical motion starts from the top the actor stood on at the start of the
  tick, so the platform's rise during the jump tick is not counted twice.
- Moving off keeps the coyote window. A coyote jump after moving off is an ordinary
  launch: it replaces the vertical velocity inherited on leaving, so the lift's rise is
  not added to it.
- A removed platform imparts nothing. Landing on any support clears inherited motion.
- Boosts are clamped to ±1000 m/s.

**One-way catch**, in each platform's frame: a platform catches an actor whose highest
foot point in the tick was at or above its previous top, and whose feet end at or below
its current top.
- A rising platform therefore picks up an actor it overtakes.
- An actor rising from below passes through and can land on it.
- The catch tick carries no horizontal displacement; riding starts on the next tick.

**Overload and failure.**
- `advance` samples every path before committing. A non-finite pose or a speed above
  `maxSpeed` throws, and no platform moves. Declare an intended jump with `cut(id)`.
- Carried and inherited planar motion slides against `Walls` and `Solid`s in sub-steps
  of at most half the radius. A step that short cannot cross a solid's outline inflated
  by the radius, which is at least two radii wide.
- Motion needing more than 1,024 sub-steps (over 512 radii in one tick) throws, and the
  tick is rolled back.
- A throwing tick is rolled back as a whole: the jump controller, the adapter's ride and
  inherited-motion state and the actor's Transform end as if the tick had been skipped.
  The platforms themselves still advanced if `platformSystem` ran.
- Without a `Walls` entity, `areaOf` uses default walls at ±1e6 m, but platform poses are
  accepted up to ±1e7. Carried and inherited planar motion is clamped at those walls (less
  the radius), so beyond ±1e6 a rider is not carried and drops off its platform. Add an
  explicit, wider `Walls` entity for platforms that travel that far.
- Platform queries cost O(platforms) per call; the adapter makes at most five per tick.

**Cancellation and recovery.**
- `remove(id)` drops riders without velocity.
- `restart()` resets the timeline to t = 0 without motion. Call it on scene enter so
  replays start from the same poses.
- `resetJump` clears the carrier and inherited motion.

**Limitations.**
- Footprints are axis-aligned boxes tested at the actor's centre: no rotation, slopes or
  side pushing.
- Inherited velocity is the platform's mean over its last tick: exact for linear paths,
  otherwise within one tick of curvature.
- A platform is not a `Solid`, and static ground higher than `stepHeight` does not block
  carried motion sideways.
- Only strictly higher support takes over from the carrier. A platform top wobbling
  around floor level by more than 1e-9 m (for example a path whose rest height is
  computed with rounding error) therefore carries its rider only intermittently: whenever the top dips below the floor, the floor wins and the actor
  stops riding until it is picked up again. For a platform flush with the floor, use an
  exact pose (a constant height) or snap the path's height to the floor.
- No render interpolation between ticks; the runner exposes `alpha` for it.

**Evidence.** These unit tests run at 30, 60, 120, 165 and 240 Hz ticks:
- exact riding, including a 20 m/s descent;
- jump apex from vertical, diagonal and descending lifts within g·dt²/8 of (v0 + v)²/2g;
- leave policies and removal;
- one-way pick-up and pass-through;
- frozen, missing and late platform systems;
- detaching on cut, restart, re-add and an external lift;
- `when` pauses;
- riding-tick sweeps of floor, step and overtaking platform;
- coyote after moving off;
- the speed and sub-step limits, a thin solid, walls, and an atomic failed tick;
- a ground query that throws once (before or after the controller steps, mid-fall and on
  flat and diagonal lifts, at 30 and 60 Hz) matches a run that skips that tick exactly.

Identical arcs at aligned times run at 30, 60, 120 and 240 Hz. The boost policy is
checked at 120 Hz. There is no browser, template or device evidence.
