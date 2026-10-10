# Region activation

Choose `@kits/region-activation` when a world is larger than what the game should simulate at once and the creator
wants regions near observers to run while distant regions sleep. The [kit contract](../../src/kits/region-activation/README.md)
lists inputs, outputs, bounds, overload, cancellation and evidence. The helper is optional and installs nothing.

## Choose the existing owners

Region activation decides **whether** a region runs. It does not decide what a region contains or how it is stored:

- Simulation: run your own systems as usual, and skip entities whose region is not active
  (`isActive(regionAt(x, z))`). The kit never touches the ECS, so despawning, freezing or keeping entities is your
  choice.
- Content and saves: load a region's records from the [chunk store](../recipes/store-large-world-records.md) when it
  activates and write them when it deactivates. Capture `epochOf(region)` when a load starts and drop the result if
  the epoch changed or the region is no longer active. Order a region's load after its own pending save (keep the
  write's promise per region key and await it before reading), or a quick return can read the previous record.
- Catch-up: `dormantFor` is the number of updates since the region last deactivated. Apply a bounded creator rule
  (advance growth, decay or timers by whole periods) instead of replaying every missed step.
- Interest and replication: [interest sets](interest-sets.md) decide what each connection is sent; region activation
  decides what the host simulates. They are independent and can share observer positions.
- Terrain residency and rendering keep their own owners; region activation is not a streaming system.

## Choosing limits

`activateRadius <= releaseRadius` gives hysteresis so an observer moving along a border does not toggle regions every
step. `lingerUpdates` adds time hysteresis. Pins express keep-alive needs (they rank first but are subject to `maxActive`) such as a scripted event, a region another
system is working in, or always-on areas; release them when the need ends. Per-update budgets spread expensive
transitions (loading, spawning) over several updates; a `deferred` status is normal under motion, `saturated` means
`maxActive` is too small for your observers.

## Evidence and limits

Headless tests only: an independent brute-force model comparison, an ECS fixed-step consumer and a chunk-store
consumer. No browser, device or multiplayer acceptance. Regions are uniform 2D squares and distance is Euclidean;
portal or path distance, vertical layers and predictive preload belong to the creator's observer positions and pins.
