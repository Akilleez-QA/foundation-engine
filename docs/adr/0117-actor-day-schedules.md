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
- `schedulePlacement(schedule, time, flags)`: O(variants + log windows) after reading each flag once into a mask; a
  frozen placement with `windowEnd` (the next possible change, strictly later than `time`) and travel `progress`.
- One boundary expression on the timeline for both placement and catch-up (day `d` starts at `epoch + d * dayLength`;
  a window is `[dayStart + start, dayStart + end)`; an end at `dayLength` is the next day's start), and a time
  resolution rule that refuses times whose float spacing could merge the schedule's shortest segment.
- `scheduleCatchUp(schedule, from, to, flags, {maxTransitions})`: the ordered occupant changes in `(from, to]`, at
  most `maxTransitions` (default 64, max 4,096), `truncated` beyond, `rewound` for `to < from`, and always the exact
  final placement. Days without a change are jumped over using a per-weekday table, so work is
  O(cycleDays x variants + log windows + maxTransitions).
- `scheduleItineraryOrder` (plain order data with an absolute deadline for the itinerary controller) and a bounded
  `createScheduleRoster` with enumeration and an anchor-to-actors index. Only schedules returned by `defineSchedule`
  are accepted.

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

Eighteen headless tests: definition refusals, placements, variants and flag reads, transition rules, truncation and
bounded long skips, a 300-schedule integer brute-force comparison, a 400-schedule decimal fuzz near zero and near 1e15
comparing catch-up with a wake-at-`windowEnd` sequence, resolution refusals, a worst case bounded by a deterministic `daysVisited` work count, the roster, and five
compositions with real owners (core clock wake-ups and a restored jump, the non-dyadic wake repro on the core clock,
the itinerary controller, region activation waking a region, and a region that stays active receiving a dormant actor
through a clock wake). An independent review of the first candidate found inconsistent float boundaries between
placement and catch-up (a wake loop; critical), an overstated region-activation composition, accepted hand-built
schedules, slow worst-case catch-up, a wrong complexity claim, undocumented midnight transitions, flag-source gaps and
a stale itinerary deadline; all were fixed or documented with regression tests. A re-review of the fixes was clean;
its two low notes were applied (an unresolvable segment is refused at definition with a clear message, and test
timing assertions became deterministic work counts). No browser, template or device
evidence; hosted CI remains required.
