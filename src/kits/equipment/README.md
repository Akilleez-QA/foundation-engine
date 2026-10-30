# Equipment

Unique instance IDs, definition IDs, arrangements and functional/cosmetic intent are separate. `preview` shows all items displaced by a multi-slot arrangement. `commit` rechecks the current revision and bag capacity, then changes all slots together or none. Stale UI commands cannot overwrite a newer arrangement. Saved snapshots validate duplicate instances, overlapping slots and custody capacity.

The kit operates over a bounded owned item set (4,096 items, 64 slots). It does not import material-stack inventory or imply network authority. Reconcile `active()` IDs into source-owned capability modifiers; cosmetics are excluded. An application must save custody and modifier source definitions in its own coherent section. World/container transfers and appearance rendering are separate adapters, not side effects hidden inside an equipment swap.

## Acquisition, release and projections

`acquire(item, expectedRevision)` admits a unique instance to the bag and returns
`applied`, `stale`, `duplicate`, `capacity` or `limit`. A duplicate ID never replaces
its definition or arrangement. `release(id, expectedRevision)` returns `applied`,
`stale`, `missing` or `equipped`: explicitly unequip before releasing. No operation
silently destroys a displaced selection. Successful mutations advance the revision;
old previews cannot commit after custody changes. Malformed inputs and exhausted
revisions throw before mutation. Mutation reentry from input getters is rejected;
arbitrary getter execution time is not bounded or sandboxed.

`equipped()` returns detached instances including cosmetics. `active()` still
excludes cosmetics. These are data projections: callers own visual attachment and
modifier reconciliation, and may choose either or neither. Mutating returned arrays,
instances or arrangements does not change custody.

Retained custody is limited to 4,096 instances, 64 configured slots and 64 slots per
arrangement. Instance, definition and configured slot identifiers are nonempty
strings of at most 256 UTF-16 code units. Oversized arrays are rejected before their
entries are read. Bag capacity is a creator-selected nonnegative safe integer.
These bounds constrain records and captured identifiers, not callback CPU time.
This introduces explicit identifier bounds for previously accepted longer names;
author-provided persisted states with longer identifiers require migration.

Released IDs may be reused. Revision checks protect this owner's current command
sequence; there are no retained tombstones, issuance generations, distributed
uniqueness, or network authority. Creators needing those properties can compose an
issuance policy above this owner. Snapshots restore custody; they do not themselves
persist it.

For a coupled conversion or delivery, reconstruct draft inventory and equipment
owners from one application envelope, apply both changes, then publish the envelope
only if both succeed. Include delivery receipts in that same envelope. Do not remove
from one live owner and add to another while claiming atomic transfer. The executable
`custody.test.ts` consumer exercises rejected publication, capacity rejection,
material-to-instance conversion, duplicate delivery, restoration and explicit release.
Its publication is an application-owned in-memory assignment, not proof of durable
storage rollback or atomic external effects. Use the existing save owner and its
failure/retry contract for actual persistence. No renderer or visible template behavior
changes are included in this extension.
