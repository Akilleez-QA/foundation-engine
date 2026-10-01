# Optional connection and command intake

`createNetworkIntake` is a creator-owned, transport-neutral helper. It installs no
network service, socket, timer, simulation loop, authentication provider or game
policy. Construct it explicitly, supply ports and finite limits, drive it with
monotonic host time, and dispose it with its host owner. It is suitable for an
adapter around a maintained transport or server framework; it requires neither.

This intake supplies bounded connection/authentication/command admission; it does
not itself supply replication, prediction, persistence, matchmaking or identity.
A dispatched command is not evidence of a durable consequence. A sent message is
only transport admission, never remote receipt or an application acknowledgment.

For the composition and runnable consumer, see the
[network admission guide](../../../docs/guides/network-admission.md).

## Inputs and owner

```ts
import { createNetworkIntake } from './index';

const intake = createNetworkIntake({
  limits: {
    maxConnections: 8, maxPendingAuth: 4, maxPreAuthMessages: 2,
    authTimeoutMs: 5000,
    maxQueuedMessagesPerPeer: 16, maxQueuedBytesPerPeer: 16384,
    maxQueuedMessages: 64, maxQueuedBytes: 65536,
    maxPumpOperations: 8,
    message: { maxBytes: 4096, maxNodes: 256, maxDepth: 8 },
    principal: { maxBytes: 1024, maxNodes: 64, maxDepth: 4 },
  },
  ports: {
    authenticate: ({ credential, complete }) => {
      // Creator verifier eventually calls complete(boundedPrincipalJson),
      // or complete(null). The adapter must handle its own async errors.
    },
    authorize: ({ principal, command }) => false, // Creator's CURRENT policy.
    dispatch: ({ peer, principal, command }) => {},
    send: (peer, json) => false, // Replace with bounded transport admission.
    close: (peer, reason) => {}, // Release transport/listeners for this handle.
  },
});
```

These example values are configuration, not required game limits. Every numeric
limit must be a positive safe integer. `message` bounds credentials, commands and
outbound JSON; `principal` bounds verifier results. Limits and port functions are
captured at construction. Ports are trusted code, not a CPU sandbox.

`open(now)` returns `{status: 'opened', peer}` or a refusal. A peer is an opaque
object recognized only by that exact owner. Opening creates a pre-authentication
connection, not an identity. Labels, local ECS IDs and wire IDs are creator data;
reusing any label does not reuse a peer handle.

`authenticate(peer, credentialJson, now)` starts at most one verifier attempt for
that connection. The verifier receives detached, frozen data and an exact-attempt
`complete(principalJson | null)` function. Completion after timeout, close, revoke,
dispose or an earlier completion cannot publish identity. Completion with invalid
JSON closes the connection. `started` reports verifier invocation, not successful
authentication; inspect `read(peer).state`. An immediate rejection can already have
closed the peer when `authenticate` returns.

The verifier owns any external request/Promise and its cancellation. The helper
invalidates late completion and releases its own reservation, but cannot cancel
an arbitrary verifier's I/O or release data retained by the verifier itself.

## Command capture and current permission

`receive(peer, commandJson, now)` admits only active connections. JSON text is
checked for UTF-16 length and UTF-8 bytes **before** parsing, then node/depth and
finite-number limits are checked using the existing authored-document capture.
Ordinary JSON parsing allocates within the admitted byte bound before the
structural check. Captured facts are detached and recursively frozen. The creator
still owns schema/version validation, principal interpretation and command rules.

`pump(now, budget?)` attempts at most `budget` commands, capped by
`maxPumpOperations`. Zero budget expires authentication without dispatching.
An authorization refusal consumes one command and one attempt. Each attempt
rechecks `authorize` against the captured principal and current creator policy;
only literal `true` permits dispatch. Revoking or closing during authorization
prevents dispatch even if the callback returns true. Changed permissions need not
wait for an old receive-time decision. The creator can reject with a bounded reply
from inside `authorize`, then return false.

Drain order is round-robin across live connections, one queued command per turn.
The cursor survives peer removal/insertion, so replacing a flooding peer does not
move it ahead of a waiting peer. Empty peers are scanned only within the configured
connection bound. A pump with a positive budget and a fixed set of queued peers
serves each within at most that many attempted commands. This is work-count
fairness; callback execution time is not preemptible.

`dispatch` is synchronous creator code. It may hand off to a separately bounded
operation owner, but this kit makes no guarantee about that owner's acceptance,
cancellation or durable outcome. Exceptions close the affected peer and consume
the attempted command. The helper does not roll back callback side effects.

## Bounds, overload and output

Connections, pending verifier attempts, pre-auth traffic, per-peer/global queued
command count and UTF-8 bytes are bounded independently. Queue capacity refusal
keeps the connection and existing queue intact; retry is a creator protocol choice.
Malformed/oversized/deep data closes the affected peer. Pre-auth receive attempts
and repeated authentication requests share `maxPreAuthMessages`; crossing it
closes the peer. Authentication-capacity refusal does not silently queue a verifier.

