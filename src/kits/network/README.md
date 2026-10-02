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

The intake itself does not rate-limit bytes/messages per second. The kit exports a
separate, optional [`createRateAdmission`](#optional-rate-and-concurrency-admission)
token bucket that an adapter can apply per peer before calling intake admission;
the three reference hosts do so. Neither establishes distributed or cross-process limits. Queued data
bounds are not authentication-provider capacity guarantees or total process heap
bounds. Trusted projection/domain callbacks and remote I/O are not timed here.

## Optional queued-command age (NW-06)

Creators who want abandoned work dropped may set `limits.maxQueuedAgeMs` (a
positive safe integer in host-time units) and, optionally, a `stale(context)` port.
Without `maxQueuedAgeMs` behaviour is unchanged: commands wait indefinitely and
`pump` returns the same five fields as before.

- **Input and owner.** The intake owner records the `now` passed to `receive` with
  each queued command. No clock, timer or scheduler is added; age is measured
  only when the caller drives `pump(now)`.
- **Rule.** On a peer's drain turn, its aged prefix is shed first: every head with
  `now - receivedAt >= maxQueuedAgeMs` is removed, its count and bytes released,
  and never passed to `authorize` or `dispatch`. Age equal to the limit is stale.
  Per-peer receive times are nondecreasing, so the first fresh head ends the prefix
  and that fresh head is then attempted on the same turn.
- **Output.** `pump` adds `stale` (shed count) only when the limit is configured.
  Shed commands are **not** counted in `attempted` and do not consume the pump
  budget, so a tight age cannot starve dispatch of fresh work (see below).
  A zero budget sheds nothing, because no drain turn runs.
- **Bounds.** Shedding per pump is capped by the optional `maxStaleDropsPerPump`
  (positive safe integer; default `maxQueuedMessages`, ignored without
  `maxQueuedAgeMs`). Nothing can be queued during a pump, so the default already
  bounds drops by the queued backlog. Loop turns are bounded too: the empty-turn
  scan restarts after each attempt, so the worst case is about drops plus
  `budget x connections` turns plus one final scan of connections, each turn O(1)
  apart from creator callbacks. Lower the cap to bound `stale` callback work per pump. Once it is
  spent, a peer whose head is still stale is skipped for that pump: a stale command
  is never dispatched. One extra number per queued command, bounded by the existing
  message-count limits, is retained; it is not added to the UTF-8 byte accounting.
- **Overload.** Before this rule was uncharged, each shed cost one pump attempt. Once
  real queued wait exceeded the age, most attempts went to already-stale commands and
  goodput collapsed. The deterministic regression test (7 peers, about 113 commands/s
  offered, 4 attempts per 50 ms pump = 80/s) measured goodput 20.6 and 22.0/s at
  150 and 300 ms ages before the change, against 80.4/s FIFO, and 80.4/s at every age
  after. The NW-07 loopback probe from PR #27 (`npm run probe:network`, integrated in v0.2.0;
  these runs used that branch's tools with and without this change) measured saturated final/peak goodput at a 300 ms
  age of 0.253 and 0.229 before and 0.955 and 0.915 after (two runs each, heavily
  loaded host).
- **Choosing an age.** With round-robin drain, a command at the back of a full
  per-peer queue waits about `ceil(maxQueuedMessagesPerPeer x activePeers / budget)`
  pumps, times the caller's pump interval, plus host lag. For example, 8 x 7 / 4 = 14
  pumps of 50 ms is 700 ms; the full global-queue drain (32 / 4 = 8 pumps, 400 ms) is
  not the binding bound. The intake cannot compute this in milliseconds, because the
  pump cadence and active peer count belong to the caller. An age below that bound
  now sheds the tail of the queue rather than collapsing goodput. Choose the age from
  how long a client keeps waiting for a reply, and shrink per-peer queues if the
  shed rate is too high.
- **Reply.** `stale({peer, principal, command, receivedAt, ageMs})` may reply through
  `intake.send` (each send bounded by message limits) on the existing reply path.
  Authorization is **not** rechecked for this notice; disclose only correlation (for
  example a command ID and `expired`). Nested pump/receive return busy. A throwing
  notice retires the peer with `stale-error`, releasing the rest of its queue.
- **Time and recovery.** Backwards or non-finite time still throws before any work,
  so nothing is shed or dispatched on a bad clock. A shed command never reached
  creator logic; whether the client retries, and how fast, is creator protocol.
  Durable authority does not see it, so no authority sequence is consumed.
- **Limits.** A peer's stale commands are only examined on that peer's drain turn,
  so an idle pump with zero budget does not sweep them. Age measures host queueing
  only, not client send time, network delay or clock skew between hosts. Unit tests
  cover the exact boundary, uncharged shedding, the drop cap, fair drain, backwards
  time, reply/reentry, a notice that retires its peer mid-pump, configuration and the
  sustained-overload goodput regression.
  The probe numbers are loopback, one machine; no WAN, browser or device acceptance
  is claimed.

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


## Optional rate and concurrency admission

`createRateAdmission({maxKeys, capacity, refillPerSecond, maxInFlight?, maxKeyLength?})`
is a pure, caller-owned token bucket with an optional per-key concurrency gate. It
constructs no timer or clock; time is supplied on each call (finite, nonnegative, at most
`Number.MAX_SAFE_INTEGER` ms; a backwards reading grants no refill). `refillPerSecond`
is at most 1e6 and `capacity` at most 1e9. `admit(key, now, cost?)`
returns `admitted` (with a lease when `maxInFlight` is set), `limited` (`rate` with
`retryAfterMs`, or `concurrency`) or `refused` (`key-capacity`, `invalid-key`,
`invalid-time`, `invalid-cost`, `disposed`); overload never throws and a limited call
consumes nothing. Tracked keys are bounded by `maxKeys`; only an idle, fully refilled
key is reclaimed, so key churn cannot reset a limit. The owner calls `forget(key)` on
retirement and `dispose()` with the host. It is single-process only. See the
[rate admission guide](../../../docs/guides/rate-admission.md) for bounds, clock
regression, cancellation, limitations and the reference-host migration (NW-05).

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

## Optional reconnect/retry pacing (NW-04)

`createRetrySchedule({limits:{baseMs,capMs,maxAttempts,budget:{capacity,refillEveryMs}},random})`
is a pure pacing state machine: capped exponential backoff with full jitter per
episode, and a token-bucket retry budget across episodes. It owns no timer, socket,
credential, clock or random source and no other helper constructs it. The caller
reports a failure with `next(now)` (`wait`, `exhausted`, `budget-empty`, `busy` or
`retired`), polls `due(now)` from its existing frame system, then makes one fresh,
freshly authenticated attempt and calls `succeeded(now)` or reports the next failure.
`cancel()` ends an episode without refunding tokens; `dispose()` is terminal and
cancels an outstanding wait. Time must be finite, nonnegative and nondecreasing.
Inject a seeded per-owner random stream, not gameplay `ctx.random()`. Retry belongs
at one layer; reconnecting does not make an unknown command outcome safe to resend.
See the [retry pacing guide](../../../docs/guides/network-retry.md). Integrated in v0.2.0
(NW-04, PR #14); no WAN or physical-device acceptance.

`createClosePolicy({terminalReasons?, terminalCodes?})` classifies the browser
transport's validated `remoteClose` (`{code, reason}` or `null`) as `terminal` or
`transient`, so a consumer stops reconnecting on a refusal that would repeat.
Defaults: reasons `auth-rejected` and `revoked`, codes 1002, 1003 and 1007; `[]`
means none; at most 32 distinct entries each. Unknown causes are transient. The
close reason is untrusted remote input: the transport keeps it only as a bounded
token, and consumers display it only as text. See
[terminal refusals](../../../docs/guides/network-retry.md#terminal-refusals-and-transient-loss).

## Optional planned drain and capped lifetime (NW-08)

`createConnectionDrain({limits:{maxKeys,maxNoticeMs,maxReconnectAfterMs,maxActionsPerPoll,lifetime?},random?})`
is a host-side pure state machine. `track(key, now)` on open, `admits(key)` before
admitting new work, `drain(now, {noticeMs, reconnectAfterMs})` for an operator
drain (new connections refused until `resume()`), and `poll(now)` from the host's
existing driver returns at most `maxActionsPerPoll` `notify` then `close`
instructions, earliest first. An optional `lifetime` caps each connection at
`maxLifetimeMs`, dithered earlier by up to `jitterMs`, with `noticeMs` warning.
A drain reaches connections already notified: the close only moves earlier, the
announced return only lengthens, and a changed notice is re-sent once. The
lifetime cap bounds the scheduled close; emission waits for the next poll and the
per-poll cap. It never cancels admitted work.
`createDrainFollower({limits:{maxNoticeMs,maxReconnectAfterMs}})` is the client
side: it validates a notice against the client's bounds, stops new work, signals
one cooperative close and holds the first reconnect until the announced return;
pacing after that is the caller's `createRetrySchedule`. Drain closes use
`DRAIN_CLOSE_CODE` (1012) and are transient under the default close policy. Both
own no timer, socket or random source; time is caller-supplied and nondecreasing.
See the [drain guide](../../../docs/guides/network-drain.md). Integrated in
v0.2.0 (NW-08, PR #21); no WAN, process-restart or physical-device
acceptance.

## Optional command integrity (SEC-01)

`createIntegrity({rules, limits, decayPerSecond, enforcement?, config?, subject?, tickBudget?, throttle?, close?, ruleErrorWeight?, onAudit?})`
separates validity from policy. `assess({command, state, tick})` is pure: creator
rules return `integrityOk()`, `integrityReject(reason, weight, evidence?)` or
`integrityFlag(...)`, and the result can be computed inside an authority reducer so an
invalid sequenced command is consumed as a domain rejection (no `gap`; prediction
reconciles). `admit(key, now, {tick})` applies policy before dispatch: close state,
score throttle and a tick-rate budget built on `createRateAdmission` that charges the
claimed tick gap (only early retries score; impossible claims are rejected `tick-claim`). `record(key,
assessment, now, ref)` scores an outcome once. `check` composes them for unsequenced
commands. Scores decay linearly with host time; per-rule ceilings, windowed close
(`requires: {violations, withinMs}`) and owner or rule observe mode contain false
positives. Close uses the terminal token `integrity-violation`. The key table evicts
the least-recently-seen key and never refuses a new one. Audit entries are bounded,
local and exportable (`exportAudit()`). Pure tick-addressed helpers in
`integrityRules`: `maxRateOfChange`, `valueInRange`, `valueInSet`, `monotonic`,
`cooldown`, `claimedTickInBand`. `assertDisclosure`/`findDisclosureLeaks` check a
view projection against what an observer may know, in tests. See the
[integrity guide](../../../docs/guides/integrity.md) and the
[five-minute recipe](../../../docs/recipes/add-command-integrity.md). Slice A
integrated in v0.2.0 (PR #20). Unit and loopback host tests only.

NW-03 is integrated on private `main` by merge `b6fb4a3` (PR #123 in the private development history). Exact head `883f4ad` passed all seven template gates: 2,018 tests, 129 performance checks, zero enforced breaches/regressions/inconclusive results and four advisory heap warnings. Combined main tests (2,018) and build passed. Clean native acceptance passed at `8317c69` with seven observations; 17 storage/host checks passed on Node 22.13. DV-01 remains open. The [acceptance ledger](../../../docs/guides/upgrade-acceptance-ledger.md)
records revisions, process evidence and outstanding work. Application credit,
command consumption, durable commitment and disclosure permission remain distinct.

## Measured loopback overload (NW-07, tools only)

`npm run probe:network` ([tool](../../../tools/network-probe/README.md),
[guide](../../../docs/guides/network-overload.md)) drives the network and replication
reference hosts past saturation over real loopback WebSockets. It reports goodput
against offered load, rejections by reason, admitted-work latency, high-water marks,
a physical non-reading peer and a host-restart reconnect storm paced by
`createRetrySchedule`. It changes nothing in this kit. Its earlier finding on this kit's
optional `maxQueuedAgeMs` (an age shorter than the real queued wait collapsed goodput,
because each aged shed cost a pump attempt) is resolved by the NW-06 follow-up above.
The probe now asserts that queue-age variants plateau, like FIFO. Evidence is
loopback/process scope only, not WAN or physical devices. Integrated in v0.2.0 (PR #27).

## Optional shared session for game code (MP-01)

Game code imports only `@engine` and `@kits/<name>`, so it could not reach the browser
transport, and nothing composed the owners above into a session a newcomer could run.
Three exports do that; none is constructed unless a game calls it:

- `defineSessionRules({id, version, maxPlayers, initial, join, leave, action, apply, disclose?, integrity?, limits?})`:
  one pure, frozen rules definition (a world is entity id to JSON fields, bounded by
  `limits.world` and `limits.maxEntities`) that the page and the host both import.
- `createSession({rules, endpoint?})`: the page's owner for one scene visit. Without an
  endpoint it plays the same rules locally for `p1`. With one it composes the browser
  transport, `createViewReceiver`, `createPrediction` (baseline = view sequence plus the
  host's `processed` count in the same view), `createRetrySchedule` and
  `createClosePolicy` (`SESSION_TERMINAL_REASONS`). `update(now)` drives it from a frame
  system; `act(action)` predicts and sends; `read()` reports status, world, revision and
  the last validated close. Lost actions are never resent.
- `createSessionHost({rules, joinCode, ports, integrity?, limits?})`: transport-neutral
  authority composing `createNetworkIntake` (join code, player slots, fair sequenced
  dispatch), one `createViewPublisher` per connection, `createRateAdmission` per
  connection and `createIntegrity` (`observe` by default). It owns no socket or timer;
  `scripts/host.mjs` (`npm run host`) supplies `ws`, a 20 ms driver and loopback/LAN
  binding.

`sessionEndpointFromPage()` reads `?host=&join=` and accepts only loopback and private
LAN hosts. See the [shared session guide](../../../docs/guides/multiplayer-session.md)
for the wire contract, bounds, overload, recovery and evidence, and the
[recipe](../../../docs/recipes/two-players-one-world.md) for the `shared-world`
template. Implemented, candidate (MP-01, PR #61); not integrated. Unit, loopback socket and
desktop headless Chromium evidence only; LAN/loopback only, no accounts, matchmaking,
NAT traversal or WAN certification.
