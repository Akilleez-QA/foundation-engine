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

A downstream consumer outside this repository (not published, so not reproducible
here) measured 12.3 ms for three warm cooperative turns, versus 0.1–0.2 ms without
cooperation. That figure is context for the prediction below, not Foundation evidence. Before changing the scheduler, predict that
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

## Public native task oracle follow-up

The native fixture now uses a bounded 0.25ms acquisition workload over 256 nodes so a prequeued timer becomes eligible during preparation. Different browser task sources do not promise FIFO ordering; an otherwise empty short native-priority task chain can complete before a clamped timer becomes eligible. The sustained oracle requires the timer to observe a nonzero strict subset, unfinished. Run `node -r ./scripts/silent-browser.cjs scripts/play/dependency-preparation-check.mjs`; it retains revision, result and failures. No graphics context, application data or external source content is used. Exact-head native/gate evidence follows separately. Upstream fetched and reconciled at c0e73c9; no rebase changes were necessary.

## Public submission checkpoint `3361a43`

Rebased onto public `main` `9585f3f` and stacked on the program preparation
branch (both append to the same status records; there is no source overlap). The
review added only the label on the unpublished downstream measurement above.

Native task oracle on exact head `3361a43f3562b553996ff4b763c0cb71439d3400`,
isolated muted Chromium via `scripts/play/dependency-preparation-check.mjs`:
PASS, the prequeued timer observed 1 of 256 acquisitions with preparation
unfinished; all 256 then completed. See [report](native-oracle-3361a43.json).

On the same head with Node 22: `npm run check` PASS; `npm test` 2,060 tests,
0 failures; `npm run lint` PASS; `npm run gate:templates` PASS for all seven
templates (arcade 43 s, blank 38 s, expedition 57 s, explorer 55 s, learn 38 s,
mechanics 40 s, terrain 43 s): 129 software-GL performance checks, zero over
budget, regressions or inconclusive results, and the same four advisory heap
warnings as the base. Budgets unchanged. No stock template scene creates a dependency
closure, so for that path the gate is a regression check, not a responsiveness
measurement; worker-runtime checkpoints now default to the same task seam. Downstream comparison, frame-time and
physical-device acceptance remain unverified.

Revision map: `3361a43` (named above) was measured before later rebases and is not
published. This branch's own files (task seam, dependency lease, worker runtime,
oracle) are identical in published `b075a9a`; the base additionally gained the
program-preparation CI fix `17391f3`. Results at the final head are recorded below.
