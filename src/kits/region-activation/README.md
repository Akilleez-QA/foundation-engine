# kits/region-activation

Optional bounded decision of **which regions of a large world are simulated**. A uniform grid of rectangular
regions covers the creator's plane; observers (players, cameras, sensors) wake dormant regions near them and keep
active regions alive while they stay within a wider release radius. An unkept region lingers for a configured number
of updates (an observer returning cancels the release), then becomes dormant. Pins keep chosen regions active
regardless of observers. It is a pure helper imported from `@kits/region-activation`: no system, clock, loader,
save data, ECS access or registration is installed.

```ts
import { createRegionActivation, createRegionUpdateResult } from '@kits/region-activation';
const limits = {
  cellSize: 64, minX: 0, minY: 0, maxX: 4096, maxY: 4096, maxRegions: 4096,
  activateRadius: 96, releaseRadius: 160, lingerUpdates: 30,
  maxObservers: 16, maxActive: 512, maxPins: 8,
  maxActivationsPerUpdate: 4, maxDeactivationsPerUpdate: 4, maxCellsPerObserver: 49,
};
const regions = createRegionActivation(limits);
const out = createRegionUpdateResult(limits);          // reusable; overwritten by each update
regions.addObserver(playerEntity, x, z);
// In an ordinary scene system, before the systems that simulate regions:
regions.moveObserver(playerEntity, x, z);
regions.update(out);
for (let k = 0; k < out.activatedCount; k++) wake(out.activated[k], out.dormantFor[k], regions.epochOf(out.activated[k]));
for (let k = 0; k < out.deactivatedCount; k++) sleep(out.deactivated[k]);
// Simulation systems skip entities whose region is not active:
if (!regions.isActive(regions.regionAt(pos.x, pos.z))) continue;
```

| Contract | Definition |
|---|---|
| Creator-owned semantics | Plane and units, region size, radii, linger, what an observer or pin is, what a region simulates, what a transition loads, saves or spawns, how a waking region catches up its dormant time, and when to update |
| Inputs and outputs | Observer ids are nonnegative safe integers with finite positions (off-grid positions are allowed and wake only overlapping regions). `update(out)` writes activated region indices (pins first, then nearest observer distance, ties by ascending index) with `dormantFor` (updates since that region last deactivated, `-1` if never active), deactivated indices (ascending), deferred counts, the update ordinal and a status. Queries: `regionAt`, `regionIndex`, `stateOf` (`dormant`, `active`, `lingering`), `isActive` (active or lingering), `epochOf` |
| Owner | The caller creates, drives and disposes it, normally from a scene system before the systems it gates. It borrows no scheduler, clock, worker or store |
| Bounds | All per-region tables, the active list, candidate scratch and selection buffers are allocated at construction from `columns x rows <= maxRegions` (ceiling 4,194,304), `maxObservers` (65,536), `maxActive`, `maxPins` (1,048,576) and the per-update budgets. Construction refuses a `releaseRadius` whose worst-case scan exceeds `maxCellsPerObserver` (65,536). An update visits each observer's release square, the live pins and the active list; selection is bounded insertion. A steady-state update allocates nothing; `pin` allocates its handle |
| Overload | More wanted activations than `maxActivationsPerUpdate`: the nearest are applied, the rest reported as `deferredActivations` with status `deferred` and reconsidered next update. No room under `maxActive`: status `saturated`. Due deactivations beyond `maxDeactivationsPerUpdate` stay active and lingering (`deferredDeactivations`). Full observer or pin tables: `saturated`. Nothing grows, queues or retries on its own |
| Cancellation and replacement | Synchronous only. An observer returning within `releaseRadius` before the linger expires cancels the release without any event. `epochOf(region)` advances on every activation and deactivation: compare it after asynchronous work (a chunk load, a worker job) to refuse a result for a superseded activation. `removeObserver` and `unpin` release keep-alive at the next update. `dispose()` is terminal and idempotent; later calls report `closed` and queries report dormant |
| Failure and recovery | Malformed limits, ids, coordinates, regions or result records throw before any change. Every refusal leaves state unchanged. State is transient and derived: after a reload, register observers and pins again; the first update re-activates what they need (`dormantFor -1`). Persist region content and the creator's own last-simulated time through the existing save owners (`chunk-store` for region records) |
| Evidence | `activation.test.ts` (8 tests): limit and input refusals, inclusive grid addressing, activation/linger/dormancy, returning-observer cancellation, `dormantFor`, pins outranking observers, budget deferral ordering, `maxActive` saturation, bounded tables, disposal, and a 3,000-step randomised comparison with an independent brute-force model including off-grid observers, exact edges, pins and budgets. `consumers.test.ts` (2 tests): a `World` + fixed-step runner consumer that ticks only creatures in active regions and applies a creator catch-up rule on wake; a `chunk-store` consumer that loads on activation, saves on deactivation and refuses a load that resolves after its region slept (epoch) |
| Limits | 2D only, uniform square regions, Euclidean distance from an observer point to a region rectangle. No visibility, portals, path distance or vertical layers (compose those in the creator's observer positions or pins). No per-entity activity, no predictive preload, no timing budget in milliseconds, no persistence, no worker offload, no network authority. Measured headless cost is not a device budget; no browser or physical-device evidence |

## Measured cost (headless, not a device budget)

One local run (Node 26, desktop CPU): 100 x 100 regions of 64 units, 64 observers random-walking, release radius
160, linger 20, budgets 16/16, about 1,450 active regions: median 0.017 ms and p99 0.063 ms per `update` over 2,000
updates. This is an indication of order of magnitude only.
