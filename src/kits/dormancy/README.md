# kits/dormancy

Optional bounded decision of **which tracked entities are dormant**: not updated (and optionally reported hidden)
because they are outside every active zone and outside every camera-relative view volume, and which wake again. It
is a pure helper imported from `@kits/dormancy`: no system, clock, renderer, ECS access or registration is installed.
It composes with two existing owners instead of adding a second one:

- **Zones** are integer ids the creator assigns to whatever partitions the world: rooms of an interior, cells from a
  portal or visibility pass, or grid regions. Region indices from
  [region-activation](../region-activation/README.md) work directly (`activeRegions(out)` is the active zone list);
  authored room numbers (the current room plus the previous one during a transition) work the same way. Dormancy keeps
  no region registry, geometry or observer table of its own.
- **Update tiers** from [population](../population/README.md) stay the owner of how much time an entity is simulated
  with. `dormantAsFar(dormancy, position)` wraps the tiers' position callback so a dormant entity reads as far: a
  `near`-tier entity is frozen while dormant, a `background`-tier entity keeps its conserved round-robin slices, an
  `always`-tier entity ignores it. Dormancy adds a view/zone signal to tiers; it is not a second tier system.

```ts
import { createDormancy, dormantAsFar } from '@kits/dormancy';
const dormancy = createDormancy({ zones: regions.stats.regions, wakeMargin: 1, sleepMargin: 4, maxWakesPerStep: 16 });
dormancy.track(e, { policy: 'zone-or-view', zones: [regions.regionAt(x, z)], radius: 1.5, hide: true });
// First fixed-step system, after region activation has updated:
const n = regions.activeRegions(activeBuf);
const s = dormancy.step({
  activeZones: activeBuf.subarray(0, n),
  views: [{ x: cam.x, z: cam.z, yaw: cam.yaw, far: 60, halfWidth: 4, spread: 0.7, behind: 8 }],
  position: id => positionOf(id),
});
for (const id of s.slept) hide(id);                          // creator-owned presentation
for (let k = 0; k < s.woke.length; k++) show(s.woke[k], s.dormantSteps[k]);
tiers.step(dt, dormantAsFar(dormancy, positionOf), observers);
// Later systems: if (tiers.due(e) > 0) simulate(e, tiers.due(e));   or simply: if (!dormancy.isAwake(e)) continue;
```

