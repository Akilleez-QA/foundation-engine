# Complete-view reference host

Optional loopback diagnostic, not a production identity provider or a game policy.
The creator-selected fixture exposes the same finite entity identities to two
principals, with a public numeric `value` and a recipient-specific `private`
string. Policies can remove fields or entities without changing `worldRevision`.

Run the host with `node --import tsx tools/replication-workbench/server.mjs`.
Run focused sockets with `node --import tsx --test tools/replication-workbench/server.test.mjs`.
Run the separately scheduled load probe with `node --import tsx tools/replication-workbench/load.mjs`.

## Ownership and wire contract

The host composes the optional intake and complete-view publisher with maintained
`ws` 8.22.0. It binds only loopback, disables compression, and constructs one
publisher per exact authenticated connection. One existing host timer pumps
intake and publishers; it creates no browser frame loop or retained snapshot outbox.
Random credentials are issued once over trusted process IPC (or operator stdout
when run directly). Never publish that ready message or put it in test evidence.
Each authenticated connection receives a fresh random session nonce.

Clients send only:

- `{v:1,type:'auth',token}`;
- `{v:1,type:'view-ack',session,sequence}`;
- `{v:1,type:'view-refresh',session}`.

The host sends `{v:1,type:'authenticated',principal,session}`, followed by complete
`view` or bounded `view-unavailable` frames from the kit. Acknowledgment releases
one exact outstanding sequence; wrong, stale or duplicate credit grants nothing.
It is application credit, not persistence or proof of a rendered frame. Ordinary
world changes coalesce behind withheld credit. A disclosure change with credit
outstanding retires the connection immediately. Reconnect requires authentication
and a new session. Already disclosed data cannot be recalled from an untrusted client.

## Bounds and failure

Eight connections, eight pending authentications, two pre-authentication attempts,
1,500 ms authentication timeout, 15-second incoming-idle timeout. Incoming frames
are at most 1,024 bytes; each peer has a [rate admission](../../docs/guides/rate-admission.md)
token bucket of burst 256, refilled at 256 messages per second, and a limited frame closes
the peer (NW-05; previously a 256-per-1000 ms fixed window). Intake holds at most
eight messages/8 KiB per peer and 64 messages/64 KiB globally, with at most 64
operations per driver round. Each connection gets at most one publisher attempt
per round. The default driver interval is 10 ms.

Complete frames admit at most 64 entities, 64 KiB UTF8, 4,096 nodes, depth eight,
and 256-character identities. Prospective native send buffer plus payload is
capped at 128 KiB. Failure to admit a send retires its owner. Projected oversize
emits a small unavailable frame when credit is free; after acknowledgment, a
higher valid sequence can recover. These limits bound admitted application work;
they do not bound OS/native transport allocations or trusted callback CPU.

The host's finite source has at most 64 rows. The explicit oversize diagnostic
allocates one deliberately over-limit string; it is not reachable over the public
socket protocol. Timing observations retain at most 2,048 samples. Metrics count
admitted JSON payload bytes, not delivered bytes or transport framing overhead.

## Trusted operator controls

`startReplicationWorkbench({port,autoDriver,driverMs,entityCount})` returns
`url`, `credentials`, `read()`, `pump()`, and these controls:

- `changeWorld({id,value})`: bounded integer 0–100000, advances world revision.
- `setScope({principal,ids:null|id[]})`: complete disclosure selection, no world revision change.
- `removeField({principal,field:'private'|'value',removed:true|false})`: disclosure change.
- `replaceEntity({id})`: advances incarnation and world revision.
- `omitEntity({id,omitted:true|false})`: changes complete membership and world revision.
- `oversize({principal,enabled:true|false})`: bounded diagnostic projection failure.
- `revoke(principal)` and asynchronous `close()`.

Object-control IPC requests are `{id,method,payload:{...arguments}}`: the outer
`id` correlates the reply; an entity `id` belongs only inside `payload`. Scalar
revocation remains `{id,method:'revoke',principal}`; `read`, `pump` and `close`
need no payload. Replies are
`{type:'reply',id,value}` or `{type:'reply',id,error}`. Only the trusted operator
channel has these controls. The initial identities are `entity-0` through
`entity-(count-1)`, incarnation zero and value equal to their index. `read()` is
trusted diagnostic state and contains both principals' policy metadata. It never
contains credentials. Avoid exposing it as a public endpoint.

