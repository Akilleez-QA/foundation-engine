# Streaming queue

Choose `@kits/streaming` when a scene should load content as the player approaches it rather than all at entry: model
assets and the animation clips they carry, area records, sounds. It ranks requests, limits how many loads run and how
many bytes they and their results hold, cancels what is no longer wanted and retries failures. The
[kit contract](../../src/kits/streaming/README.md) lists inputs, outputs, bounds, overload and evidence. The helper is
optional and installs nothing.

## Choose the existing owners

- Loading: a port puts the queue in front of an existing owner. `leasePort` adapts a lease acquisition (the texture
  and model libraries, `LeaseCache`), `promisePort` any cancellable promise (a worker-host job, a fetch), and
  `modelPort` the scene's model owner through hidden `Model` entities and `ctx.modelState`. Deduplication, warm
  residency, GPU upload and their byte accounting stay with that owner ([asset residency](asset-residency.md)).
- Preparation: what a scene needs before it activates belongs in its preparation (the dependency lease owner). The
  queue is for what can arrive during play.
- Time: pump from an ordinary system with your own tick counter. Backoff is in those ticks.
- Workers: the queue starts work; it never waits for it. Expensive decoding belongs in a worker job behind the port.

## Choosing limits

`maxConcurrent` bounds in-flight loads (bandwidth and decode contention), `maxBytes` bounds what loads and results
hold together, `maxStartsPerPump` spreads start-up cost. A `blocked` status means the highest-priority key waits for a
slot or bytes; cancel what is far away, or enable `preempt` so near content displaces far loads. Priorities are any
finite numbers: negative distance is a simple choice.

## Evidence and limits

Headless tests only: unit tests including a randomised budget and release-exactly-once run, a real lease-cache
consumer, a model-owner consumer with a simulated owner state, and a promise-port cancellation consumer. No browser
load timing, template consumer or device acceptance.
