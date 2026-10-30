# Optional work roster

`createWorkRoster` selects fair finite batches of registrations. It is a pure helper
imported from `@kits/work-roster`; no kit registration, clock, callback scheduler,
worker, ECS allocation or persistence service is installed. The creator drives it
from an existing system and owns the work, effects and lifetime.

```ts
const roster = createWorkRoster({maxEntries: 128, maxIdLength: 64});
const admission = roster.add('station-a');
if (admission.status === 'accepted') {
  // Keep creator state separately, associated with admission.ticket.
}
const batch = roster.take(4);
if (batch.status === 'ready') {
  for (const ticket of batch.tickets) {
    if (!roster.check(ticket)) continue;
    // Prepare creator work. Recheck membership and creator revision before effects.
  }
}
// Retire individual registrations with remove(ticket), or the whole owner:
roster.dispose();
```

## Admission and authority

Both limits are required positive safe integers: `maxEntries <= 65536` and
`maxIdLength <= 256` UTF-16 code units. Options are captured once. IDs are nonempty
primitive strings within the chosen length. Invalid limits, IDs or visit counts
throw before changing state. Argument validation precedes the closed check.

`add` returns `accepted` with a frozen ticket, or `duplicate`, `full`, or `closed`.
Duplicate wins over full; neither moves an existing entry. No implicit replacement
or eviction occurs. Remove then add to create a fresh registration for a reused ID.
Only the exact issued object is valid. Copies, foreign tickets, proxies and retired
tickets fail `check`/`remove` without reading properties or invoking getters.
`remove` returns whether it removed a live registration. Disposal is idempotent,
clears all entries and invalidates every ticket. No history or generation tombstones
are retained. Payloads live with the consumer, who also removes their associations.

## Fairness, work and storage

`take(k)` accepts every nonnegative safe integer, including zero and values above
capacity. On a live roster it returns `ready` with a frozen array of
`min(k, currentSize)` distinct tickets; on a disposed roster it returns `closed`.
Selection moves each chosen entry to the tail. New registrations append. A
continuously registered member is selected within at most `maxEntries` subsequent
positive one-visit selections, even when served members retire and newcomers join.
Zero budgets make no progress. Eligibility filtering happens after selection and
consumes that visit; there is no hidden unbounded skip scan.

Selection performs a captured finite number of Map operations. Two maps retain at
most `maxEntries` live entries each, with one frozen ticket per registration. Each
returned batch holds at most `maxEntries` references; selection allocates that
batch. This is a bounded preparation helper, not an allocation-free simulation
kernel. Caller-held batches, tickets, consumer data and ECS entities are outside
the owner's retention count. Native Map storage, garbage collection and elapsed
CPU time are not bounded by these logical counts. The ceilings limit admitted
structure, not a game population policy or measured device budget.

Membership is distinct from result freshness. Two visits of the same registration
can both remain valid while their computed results become obsolete. The consumer
uses its state/request revision and existing continuation owner for newer-result
or once-only effects, rechecking after externally supplied work. A ticket does not
make a transaction across ECS, spatial indexes, saves or other owners atomic.
Save semantic creator state through the existing save owner and register fresh
runtime tickets after loading; runtime handles are not portable.

## Evidence and limits

`roster.test.ts` checks an independent array-order model over 10,000 deterministic
operations, tail churn, bounds/refusal ordering, immutable batches and hostile
handle shapes. `consumers.test.ts` exercises distance observations in a real World
through the fixed runner and inspection results with a separate state revision.
Replacement during work refuses the old observation; inspection demonstrates that
membership alone accepts old work and consumer revision rejects it. Both retire
their consumer state explicitly. Headless checks do not establish physical-device
timing, native heap ceilings or arbitrary callback costs.