| Contract | Definition |
|---|---|
| Creator-owned semantics | What a zone is and which zones are active, entity zone membership (update it with `setZones` when an entity crosses a doorway), the view volumes (camera pose, reach, width, spread, box behind, height band), margins, dwell, budgets, what dormancy means for an entity (skip its systems, freeze its tier time, hide it) and how a woken entity catches up (`dormantSteps`) |
| Policies | `always` (never dormant; a policy change to `always` wakes at the next step without spending the budget), `zone` (awake while any of its zones is active), `view` (awake while inside any view volume), `zone-or-view` (either; the position is read only when no zone keeps it) |
| View volume | Engine camera convention: a camera at (x, z) with `yaw` looks along −(sin yaw, cos yaw), as the camera kit's orbit pose and the character kit's rig yaw do (an orbit camera at yaw 0 sits on +z of its target and looks toward −z; pass the same yaw). Ahead: a plan-view frustum to `far` with half width `halfWidth + spread × forward distance`. Behind: a box of half width `halfWidth` to `behind`. With `y`, a height band `down`..`up` (entities without a height skip it). Forward and vertical margins are along the camera's axes; the lateral margin is multiplied by sqrt(1 + spread²) so radius and margins are at least their value perpendicular to a slanted side (conservative: the box behind widens by the same factor). Pitch is not modelled: pass a wide enough band |
| Hysteresis | A dormant entity wakes inside the volume grown by `wakeMargin + radius`; an awake one sleeps only outside the volume grown by `sleepMargin + radius` (`sleepMargin >= wakeMargin`). A queued entity is also judged against the sleep volume, so jitter at the wake edge neither sleeps an awake entity nor withdraws a queued one. After waking an entity stays awake at least `minAwakeSteps` (default 8); after sleeping it waits `minDormantSteps` (default 0) before it may queue. Both apply to zone changes too. Dwell starts satisfied at tracking |
| Inputs and outputs | `step({activeZones, views, position})` returns a frozen record: `woke` (queue order) with `dormantSteps` (steps dormant, `-1` if never awake), `slept` (track order), `deferred` (still queued), `withdrawn` (left the queue because they stopped wanting), `oldestWait`, `awake`, `dormant`, `status` (`complete` or `deferred`) and the step ordinal. Queries: `isAwake` (untracked ids are awake: dormancy never freezes unknown entities), `isHidden` (tracked with `hide` and dormant), `state` (`awake`, `dormant`, `queued`), `policy`, `stats` |
| Owner | The caller creates and drives it once per fixed step, before tier stepping and the systems it gates. It borrows no scheduler, clock or store |
| Bounds | `zones` 1..4,194,304 (default 256; one 4-byte generation stamp per zone, 16 MiB at the ceiling, is allocated at construction; the table is cleared when the generation wraps), `maxEntities` 1..65,536 (default 4,096; `track` returns `full`), `maxZonesPerEntity` 1..16 (default 4), `maxWakesPerStep` 1..maxEntities (default 32), `maxViews` 1..8 (default 2), margins and radius 0..1e6, dwell 0..10,000 steps, view extents within 1e7 and spread within 100. Work per step: O(active zones + tracked × (zones per entity + views)); the step allocates its result arrays and a copy of the entry list |
| Overload | Entities wanting to wake beyond `maxWakesPerStep` wait in one first-in-first-out queue (an entity's place is the step it qualified, ties in track order) and are reported as `deferred` with status `deferred`. Later arrivals queue behind, so a queued entity that keeps wanting wakes within `limits.maxWakeLatency = floor((maxEntities - 1) / maxWakesPerStep)` steps. The queue is not by distance or visibility. Sleeps are not budgeted. The bound holds while the entity keeps wanting; it restarts only on a real withdrawal (leaving the sleep volume or its zones). Exceptions that bypass the budget: `always` entities (including a policy change to `always`, woken at the next step) and `initial: 'awake'` tracking |
| Cancellation | An entity that stops wanting while queued is withdrawn (counted in `withdrawn`) and queues again at the back if it wants later. `untrack` removes a queued entity (counted in `stats().cancelled`). Synchronous only |
| Failure and recovery | Malformed limits, ids, policies, unknown zone ids (at `track`, `setZones` and in `activeZones`), too many zones per entity, sparse `views` arrays (holes), malformed `math`, degenerate views (`far <= 0`, `halfWidth` and `spread` both 0, `up + down = 0`, `up`/`down` without `y`, non-finite values) and malformed positions throw `RangeError` before any change. A throwing `position` callback leaves the state untouched (skip that step's gating; `isAwake` still holds the previous decision). The callback must not track, untrack, change or step (refused). State is transient: after a reload, track entities again and the first step decides (within the wake budget) |
| Determinism | Order depends only on track order, step inputs and the step count. No clock or randomness. View trigonometry uses `limits.math` (default `platformMath`); pass the engine's `dmath` for membership identical in every JavaScript engine, since platform `Math.sin`/`cos` may differ in the last bit near a boundary |
| Limits | No occlusion, portals or cell visibility (pass zones from the creator's portal or visibility pass); no Euclidean distance test (that is the tiers' radius); no pitch or true perspective frustum; no per-entity custom volume beyond `radius`; no rendering (hiding is a reported flag); no persistence. Headless evidence only: no browser, template or physical-device evidence |

## Evidence

`dormancy.test.ts` (14 tests): limit, option and input refusals; degenerate view volumes; forward frustum, box behind,
spread, yaw and height band membership; an oscillating camera at the boundary that flickers without hysteresis and
makes exactly one transition with a sleep margin (and bounded transitions with dwell alone); dwell timing; zone
transitions including a two-zone transition window and a doorway entity; `zone-or-view` reading positions only when
needed; a wake budget that defers in a stable order and drains, with identical events from a second instance;
cancellation by untracking and withdrawal; a 2,000-step churn run that never exceeds `maxWakeLatency`; a throwing
callback leaving state untouched; `always`, policy changes, `hide`, `initial` and `radius`. `consumers.test.ts`
(2 tests): real population update tiers fed through `dormantAsFar` (a `near`-tier entity frozen while dormant, a
`background`-tier entity keeping conserved time), and real region-activation regions as zones, including an edge
position keeping two regions active and a region pin keeping its entities awake.

Independent review of the first revision (2026-10-10) found: the view yaw was reversed relative to the engine
camera (an orbit camera's own target read as dormant); queued entities were judged against the wake margin, so
jitter at the wake edge withdrew and re-queued them at the back without bound; the radius was not conservative on a
slanted side; budget exceptions were undocumented; and smaller items (zone length read per iteration, sparse view
arrays accepted, 8-byte stamps, unqualified determinism with platform trigonometry). All were fixed; regression
tests cover the orbit pose from `@kits/camera` at five yaws, the edge-jitter starvation case (40 entities, budget 2),
the slanted-side radius, sparse views and `dmath`. The fix tests fail on the previous code. The zone stamp wrap
(after 2³² steps) is not exercised by a test.

Caveat repeated for `dormantAsFar`: a dormant `background`-tier entity still receives conserved round-robin slices;
for no update while dormant, use `near` tiers or check `isAwake`.
