# Dependency preparation M2

Prospective oracle, recorded before source changes on public base c0e73c9:

1. Queue a zero-delay task before `prepare(4)` on 256 immediately resolving
   required nodes, concurrency one. The task must observe an unfinished owner and
   at least one but fewer than 256 acquisitions. A microtask-only chain fails.
2. Declare an unresolved optional node before a required node, concurrency one.
   The required acquisition must start without resolving the optional one.
3. Preserve explicit `pump` work counting, dependency order, cancellation and
   admission ownership through unsettled acquisitions. Test task-time cancellation.

CPU task evidence is not browser responsiveness acceptance. A later native fixture
must exercise the actual browser task queue. No GPU or device acceptance is claimed.
An arbitrary synchronous acquisition cannot be preempted by this mechanism.

## CPU result

`baseline-oracle.ts` ran before source edits: scheduled task observed all 256
acquisitions and completed preparation; an unresolved optional acquisition blocked
the required node. `baseline.txt` retains those failures. With the candidate,
`changed.txt` observes one acquisition and unfinished preparation, then required
before optional. These are real Node timer tasks, not simulated scheduler callbacks.

81 focused tests passed, including task-time abort, throwing scheduler cancellation,
critical diamond ordering, spare-capacity optional work and unchanged worker-host
ownership tests. `check.txt` passes type/layer/genericity/brief/budget checks and 29
affected test files. The initial test type-inference failure is retained separately.

The priority policy reserves one slot for pending critical work, rather than
idling all spare slots. One existing optional cleanup fixture now explicitly pumps
optional work after critical readiness; its disposal assertions remain intact.
Native browser interleaving, screenshots, full gates and downstream integration
remain pending. No broad performance, quality, or device acceptance is claimed.

## Prospective postTask comparison

The downstream native consumer measured 12.3 ms for three warm cooperative turns,
versus 0.1–0.2 ms without cooperation. Before changing the scheduler, predict that
feature-detected native `scheduler.postTask` keeps actual task interleaving and
owner cancellation while reducing timer-clamping overhead on supported browsers.
Retain the timer fallback and original measured result. Rejection must neither
hang nor leak; synchronous nonconforming adapters must not run the continuation
inline. The same actual consumer/native resources will be compared again.

Primary API reference inspected 2026-10-01:
https://wicg.github.io/scheduling-apis/ . PostTask schedules priority-based tasks
and accepts an AbortSignal; abortion rejects its returned promise. This is not a
render or presentation guarantee. Installed TypeScript lib.dom has no Scheduler
interface, so only the used structural signature will be declared locally.
