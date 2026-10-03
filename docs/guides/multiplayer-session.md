# Optional shared session for game code (MP-01)

Ledger ID: MP-01. Status: implemented, candidate (see the
[acceptance ledger](upgrade-acceptance-ledger.md#newcomer-shared-session-mp-01--implemented-candidate)); not integrated.

The network kit already had bounded admission, a browser transport, complete scoped
views (NW-02), prediction, reconnect pacing (NW-04), rate admission (NW-05), drain
(NW-08) and integrity (SEC-01), but game code could not reach the browser transport
(`src/platform/network` is outside `@engine` and `@kits`) and there was no runnable
"two browsers, one shared world" path. MP-01 composes those owners behind three
game-facing calls in `@kits/network` and a development host, `npm run host`. It is
optional: a game that does not import it is unchanged, and nothing connects unless a
page is opened with a host address.

For the ten-minute walkthrough, read the recipe
[two players in one world](../recipes/two-players-one-world.md). The
`shared-world` template is the runnable consumer.

## The three pieces

| Piece | Where | Owner and lifetime |
|---|---|---|
| `defineSessionRules({ id, version, maxPlayers, initial, join, leave, action, apply, disclose?, integrity?, limits? })` | `game/session.ts`, imported by the scene and by the host | Creator data, frozen at definition. Pure functions only. |
| `createSession({ rules, endpoint })` | the scene: `enter` creates, a frame system calls `update(ctx.time.now)`, input calls `act(action)`, `exit` calls `dispose()` | One owner per scene visit. Owns one transport, view receiver, prediction owner and retry schedule at a time. |
| `createSessionHost({ rules, joinCode, ports })` | `npm run host` (Node, `ws`); transport-neutral, so tests drive it in memory | One owner per host process. Owns the intake, one view publisher per connection, a frame token bucket and an integrity owner. No socket, timer or clock of its own. |

`sessionEndpointFromPage()` reads `?host=<port | ws://address:port/session>&join=<code>`
from the page URL, as `npm run host` prints it. A bare port means the page's own host
name. Without both values, or for a host outside loopback and private LAN ranges, it
returns `null` and the session plays locally.

## Inputs and outputs

- **World:** a JSON object, entity id to creator fields. Ids are 1-64 of
  `A-Z a-z 0-9 _ . : -` and must not start with `@` (reserved). `checkWorld` enforces
  `limits.world` (default 16 KiB, 1024 nodes, depth 6) and `limits.maxEntities`
  (default 48) every time a creator function returns a world; an invalid result is
  treated as a rule error, never published.
- **Players:** the host assigns `p1`..`pN` (N = `maxPlayers`, at most 16). `join` and
  `leave` are creator rules; `leave` runs when a disconnected player has not returned
  within `leaveAfterMs`.
- **Actions:** creator JSON within `limits.action` (default 512 bytes, 32 nodes,
  depth 4), checked by `rules.action` on both sides. `apply(world, player, action)`
  must be pure and deterministic; return the same world to ignore an action.
- **Client output:** `session.read()` gives `status` (`local`, `connecting`, `joined`,
  `reconnecting`, `closed`), `player`, `world` (predicted when joined), `confirmed`,
  `revision` (changes only when `world` changes, so a scene redraws only then),
  `stale`, `pending`, `lastClose` (validated untrusted tokens), `reason`, `retryAt`
  and `reconnects`.
- **Host output:** `read()` gives the world, revision, players, metrics, close reasons
  and the integrity mode, stats and audit. It is operator data, never sent to clients.

## Wire contract (text JSON, `v: 1`)

Client to host: `join {rules, version, token, player}` (the page's random key keeps its
slot across reconnects; it is not an account), `action {seq, action}`, `ack {session,
sequence}` and `ping`. Host to client: `welcome {player, session}`, then NW-02 complete
views whose reserved entity `@you` carries `{player, processed}`, the last action
sequence of this connection the host consumed, in the same projection as the world.
That pair is the prediction baseline: `revision` is the view sequence and
`processedThrough` is `processed`, so prediction reconciles exactly and replays only
unconsumed actions. Views go straight to the transport port under the view limits;
the intake's message limits bound inbound actions and small replies.

## Bounds and overload

| Resource | Default | Over the bound |
|---|---|---|
| Joined connections | one per player slot (a resume replaces the old connection with `replaced`) | n/a |
| Joining connections (no join accepted yet) | `maxPreJoin` = max(4, `maxPlayers` + 2), at most `maxPreJoinPerAddress` = 2 from one remote address | refused at connect, close 1013 `connection-limit` (transient, paced retry) |
| Resume reserve | `resumeReserve` = `maxPlayers` extra joining connections, used only while the normal pool (or the address's share) is full and some slot exists; 2 per address | the join must present a known page key within `reserveJoinMs` (500 ms), otherwise close 1013 `connection-limit` or `auth-timeout` |
| Players | `maxPlayers` | refused, close 1013 `session-full` (transient: the page retries, paced) |
| Join deadline | 1500 ms, 2 frames before joining | intake closes `auth-timeout` / `pre-auth-limit` |
| Incoming frames | 60 per second per connection, burst 60, counting actions, pings, joins and unsolicited acks; an ack that releases the connection's outstanding view credit is free (credit bounds it to one per view) | close 1013 `rate-limit` |
| Client action pacing | `actionsPerSecond` 30, burst 30 (half the host frame rate) | `act` returns `{status:'refused', reason:'paced'}` synchronously and sends nothing |
| Raw frame | action bytes + 320 characters; `ws` `maxPayload` 8192 | close `frame-too-large` |
| Queued actions | 16 per connection, 64 applied per pump, round robin | close 1013 `queue-limit` (actions are sequenced; none is silently dropped) |
| Views | one unacknowledged view per connection (NW-02 credit); a change while waiting coalesces | the next view waits for the ack |
| Client pending actions | `maxPending` 16, equal to the host's `maxQueuedActionsPerPeer`, so a burst cannot fill the host queue | `act` returns `{status:'refused', reason:'busy'}` synchronously and sends nothing |
| Client inbound queue | 8 frames, view-sized | the transport closes and the page reconnects |
| Idle connection | 15 s without a frame (clients ping every 5 s) | close 1001 `idle-timeout` |
| Away player | 10 s | `rules.leave` runs and the slot frees |
| Host send buffer | 256 KiB per socket (`npm run host`) | send refused, connection closed |

Idle sockets that never present the join code are the cheapest attack on a session
host. Before MP-01's review fix, eight idle sockets held every connection slot and
locked out real players. Now one address can hold at most two joining connections,
they expire after 1.5 s, and a player returning to an existing slot can use the resume
reserve even while the normal pool is full (`session.test.ts`: "idle sockets without
the join code cannot lock players out"). Many hostile addresses on the same LAN can
still fill both pools between expiries; that is outside this development host's scope.

`act` may be called on every 60 Hz fixed tick: the client paces itself below the host
frame limit and refuses (`paced`, `busy`) instead of sending, so it never reports
`predicted` for an action the host would drop (`session.test.ts`: "act() on every 60 Hz
tick"). Keep `actionsPerSecond` at or below half the host's `framesPerSecond` and
`maxPending` at or below its `maxQueuedActionsPerPeer` if you change either.

These are example limits for a small LAN session, not recommendations; every host
limit is a `createSessionHost({ limits })` option. They bound admitted application
work, not kernel or browser buffers, and they are not a CPU deadline: `apply`,
`disclose` and `join` are trusted creator code.

## Failure, cancellation and recovery

- **Close policy.** The client classifies the host's validated close with
  `createClosePolicy`: `auth-rejected`, `revoked`, `integrity-violation`,
  `rules-mismatch` and `replaced`, and codes 1002, 1003 and 1007, are terminal (status
  `closed`, no further attempts). Everything else, including a dropped connection
  (1006), `host-closing`, `idle-timeout` and `session-full`, is transient.
- **Reconnect.** A transient loss asks `createRetrySchedule` for a jittered wait (250 ms
  base, 4 s cap, 6 attempts per episode, a budget of 8 refilling one per 15 s), then
  opens a fresh transport and joins again with the same page key. Within the host's
  `leaveAfterMs` the player resumes the same slot. Pending actions are dropped on loss
  and never resent: one that reached the host before the loss stays applied once.
  Exhausted retries end in `closed` with `retry-exhausted`.
- **Resynchronisation.** A malformed frame, a prediction failure, a send refusal or a
  `view-unavailable` frame tears down the connection and reconnects through the same
  schedule; a fresh connection brings a fresh baseline and prediction owner.
- **Rejected actions** (schema, a rule that ignores them, enforced integrity, a
  throwing `apply`) are consumed: `processed` advances, the next view reconciles the
  client's prediction back to the authoritative world, and no sequence gap stalls it.
- **Out-of-order or unjoined traffic** closes the connection (`sequence`, `protocol`).
- **Disposal.** `session.dispose()` closes the transport and cancels the retry
  schedule; `host.dispose()` closes every connection with 1001 `host-closing`.

## Integrity (SEC-01) in observe mode by default

`rules.integrity` takes the kit's integrity rules over
`{ command: action, state: { world, player, lastActionTick }, tick }`, where
`tick = floor(now / tickMs)` (50 ms) at dispatch time. The host runs
`admit`, `assess` and `record` around every action. With `integrity: 'observe'`
(the default, also `npm run host -- --integrity observe`) nothing is refused: verdicts
are audited and counted as `would*` statistics in `read().integrity`. With `enforce`,
an invalid action is consumed as a rejection and repeated violations close with the
terminal `integrity-violation`. `off` constructs no integrity owner. Observe first:
the template's one rule (at most one action per host tick) flags an honest paint that
lands in the same tick as a step, which is exactly the false positive observe mode
exists to measure before anyone enforces it.

## `npm run host`

```
npm run host [-- --port 8787] [--lan] [--join <code>] [--integrity observe|enforce|off] [--game <dir>]
```

It loads the selected game's `session.ts` (default export), starts the host on
127.0.0.1, prints a fresh join code and the link to open, and logs joins and leaves.
`--lan` listens on every interface and prints the LAN links. A browser `Origin` is
checked at the handshake: in the default loopback mode only `localhost`, 127.x and ::1
pages are accepted; with `--lan`, private LAN (10/8, 172.16/12, 192.168/16),
link-local and `.local`/`.localhost` pages are accepted too. Any other site is refused.
The remote address of each connection feeds the per-address joining cap. Stop it with
Ctrl+C. It is off by default: nothing in a build or a test starts it.

**Restarting the host.** Open pages reconnect by themselves only if the new host uses
the same join code: run `npm run host -- --join <code>` with the code the previous run
printed (it prints that command). `--join` takes 16-128 URL-safe characters with at
least 10 different ones; reuse a generated code rather than typing one. A new code
means every page must open the new link. Either way the restarted host starts a new,
empty world.

## Evidence

- `src/kits/network/session.test.ts` (15 tests): rule validation, local play, two
  in-memory clients joining one host with prediction and authoritative views,
  reconciliation after an enforced rejection, observe mode, terminal refusals (wrong
  code, rules mismatch), paced reconnect that resumes the slot without resending,
  retry exhaustion, capacity and the leave grace period, protocol, sequence and
  frame-rate closes, views larger than the action bound, page endpoint parsing, an
  idle-socket flood (one address, then many) that neither blocks new players nor a
  returning player, `act` on every 60 Hz tick for ten seconds without a close, and a
  40-action burst stopping at the host queue size.
- `scripts/host.test.mjs` (6 tests): real loopback WebSockets through `npm run host`'s
  server: two clients share one world, a wrong code closes 1008 `auth-rejected`,
  origins are limited by mode (loopback only by default; LAN with `--lan`; public
  sites never), `--join` reuses a code across a restart and refuses weak codes, and
  close sends 1001 `host-closing`. Two subprocess cases exercise the actual CLI with
  generated and supplied join codes: each printed link admits a real socket, and the
  existing IPC close command shuts down the host and connection. See the
  [CLI startup regression receipt](../verification/session-host-cli-20261003.md).
- `templates/shared-world/game/world.test.ts`: the scene in local play and the host core
  produce the same world from the same actions (criterion S1).
- `npm run test:session-browser`: two isolated headless Chromium contexts against a
  loopback host: both join, a move and a paint reach the other page, a host restart on
  the same port with the same join code is ridden out by paced reconnects, a wrong join code is terminal with
  exactly one attempt, integrity stayed in observe mode, no page or console errors
  beyond the expected refused connections while the host was down. Revisions and
  results are in the [ledger](upgrade-acceptance-ledger.md#newcomer-shared-session-mp-01--implemented-candidate).

## Limits (honest)

- **LAN and loopback only.** Unencrypted `ws://`, one shared join code per run, no
  accounts, identity provider, matchmaking, lobby, NAT traversal, relay or TLS
  termination. Not WAN-certified; no Internet exposure is supported.
- **Ephemeral.** The world lives in the host's memory; a host restart starts a new
  world, and pages reconnect only when the restart reuses the join code (`--join`). Durable authority (NW-03) is not wired into this path.
- **Small worlds.** Every change sends each player a complete view (bounded, coalesced
  by one credit). It suits boards and small rosters, not large or fast worlds; there
  is no interest management, delta compression or server-side simulation tick.
- **Prediction is of the disclosed world.** `apply` runs on the client over what the
  player can see; when `disclose` hides data that `apply` needs, the prediction can
  differ until the next view corrects it.
- **No host liveness check from the client.** A silent host whose TCP connection stays
  open is not detected until the connection closes.
- **Drain (NW-08) is not wired** into this path; a restart is seen as a transient loss.
- Evidence is unit, loopback-socket and desktop headless Chromium on one machine. No
  LAN between devices, WAN, physical phone or tablet, gamepad, touch, thermal or
  scalability claim. The template targets desktop and laptop only.
