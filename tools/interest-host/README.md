# Interest-set reference host (SC-02)

Tools-only, in-process reference composition: one SC-01 spatial grid, SC-02 interest sets
and one NW-02 complete-view publisher per connection. No sockets, authentication or game
policy: the field projection, radii, budgets and identities in `demoConfig` are fixture
choices. A real host binds `send`/`ack` to its authenticated transport (see
[network views](../../docs/guides/network-views.md)).

- `npm run host:interest` prints a short transcript (one connection, one entity
  approaching).
- `node --import tsx --test tools/interest-host/host.test.mjs` checks the composition with
  real view receivers.

Disclosure discipline shown here: a view is marked dirty only when its membership or a
member changes; the frame's `worldRevision` is a per-connection counter; entities leaving
the grid rectangle are despawned. This hides outside activity only while scans are
complete: an `incomplete` scan (hidden entities crowding `maxCandidates`) makes unseen
members leave and so produces a frame. Size `maxCandidates` above the densest exit circle
and alert on `incomplete`. A session already connected is refused (`duplicate`) until it
disconnects; a refused publisher releases its observer slot. See the [interest sets guide](../../docs/guides/interest-sets.md).