## Evidence and limits

Nine focused tests pass, including a separate forked-process IPC mutation regression: peer-specific raw wire exclusion, field and
scope replacement at unchanged world revision, stalled-credit coalescing and
healthy service, immediate disclosure retirement, wrong/duplicate credit,
oversize recovery, incarnation/membership changes, reconnect, malformed/oversized
admission and connection cleanup.

The root ran all four declared load cases successfully; the worst observed
publisher p95 was 0.321 ms (8 peers, 64 entities), with all 100 healthy service
rounds passing and no retained peer queue. These are observed local-host results,
not a portable performance guarantee. It declares four loopback
cases: 2/8 peers × 8/64 entities, each with 100 updates. One peer withholds
application credit; every healthy available-credit peer must receive the current
view in one driver round. It asserts configured retained bounds and a prospective
p95 publisher-pump duration below 16 ms. That duration includes projection,
bounded capture and local send admission, providing an upper bound for the first
two; it is not browser render time. Receiver timings cover Node parsing and
independent field validation only. The browser workflow must separately measure
actual ECS adoption and visible rendering. This probe does not test a physical
TCP non-reading peer, WAN behavior or physical devices.

The native browser workflow passed on clean committed revision `f98eb2c`,
recorded in `playtest/replication-workbench/report.json` with `workingTreeDirty: false`.
It used two isolated desktop Chromium contexts and a separate host process. Independent host counters, captured incoming wire, actual ECS
components and DOM observations checked private-field exclusion, complete
replacement, incarnation changes, partial projection failure, unavailable recovery,
synchronous scene coverage cleanup, fresh-session reentry and stalled-credit
retirement. Screenshots were inspected; no page or console errors were reported.
The earlier `eaaaf2f` dirty-tree exploratory pass is retained as historical evidence.
The following all-template gate attempt failed in Arcade: 1,960/1,961 npm tests,
with a file-level `entity-inspection.test.ts` failure despite its inner test passing.
The standalone test and full source-suite TAP retry passed (1,960 tests, zero
failures/cancellations); the cause is not established. The completed 18 performance
checks passed, but the gate did not. The subsequent exact-head gate passed on `8121257`: all seven templates,
1,960 tests and 129 performance checks, with zero enforced breaches, regressions
or inconclusive results. Four software-GL heap advisories remain (two Mechanics,
two Terrain). NW-02 is now integrated on `main` by merge `ea48539` (work tracked in PR #122 in the private development history).
The rebased clean browser run passed at `508edd9`; final `47a7e6d` passed all seven
template gates with 1,965 tests and 129 performance checks, zero enforced breaches,
regressions or inconclusive results, and four advisory heap warnings. Combined
main tests (1,965) and build passed. Integration here is verified Git ancestry;
the GitHub PR API still reported OPEN immediately after push, so no PR-state
transition is asserted. No durability, command deduplication, prediction, spatial policy,
delta replication or general multiplayer scalability is claimed.


## Runnable consumer and maintenance

`npm run test:replication-workbench-browser` starts the isolated host and Vite
fixture, exercises the native scene, and writes `playtest/replication-workbench/`.
Its report records HEAD and worktree cleanliness; generated evidence is ignored
by Git. The command is configured in CI separately from the template gate; that
configuration is not evidence of a remote CI pass. `npm run test:replication-load`
is a separately scheduled local load observation, not a portable CI timing gate.

The reference panel exposes explicit connect/disconnect, refresh and diagnostic
failure controls. Credentials remain operator-issued local fixtures. The scene
uses the ordinary frame system and an optional activity notification, conceals
its canvas synchronously on coverage or retirement, and reveals a new accepted
projection only after `rendered(ctx)` reports a successful renderer call. That
callback does not establish physical display completion. Complete field replacement
removes omitted fields; entity omission despawns the owned replica; unrelated local
entities survive. Incarnation changes replace the local identity. The held
presentation callback is a creator-callback lifetime test, not asynchronous GLB
readiness evidence.

See [complete scoped views](../../docs/guides/network-views.md) and
[scene activity](../../docs/guides/scene-activity.md) for public contracts. Maintain
those guides and the acceptance ledger whenever wire, ownership, bounds or
recovery behavior changes; do not promote this diagnostic into a required player
interface or spatial/game policy.
