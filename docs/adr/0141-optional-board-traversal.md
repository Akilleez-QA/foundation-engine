# ADR 0141: optional board traversal with authored rails

- Status: Proposed for this implementation; integration is gated by full CI.
- Date: 2026-10-09
- Area: Optional kits / simulation

## Context

Board games (skate, snowboard, hoverboard) need momentum along slopes and rails, a
charged pop, landings judged by the board's orientation, balance on rails and in
manuals, and bails, all stepping identically for replay and rollback. The locomotion
kit's jump controller is vertical only and the character kit moves a circle over walls;
neither carries momentum or orientation-judged landings. The creator has asked for genre
starting points of this kind as optional, configurable kits rather than core features.

## Decision

Add `@kits/board-traversal`, a pure controller and an optional fixed-step adapter:

- Modes rolling, air, grind, manual and bail in one fixed state array; push, coast,
  brake and carve along the ground tangent; ground following with a step-up/step-down
  window and a launch rule from the vertical speed change a contact can absorb; an
  exact ballistic air arc with board spin; landing judgement (clean, sketchy, switched,
  bail by angle, impact or an unfinished creator trick timer).
- Rails are creator-authored polylines in a validated, immutable `defineRails` snapshot
  with a revision and a required segment bound; a board catches a rail within a
  horizontal radius and vertical window when aligned, grinds along it with one-scalar
  balance and leaves by pop, end, low speed or fall.
- Ports per step: a one-way ground query (`sampledBoardGround` over terrain samples is
  supplied), the rail snapshot and an optional wall slide (`characterSlide` over the
  character kit's walls and solids is supplied).
- Bounded sub-steps, at most `maxSubsteps` ground queries and `maxSubsteps × segments`
  rail checks per step; transactional steps; `dmath` determinism; JSON-exact
  snapshot/restore refused across configurations. Two generic presets, `arcade` and
  `sim-lite`. No registration, trick catalogue, scoring or camera.

## Alternatives and consequences

Building on the jump controller would keep its exact vertical arcs but would leave
momentum, rails and orientation to a second owner of the same body; one controller
owning the whole rider avoids two writers. A rigid-body physics adapter could simulate a
board and rider, but grinds, manuals and landing judgement are rules, not contacts, and
would still need this layer. Rails as authored data rather than detected edges keep the
search bounded and the result predictable; creators who want detected edges generate
rails offline. The rider is a point with an optional wall circle; vert ramps, wall rides,
flips and combos are left to creator code on the events.

## Evidence

25 headless tests: behaviour for both presets, landing judgement, rails, balance, manuals,
kicker launch, slopes and walls, refusals and the work bound, bit-identical replay and
snapshot round trips in both math modes, an ECS consumer with character-kit walls, a
terrain-kit consumer and the rollback kit's sync test. No template, browser, feel or
device acceptance is claimed.
