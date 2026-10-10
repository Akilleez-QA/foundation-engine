# Population: placements that remember and update tiers

The optional `population` kit (requires `spatial`) helps a world hold more authored
things than it should simulate at once.

**Placements.** Author where things are with `definePlacements`. Each fixed step,
`field.update(observers)` tells you which placements to create (an observer came
within the enter radius) and which to remove (every observer moved beyond the exit
radius). When play destroys one, call `field.destroyed(id)`: `never` keeps it gone
across saves (persist `field.snapshot()` in a `definePlacementSection` record),
`visit` keeps it gone for this field, and `leave` lets it return after the
observers have gone away and come back. Caps on spawns, despawns and live
placements defer work deterministically instead of growing a frame.

**Update tiers.** Track entities with a policy. Call `tiers.step` first in your fixed
lane, then simulate each entity with `tiers.due(entity)` seconds (skip it at 0).
Near entities run every step; far `near` entities freeze; far `background`
entities share round-robin slots and receive their accumulated time when their slot
comes up; a step with `dt × slots` above `maxCatchUp` is refused, so no time is dropped.

Both helpers are pure: your systems keep ownership of entities, simulation and
saves. See [the kit README](../../src/kits/population/README.md) for every bound,
overload and recovery rule.
