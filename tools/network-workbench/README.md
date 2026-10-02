# Optional network admission workbench

This loopback-only reference composes the optional transport-neutral network intake
with maintained `ws` 8.22.0 framing and two creator-defined counter targets. It is a
desktop diagnostic, not an installed networking service or prescribed game design.
Ordinary game builds do not need this tool or its Node transport. This slice proves
connection, authentication lifetime, bounded command admission and authorization.
It does not implement persistence, deduplication, replication, prediction, public
identity management or multiplayer deployment security.

Run `node --import tsx tools/network-workbench/server.mjs`. The operator process
receives one JSON ready message containing a loopback WebSocket URL and two randomly
issued fixture credentials. There is no unauthenticated HTTP token/role endpoint.
The credential authority is deliberately an in-process diagnostic map. Pass each
credential only to its intended test client through the trusted harness. No fixture
credential establishes a production identity provider or protects a public server.

## Wire contract

Text JSON only, protocol version `v:1`, with exact fields:

- Authenticate: `{v:1,type:'auth',token}`.
- Command: `{v:1,type:'command',id,target,delta}`. `id` is 1–32 ASCII letters,
  digits, underscores or hyphens; target is `alpha` or `beta`; delta is an integer
  from 1 through 5. Authorization at dispatch requires the authenticated principal
  to own that target. Each counter is bounded at 100000.
- Accepted authentication: `{v:1,type:'authenticated',principal}`.
- Dispatched result: `{v:1,type:'result',id,target,value,applied:true}`.
- Nonterminal refusal: `{v:1,type:'refused',reason,id?}`. A safe correlation ID is
  included when available. Terminal transport/authentication policy failure closes
  the connection; a close is not an acknowledged domain outcome.

Command IDs correlate replies only. Repeating an ID dispatches again if admitted.
Counters are ephemeral, and host restart resets them. Socket send admission means
neither client receipt nor durable commit. If a result cannot be sent after its
counter changed, the owner closes that peer and discards its remaining queue; the
already accepted counter remains changed. A caller must not infer rollback or
exact retry safety from disconnect. NW02/NW03 are separate unresolved acceptance.

Only the requesting principal's counter appears in its result. The host never
broadcasts the other target's value or fixture credentials on client sockets.
Authentication does not grant arbitrary remote function lookup. The host selects
and validates the two allowed message shapes before domain dispatch.

## Fixed reference bounds

| Resource | Limit / outcome |
| --- | --- |
| Live admitted connections | 8; excess peers terminate |
| Pending authenticators | 2; excess attempt refuses |
| Pre-authentication frames | 2 per connection; excess closes |
| Open-to-authentication deadline | 1500 ms; expires without another frame |
| Active connection idle timeout | 15000 ms |
| Incoming frames | Token bucket per connection ([rate admission](../../docs/guides/rate-admission.md)): burst 32, refill 32/s; a limited frame closes (NW-05; previously a 32-per-1000 ms fixed window) |
| Reassembled transport message | 1024 bytes, enforced by ws before application parsing |
| Captured command | 1024 UTF-8 bytes, 32 nodes, depth 4 |
| Captured principal | 256 UTF-8 bytes, 8 nodes, depth 2 |
| Per-peer command queue | 8 messages / 4096 bytes; extra work refuses |
| Global command queue | 32 messages / 16384 bytes; extra work refuses |
| Fair driver | At most 4 dispatch attempts per 10 ms pump by default |
| Transport buffered sends | Prospective `bufferedAmount + message bytes` at most 8192; refusal closes owner |

Compression is disabled. Malformed text, binary frames and oversized transport
messages cannot dispatch a counter mutation. Small admitted JSON uses the ordinary
parser before schema/node checks; this is not a preemptible CPU sandbox. Quotas
bound admitted application work; they do not certify kernel/network buffers, HTTP
handshake flood protection, WAN scalability or native-browser internal memory.
All timers belong to the reference host, and close stops the driver. The browser
adapter is separately explicit and uses the scene ticker, not this Node timer.

Closing, revoking or timing out a peer invalidates authentication completion first
and releases its queue. Held test authentication callbacks cannot activate a closed
or replacement connection. Revocation also rejects future use of that principal's
fixture credential for this host lifetime.

## Optional paced reconnect (NW-04)

The browser client has a "Reconnect automatically" checkbox, off by default. When
checked, an unexpected close (including an injected send refusal or a rejected
authentication) asks one per-visit [retry schedule](../../docs/guides/network-retry.md)
for a jittered wait: base 250 ms, cap 4,000 ms, five attempts per episode, and a
budget of eight retries refilling one per 15 s. When due, it opens a fresh transport
and authenticates again; on `authenticated` the episode ends. It never resends a
command: pending correlation IDs are cleared on loss, and a dispatched command whose
reply was lost stays applied once. Protocol errors, Disconnect, unticking the box,
hidden page, page exit and scene exit stop reconnecting and drop the retained
credential. Time is the scene's frame time; jitter uses a dedicated stream that
`?seed=` replays. These are example limits, not recommendations for any game.

## Trusted harness controls and evidence

`startNetworkWorkbench({port:0,autoDriver:true,driverMs:10})` returns `url`,
`credentials`, `read`, `pump`, `revoke(principal)`, `holdAuthentication(boolean)`,
`releaseAuthentication`, `captureAuthentication`, `blockSends(principal,boolean)`
and idempotent asynchronous `close`. `read` exposes independent operator-only
counter/queue/admitted payload metrics; it is never a client HTTP endpoint. Captured callbacks
are solely a native-test seam for deliberately delivering a retired verifier result.
`blockSends` simulates transport admission refusal; it does not simulate or certify
a physical slow network.

A forked host emits `{type:'ready',url,credentials}` once over Node IPC. Trusted
requests use `{id,method,...arguments}`; replies use `{type:'reply',id,value}` or
`{type:'reply',id,error}`. Supported methods are `read`, `pump`, `revoke`,
`holdAuthentication`, `releaseAuthentication`, `blockSends` and `close`. Use request
IDs to correlate replies. Closing or losing the operator IPC channel tears down
the host. Do not expose this operator protocol to clients.

Focused tests run with `node --import tsx --test tools/network-workbench/server.test.mjs`.
They use real TCP/WebSocket connections to verify principal separation, wrong/missing
credentials, retired authentication callbacks, revocation before queued dispatch,
fair service under queue flooding, message/schema rejection, timeouts, connection
capacity and cleanup after injected transport refusal. They also explicitly prove
that reused correlation IDs are not deduplicated. Five response-schema tests reject
unexpected fields and mismatched original targets before the scene changes.

The separate native two-browser diagnostic passed at `4e51a04`; screenshots show
the accepted shapes and revoked-state clearing. Run
`npm run test:network-workbench-browser` for that workflow. See the
[guide](../../docs/guides/network-admission.md) and
[acceptance ledger](../../docs/guides/upgrade-acceptance-ledger.md) for exact scope.
PR #120 integrated the work after final candidate `5f871b3` passed all seven
template gates and combined main passed tests/build. Measured network load remains
unverified; socket tests alone do not establish scalability.
