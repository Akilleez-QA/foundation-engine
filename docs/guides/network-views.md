# Complete scoped network views

Foundation's optional network kit can publish one complete, creator-selected view
per authenticated connection and capture it on a receiver. Creators define which
entities and fields a peer may see, their meaning, and how to present them. The
kit does not choose a spatial policy, reflect ECS components, grant command
permissions, or require every game to use networking. A maintained replication
framework remains an alternative when its delta encoding, scheduling or other
facilities better fit the game.

See [network admission](network-admission.md) for authentication and command
ownership, and the [kit contract](../../src/kits/network/README.md#optional-complete-scoped-views)
for all method/result types. The [loopback reference](../../tools/replication-workbench/README.md)
composes these helpers with a separate native host and an ordinary Foundation
scene; its small numeric fields are fixture policy, not engine schema.

## Data, identity and bounds

A receiver is constructed with a trusted session issued for the current
authenticated connection. It does not learn its session from the first view.
Complete frames contain exactly:

```ts
{ v: 1, type: 'view', session, sequence, worldRevision,
  entities: [{ id, incarnation, fields }] }
```

An unavailable frame contains exactly
`{v:1,type:'view-unavailable',session,sequence,reason}`. `sequence` is a positive
safe integer ordering disclosure within that session. `worldRevision` is
nonnegative safe-integer metadata; a privacy change may advance sequence without
changing world revision. IDs are unique within the frame, and each incarnation
is a nonnegative safe integer. The creator owns incarnation allocation and
semantic validation of arbitrary JSON `fields`.

All five limits are explicit positive safe integers. `maxIdentityLength` may be
tightened but cannot exceed this protocol version's 256-code-unit ceiling. Other
protocols remain creator-selectable. The reference uses:

| Limit | Reference value | Applies to |
|---|---:|---|
| `maxBytes` | 65536 | Raw UTF-8 input and the entire outgoing envelope |
| `maxNodes` | 4096 | Parsed JSON values, including envelope values |
| `maxDepth` | 8 | JSON nesting, root at depth zero |
| `maxEntities` | 64 | Rows in a complete view |
| `maxIdentityLength` | 256 | Nonempty session, entity ID and unavailable reason, in UTF-16 code units |

Existing authored-document capture checks raw byte size before parsing, then
structure and finite numbers, and returns detached frozen values. An admitted
JSON parse still allocates before structural validation. Trusted project callbacks
are not CPU-preemptible or memory-sandboxed. These are application bounds, not
browser, operating-system or whole-network memory guarantees.

## Publisher: one credit and current disclosure

The publisher owns only one outstanding sequence/byte count and one dirty marker;
it retains no snapshot outbox. Drive `pump()` from the existing host scheduler.
Each call attempts at most one projection. A creator adapter can wire it as follows:

```ts
import { createViewPublisher, type ViewLimits } from '@kits/network';

function createConnectionView(session: string, limits: ViewLimits, port: {
  isCurrent(): boolean;
  projectJson(): string; // exactly {worldRevision, entities}
  sendText(json: string): boolean;
  close(reason: string): void;
}) {
  return createViewPublisher({ session, limits, ports: {
    current: () => port.isCurrent(),
    project: () => port.projectJson(),
    send: json => port.sendText(json),
    retire: reason => port.close(reason),
  } });
}
```

Bind these ports to the exact authenticated intake peer. Returning true from
`send` means transport admission only. `ack(session, sequence)` releases only the
exact outstanding credit; duplicate, wrong or stale credit grants nothing.
Acknowledgment routing must itself come from that same authenticated peer.

Call `markDirty()` for ordinary source changes. While credit is held, changes
coalesce; after release the next pump projects current state. Releasing credit
does not mark dirty automatically. `invalidateDisclosure()` is stronger: without
outstanding credit it demands fresh projection, and with credit held it retires
immediately. The reference closes that connection and requires fresh authentication.
It never queues further private views behind withheld credit.

A callback changing the generation during projection or authority checking
supersedes that attempt. Recursive pumping is refused. Credit is reserved before
calling `send`, so synchronous acknowledgment and cleanup cannot duplicate a send.
Authority loss, failed send and sequence exhaustion retire; state clears before
the cleanup callback. A projection/schema/size failure instead sends a small
`projection-failed` unavailable frame, consuming credit, if that control frame
fits. Otherwise it retires. Recovery requires returned credit and a fresh dirty
request. Bounds are never enlarged to accommodate failure.

## Receiver: replacement, failure and recovery

`createViewReceiver({session,limits})` exposes `receive`, `read`, `invalidate` and
`dispose`. Its states are waiting, ready, unavailable and terminal retired.
`read().view` exists only while ready. A newer complete frame replaces everything
in scope: omitted fields and entities do not retain earlier values.

Valid foreign sessions are ignored; lower sequences are obsolete. Equal current
sequence plus identical raw JSON is a duplicate; different serialized bytes at
that sequence retire, even when differing only in whitespace or property order.
The helper keeps no historical conflict archive. Malformed or overbound frames
retire and clear data without trusting their claimed sequence. An unavailable
frame advances the floor and clears data; a higher valid view can recover.

After local projection failure, call `invalidate` to clear active view and retained
raw JSON while preserving the floor. Equal-floor input is then obsolete, and only
a newer view can recover. `dispose` is terminal. Immutable snapshots previously
returned to callers cannot be recalled: do not retain private diagnostic copies
longer than the application needs them.

The receiver does not own rendering. A consumer should:

1. Validate field meaning and preflight its complete projection.
2. Replace its own ECS entities/components, removing omissions and retiring old
   local identities when incarnation changes or membership ends.
3. On partial failure, clear only replica-owned presentation and invalidate the
   receiver. Preserve unrelated local camera, terrain and game entities.
4. Return credit after synchronous logical adoption or the declared fail-clear
   boundary. Request a fresh projection explicitly when recovery is wanted.

The reference uses [a creator-side projection](../../tools/replication-workbench/projection.mjs)
with bounded rows, native `World` entities, and identity-qualified deferred work.
That is an example composition, not a new engine registry. It does not prove
arbitrary asynchronous model/asset pipelines are safe.

## Scene lifetime and actual presentation

The optional [activity hook](scene-activity.md) reports active/retired phase,
coverage and document visibility synchronously through existing lifecycle signals.
The reference retires networking and clears replicas on non-top coverage, hidden
document or scene retirement. This is its chosen policy, not a requirement that
every creator pause or disconnect covered scenes. Reentry needs a fresh receiver
and session; stale transport/presentation callbacks cannot inherit authority.

Clearing ECS objects does not erase previously drawn canvas pixels. The reference
conceals the canvas through suspension, reconnection and logical adoption. Its
`rendered(ctx)` hook reveals it only when current activity remains eligible and
the receiver is ready. The hook runs after a successful native renderer return,
not after a GPU fence or physical display update. Headless tests never fabricate
it. No additional animation loop or polling timer is needed.

An activity hook oscillating through eight notifications with further work pending
causes actual scene error retirement and one terminal notification. It does not
leave an eligible observer waiting for a future signal. This bounded error policy
is documented separately from normal creator-defined behavior.

## Evidence and current limits

Integrated NW-02 implementation history: pure owner commit `685a25f` passed 18 view
regressions plus 16 existing intake tests and targeted strict TypeScript checks.
Commit `762b418` adds constructor and 256/257 boundary coverage: all 19 view
tests pass. Lifecycle/render-hook commit `eaaaf2f` passed nine activity tests and the full
TypeScript check. Host socket tests and measurements are detailed in the reference
README; they are not browser-render or physical-device evidence.

The native two-client/separate-host workflow passed on clean committed revision
`f98eb2c`; `playtest/replication-workbench/report.json` records `workingTreeDirty:
false`, no page/console errors and five screenshots. Runner `534c11a` exercises
scoped disclosure, independent ECS checks, failure clearing and fresh-session
recovery. The earlier `eaaaf2f` dirty-tree exploratory pass remains historical
workflow evidence; the clean run supplies committed-head browser acceptance.
Evidence files are local generated artifacts, not required repository links.

The subsequent seven-template gate attempt failed during Arcade: npm test reported
1,960/1,961, with a file-level failure for `entity-inspection.test.ts` despite its
inner test passing. The standalone test and then the full source-suite TAP retry passed (1,960 tests,
zero failures/cancellations); the cause is not established.
The completed 18 performance checks passed, but the all-template gate did not.
The subsequent exact-head gate passed on `8121257`: all seven templates,
1,960 tests and 129 performance checks, with zero enforced breaches, regressions
or inconclusive results. Four software-GL heap advisories remain (two Mechanics,
two Terrain). NW-02 is now integrated on `main` by merge `ea48539` (work tracked in PR #122 in the private development history).
The rebased clean browser run passed at `508edd9`; final `47a7e6d` passed all seven
template gates with 1,965 tests and 129 performance checks, zero enforced breaches,
regressions or inconclusive results, and four advisory heap warnings. Combined
main tests (1,965) and build passed. Integration here is verified Git ancestry;
the GitHub PR API still reported OPEN immediately after push, so no PR-state
transition is asserted.

One-credit delivery may be round-trip limited. Complete views reproject and
reserialize unchanged state; measure peers, entities, change density, traversal,
bytes, encoding/adoption cost and slow-peer behavior at the intended scale.
Application credit withholding is not a physical TCP non-reading test. Already
disclosed information cannot be recalled from an untrusted peer. No durability,
prediction, delta replication, universal multiplayer scalability or physical-device
performance is claimed by this slice.


Rebase checkpoint: current input-resize integration `894fc52` is preserved. The
rebased candidate `508edd9` passed the native two-client/separate-host browser
workflow on a clean tree with no page or console errors. The rebased final
`47a7e6d` then passed all seven gates (1,965 tests, 129 performance checks, four
advisory heap warnings) before merge `ea48539`; combined main tests/build passed.
Earlier gate results remain tied to their original revisions. PR #122 in the private development history tracks the
integrated work; PR #121 was superseded without rewriting its published branch.
