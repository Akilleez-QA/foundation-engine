# ADR 0117: optional day-cycle schedules for actors

- **Status:** Proposed
- **Date:** 2026-10-10
- **Area:** Optional kits / Simulation scale
- **Tracking:** linked from the pull request

## Context

Creator requirement: actors that keep a routine on the game clock (work by day, home at night, a different pattern
on rest days or during an event), that are where their routine says when a player arrives even if nobody watched
them, and whose skipped routine can be accounted for after a sleep, a fast-forward or a load.

Existing seams: the core `GameClock` (`src/core/clock.ts`, persisted by `core.clock` through the player clock
runtime) owns game time, never jumps UT on its own and exposes `schedule(atUt, fn)` for wake-ups; the remote-clock
estimator in `@kits/playout` is a network presentation concern, not world time. `@kits/itinerary` owns editable
destination orders and completion attempts; `@kits/region-activation` decides which regions simulate; `@kits/population`
keeps placement depletion for authored spawns. None of them answers "where should this actor be at time t".

## Decision

Add `@kits/schedules`, pure helpers with no system, clock, mover or registration:

- `defineScheduleCalendar` (day length, epoch, pattern length) and `defineSchedule`: variants in priority order with
  weekday lists and `when` / `unless` flags; half-open windows naming an anchor, an activity and an optional travel
  origin; idle entries for uncovered time. Overlapping windows inside a variant are refused at definition; gaps fall to
  the variant's or the schedule's idle entry (the documented default).
- `schedulePlacement(schedule, time, flags)`: O(variants + flags + log windows), flags read once, a frozen placement
  with `windowEnd` (the next possible change) and travel `progress`.
- `scheduleCatchUp(schedule, from, to, flags, {maxTransitions})`: the ordered occupant changes in `(from, to]`, at
  most `maxTransitions` (default 64, max 4,096), `truncated` beyond, `rewound` for `to < from`, and always the exact
  final placement. Work stops at the limit or after one quiet pattern cycle, so long skips are bounded.
- `scheduleItineraryOrder` (plain order data for the itinerary controller) and a bounded `createScheduleRoster`.

Inputs and outputs, owner (the caller), bounds (dayLength 1..1e9, cycleDays 1..366, 32 variants, 256 windows per
variant and 1,024 per schedule, 32 flags, `|time - epoch| <= 1e15`, roster `maxActors`), overload (`truncated`,
`saturated`), cancellation (synchronous; split a catch-up where flags change; roster `dispose`) and recovery
(definition errors throw before returning; placement is derived from time, so a reload just re-evaluates) are in the
[kit README](../../src/kits/schedules/README.md).

## Alternatives and consequences

A bytecode or script interpreter per actor (branching on day, flags and time ranges) was rejected in favour of data:
variants in priority order express the same decisions and can be validated and searched. A scheduled system that moves
actors would duplicate the clock's scheduling, the itinerary controller and the creator's movement. Midnight-crossing
windows and per-day flags in a catch-up are not supported; creators split windows and calls. Travel progress is a time
fraction, not a path.

## Evidence

Eleven headless tests: definition refusals, placements, variants and flag reads, transition rules, truncation and
bounded billion-day skips, a 300-schedule brute-force comparison, the roster, and three compositions with real
owners (core clock wake-ups and a restored jump, the itinerary controller, region activation waking a dormant actor
at its scheduled anchor). No browser, template or device evidence; independent review and hosted CI remain required.
