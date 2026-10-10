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
| Bounds and overload | Spawns beyond the per-update or live cap, and despawns beyond the per-update cap, wait and are counted in `deferred`; they are reconsidered next update in definition order. Work per update: grid cells near observers plus live and waiting placements × observers. |
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
| Semantics | `always`: every step. `near`: every step while an observer is within `nearRadius` (until `farRadius`, default 1.25×), frozen otherwise and its far time is discarded. `background`: every step while near; while far, one of `slots` round-robin groups runs per step with the time it accumulated, so simulated time is conserved at 1/`slots` of the cost. Returning near delivers owed time at once. |
| Bounds and overload | `maxTracked` (default 4,096, max 65,536): `track` returns `full`. Catch-up per delivery is capped by `maxCatchUp` (default 1 s, max 60); discarded seconds are reported in `stats().droppedSeconds`. Slots are assigned to the least-populated group at track time. Work per step O(tracked × observers). |
| Determinism | Order and slot choice depend only on track order and step count. An untracked id gets the full step (`due` never freezes unknown entities). A null position counts as far. |
| Limits | Distance only: no frustum, room or portal visibility (pass observers you choose). No rebalancing of slots after untracking. Large delivered steps are the creator's to sub-step. Headless evidence only. |
