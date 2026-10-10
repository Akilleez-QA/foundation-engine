# kits/population

Two optional pure helpers for worlds with more authored things than should simulate at
once. Requires the `spatial` kit. No system, renderer, timer or persistence owner.
Guide: [population](../../../docs/guides/population.md).

## Placements that remember

```ts
import { createPlacementField, definePlacementSection, definePlacements } from '@kits/population';
const yard = definePlacements({ id: 'yard', placements: [
  { id: 'crate-1', x: 10, z: 4, kind: 'crate', respawn: 'never' }, // stays gone across saves
  { id: 'guard-1', x: 30, z: 8, kind: 'guard' },                   // 'leave' (default): returns after you go away
  { id: 'coin-1',  x: 12, z: 2, kind: 'coin', respawn: 'visit' },  // gone until this field is recreated
] });
const section = definePlacementSection('mygame.yard', yard);       // register in defineGame defs
const field = createPlacementField(yard, { enterRadius: 40 }, save.get().state);
// In a fixed-step system:
const u = field.update([{ x: player.x, z: player.z }]);
for (const id of u.despawn) remove(id);
for (const p of u.spawn) create(p);         // or field.returned(p.id) if it cannot be created now
// When play destroys one: field.destroyed(id); save.update(r => { r.state = field.snapshot(); });
```

| Contract | Definition |
|---|---|
| Inputs | Authored placements (1–65,536; unique ids; finite x/z within ±1e7; creator `kind`; `respawn` `never`/`visit`/`leave`). Field limits: `enterRadius`, `exitRadius` ≥ enter (default 1.25×), `maxLive` (default 256, max 4,096), `maxSpawnsPerUpdate` (16, max 1,024), `maxDespawnsPerUpdate` (64, max 4,096). Up to 8 observer positions per update. |
| Outputs | `update` returns frozen `spawn` placements and `despawn` ids in definition order plus a `deferred` count. `status`, `live`, `snapshot`. |
| Owner | The caller creates and removes entities and owns their state; the field only keeps placement status. Persistence borrows a save section (`definePlacementSection`). |
| Bounds and overload | Spawns beyond the per-update or live cap, and despawns beyond the per-update cap, wait and are counted in `deferred`; they are reconsidered next update in definition order (not by distance: a near placement can wait behind lower-index ones). Work per update: the grid entries in cells near observers plus live and waiting placements × observers. Cells are at least the enter radius and at least 1/2000 of the set's span, so one far outlier coarsens cells and a dense cluster is then scanned whole; the cell table can reach about 2,001² entries (≈16 MB) for a huge span with a tiny radius. An update with no observers despawns everything live and releases every waiting placement. |
| Persistence | Only `never` depletion is saved. A record for another or edited set (fingerprint), duplicates or ids that cannot be depleted are refused, so the store quarantines the record and nothing is depleted. Live placements are not saved: they spawn again by proximity after a load, and their own state is the creator's. |
| Cancellation and recovery | `returned(id)` puts a live placement back to dormant (failed creation, scripted removal); `revive(id)` undoes depletion (a reset); `dispose()` is terminal. |

## Update tiers

```ts
const tiers = createUpdateTiers({ nearRadius: 30, slots: 4 });
tiers.track(entity, 'background');                        // 'always' | 'near' | 'background'
// First fixed-step system: tiers.step(dt, id => positionOf(id), [observer]);
// Later systems: const t = tiers.due(e); if (t > 0) simulate(e, t);
```

| Contract | Definition |
|---|---|
| Semantics | `always`: every step. `near`: every step while an observer is within `nearRadius` (until `farRadius`, default 1.25×, at most 1e6), frozen otherwise and its far time is discarded. `background`: every step while near; while far, one of `slots` round-robin groups runs per step with the time it accumulated, so simulated time is conserved at 1/`slots` of the cost. Returning near delivers owed time with the step. A newly tracked entity has `due` 0 until the next `step`. |
| Bounds and overload | `maxTracked` (default 4,096, max 65,536): `track` returns `full`. A step with `dt × slots` above `maxCatchUp` (default 1 s, max 60) is refused, so no delivery exceeds that bound and no time is dropped. Slots are assigned to the least-populated group at track time. Work per step O(tracked × observers); headless, 65,536 tracked entities with 8 observers took about 3.5 ms per step on a desktop in independent review (not device evidence). |
| Failure | All positions are read before anything changes: a throwing or invalid `position` callback leaves the tiers untouched (skip simulating that step, since `due` still holds the previous step's values). The callback must not track or untrack. `untrack` discards owed time. |
| Determinism | Order and slot choice depend only on track order and step count. An untracked id gets the full step (`due` never freezes unknown entities). A null position counts as far. |
| Limits | Distance only: no frustum, room or portal visibility (pass observers you choose). No rebalancing of slots after untracking. Large delivered steps are the creator's to sub-step. Headless evidence only. |
