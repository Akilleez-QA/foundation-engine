# Optional durable command authority

This optional framework separates command admission, durable acceptance and
response delivery. It is optional: creators choose their state, commands, reducers,
authorization, storage, transport and presentation. Using Foundation does not
require a server or database. This guide records the implementation contract;
focused owner, SQLite process and native composed browser checks passed. NW-03 is integrated on private `main` by merge `b6fb4a3` (PR #123 in the private development history). Exact head `883f4ad` passed all seven template gates: 2,018 tests, 129 performance checks, zero enforced breaches/regressions/inconclusive results and four advisory heap warnings. Combined main tests (2,018) and build passed.

## Owner and ports

`createDurableAuthority` owns one serialized operation and no request queue,
scheduler or transport. The service outlives an individual requesting connection.
Its explicit operations are `recover`, `submit`, `read` and `dispose`.

The storage adapter supplies:

```ts
settle(): Promise<void>;
read(): Promise<string | null>;
compareAndSwap(request: {
  lineage: string; schema: string; revision: number; json: string;
}): Promise<'committed' | 'rejected' | 'unknown'>;
```

`json` is the complete proposed checkpoint. The expected lineage, schema and
revision must match within the same transaction that replaces it. `committed`
means the entire candidate committed under the adapter's declared failure model;
`rejected` guarantees that attempt wrote nothing. An exception after invocation
is conservatively unknown. A boolean browser-storage write is insufficient.

Every recovery first awaits `settle`. That is a finality barrier: earlier writes
through that adapter have completed or been fenced so they cannot commit later.
A timeout, abort request or read of unchanged bytes does not provide this guarantee.
Recovery then reads a coherent committed checkpoint. Missing, malformed, foreign
or incompatible storage cannot silently create a new world. Genesis is an explicit
operator action using `createAuthorityGenesis`.

## Constructing a service

Optional exports are `createDurableAuthority`, `createAuthorityGenesis` and their
contract types from `@kits/network`. Supply `lineage`, `schema`, `limits`, `storage`,
`validateState`, `validateInput`, `validateResult`, `authorize` and `reduce`.
`minimumRevision` is an optional trusted recovery floor. Each JSON limit has
`maxBytes`, `maxNodes` and `maxDepth`; `AuthorityLimits` also requires `maxStreams`
and `maxReceiptsPerStream`. Choose limits for the creator's actual schema and load.

`authorize({stream,sequence,input,state})` returns a synchronous boolean.
`reduce({stream,sequence,input,state})` returns `{stateJson,resultJson}`. Validators
accept a captured JSON value and return a boolean. These are creator policies,
not supplied combat, economy or movement rules.

Call `await recover()` and require `status === 'recovered'` before submitting
`{stream,sequence,inputJson}`. `committed` and `duplicate` return `revision`,
`sequence` and the captured `result`. `busy` admits no queued work; `gap` cannot be
fixed by renumbering commands; `result-unavailable` means consumed history whose
receipt has expired. `conflict` is a changed retained payload; storage conflict
instead returns `unavailable` and requires recovery. `unknown` requires settlement
and readback. `refused` includes a diagnostic `reason`. Do not interpret every
non-success as an unconsumed retry: consumption is uncertain after `unknown`.

`read()` exposes `status`, a ready-only `snapshot`, `lastConfirmed`, `floor` and
`reason`. A snapshot wraps `{envelope,json,bytes}`. Last-confirmed facts while
pending or unavailable are not fresh authoritative state. `dispose()` retires the
service; adapter connection ownership remains with its creator and must be closed
separately after writes settle. See the adapter guide for explicit initialization.

## Persistent identity and retries

The versioned checkpoint contains immutable `lineage` and `schema`, a monotonic
world `revision`, creator `state`, and permanent command-stream records. Each
stream has an opaque trusted incarnation ID, a consumed-through sequence and a
bounded contiguous suffix of receipts. A receipt records its sequence, world
revision, canonical input and result. The creator's authentication system supplies
stream identity; a client cannot choose another incarnation to bypass history.

Genesis has revision zero and no streams. Every terminal command consumes exactly
the next sequence and advances world revision once, including a domain rejection
represented by an unchanged state and a terminal result. The sum of consumed
stream prefixes equals world revision. Transport/schema/authorization refusals,
busy admission and storage conflict do not consume a sequence.

Authorized exact retries consult retained receipts before applying current domain
rules. The same retained canonical input returns its prior result; changed input
conflicts. A consumed sequence older than retained receipts reports its result
unavailable and is never executed again. After eviction, the helper cannot prove
which old payload or result occupied that sequence. It does not promise unlimited
historical results or changed-payload diagnosis for evicted history.

Streams and consumption floors are never silently evicted. Stream capacity refuses
new identities while preserving recovery and existing retries. Account recreation
must use a durably issued, never-reused incarnation. Arbitrary identity churn needs
an explicit creator migration or retirement protocol.

## Capture, bounds and callbacks

Limits independently bound checkpoint, state, input and result JSON bytes/nodes/
depth, stream count and receipts per stream. Receipts retain exactly the configured
suffix count; if the full prospective envelope exceeds its byte limit, the new
operation is refused without consuming its sequence. Lowering limits below retained
safety metadata requires migration, not truncation.

Canonical version 1 parses bounded JSON, sorts object keys by UTF-16 code-unit
order, preserves array order, and uses JSON numeric/string serialization. Duplicate
keys resolve to their last parsed value; negative zero becomes zero. Strings receive
no Unicode normalization. Both raw and canonical bytes are checked. Validators and
reducers receive the same frozen canonical value used for retry identity and wire
output. Creators define numeric precision and complete operation meaning in their
schema; schema changes must not reinterpret old receipts silently.

The reducer produces complete state and result JSON. It must not perform external
writes, emit accepted effects or mutate unrelated resources: those actions would
fall outside the checkpoint transaction. TypeScript cannot sandbox creator code.
Callbacks and adapter calls are trusted and not CPU-preemptible. The owner bounds
retained work, including one pending candidate, rather than claiming to bound all
OS/database allocation or callback execution time.

## Authorization, failure and recovery

Authorization is checked before receipt lookup and again immediately before storage
invocation after creator callbacks. This is admission-time authorization. Revocation
after invocation does not roll back an already possible commit. A creator requiring
transaction-time grant revocation must include a grant fence in a stronger adapter.
Result and baseline disclosure also require current permission and the exact live
requesting connection; transport membership alone is insufficient.

Known storage conflict requires recovery; unknown outcome halts mutation until
settlement and readback. Do not automatically rerun the reducer. A newer consumed
prefix with an evicted result proves consumption, not that this particular competing
attempt committed. `read` distinguishes ready state from last-confirmed facts while
pending or unavailable. Disposing the service invalidates local publication and
late callbacks, but cannot promise rollback of an invoked storage operation.

Within a service lifetime, recovery rejects revision rollback below its observed
or caller-supplied minimum floor. A structurally valid old backup after process
restart is indistinguishable from current storage without an independent monotonic
anchor. Backup restoration requires explicit lineage/floor preservation or trusted
fencing and rollover. Schema validation does not prove historical causality or
physical power-loss durability.

## Optional submit deadlines (NW-06)

Creators may supply `clock: () => number` when constructing the authority and pass
`submit(command, {deadlineMs})`. Without a deadline, the clock is never read and
behaviour is unchanged. The clock is injected; no wall clock is consulted. Any
finite millisecond scale works if the caller's `deadlineMs` uses the same one.
The clock is called without a receiver, so pass `() => performance.now()` rather
than the unbound `performance.now`, which would refuse every deadlined submit with
reason `clock`. Only a non-null object second argument is admission policy; other
values (for example the index passed by `commands.map(owner.submit)`) are ignored.
The `deadlineMs` property is read after the authority reserves its single slot, so
a getter that reenters `submit` or `recover` sees `busy`, and one that disposes the
owner yields `retired` without storage invocation.

- **Owner and checks.** The existing serialized authority owns the check; there is
  no queue or timer. While holding its single reserved slot it reads the clock at
  most twice: once before command validation, receipts and reduction, and once
  immediately after the final authorization recheck, with no await between that
  read and `compareAndSwap`. A reading at or after `deadlineMs` returns
  `{status: 'expired'}`.
- **After invocation.** The clock is never read again. An in-flight write keeps the
  existing `committed`, `rejected` (`unavailable`) and `unknown` semantics exactly,
  however late it finishes. A deadline is never a storage timeout, and `expired`
  never means "might have committed".
- **Consumption.** `expired` consumes no sequence and no revision, writes nothing
  and returns `status` to ready. It is distinct from `busy`, which
  also admits no queued work, and from `refused`. The client may retry exactly the
  same `{stream, sequence, inputJson}` later; retry pacing belongs to one layer.
- **Receipts.** The first check precedes receipt lookup, so an expired retry of an
  already committed command returns `expired`, not `duplicate`. A later retry
  without an elapsed deadline returns the retained receipt as usual.
- **Invalid input.** A deadline without a configured clock, or a non-finite
  `deadlineMs`, returns `refused` with reason `deadline`. A clock that throws or
  returns a non-finite value returns `refused` with reason `clock`. Neither touches
  storage. Readings need not be monotonic: each one is compared on its own, so a
  backwards step can admit work that an earlier reading would have refused.
- **Overload and cancellation.** `busy` is still returned before any deadline check,
  so expiry adds no waiting. Pure reducer work done before a late expiry is
  discarded. Reentrant `submit` from the clock is busy; disposal from the clock
  retires without storage invocation.
- **Limitations.** A deadline bounds admission, not storage latency or callback CPU
  time. Clock skew between client and host is the creator's protocol concern.
  Nine focused tests cover the boundary, expiry during callbacks, late completion
  as committed/unknown/throw, non-monotonic and invalid clocks, receipt retry
  interplay, configuration, receiver-less clocks, non-object admission, clock
  reentry and `deadlineMs` getter reentry. No load, WAN or device acceptance is claimed.

## Composition and acceptance

Existing [network admission](network-admission.md) is a synchronous bounded ingress
owner. Its dispatch counter is not a commit acknowledgment. Hand off explicitly to
the authority's single reserved slot; do not hide an unbounded Promise queue behind
it. Existing [scoped views](network-views.md) describe disclosure, and their returned
credit does not acknowledge command processing. Prediction needs a coherent
[baseline and processed prefix](prediction.md), not two independently sampled values.

The [optional SQLite reference adapter](../../tools/authority-workbench/README.md)
remains tooling; ordinary player builds gain no database dependency. It requires
Node 22.13 or newer. All 17 storage/host tests passed on Node 22.13.0 / SQLite
3.47.2; the 12 storage tests also passed on Node 22.23.3 and Node 26.8.1. Tests
include competing processes, SIGKILL around COMMIT, independent SQL readback and
externally corrupted records. These process checks do not establish physical
power-loss durability.

The 19 focused authority tests cover retry/eviction, envelope coherence, bounded
admission, settlement fencing, authorization, retirement and overlapping receipt
immutability. A newer recovered checkpoint cannot rewrite already observed retained
receipts. Chronology validation checks whether omitted prefixes can fit before their
retained suffixes, with work bounded by retained records rather than numeric history.
It cannot authenticate evicted payloads or derive past state from unavailable commands.

The native two-client diagnostic has passed exploratory correction/replay, delayed
and reordered baselines, persisted restart and scene/control retirement checks.
Clean native acceptance passed at `8317c69`; [saved evidence](../verification/authority-20261001/README.md)
records its precise scope. NW-03 is integrated on private `main` by merge `b6fb4a3` (PR #123 in the private development history). Exact head `883f4ad` passed all seven template gates: 2,018 tests, 129 performance checks, zero enforced breaches/regressions/inconclusive results and four advisory heap warnings. Combined main tests (2,018) and build passed. See the [acceptance ledger](upgrade-acceptance-ledger.md); DV-01 remains open.
