# Eligible weighted choice and recent history

Import `chooseWeighted` and `createChoiceHistory` from `@kits/procgen`. These are
pure or caller-owned helpers, not another kit, director or PRNG. Supply an existing
seeded `Rng` or its `next` interface. `createSaveableRng` from `@engine` supplies the
same stream with explicit state/restore for persistence.

```ts
import { createChoiceHistory } from '@kits/procgen';
import { createSaveableRng } from '@engine';
const rng = createSaveableRng('rooms');
const history = createChoiceHistory({
  maxCandidates: 32, maxIdLength: 64, maxLabels: 4, windowSize: 2,
});
const planned = history.prepare('rooms', [
  { id: 'courtyard', weight: 3, eligible: true },
  { id: 'hall', weight: 1, eligible: true },
], rng);
if (planned.status === 'prepared') {
  // Admit the creator's generation/action before committing its history.
  // A rejected proposal can be cancelled without consuming history.
  history.cancel(planned.ticket);
}
history.dispose();
```

## Selection

`chooseWeighted(candidates,rng,{maxCandidates,maxIdLength})` returns an ID or null.
Each ordered row has a unique nonempty ID, nonnegative finite weight and boolean
eligibility. Candidate bounds are 1–4096; ID bounds are 1–256 UTF-16 units. Empty
arrays are valid. All rows are captured before drawing. Caller order is preserved;
zero/ineligible rows receive no interval. Positive eligible rows use half-open
cumulative intervals and exactly one draw in [0,1). Empty eligibility returns null
without drawing. Invalid rows, duplicates, excess count, sum overflow or a positive
weight too small to advance its accumulated sum throw before drawing.

Invalid random output or a throwing RNG throws without history publication. The
RNG may already have advanced; arbitrary RNG side effects are not rolled back.
Floating-point rounding and finite RNG resolution limit distribution precision.
A final-interval fallback handles multiplication rounding up to the total for tiny
weights. This is not an exact rational probability guarantee or a CPU deadline.

## History ownership, bounds and failure

`prepare(label,candidates,rng)` excludes that label's committed recent IDs and returns
prepared/empty/saturated/busy/disposed. One prepared ticket is retained. Busy,
disposed, saturation and empty outcomes take no RNG draw. A valid preparation takes
one draw even if later cancelled. Exhaustion does not automatically reset the pool.

`commit(ticket)` appends the ID and evicts only that label's oldest entry when needed.
`cancel(ticket)` retires the ticket without history changes. Both return false for
copied, foreign, replayed or retired tickets. `clear(label)` explicitly forgets that
label, frees its capacity and retires its pending ticket; its return value states
whether committed history was removed. Clearing is creator policy, not automatic
eviction of a different label. `dispose()` permanently clears and retires the owner.
The caller must cancel its actual external action/worker separately.

maxLabels and windowSize each range 1–4096, with product at most 65,536 IDs. Each
prepare visits at most maxCandidates plus windowSize, commit copies at most
windowSize, and restore visits at most the configured product. Storage is bounded
windows and labels plus one ticket. Caller-retained snapshots and arbitrary
proxy/RNG work are outside these count bounds. No idle work, draws or triangles.
Reentrant mutations throw; disposal during input/RNG handling prevents publication.
Plain record/dense own-index capture rejects accessors and custom iterators but is
not a sandbox against arbitrary proxy traps or modified global prototypes.

## Persistence and integration

`snapshot()` contains schema version 1, exact options and ordered per-label windows;
it is deeply immutable and omits pending work. `restore(raw)` validates every ID,
unique label/window entry, bound and exact options before replacement. Invalid data
throws without publication; a disposed owner returns false. Successful restore
retires pending tickets. Keep invalid bytes for SaveStore quarantine/recovery;
do not silently reset. Creators version and migrate the surrounding definition.

Save RNG state and history together in one creator-owned save envelope. Saving
during preparation does not serialize the pending action: its draw remains consumed.
Commit changes history only; it is not proof of durable rewards, inventory effects
or an external operation. Coordinate those through their existing receipt/save
owner. There is no new persistence, eligibility or assignment authority.

Ten focused tests cover room-theme generation with rejected proposals, objective
activity admission, exact saved RNG/history continuation through real SaveStore
and fresh reload, interval endpoints, no-draw/overflow, isolated eviction, malformed
restore and lifetimes. No browser, native-source parity, fairness, network authority
or physical-device performance acceptance is implied. See [ADR 0082](../adr/0082-bounded-weighted-choice-history.md).
