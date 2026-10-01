# Resources, surveying and production

Optional kit, declared dependency `inventory`. No renderer or automatic world generation. It provides reproducible abundance fields, cancellable surveys, recipe property weighting, finite extraction and local factory accounting. Property names/units, spawn schedules, terrain geology, progression, UI and lesson policy belong to the game.

## Deposits and surveys

`defineDeposit({ id, revision, seed, cellSize, expiresTick, reserve, batch })` clones and freezes identity and material properties. `batch` uses the inventory kit's persistent material identity. The version-one `sampleDeposit(deposit,x,z)` field is seeded bilinear value noise on a bounded lattice. Abundance is in [0,1]; it is separate from finite remaining reserves, and collected batches retain their properties when a deposit expires. Changing the field/identity requires a revision and an explicit save migration. An abundance field alone is not a geological simulation or evidence of mineable subsurface geometry.

`createSurvey(deposit,{x,z,spacing,columns,rows})` snapshots its inputs. `step(maxPoints,currentRevision)` samples at most that many points and returns `{result,sampled}`. Status is `pending`, `complete`, `cancelled`, or `stale`. A changed revision cancels unpublished results; completed results include their deposit id/revision so consumers can recheck them before display. Grids allow 1–64 points per axis. Cancellation is idempotent. No worker or frame loop is created.

`recipeSuitability(properties,weights)` computes a weighted mean in authored property scales. Missing/nonfinite properties, negative weights and zero total weight are errors. There is no universal quality statistic.

## One coherent production owner

```ts
const model = createProduction({
  capacities: { hopper: 100, products: 100 },
  deposits: [deposit], recipes: [recipe], jobs: [harvester, factory],
  initialInventory: optionalValidatedInventorySnapshot,
}, optionalProductionSnapshot);
const result = model.apply({
  kind: 'advance', id: 'catchup-1', jobId: 'factory',
  toTick: 1000, maxTicks: 60, maxCycles: 4,
}, model.epoch);
const completeEnvelope = model.snapshot();
```

Each job has an explicit integer `startTick`, `periodTicks`, and power state. Tick units and the monotonic source of time are authored; the kit never reads wall-clock time. A harvester binds a deposit, world position and container. Its cycle duration is `ceil(periodTicks / abundance)`; zero abundance produces nothing. Every unit deposited reduces the finite reserve by one. Expired time does not count as extraction work. Full hoppers do not consume reserves or accumulate free future production.

A factory binds a recipe, input/output containers and a lifetime cycle limit. Recipe ingredients specify **exact batch IDs and quantities**. Outputs specify a material batch and units per cycle. Optional recipe suitability weights derive one named output property from the quantity-weighted ingredient suitability. Inputs, derived output properties, capacities, production progress and successful retry receipts change together in this owner. Reserved inputs are unavailable. Same-container recipes account for space freed by consumed ingredients. This is an authored material transformation, not a physical mass/energy model.

`advance` handles no more than `maxTicks` elapsed ticks and `maxCycles` cycles. `pending` explicitly reports remaining catchup; resume with a new command id. Insufficient stock, full output, reserve exhaustion or cycle limits pause useful production and discard blocked work. They cannot bank work to spend after supplies arrive. A successful command records its cursor even when no units were produced. Runtime limits: 64 jobs, 256 deposits, 256 recipes, 1,024 known batches; tick window at most 1,000,000 and cycle budget at most 1,024 per command.

`configure` is a piecewise boundary:

```ts
model.apply({ kind: 'configure', id: 'power-off-1', jobId: 'factory',
  atTick: 1000, powered: false, periodTicks: 10 }, model.epoch);
```

The cursor must already equal `atTick`. A speed change also requires zero partial-cycle progress; it cannot retrospectively reprice accumulated work. Settle previous segments first. Power changes preserve fractional-cycle progress but do not add work while off. Future spawning or power events must be supplied in their actual order by the game.

## Integration and persistence

`resourceProductionSystem({ model, options, nowTick, publish, maxTicks, maxCycles })` wraps a **scene-owned, already-prepared model** in an author frame system. It visits one job per frame, advances bounded work, and publishes one complete snapshot through an adapter. The adapter synchronously returns literal `true` only after accepting the full envelope; any other value (including a Promise) or exception is visible, and the next call retries the same pending envelope before doing more work. The adapter must tolerate repeated publication. Acceptance is the adapter's claim, not proof of durable storage; asynchronous adapters must track their own completion and return `true` only when it is known. Use a fresh model/system per scene owner; do not share one mutable model between scenes.

Connect `publish` to one existing engine save section that contains the **whole production snapshot**. Its parse function can use `createProduction(options, raw).snapshot()`. Saving inventory and machine progress in different sections loses the atomic boundary. Successful command IDs are idempotent: exact retries do nothing; changed payloads conflict. Ledger transaction IDs must also be unique against any initial inventory history; collisions fail without consuming reserves or progress. Version-two snapshots contain a checkpoint base and the current epoch’s successful command history, plus inventory, finite reserves and clocks; restore validates the base and replays the current history. Version-one snapshots require explicit migration. Compacted snapshots do not prove historical gameplay authorization before their checkpoint. Catalog/configuration mismatch is rejected rather than silently rerolling deposits. Persisting/acknowledging storage remains the existing save store's responsibility; in-memory atomicity is not proof of durable writes, cross-tab coordination or server authority.

`apply(command, epoch)` requires the current epoch; omission is only a compatibility shorthand for epoch zero. Exact retries are idempotent within that epoch. `checkpoint()` compacts inventory stock/reservations and material metadata together with machine cursors, partial cycles, counters and reserves, increments the epoch, and clears current retry receipts. Persist the complete returned `snapshot()` before accepting commands in the new epoch. Old epoch requests return `stale-epoch`, even when their IDs have been compacted away. A new epoch may reuse command IDs. The expedition consumer checkpoints each completed harvest/craft segment in the same save envelope as its stage.

`maxCommands` defaults to 256 (range 1–4,096). A full current history returns `checkpoint-required` without mutation. The frame helper never silently checkpoints: its owner must explicitly choose and persist that boundary. Material identities remain bounded at 1,024; zero-stock metadata is retained to prevent identity reuse. Checkpoint bases preserve active reservations. These boundaries permit long sessions with bounded current history without pretending forgotten requests are safe to replay.

Zero draws/triangles. Survey steps are O(points), field lookup O(1); production checks fixed recipe inputs and known batches, then delegates to inventory. Current history and compact stock are copied/replayed on transaction/restore, so work scales with the configured bounds rather than being constant-time. Networking, distributed transactions, active spawn rotation, per-cell reserve geometry, manual experimentation minigames and external asset factories are not implemented here.
