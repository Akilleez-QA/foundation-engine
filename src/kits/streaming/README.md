# kits/streaming

Optional **on-demand streaming queue** with byte and concurrency budgets, priorities, cancellation and retry. Systems
request keys (model assets, clip libraries, chunk records, sounds) with a priority and an estimated size; each
`pump(now, out)` from an ordinary system observes running loads, publishes completions in start order, requeues due
retries and starts the highest-priority keys that fit. Loads run through a **port** onto an existing owner (a lease
cache, the model library, the scene's model owner, a worker job); the frame never waits on them. It is a pure helper
imported from `@kits/streaming`: no system, loader, cache, worker or registration is installed.

```ts
import { createStreamQueue, createStreamResult, modelPort } from '@kits/streaming';
const limits = { maxEntries: 256, maxConcurrent: 2, maxBytes: 48 * 2 ** 20, maxStartsPerPump: 1, preempt: true };
// Stream model assets (and the animation clips they carry) through the scene's model owner:
const port = modelPort({
  world: ctx.world,
  components: asset => [Transform(), Model({ asset, visible: false, playing: false })],
  modelState: e => ctx.modelState(e),
  bytes: asset => estimatedBytes[asset],          // the model owner does not report bytes per asset to scenes
});
const stream = createStreamQueue(port, limits);
const out = createStreamResult(limits);
// In a fixed-step system: request what is near, re-rank as the player moves, cancel what is left behind.
const h = stream.request('clips.swim', { priority: -distance, bytes: 6 * 2 ** 20 }).handle;
stream.setPriority(h, -newDistance);
stream.pump(tick, out);                            // events: started, ready, retrying, failed, preempted
if (stream.state('clips.swim') === 'ready') useClipsFrom(stream.get('clips.swim'));
stream.cancel(h);                                  // last request: aborts the load or releases the value
```

| Contract | Definition |
|---|---|
| Creator-owned semantics | What a key is, its priority (distance, visibility, script need), its estimated bytes, the port that loads it, what to do while it is not ready (keep the bind pose, a placeholder, wait), and the budgets |
| Inputs | `maxEntries` 1..65,536 distinct keys; `maxRequests` (default 4 × entries); `maxRequestsPerKey` 1..4,096 (default 64); `maxConcurrent` 1..256 running loads; `maxBytes` (positive safe integer); `maxStartsPerPump` (default `maxConcurrent`); `maxAttempts` 1..16 (default 3); `retryTicks` and `maxRetryTicks` (defaults 30 and 600); `preempt` (default false). Requests: a key of 1..512 characters, a finite priority (higher first) and an estimate in bytes; `now` is the caller's nondecreasing integer tick |
| Outputs | Per key: `state` (`absent`, `queued`, `waiting`, `running`, `ready`, `failed`), `get` (the ready value), `error`. Per pump: a status (`idle`, `complete`, `blocked`, `budget`, `closed`) and events in the order they happened (outcomes of settled loads in start order: `ready`, `failed`, `retrying`, `requeued`; then `preempted` and `started` as the queue is served, so a preemption may follow a start) in a reusable result sized so no event is dropped. `stats()` counts entries, requests, phases, charged bytes, starts, completions, failures, retries, preemptions, cancellations, over-estimates, values requeued at their real size (`resized`), oversize refusals and release errors |
| Priority and order | Highest priority first, ties by first request. A key's priority is the highest of its live requests. A head that does not fit (slot or bytes) blocks the queue: lower priorities do not overtake it (no starvation of large items). With `preempt`, running loads of strictly lower priority are cancelled (lowest first, latest started first), but only as many as make the head fit once they and earlier cancelled loads settle, and none if even all of them would not; a preemption also needs a free table entry (the key's requests move to a fresh queued entry while the cancelled load retires). Preempted keys queue again without spending an attempt |
| Bytes | A running load charges its estimate (the largest estimate requested before it started); a ready value charges its actual bytes as the port reports them (for a lease cache, the cache's own residency measure). An actual size larger than the estimate is kept if it fits (`overEstimate`); if it does not fit beside what is held now it is released and the key queues again at its real size (`resized`, event `requeued`; the first requeue is free, later ones spend attempts); a value larger than `maxBytes` itself is released and fails without retry (`oversize`) |
| Owner | The caller drives `pump` from an existing system and owns the port. The queue holds requests and published values only; the existing owner (lease cache, model library, model owner, worker host) keeps loading, deduplication, warm residency and GPU upload |
| Cancellation | `cancel(handle)` ends one request; the last request of a queued key removes it, of a ready key releases its value through the port, of a running key aborts the load. A cancelled load keeps its slot and byte charge until the work reports that it settled; a value that still arrives is released, never published. What "settled" means is the port's: `promisePort` and `leasePort` settle when the promise settles, and a lease cache rejects an aborted acquisition at once while its own fetch may continue under the cache's admission; `modelPort` settles when it removes its entity, while the model owner retires its own load. Work an owner keeps running after rejecting delivery is bounded by that owner, not counted here. `dispose()` cancels every load and releases every value, once |
| Failure and recovery | A failed load (or a throwing `start` or `poll`) retries after `retryTicks × 2^(n-1)` ticks up to `maxAttempts`, unless the work says `retry: false` (aborts are final in `promisePort`). Malformed limits, keys, priorities, sizes, ticks and results throw before any change. Release errors are counted, not rethrown. The queue keeps no persistent state: after a reload, request again |
| Bounds | Entries, requests, running loads and per-pump starts are capped as above; a pump costs O(running + waiting + starts × log queued); `request`, `setPriority` and `cancel` cost O(log queued), plus a scan of the key's requests (at most `maxRequestsPerKey`) only when its last request at the highest priority goes down or away. `stats()` is O(entries). A failed `start` holds its slot until the next pump |
| Determinism | Order depends only on priorities, request order and the ticks at which the caller observes settlement. Loads settle on real I/O time, so which pump sees a completion is not replayable; drive simulation-visible decisions from the published events or states, not from wall time |
| Evidence | `queue.test.ts` (11 tests): validation; priority order and start-order publication; head-of-line byte blocking and reprioritising; shared requests, retiring slots and late-value release; deterministic backoff, attempt exhaustion and non-retryable errors; preemption and throwing starts; over-estimate, requeue at real size, oversize and disposal; preemption that cannot help and a full table (nothing cancelled); the per-key request cap with cancellation from the highest priority down, repeated requeues ending in failure, and cancellation inside `start`; a 4-seed × 4,000-tick randomised run (cancelled works stay pending until they settle, some releases throw, two seeds with a six-entry table) asserting the byte, concurrency and entry budgets every tick, that every produced value is released exactly once, and that a seed replays the same event log. `consumers.test.ts` (4 tests): a real `LeaseCache` behind `leasePort` (two at a time, cache byte measure, cancellation before start fetches nothing, warm residency makes a re-request a hit); a fixed-step system streaming model assets through `modelPort` with a simulated model owner state (nearest first, failure retry, byte blocking, release on leaving); `promisePort` releasing a value that resolves after cancellation and treating aborts as final; a throwing late release that cannot hold the slot |
| Limits | Animation clips stream as the model assets that carry them: the model owner has no separate clip-file loader, so clip-only files need a creator port (for example through `@kits/three`). `modelPort` charges creator estimates because scenes do not see per-asset bytes. No distance or visibility logic, no prefetch policy, no persistence, no network transport. Headless evidence only: no browser load timing, template consumer or physical-device acceptance |

## Measured cost (headless, not a device budget)

One local probe run (Node 26, desktop CPU; the probe script is not committed): about 6,000 keys, 8 concurrent loads,
20 priority changes, one request and about one cancel per tick: median 2.4 µs and p99 11 µs per `pump` over 3,000
ticks. Order-of-magnitude indication only.
