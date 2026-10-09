# Editable itinerary helper and lab

The [headless lab](../../tools/itinerary-lab/README.md) explores preserving active
work while editing its surrounding itinerary. The public candidate is now imported from @kits/itinerary with no registration
hook. The lab consumers share that implementation. Creators choose order tags, destination
identities, action meaning, looping, arrival criteria, costs and recovery policy.

## Owner, inputs and bounds

`createItinerary` owns an ordered list and one active attempt. The consuming scene
or task owns the controller and all external work. Options set positive safe-integer
`maxOrders` and `maxTextLength`, and a unique nonempty tag list bounded by maxOrders.
Each input contains a configured tag, destination `{id,generation}`, and a
nonnegative safe-integer value interpreted by the creator. IDs and tags have bounded
UTF-16 length. Destinations do not imply coordinates or accepted world validity.

Retained storage is O(maxOrders × maxTextLength), plus the bounded tag set and one
ticket. Edits, validation, invalidation and snapshots restored from data are bounded
by admitted record counts. There is no retained history or tombstone table. These
are work/storage bounds, not millisecond or heap-byte guarantees; caller-retained
snapshots, navigation graphs and external jobs are outside them.

Orders receive monotonically increasing safe-integer IDs. Replacement keeps an ID
and advances its generation. A controller never reuses an issued ID, including
after restoring an older snapshot. Exhausted counters refuse further affected work;
invalidation, cancellation and disposal remain available. Begin refuses new work
when revisions are exhausted. Recover by retiring the owner and creating a new one;
IDs are local to that owner, not globally unique or authentication credentials.

## Edits and attempts

`edit(expectedRevision, change)` applies one insert, replace or remove atomically.
`start(expectedRevision, id)` explicitly selects or restarts a task. Revision
conflicts return `stale`; order-count overflow returns `saturated`; counter overflow
returns `exhausted`; retired owners return `closed`. Invalid admitted data throws.
Rejected edits preserve data and current completion authority.

Insertion uses a zero-based slot in [0,length]. It does not auto-start an idle list.
Unrelated insertions/deletions preserve the active ID and its ticket. Successful
completion selects the next order in the *currently edited* list; newly inserted
orders before the active cursor are not revisited automatically. Reaching the end
sets the cursor to null. A creator may call `start` to loop or resume elsewhere.

Removing the active order requires `current: 'stop' | 'advance'`: stop clears the
cursor, while advance selects the removed order's following neighbor, or null at
the end. Both revoke its pending ticket. Replacing the active order also revokes
the attempt, retains its cursor and permits a new begin. Editing another order
does not invalidate active work merely because the list revision changed.

`begin()` admits at most one attempt and returns an immutable opaque ticket, or
null if no valid active work can begin. `check(ticket)` checks exact object identity
and current authority. `finish(ticket)` consumes that authority once and advances
the cursor. Copied, foreign, restored and replayed tickets cannot finish work.
Tickets are in-process handles; do not serialize or send them over the network.

The consumer must check validity before adopting async results or moving an actor.
`finish` authorizes controller advancement only: it is not a transaction across
storage, inventory or arbitrary callbacks. A creator must compose those owners'
existing acceptance mechanisms before granting durable effects. There is no callback
invoked by this controller and no automatic retry after external failure.

## Invalidation, cancellation and restore

The destination owner calls `invalidateDestination({id,generation})` when that exact
incarnation ceases to be usable. All matching orders become invalid and a matching
attempt is retired. A blocked cursor stays visible and `begin` refuses it until an
explicit replacement, deletion or start elsewhere. An invalidation for an old
incarnation does not block a replacement destination with a higher generation.
The controller does not maintain the world's identity registry or infer removals:
the host must deliver invalidations and verify accepted world identity at use time.

`cancel()` retires only the pending attempt, allowing a retry of the same active
order. `dispose()` permanently retires the controller and releases its order list.
Both are idempotent. The consumer must cancel/release its actual path search or
worker request too; ticket refusal cannot physically stop external work.

`snapshot()` returns detached immutable records, including schema version, cursor,
order generations, validity, next ID and revision. `restore(expectedRevision, data)`
validates the whole snapshot before committing; malformed, duplicate, missing-active,
sparse, executable-iterator, accessor and oversized records cannot replace current state. Restore advances local
revision beyond both old and supplied revisions and retires every pending attempt.
It never resurrects external jobs or imports tickets. Validate destination references
against the accepted world after loading and before starting work; persisted validity
is not proof that a destination still exists. This lab does not register a SaveStore
section or supply schema migrations. Unknown versions are refused without reset.

## Evidence and remaining work

Nineteen focused tests passed on this candidate, covering insertion slots before,
at and after the active cursor; neighbor/current deletion; capacity refusal without
mutation; revision conflicts; replacement; invalidation and destination reuse;
copied/foreign/replayed completions; cancellation/disposal; immutable and corrupted
snapshot handling; rollback ID monotonicity and revision exhaustion.

The patrol fixture uses the existing incremental path search with caller-issued
one-unit steps. A computed path does not count as arrival: the test observes no
position or observation change until a separate matching physical-arrival input.
Each search is bound to its exact attempt; an old completed route cannot authorize
a replacement task, and stale preparation cannot cancel the current search.
The delivery fixture exercises collect, deliver and service rules, refusal of an
impossible transfer, preserved carried quantity and rejection of duplicate effects.
Its finite counters are synthetic custody, not production inventory or save evidence.

Five additional public-kit tests cover plain-data command capture, reentrancy,
real SaveStore persistence, counter limits and terminal deletion (24 tests total).
Scoped strict TypeScript checking passed for the public kit and its TypeScript tests. Fixtures/tests run as
JavaScript under Node with tsx; they are not included in that TypeScript check. The
repository's existing `tools/**/*.test.mjs` test discovery includes this suite.
No full gate, browser, rendering, network authority, durable-effect transaction,
real collision/arrival adapter or physical-device timing acceptance was performed.
The public helper is a candidate on its own branch, not an integrated release.
The two fixtures remain headless; production movement and durable custody integration
need their own acceptance.
