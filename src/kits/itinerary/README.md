# Editable destination itineraries

Optional pure helpers for a bounded order list whose active attempt survives edits
to its neighbors. Import `createItinerary` from `@kits/itinerary`; no registration,
system, scheduler, clock or global service is installed. The consuming scene/task
owns and disposes the controller. Creators choose order tags, destination identity,
integer-value meanings, arrival criteria, repetition, costs and recovery.

```ts
import { createItinerary } from '@kits/itinerary';

const route = createItinerary({ maxOrders: 16, maxTextLength: 64, tags: ['visit'] });
route.edit(0, {
  type: 'insert', index: 0,
  order: { tag: 'visit', destination: { id: 'lookout', generation: 2 }, value: 0 },
});
const order = route.snapshot().orders[0];
if (order) route.start(route.snapshot().revision, order.id);
const attempt = route.begin();
// Pass attempt to the caller's existing execution/arrival adapter.
// It checks route.check(attempt) before applying delayed results and calls
// route.finish(attempt) only after its own completion contract is satisfied.
// On owner retirement, also cancel/release the adapter's actual external work.
route.dispose();
```

The [full contract](../../../docs/guides/itinerary-lab.md) defines edit semantics,
revision/counter exhaustion, destination invalidation, snapshot schema and recovery.
Options and edits must be plain own-data records; arrays must be dense plain data.
Accessors, custom iterators, duplicate tags and unknown fields are rejected. These
checks are not a sandbox against arbitrary proxy traps or global prototype changes.

An admitted order has a stable owner-local ID and generation. Insertions before the
active cursor do not restart it. Removing the active order explicitly chooses stop
or advance. Active replacement, destination invalidation, cancel, restore and dispose
revoke the pending opaque ticket. Unrelated edits preserve it. Success advances to
the following order in the current list; completion at the end becomes idle. There
is no implicit loop. Snapshot validity must be rechecked against the current world
before execution; this helper is not the destination registry.

`maxOrders` bounds retained orders and tag count; `maxTextLength` bounds tag and
destination UTF-16 lengths. Numeric values and generations are nonnegative safe
integers. Each command scans/copies at most the admitted list; retained storage is
O(maxOrders × maxTextLength), with no history. Overload returns `saturated` without
mutation. Revision conflicts return `stale`; exhausted counters return `exhausted`;
disposed owners return `closed`. Malformed admitted input throws without publishing.
Cancellation/invalidation/disposal remain possible at counter exhaustion. No idle
work, draws or triangles; count bounds are not CPU deadlines or exact heap budgets.

Navigation still owns routes and movement adapters own physical arrival. Turns owns
command replay; objectives owns requirement/stage completion. This helper supplies
neither. Persist `snapshot()` in a creator-owned versioned SaveStore section, validate
it with a temporary controller's `restore`, and handle refusal without overwriting
stored bytes. Tags/domain definitions and migrations belong to that section. Restore
does not resume a worker, accept a foreign ticket or prove an external effect durable.

`finish` changes only this controller. It is not an atomic inventory/reward/save
transaction. Put coupled state in the existing owner's accepted envelope and use its
idempotency/commit mechanisms. Cancelling a ticket does not cancel its actual worker
or path request; the caller must do both. `cancel` permits retry; `dispose` permanently
retires the owner.

Evidence: 19 lab regressions now run through this public helper, including two
separate patrol and delivery/service consumers. Five public-kit tests add data-only
command admission, reentrancy refusal, a real SaveStore/fresh-store round trip,
counter limits and terminal deletion. Scoped strict typechecking covers this kit
and its TypeScript tests. Delivery custody is synthetic; the save test proves route
data persistence, not atomic delivery effects. No full gate, browser, collision,
network authority, sustained performance or physical-device acceptance is claimed.
