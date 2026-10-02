# Optional reconnect and retry pacing

`createRetrySchedule` in `src/kits/network/retry-schedule.ts` (exported from the
network kit) paces reconnect or retry attempts with capped exponential backoff,
full jitter and a token-bucket retry budget. It is an optional, replaceable helper
(ledger NW-04). It owns no timer, socket, credential, clock, random source or
loop, and nothing in the engine constructs it. A creator who wants no automatic
recovery, or a different policy, omits or replaces it.

Requirement served: a creator using the network kit can recover from transport
loss without every client reconnecting at the same moment after a host restart,
and without unbounded retry loops. It does not decide *whether* a game should
reconnect automatically; that remains a creator choice.

## Inputs and outputs

```ts
import { createRetrySchedule } from '../../src/kits/network/index';

const retry = createRetrySchedule({
  limits: {
    baseMs: 250,        // attempt 1 waits uniformly in [0, 250]
    capMs: 4000,        // later ceilings double up to this value
    maxAttempts: 5,     // retries per episode
    budget: { capacity: 8, refillEveryMs: 15000 }, // retries across episodes
  },
  random: seededStream.next, // uniform [0, 1); a per-owner stream, not gameplay ctx.random()
});
```

Every limit is a positive safe integer and `baseMs <= capMs`. Unknown or
misspelled keys are rejected. Limits and the random port are captured at
construction; mutating the caller's object later changes nothing.

| Method | Result |
|---|---|
| `next(now)` | Report one failure. Returns `{status:'wait',attempt,delayMs,untilMs}`, `{status:'exhausted',attempts}`, `{status:'budget-empty',refillAtMs}`, `{status:'busy'}` (reentrant call from the random port) or `{status:'retired',reason}`. A second failure reported while already waiting returns the same wait and consumes nothing. |
| `due(now)` | `true` exactly once when the outstanding wait has elapsed. The caller then makes one fresh attempt. Never true early, after `cancel` or after `dispose`. |
| `succeeded(now)` | The attempt worked: end the episode, reset `attempt` to zero. Tokens are not refunded. |
| `cancel()` | Abandon the episode (for example an explicit disconnect). Tokens are not refunded. |
| `read()` | Frozen `{state,attempt,tokens,untilMs,reason,limits}`; `state` is `idle`, `waiting`, `attempting`, `exhausted` or `retired`. Does not advance time. |
| `dispose()` | Terminal and idempotent. |

`delayMs` is an integer drawn uniformly from `[0, min(capMs, baseMs * 2^(attempt-1))]`
("full jitter"). The exponent saturates at the cap, so very large attempt counts
cannot overflow.

## Owner, time and randomness

The owner is the consumer's scene visit or connection owner. Construct one schedule
per owner, drive it from that owner's existing frame system and dispose it when
the owner retires. There is no new scheduler: the schedule only answers questions
about the time the caller supplies.

Time is caller-supplied, finite, nonnegative and nondecreasing across all
time-bearing methods; anything else throws `RangeError` before any work. The
reference consumer uses `ctx.time.t` (the scene's accumulated frame time). That
clock pauses while the loop is idle, hidden or covered and clamps long frames, so
waits measured with it can only be longer than wall-clock time, never shorter;
when frames stop, no attempt is made.

Randomness is an injected port. Give each client its own seeded stream so separate
clients do not retry in lockstep, and do not pass the scene's gameplay
`ctx.random()`: network jitter would then consume the deterministic gameplay
sequence. With a fixed seed the whole schedule replays exactly. A random port that
throws, or returns a value outside `[0, 1)`, retires the schedule (`random-failed`
or `random-invalid`) instead of producing a bad delay; no token is consumed.

## Bounds and overload

State is O(1): a few numbers and at most one outstanding wait. Per episode there
are at most `maxAttempts` retries; after that `next` returns `exhausted` until
`succeeded` or `cancel`. Across all episodes of one schedule, the budget limits
retries over any window of `T` ms to at most `capacity + floor(T / refillEveryMs)`.
Idle time refills only up to `capacity`, so there is no stored burst. An empty
budget returns `budget-empty` with the time of the next token and consumes no
attempt: the consumer shows an offline state; it does not spin. `cancel` cannot
be used to bypass the budget because tokens are never refunded.

## Cancellation

`dispose` mid-wait cancels the outstanding wait: `due` stays false and a late
`next` returns `retired`. Disposing from inside the random port is honoured.
Nested calls from the random port return `busy` (or `false` from `due`) and do not
change state.

## Recovery: retry belongs at one layer

The schedule never carries credentials or application messages. Each attempt must
create a fresh transport and authenticate afresh (see
[network admission](network-admission.md)). After a reconnect the consumer follows
the existing contracts:

- a fresh view receiver and session ([network views](network-views.md));
- prediction rebuilt from a trusted baseline ([prediction](prediction.md));
- an exact retry of the same `{stream, sequence, inputJson}` where durable
  authority is used ([durable authority](durable-authority.md)).

Pace retries at one layer only. Retrying in the transport, again in the command
layer and again in the authority multiplies load on a struggling host. A creator
who wants automatic `recover()` attempts on durable authority can drive them
through one schedule; with a single serialized slot that is one probe at a time.
Commands whose outcome is unknown are not made safe to resend by reconnecting.

## Representative consumer

The [network workbench](../../tools/network-workbench/README.md) client has an
optional "Reconnect automatically" checkbox, off by default. When checked, an
unexpected transport close schedules a wait; when it is due, the client opens a
fresh transport and authenticates again. It never resends commands: pending
correlation IDs are cleared on loss. A protocol error, explicit disconnect, hidden
page, page exit or scene exit stops reconnecting. The credential is kept in memory
only while reconnect is armed, and the diagnostic read-out reports only whether it
is armed. Its jitter stream is `?seed=`-replayable and otherwise independent per tab.

## Evidence and limitations

Focused unit tests (`src/kits/network/retry-schedule.test.ts`) cover limit
validation and capture, jitter range and both ends, cap saturation, exhaustion and
reset, budget refill and cross-episode spending, the window bound under a hostile
consumer, cancel and dispose during a wait, time validation, failing, invalid and
reentrant random ports, seeded replay, and a seeded 1,000-client host-restart
simulation where arrivals spread across the jitter window instead of one spike.

The network workbench browser workflow (`npm run test:network-workbench-browser`)
exercises paced recovery after an injected send refusal closes the connection
(command not resent; host dispatch count unchanged), bounded exhaustion against a
revoked credential (exactly one plus `maxAttempts` transports, then no further
attempts), owner exit during a reconnect episode (no attempt after exit), and the
Disconnect, untick, hidden-page and pagehide stop paths (each reports the
credential released and opens no transport in the following 1.5 s). The hidden and
pagehide cases dispatch synthetic events in the page; they are not real tab
switching or navigation.

These establish behaviour under one loopback host and simulated clients. They do
not establish WAN loss behaviour, a measured multi-client reconnect storm against
a real host, physical-device behaviour, or that the example limits suit any game.
The browser transport itself still implements no reconnect; pacing is the
consumer's explicit choice.
