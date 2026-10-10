# Economy and production

Optional kit (`economy()`, no dependencies, no systems, no rendering). One owner per economy (a team, a player, a
colony) holds integer stock with storage caps, keyed income and upkeep, production queues with prerequisites, and
reclaimable pools, on the caller's fixed tick. The creator owns what items are, where completed items appear, how
reclaimers move and which buildings feed which sources; the kit owns the arithmetic, order and bounds.

It complements the resources kit, which models discrete material batches, exact recipes and deposits through the
inventory ledger. Use this kit for continuous flows (income per tick, build power, stalls); use resources for
identifiable items and recipes.

```ts
import {createEconomy, defineEconomyRules, economyPresets, RATE_ONE} from '@kits/economy';

const team = createEconomy(defineEconomyRules(economyPresets.flowEconomy));
team.setIncome('commander', {metal: 1000, energy: 20_000}); // per tick, 1,000 units = 1 displayed unit
team.setQueue('yard-1');                                     // rate 1,000 = normal speed; 0 = paused
team.enqueue('yard-1', 'light-unit', {count: 5, repeat: true});
team.addPool('wreck-17', {amounts: {metal: 120_000}, work: 300, decayTicks: 3600});
team.setReclaimer('builder-4', 'wreck-17', RATE_ONE);

// In a fixed system, once per tick:
const {reports, events} = team.advance(1);
for (const e of events) if (e.kind === 'completed') spawn(e.item, e.queue);
```

## Rules

`defineEconomyRules({resources, items, costModel?, refundPercent?})`: 1–16 resources with base `capacity` and
`initial` stock; up to 1,024 items with a `cost`, `work` (ticks at rate 1,000), `requires` (unlock ids that must be
above zero when the item starts) and `grants` (unlock ids incremented on completion). Amounts are integers up to
10^12 in a unit the creator chooses. `costModel`:

- `upfront` (default): a queue head waits (`waiting`) until the whole cost is in stock, pays it, then builds.
- `streamed`: cost is drawn as work progresses (paid = ⌊cost × progress / total⌋, so the total is exact at
  completion). When stock cannot cover every builder's demand this tick, the scarcest resource sets one fraction
  and every active queue progresses by that fraction (equal slowdown, no starvation by queue order).

`refundPercent` (default 100) applies to the paid cost of cancelled started work.

## The owner

- Stock: `stock()`, `capacity()`, `deposit(amounts)` (returns what did not fit), `withdraw(amounts)` (all or
  nothing). `setIncome(key, perTick)` (negative = upkeep), `setStorage(key, extra)`, `removeSource(key)`.
- Queues: `setQueue(id, rate)` creates or re-rates (pause keeps progress), `enqueue(id, item, {count, repeat})`,
  `cancel(id, index)`, `removeQueue(id)` (cancels every entry), `queue(id)`/`queues()` views with state `idle`,
  `blocked` (prerequisite missing at start), `waiting` (upfront stock missing), `building` or `paused`.
- Prerequisites: `canBuild(item)`, `unlocks()`, `adjustUnlock(id, delta)` (a granting building was destroyed).
  Prerequisites are checked when an entry starts; started work is not interrupted by a lost unlock.
- Reclaim: `addPool(id, {amounts, work, decayTicks?})`, `removePool(id)`, `pools()`, `setReclaimer(id, pool | null,
  rate)`. Extraction is proportional to work done and stops at free storage (it waits, it is not lost). An exhausted
  or decayed pool releases its reclaimers (events).
- `advance(ticks)` (≤ `maxAdvance`, default 600) runs, per tick: income and upkeep (net per resource, clamped to
  [0, capacity]; overflow reported as `wasted`, unpaid upkeep as `shortfall`), reclaim in reclaimer id order, pool
  decay, then production in queue id order. It returns one report per tick (`income`, `wasted`, `shortfall`,
  `spent`, `reclaimed`) and the events (`started`, `completed`, `cancelled`, `pool-exhausted`, `pool-decayed`,
  `reclaimer-released`). A queue completes at most one entry per tick; excess progress is not banked.
- `snapshot()` / `restore(raw)`: plain data with the rules signature; restore checks every field, that paid amounts
  match progress exactly, that pools' extraction matches their work and that reclaimers name live pools.

## Bounds, overload and failure

Defaults (maximums): 64 queues (1,024), 32 entries per queue (256), 1,024 sources (16,384), 1,024 pools and
reclaimers (16,384), 256 unlock ids (4,096), 600 ticks per advance (3,600). Per tick the work is O(resources ×
sources + reclaimers × resources + queues × resources) plus sorting keys. Overload is explicit: `false` from
`setQueue`, `enqueue`, `addPool`, `setReclaimer` and `setIncome`/`setStorage`; refused withdrawals change nothing.
Every mutation runs on a copy and publishes only when it completes; a throw (invalid input, unlock capacity during
`advance`) leaves the economy unchanged. Payments use exact integer (BigInt) arithmetic.

## Limitations

No spatial model: reclaim range, builder assistance and where items appear are the game's. One economy per owner;
shared team pools or trades between economies are two calls the game makes. Fractional resources need a chosen
integer unit. Evidence is headless tests; no game, browser or device acceptance is claimed.