`send(peer, json)` validates bounded JSON and invokes the transport port immediately;
there is no library outbox. It is allowed inside authorization/dispatch so replies
need no unbounded deferred queue. Recursive send from the send port is refused.
A false/throwing port retires the peer; a port that closes the peer cannot return
an apparently successful send. Port admission must separately check transport
buffering. Browser/network buffers are outside this helper's retained-memory
bounds; an application queue bound is not inbound browser backpressure.

The library does not rate-limit bytes/messages per second. The reference adapter
must independently limit traffic before repeatedly calling admission. Queued data
bounds are not authentication-provider capacity guarantees or total process heap
bounds. Trusted projection/domain callbacks and remote I/O are not timed here.

## Time, reentry and cleanup

Time is caller supplied, finite, nonnegative and nondecreasing across methods;
invalid time or pump configuration throws before work. No wall clock is consulted.
Authentication timeout starts at `open`, includes pre-auth waiting, and is not
extended by traffic. `pump(now)` expires pre-auth/pending connections even with no
new traffic. Active-session idle timeout, if desired, belongs to the transport
host policy. Deferred completion uses the last supplied host time: the caller must
keep driving time even when simulation is paused or a browser is hidden.

While a port executes, recursive open/authenticate/receive/pump calls return busy.
Read, stats, close, revoke and dispose remain available; bounded sends remain
available except nested sends. Retirement removes membership, clears queue/principal,
and releases authentication capacity **before** invoking `close`. Close callback
exceptions cannot strand reservations or revive identity. It is called once per
peer. `dispose` is idempotent and rejects further admission.

`read(peer)` returns a frozen detached state record, including frozen principal
facts and queue counts; unknown/foreign handles return null. Closed handles report
closed without retaining credentials or queued commands. `stats` reports current
owner counts. Neither inspection advances time or dispatches work.

## Evidence and limits

Focused tests cover opaque identity; detached facts; current authorization;
late/duplicate authentication; idle timeout; independent quotas; malformed,
multibyte, deep and nonfinite JSON; byte/count release; fair drain under churn;
revoke during authorization; callback reentry; send refusal; cleanup exceptions;
and owner disposal. These unit tests do not certify native transport integration,
Internet security, physical devices, multiplayer scale or durable state. Separate
reference-host/browser acceptance and integration gates are required for those
claims, with scope stated explicitly.

## Optional complete scoped views

`createViewReceiver` and `createViewPublisher` exchange creator-projected JSON;
no socket, ECS reflection, spatial index, persistence owner or simulation loop is
constructed. Creators choose disclosure and field meaning, and may replace these
helpers with a maintained replication adapter. Command authorization remains a
separate intake policy. A visible entity does not grant permission to mutate it.

Both constructors take a trusted, nonempty `session` and explicit `ViewLimits`:
`maxBytes`, `maxNodes`, `maxDepth`, `maxEntities`, `maxIdentityLength`, all positive
safe integers. Limits are captured. The reference uses 65536 bytes, 4096 JSON nodes,
depth 8, 64 entities and 256 UTF-16 code units per identity. The full wire envelope
counts toward the bounds. Existing authored-document decoding checks raw UTF-8
bytes before parsing, then bounded JSON structure and finite numbers. Parsing an
admitted string still allocates before structural checks. Creator callbacks are
trusted and cannot be preempted or memory-limited by this helper.

A complete frame has exactly these keys:

```ts
{ v: 1, type: 'view', session, sequence, worldRevision,
  entities: [{ id, incarnation, fields }] }
```

`sequence` is a positive safe integer ordering disclosure for this session;
`worldRevision` is nonnegative safe-integer metadata and does not order views.
Each entity has exactly `id`, nonnegative safe-integer `incarnation`, and arbitrary
JSON `fields`. IDs are nonempty, bounded and unique within the complete view.
Creators allocate incarnations and validate semantic field requirements. The
helper does not establish global uniqueness or persistent identity.

An unavailable frame has exactly
`{v:1,type:'view-unavailable',session,sequence,reason}`; `reason` is a nonempty
string bounded by `maxIdentityLength`. Missing entities and fields in a newer
complete view are absent, not patches retaining old data. A consumer must apply
that rule to its own ECS/render projection too.

### Receiver ownership and recovery

`createViewReceiver({session,limits})` exposes `receive(json)`, `read()`,
`invalidate(reason?)` and `dispose()`. `read()` returns immutable
`{state,session,sequence,view,reason}`. States are `waiting`, `ready`, `unavailable`
and terminal `retired`; only `ready` contains a view. It owns one captured complete
frame plus its raw JSON for current-frame duplicate comparison; read performs no
network work. Caller-retained old immutable values cannot be recalled.

- A valid foreign-session frame is ignored. The constructor never learns session
  authority from a message. Guard old transport callbacks independently.
