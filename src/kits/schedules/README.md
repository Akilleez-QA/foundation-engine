# kits/schedules

Optional authored **day-cycle schedules** for actors: time windows on the game clock that name an anchor (a
creator location id) and an activity, with optional travel segments, weekday patterns and conditional variants.
Pure helpers imported from `@kits/schedules`: no system, clock, mover, save data or registration is installed.
Time is an input, normally the core `GameClock.ut`.

```ts
import { defineSchedule, defineScheduleCalendar, schedulePlacement, scheduleCatchUp } from '@kits/schedules';
const calendar = defineScheduleCalendar({ dayLength: 1440, epoch: 0, cycleDays: 7 }); // 24 game minutes a day
const baker = defineSchedule(calendar, {
  id: 'baker',
  idle: { id: 'home', anchor: 'house', activity: 'rest' },           // uncovered time, days no variant owns
  variants: [                                                       // first matching variant owns the day
    { id: 'festival', when: ['festival'], windows: [{ id: 'parade', start: 600, end: 840, anchor: 'square', activity: 'dance' }] },
    { id: 'workday', days: [0, 1, 2, 3, 4], unless: ['sick'], windows: [
      { id: 'commute', start: 360, end: 420, anchor: 'bakery', activity: 'walk', from: 'house' }, // travel
      { id: 'bake', start: 420, end: 720, anchor: 'bakery', activity: 'bake' },
    ] },
  ],
});
const flags = (f: string) => save.get().flags.includes(f);           // read once per evaluation
const p = schedulePlacement(baker, clock.ut, flags);                 // entry, anchor, activity, progress, windowEnd
clock.schedule(p.windowEnd, reevaluate);                             // wake at the next change, not per frame
// After a load, sleep or fast-forward: side effects for skipped windows, then place at the exact current entry.
const r = scheduleCatchUp(baker, lastUt, clock.ut, flags, { maxTransitions: 32 });
for (const t of r.transitions) applySkipped(t);                      // in time order; r.truncated if more happened
teleport(actor, r.final);
```

| Contract | Definition |
|---|---|
| Creator-owned semantics | Day length and time unit, the pattern length, what an anchor and an activity mean, where an anchor is, how an actor moves (navigation, itinerary, teleport), which flags exist and what they read, side effects of skipped windows, persistence of flags and of the actor's last-applied time |
| Inputs | A calendar (`dayLength` 1..1e9, `epoch` finite, `cycleDays` 1..366). A schedule: an idle entry and up to 32 variants in priority order, each with optional `days` (weekdays `0..cycleDays-1`), `when` / `unless` flag lists, an optional own idle entry and up to 256 windows (1,024 per schedule). Windows are half-open `[start, end)` within `0..dayLength`, never overlapping inside a variant (touching is fine); a window crossing midnight is authored as two windows. Optional `from` makes a window a travel segment. Ids are unique across the schedule; text is 1-128 characters; at most 32 distinct flags. Flags are a `Set` of true flags or a predicate returning a boolean |
| Outputs | `schedulePlacement` returns a frozen placement: day index, weekday, time of day, owning variant (or null), entry (anchor, activity, `from`), `idle`, `travel`, `windowStart` / `windowEnd` on the timeline (idle time is clipped to the current day) and `progress` in [0, 1). `scheduleCatchUp(from, to)` returns occupant changes with `from < at <= to` in time order, `truncated`, `rewound` and the exact `final` placement at `to`. `scheduleItineraryOrder` turns a placement into plain order data for `@kits/itinerary`. `createScheduleRoster` maps actor ids to schedules |
| Transition rule | A change is reported at every window start (each day it occurs, including a window covering the whole day), wherever idle time begins after a window, and at midnight when the idle entry itself changes. Idle time crossing midnight under the same idle entry is one occupancy |
| Owner | The caller. Definitions are frozen data; the roster is a bounded table the caller creates and disposes. Nothing borrows the clock, the scheduler or a save section |
| Bounds | Placement: O(variants + flags + log windows), one frozen record. Catch-up: flags read once, weekday owners resolved once (O(cycleDays x variants)), then at most `maxTransitions` (default 64, max 4,096) records; the scan stops at the limit or after one full pattern cycle with no change, so a billion-day skip is bounded. `|time - epoch| <= 1e15`. Roster: `maxActors` (1..1,048,576) |
| Overload | Catch-up beyond `maxTransitions`: `truncated: true`, later changes unreported, `final` still exact. Full roster: `assign` returns `saturated` and changes nothing |
| Cancellation | Synchronous only. Flags are read once per call: if they changed during a skipped span, split the catch-up at the change. A rewind (`to < from`, an earlier save) reports nothing and returns `rewound` with the placement at `to`. Roster `dispose()` is terminal |
| Failure and recovery | Malformed calendars and schedules (overlaps, bad bounds, unknown weekdays, duplicate ids, too many entries or flags) throw `RangeError` before anything is returned. Non-finite or out-of-span time throws `RangeError`; a non-boolean flag throws `TypeError`. Placement is derived from time, so after a reload re-evaluate at the restored UT; there is no state to repair |
| Composition | **Clock**: the core `GameClock` (`src/core/clock.ts`) is the time owner; pass `clock.ut` and wake with `clock.schedule(p.windowEnd, ...)`. The clock never jumps UT itself; loads (`driver.restore`) and creator fast-forwards are where `scheduleCatchUp` belongs. **Itinerary**: `scheduleItineraryOrder` produces `{tag, destination: {id: anchor, generation}, value}` for `Itinerary.edit`; the itinerary controller and the creator's movement adapter own arrival. **Region activation**: dormant actors need no per-tick work; when a region wakes, evaluate the roster's actors (one lookup each) and spawn those whose scheduled anchor lies in it. **Population**: not used; a placement is derived from time, so no placement memory is needed |
| Evidence | `schedule.test.ts` (8 tests): definition refusals, placement (windows, gaps, travel progress, day wrap, times before the epoch), variant priority and once-per-call flag reads, transition ordering and idle merging, truncation and bounded billion-day skips, a 300-schedule randomised comparison with a brute-force occupant-change model, roster bounds and the itinerary order helper. `consumers.test.ts` (3 tests): a real `createClock` waking at `windowEnd` and catching up after `driver.restore`; a real `createItinerary` running one order per scheduled anchor; a real `createRegionActivation` where a dormant actor appears at its scheduled place when its region wakes |
| Limits | No pathing between anchors (travel `progress` is a time fraction; positions are the creator's). Flags constant across one catch-up. Windows do not cross midnight. Calendar patterns repeat every `cycleDays`; one-off dates are flags. No persistence, no network authority. Headless tests only; no browser, template or physical-device evidence |
