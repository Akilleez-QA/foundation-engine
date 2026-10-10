# ADR 0099: optional car handling on ray-cast wheels

- Status: Proposed for this implementation; integration is gated by full CI.
- Date: 2026-10-09
- Area: Optional kits / simulation

## Context

The vehicles kit deliberately owns only seating, custody and pose following, and the
character and locomotion kits move actors over height fields. A creator who wants a
drivable car had to write a whole motion model: suspension, tyres, drive and brakes,
drift, air behaviour, recovery from a roll, plus the fixed-step, determinism and
rollback contracts every simulation in this engine is expected to keep (STD-SIM-10,
-11, -17, -24). The creator has asked for genre starting points of this kind as
optional, configurable kits rather than core features.

## Decision

Add `@kits/car-handling`, a pure controller and an optional fixed-step adapter:

- One rigid body with box inertia on 2–8 ray-cast suspension corners; spring and damper
  from a corner frequency and damping ratio; tyre longitudinal and lateral forces with a
  peak-then-slide slip curve inside a friction ellipse; drive and steering curves over
  speed; foot brake by axle bias, handbrake with timed grip recovery; drag, downforce,
  air control and levelling; optional body-corner ground contacts; an upside-down watch
  that reports or resets.
- The ground is a creator port that writes a ray hit into a caller record (no
  allocation in the controller); `planeGround` and `sampledGround` (terrain `Surface.sample`) are supplied.
- Steps are split into bounded equal sub-steps; a step is a transaction committed only
  when finite and inside the configured extent. Suspension tunings too stiff for the
  sub-step (heave, pitch and roll) are refused, and rays reach back by the sub-step's
  approach along them so fast falls do not tunnel. Work per step is at most
  `(wheels + 8) × maxSubsteps` ground queries.
- `math: 'deterministic'` routes every transcendental through `dmath`; the state is a
  fixed array with a JSON-exact `snapshot`/`restore`, refused across configurations.
- Two generic presets, `arcade` and `sim-lite`, with every value documented; creators
  patch or replace them. No registration, clock, input mapping or collision data.

## Alternatives and consequences

A general physics engine (or an adapter to one) would give contacts between bodies but
not a deterministic, allocation-free, bounded handling model with a documented tuning
surface; the separate physics-adapter work can host a car later through the same
ground port. A kinematic arcade model (velocity steered directly, no suspension) is
simpler but cannot give pitch, roll, landings or drifts that come from grip; the
`arcade` preset gets its forgiving feel from tuning instead. Keeping the ground a port
means wheel accuracy is the creator's choice (exact rays, height-field marching, or a
sphere sweep); a ray wheel can drop through gaps narrower than its radius. There is no
gearbox, wheel spin dynamics, car-to-car contact or damage: games that need them extend
or replace the kit.

## Evidence

29 headless tests: behavioural checks for both presets, transactional refusal, query
bound, clamps, creep, tunnelling and slope hold, configuration stability bounds, identical bits after repeated runs and JSON snapshot round trips in both
math modes, an ECS fixed-step consumer, a terrain-kit consumer and the rollback kit's
sync test. No template, browser, feel or device acceptance is claimed.