- Lower sequences are obsolete. Equal current sequence and identical raw bytes
  are duplicates. Different bytes at that sequence retire and clear the receiver,
  including whitespace/property-order differences. This is strict wire identity,
  not canonical semantic equality. Older bytes are not retained for comparison.
- Malformed/overbound/schema-invalid input retires and clears without trusting its
  sequence. A trusted unavailable frame advances the ordering floor and clears
  data; a newer view can recover.
- Local `invalidate` clears both active frame and retained JSON, keeps the floor,
  and permits recovery only with a newer frame. Equal-floor valid input is then
  obsolete because no current bytes remain to compare. `dispose` is terminal.

`receive` reports `accepted`, `unavailable`, `duplicate`, `obsolete`, `foreign` or
`retired`. It does not modify ECS entities. The consumer preflights its semantic
projection, replaces owned entities/fields synchronously, and returns credit only
after adoption. If projection fails, clear replica-owned presentation and call
`invalidate` before returning credit and requesting a fresh projection. Clearing
one receiver cannot make a remote observer forget already disclosed information.

### Publisher ownership and transport composition

`createViewPublisher({session,limits,ports})` takes synchronous injected ports:

- `current(): boolean`: current authority for this exact connection/session.
- `project(): string`: JSON with exactly `{worldRevision,entities}`.
- `send(json): boolean`: transport admission, not acknowledgment of adoption.
- `retire(reason): void`: caller closes the associated transport/intake peer.

It exposes `pump()`, `markDirty()`, `invalidateDisclosure()`,
`ack(session,sequence)`, `read()` and `dispose()`. Initial state is active and dirty
with sequence zero. One pump performs at most one projection attempt. `pump`
reports `sent` (with sequence), `waiting`, `idle`, `superseded`, `busy` or `retired`.
`read` reports state, session, last issued sequence, `{sequence,bytes}` outstanding
credit or null, dirty flag and retirement reason. No snapshot outbox is retained.

One sent view or unavailable frame consumes the sole credit. Only an exact
outstanding session/sequence acknowledgment releases it; stale, duplicate and
wrong acknowledgments grant nothing. `markDirty` coalesces changes into a single
marker. Releasing credit does not itself mark dirty. Reprojection uses the latest
creator state on a later pump, not cached private bytes.

`invalidateDisclosure` marks dirty if no credit is outstanding, or retires
immediately if a prior frame holds credit. Retirement bypasses data credit; the
caller must close that exact connection. Authority loss/errors, send refusal/error
and safe-integer sequence exhaustion also retire. Credit and dirty state clear
before cleanup, and thrown cleanup cannot revive ownership. Nested pumping is
refused; projection/authority callbacks that change the dirty generation supersede
the attempt. Outstanding credit is reserved before `send`, so synchronous
acknowledgment or retirement cannot admit a duplicate send.

Projection/schema/envelope-bound failure emits a bounded `projection-failed`
unavailable frame when possible, without exception details. If even that frame
cannot fit configured limits, the publisher retires. A later successful projection
requires released credit and a new dirty request. No bound is raised automatically.

This one-credit protocol limits application outstanding snapshots, not browser,
TCP or OS buffers. It can limit cadence to acknowledgment round-trip time. Existing
scene scheduling, authenticated intake and transport cleanup must drive it; hidden
or covered scenes need an explicit consumer suspension/resume policy. Neither
unit tests nor this helper establish durable acceptance, prediction, WAN latency
or physical-device performance.

For creator-side examples, ECS replacement, scene suspension and native-render
recovery, see [the complete scoped-view guide](../../../docs/guides/network-views.md).


## Optional authority and prediction exports

The kit exports separately constructed `createDurableAuthority`,
`createAuthorityGenesis` and `createPrediction`. Intake and view helpers do not
instantiate them. There is no default database, simulation or transport ownership.

- [Durable authority](../../../docs/guides/durable-authority.md): serialized command
  admission, permanent consumption floors, bounded receipts, atomic storage port,
  explicit settlement/recovery and current authorization.
- [Prediction](../../../docs/guides/prediction.md): captured wire-equivalent inputs,
  bounded pure reducer replay, coherent baselines and explicit control lifetime.
- [SQLite tooling adapter](../../../tools/authority-workbench/README.md): optional
  server-side example, outside browser builds, with its own Node requirement.

NW-03 is integrated on private `main` by merge `b6fb4a3` ([PR #123](https://github.com/Akilleez-QA/foundation-engine-private-history/pull/123)). Exact head `883f4ad` passed all seven template gates: 2,018 tests, 129 performance checks, zero enforced breaches/regressions/inconclusive results and four advisory heap warnings. Combined main tests (2,018) and build passed. Clean native acceptance passed at `8317c69` with seven observations; 17 storage/host checks passed on Node 22.13. DV-01 remains open. The [acceptance ledger](../../../docs/guides/upgrade-acceptance-ledger.md)
records revisions, process evidence and outstanding work. Application credit,
command consumption, durable commitment and disclosure permission remain distinct.
