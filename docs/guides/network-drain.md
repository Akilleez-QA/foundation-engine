# Optional planned drain and capped connection lifetime

`createConnectionDrain` and `createDrainFollower` in `src/kits/network/drain.ts`
(exported from the network kit) let a host announce a planned shutdown or restart
with a bounded notice, and optionally rotate long-lived connections gradually
instead of all at once. Ledger ID NW-08 (proposal N8 of the scalability study).
Status: implemented, candidate (PR #21); not integrated.

Both are optional, replaceable, pure state machines. They own no timer, socket,
clock, random source, credential or wire format, and nothing in the engine
constructs them. A creator who wants neither omits them; a host or client that
does not opt in behaves exactly as before.

Requirement served: a creator running a host can restart it, or cap how long one
connection lives, without every client failing at once and reconnecting in the
same instant, and clients can tell planned maintenance from a failure.

## Host side: `createConnectionDrain`

```ts
import { createConnectionDrain, DRAIN_CLOSE_CODE } from '../../src/kits/network/index';

const drain = createConnectionDrain({
  limits: {
    maxKeys: 8,                 // tracked connections: use the intake connection bound
    maxNoticeMs: 60000,         // largest notice an operator drain may give
    maxReconnectAfterMs: 60000, // largest return delay it may announce
    maxActionsPerPoll: 16,      // instructions per poll; the rest wait, earliest first
    lifetime: {                 // optional; omit for no lifetime cap
      maxLifetimeMs: 1_800_000, // hard cap from track() to close
      jitterMs: 180_000,        // close uniformly in [cap - jitter, cap]
      noticeMs: 30_000,         // notice before a lifetime close
      reconnectAfterMs: 0,      // announced return delay for lifetime closes
    },
  },
  random: hostRandomStream,     // [0, 1); required only with `lifetime`
});
```

| Method | Result |
|---|---|
| `track(key, now)` | Start tracking a newly opened connection: `{status:'tracked',closeAtMs}` (`null` without a lifetime) or `{status:'refused',reason}` with `draining`, `capacity`, `duplicate`, `invalid-key`, `busy` or `retired`. |
| `admits(key)` | `true` only for a tracked connection that has not been notified. Check it before admitting *new* work. |
| `drain(now, {noticeMs, reconnectAfterMs})` | Operator drain of every tracked connection; refuses new connections until `resume`. Returns `{status:'draining',connections,closeByMs}` or `{status:'refused',reason:'invalid'}` when a value is outside the configured maxima. |
| `resume()` | Accept new connections again (the reference "host return"). Connections already notified keep their close. |
| `poll(now)` | Due instructions, at most `maxActionsPerPoll`, earliest first: `{key,action:'notify',notice:{cause,closeInMs,reconnectAfterMs}}` then, at the deadline, `{key,action:'close',cause}`. `cause` is `planned` or `lifetime`. |
| `forget(key)` | The connection is gone (for any reason). Idempotent. |
| `read()` | Frozen `{tracked,notified,closing,draining,retired,counts,limits}`. |
| `dispose()` | Terminal and idempotent; clears every connection. |

The host decides what a notify or close means on its own wire. The reference
host sends `{v:1,type:'drain',cause,closeInMs,reconnectAfterMs}` and closes with
`DRAIN_CLOSE_CODE` (1012, RFC 6455 "service restart") and reason `drain` or
`lifetime`. Neither is terminal under the default
[close policy](network-retry.md#terminal-refusals-and-transient-loss), so a
client paces a reconnect instead of giving up. A creator who lists them as
terminal has chosen that clients stop.

### Lifetime is a cap

A lifetime connection's close is *scheduled* at `track time + maxLifetimeMs -
dither`, where dither is uniform in `[0, jitterMs]`. Dither only ever brings the
scheduled close earlier, so no scheduled close exceeds `maxLifetimeMs`. The notice
is scheduled `noticeMs` before it, and configuration requires
`noticeMs + jitterMs < maxLifetimeMs`. Connections opened together therefore close
spread across a `jitterMs` window rather than in one burst.

The schedule is the cap; emission is not instantaneous. An instruction is returned
by the first `poll` at or after its time, and at most `maxActionsPerPoll` per poll.
With `n` connections due together (a notify and a close each), the last close is
emitted up to `pollIntervalMs * (ceil(2n / maxActionsPerPoll) - 1)` late, plus one
poll interval of driver granularity; the transport close follows. Example: 20
connections, cap 1000 ms, no dither, `maxActionsPerPoll` 2 and a 10 ms poll emit the
last close at 1190 ms. Size `maxActionsPerPoll` and dither for the expected
simultaneous expiries if the cap must hold tightly.

### Double drain and lifetime interaction

An operator `drain` reaches every connection not yet told to close, including one
already notified of a lifetime close or of an earlier drain. For each, the close
only moves earlier (`min` of the pending close and the new deadline), the announced
return only lengthens (`max`), and the cause becomes `planned`. If that changes what
the connection was told, it gets exactly one superseding notice at the next poll;
otherwise none. A drain never postpones a close and never reopens admission. So a
client told "lifetime close, return 0 ms" learns the planned return before the
close and does not reconnect straight into the draining host.

## Client side: `createDrainFollower`

```ts
import { createDrainFollower } from '../../src/kits/network/index';

const follower = createDrainFollower({ limits: { maxNoticeMs: 60000, maxReconnectAfterMs: 60000 } });
// On a decoded notice payload:
follower.notice({ cause, closeInMs, reconnectAfterMs }, now); // draining | updated | duplicate | invalid | retired
follower.admits();       // false while draining or holding: send no new commands
follower.closeDue(now);  // true once at the notice deadline: close cooperatively
follower.closed(now);    // {status:'hold',untilMs} during a drain; {status:'unplanned'} otherwise
follower.release(now);   // true once when the hold ends: now ask the retry schedule
```

The follower validates the notice against the *client's* bounds. A notice beyond
them is `invalid`: the reference client treats that as a protocol error and stops,
so a host cannot hold a client for longer than the client chose to accept. A later
notice in the same drain is merged monotonically: it may bring the close earlier,
lengthen the return or turn the cause to `planned` (`updated`); a notice that would
postpone the close or shorten the return changes nothing (`duplicate`).

The follower never paces retries. After `release`, the consumer calls its
existing [`createRetrySchedule`](network-retry.md) `next(now)` exactly as for any
other loss, so the first attempt lands at `return time + full jitter`, attempts
are bounded by `maxAttempts`, and the retry budget is spent and honoured as usual
(`exhausted` and `budget-empty` stay explicit). The hold itself spends no token.
If the host is still away, each refused attempt is ordinary transient loss.

## Owner, time and randomness

The host owner is the listener or host process; the client owner is the scene
visit that owns the transport. Both are driven from the owner's existing loop:
the reference host polls from its existing intake driver, the reference client
from its scene frame system. There is no new scheduler. Time is caller-supplied,
finite, nonnegative and nondecreasing; anything else throws `RangeError` before
any work. Lifetime dither uses an injected random port; do not pass gameplay
`ctx.random()`. A random port that throws or returns a value outside `[0, 1)`
retires the drain (`random-failed` or `random-invalid`) instead of producing a bad
lifetime; a reentrant call from the port returns `busy`.

## Bounds and overload

- Tracked connections: at most `maxKeys` (and at most 65,536). Excess is refused
  with `capacity`; size it to the connection bound so this never fires.
- Notice, return delay and lifetime: positive or zero safe integers of at most one
  day, further limited by `maxNoticeMs` and `maxReconnectAfterMs`.
- Work per `poll`: one pass over tracked connections plus a sort of the due ones
  (O(n log n) for n tracked), and at most `maxActionsPerPoll` instructions. When
  many lifetimes expire together, the cap spreads instructions over later polls,
  earliest first. A notice delivered late is not allowed to postpone its close:
  its `closeInMs` is the remaining time, possibly 0, and a connection's notify is
  always returned before its close. `closeInMs` is whole milliseconds rounded down.
- Follower state is O(1).

## Cancellation and recovery

`dispose` mid-drain clears every connection: `poll` returns nothing, `track` and
`drain` refuse with `retired`, and `admits` is false. A disposed follower never
releases a hold. `reset` forgets a follower's drain; the reference client calls it
on explicit connect, Disconnect, unticking reconnect, hidden page, page exit and on
a fresh authenticated session.

## In-flight work keeps its semantics

Drain stops *admission of new work* only. It never cancels, fails or rolls back
work already admitted:

- In the reference host, commands queued before the notice are still dispatched
  and replied to; commands after it are refused with `draining`, a nonterminal,
  correlated refusal that dispatched nothing.
- The cooperative client closes once its pending replies have settled, or at the
  notice deadline. A command still pending at the close has an unknown outcome,
  exactly as for any other loss; it is never resent automatically.
- With [durable authority](durable-authority.md), a `submit` already started keeps
  its committed, rejected or unknown outcome. Drain never converts a started write
  into a failure. A host using authority should not close a peer while its own
  storage write is in flight; an unknown outcome is resolved by the existing
  exact retry of the same `{stream, sequence, inputJson}` after reconnecting.
- Work admitted but not yet started when the close arrives is released with the
  connection, as for any close. Choose `noticeMs` longer than the queue service
  time to make this rare.

## Representative consumer

The [network workbench](../../tools/network-workbench/README.md) opts in on both
sides. `node --import tsx tools/network-workbench/server.mjs --drain` enables the
operator `drain` and `resume` methods; `--drain=<lifetime JSON>` also caps
connection lifetime. Without the flag the host has no drain state and the operator
methods refuse. The client's "Follow host drain notices" checkbox (off by default)
applies the follower; unticked, the client ignores the notice and the host closes it
at the deadline, which it then treats as ordinary transient loss.

## Evidence and limitations

- Unit tests (`src/kits/network/drain.test.ts`): validation and capture,
  opt-out, operator drain and resume, drain during in-flight work, double drain,
  an operator drain superseding a lifetime notice (host and follower), emission lag
  under the per-poll cap,
  a client ignoring the notice, lifetime cap and notice, seeded jitter distribution
  over 2,000 connections, lifetime expiry under load with a per-poll cap, disposal
  mid-drain, failing and reentrant random ports, follower bounds, and reconnect
  after host return through a real retry schedule (budget and exhaustion
  honoured), including 1,000 seeded followers spreading their first attempts.
- Host socket tests (`tools/network-workbench/server.test.mjs`): off by default,
  queued commands complete before the notice, a late command is refused, the
  ignoring client is closed with 1012 `drain`, new connections are refused while
  draining and admitted after resume, and lifetime notify-then-close on real TCP.
- Native browser workflow (`npm run test:network-workbench-browser`): one client
  follows the notice and holds for the announced return without opening a
  transport, one ignores it and is closed at the deadline; after the operator
  resumes, both reconnect through their retry schedules with fresh authentication
  and no command is resent.

Not established: a real process restart (the reference "host return" is an
operator `resume` of the same process, and its fixture credentials do not survive
a restart), WAN or lossy-link close-frame delivery (a lost frame surfaces as 1006,
still transient), measured reconnect storms at scale, multi-host or rolling
deploys, physical devices, and suitability of the example values for any game.
Lifetime rotation is checked by host socket tests, not in the browser workflow.
