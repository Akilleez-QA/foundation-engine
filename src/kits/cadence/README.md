# kits/cadence

Optional bounded **per-member update cadence** on the caller's integer tick. Members (entities, agents, regions,
connections) each have a period in ticks; `take(now, out)` returns the members that are due, most overdue first, at
most `maxDuePerTake`, with the ticks elapsed since each was last served. Members not taken stay due. Serving keeps a
member on its phase grid (due ticks congruent to its phase modulo its period), so missed occurrences are skipped
rather than replayed in a burst. The phase defaults to the id, so a population added together, or moved to a new
period together, stays spread instead of running in lockstep. It is a pure
helper imported from `@kits/cadence`: no system, clock, callback or registration is installed.

```ts
import { createCadence, createCadenceResult } from '@kits/cadence';
const limits = { maxMembers: 4096, maxDuePerTake: 256, maxPeriod: 64 };
const cadence = createCadence(limits);
const out = createCadenceResult(limits);       // reusable; overwritten by each take
cadence.add(entity, 8);                         // ticks congruent to entity mod 8
// In an ordinary fixed-step system, with the creator's own tick counter:
cadence.take(tick, out);
for (let k = 0; k < out.count; k++) think(out.ids[k], out.elapsed[k] * stepSeconds);
// Creator policy decides periods (distance band, state, importance); jitter comes from ctx.random():
cadence.setPeriod(entity, nearPlayer ? 1 : 8);
```

| Contract | Definition |
|---|---|
| Creator-owned semantics | What a member is, what serving it does, its period (distance band, state, importance, jitter from `ctx.random()`), the tick it runs on, what a deferred member means, and how its state is saved |
| Inputs and outputs | Ids are nonnegative safe integers (ECS entity numbers fit); periods are integers `1..maxPeriod`; an explicit phase is `0..period-1` (default: the id); `now` is a nondecreasing integer `0..MAX_CADENCE_TICK` (2^53 minus two period ceilings). A member added between takes is anchored at the latest take's tick. `take` writes `ids` (earliest due first, ties by ascending id), `elapsed` (ticks since that member was last served or added), `late` (ticks past its due tick), `count`, `now` and a status. `snapshot()` returns plain JSON-safe state sorted by id (period, due, last serve, phase); `restore(snapshot)` reads each field once, checks `last <= now`, `last < due <= now + period` and the limits, then replaces all state |
| Owner | The caller creates, drives and disposes it from an existing system. It borrows no clock, scheduler or worker and never calls back |
| Bounds | Slot tables and a binary heap sized by `maxMembers` (ceiling 1,048,576) are allocated at construction; result buffers by `maxDuePerTake`. `add`, `remove` and `setPeriod` are O(log n); `take` is O(k log n) for k returned members with no table growth. `snapshot` allocates its result; `restore` allocates a validation set |
| Overload | More due members than `maxDuePerTake`: the most overdue are returned, status `deferred`, the rest stay due and come first next take (their `late` grows). Full table: `saturated`. Nothing is dropped or retried on its own |
| Cancellation and replacement | Synchronous only. `remove` cancels a member's schedule immediately; re-adding starts a fresh schedule. `setPeriod` to the same period is a no-op; an already-due member stays due; otherwise the next due tick is the first phase-grid tick after the last serve, or after now if that has passed (no burst). `dispose()` is terminal and idempotent; later calls report `closed` |
| Failure and recovery | Malformed limits, ids, periods, phases, ticks, results (including buffers that share memory) or snapshots throw before any change; a decreasing `now` throws. A refused `restore` keeps the previous state. Save `snapshot()` in a save section to continue the exact schedule after a reload; or re-add members after loading to start fresh |
| Evidence | `cadence.test.ts` (8 tests): validation, id spread and phase grid, spread preserved across same and changed periods for a whole population, aliasing and tick-ceiling refusal, explicit phase with `elapsed`/`late` and no burst after a gap, budget deferral ordering, `setPeriod`/remove/saturation/disposal, snapshot JSON round trip continuing identically and malformed snapshots refused without change, and a 4,000-step randomised comparison with an independent model that finds grid ticks by enumeration (including occasional large gaps and mid-run JSON snapshot round trips). `consumers.test.ts` (2 tests): a `World` + fixed-step runner consumer with distance-banded think periods integrating `elapsed`; an interest-set consumer refreshing relevant members by distance band and removing schedules when members leave |
| Limits | Integer ticks only (no wall-clock time); periods are per member, not per component; no priority beyond earliest-due-first, so a permanently over-budget population is served in due order but each member's `late` can grow (choose `maxDuePerTake` or periods so the steady due rate fits). No worker offload, no persistence of its own, no network policy. Measured headless cost is not a device budget; no browser or physical-device evidence |

## Measured cost (headless, not a device budget)

One local probe run (Node 26, desktop CPU; the probe script is not committed): 10,000 members with periods 1, 4, 16 and 64, budget 4,096, about 3,200 members
served per take: median 0.28 ms and p99 0.36 ms per `take` over 2,000 ticks. Order-of-magnitude indication only.
