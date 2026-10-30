# Indexed geometry ownership transactions

An indexed mesh replacement now validates and builds through the existing scene
resource owner, then publishes geometry, source-array identities, revision,
vertex-color flags and dirty state before retiring the old geometry. A throwing
disposer cannot leave the old geometry installed or cause the next synchronization
to allocate the same replacement again. Nested replacements supersede the outer
transaction; runtime checks the slot, entity and visit before continuing writes.

Representation retirement removes map identity before Three removal callbacks and
captures resource identities before callbacks can replace them. Shared visit teardown
clears both representation maps first. The production cleanup helper attempts every
detachment and resource release, collecting failures in an AggregateError. It does
not replace the existing resource owner or change activity error policy.

Focused tests use real Three geometry, materials, removal/disposal events and the
production resource owner. Cases include invalid replacement, throwing old disposal,
nested replacement, teardown during disposal, replacement-slot preservation,
throwing removed/childremoved events and exactly-once cleanup after aggregate errors.

The prepared composed browser diagnostic runs with:

```sh
node -r ./scripts/silent-browser.cjs scripts/play/indexed-geometry-check.mjs playtest/indexed-geometry
```

It performs ten actual runtime mesh revisions, then intentionally throws from an
old-geometry disposal listener. The existing loop policy removes the failing ticker;
the diagnostic checks published replacement identity and subsequent route cleanup,
not resumed rendering after that failure. A fresh composition also disposes the real
app synchronously from old-geometry disposal, checking that all observed geometry
is released and no further scene draw occurs. This is framework evidence using an
instrumented Chromium fixture, not physical-device performance or game acceptance.
The composed indexed check passed: ten replacements retained one live indexed
geometry, the deliberate disposer failure left the replacement published, and route
cleanup released every observed geometry once. Synchronous app disposal inside the
swap produced zero late scene draws and released both observed geometries once.
The existing primitive-retention browser diagnostic also passed. Reports and
screenshots are generated under `playtest/indexed-geometry` and
`playtest/primitive-retention`; these are local evidence outputs.
