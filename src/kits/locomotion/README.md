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
that actor is despawned or renamed (`jumpStateCount(world)` reports it). Invalid steps, facts or ground answers
throw before any state changes; a throwing tick is reported by the system runner.
Presses are used as the input layer reports them. The stock runtime's press latch
(STD-SIM-12, PR #19) shows each press to exactly one fixed tick, including through
frames that run no tick, so the adapter adds no filter of its own: presses on adjacent
ticks are two presses. A custom input source must keep that exactly-once contract.

**Cancellation and recovery.** `cancelPress()` drops a pending press (`when` returning
false does this). `reset()` clears everything; `resetJump(world, entity?)` does it for
the adapter, for example from the control kit's `resetMotion` port or after a teleport.
`ceiling()` drops upward velocity; `setVelocity(v)` applies an external launch that
release gravity does not cut.

**Limitations.** No moving-platform velocity carry, wall contact, corner correction,
slope limits or lateral blocking (lateral collision stays with `Walls`/`Solid`s). The
support query is a height field per (x, z) at the actor centre, not a swept body.
The adapter never calls `step(0)`; a caller of the pure controller may use `dt = 0` to
record a press during a frame that runs no tick. Evidence: unit tests at 30, 60, 120, 144, 165 and
240 Hz ticks and display rates, including exact apex and identical fixed-step samples;
no browser, device or template consumer yet.
