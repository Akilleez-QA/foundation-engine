# Optional rate and concurrency admission

`createRateAdmission` (exported by `src/kits/network`) is a pure, caller-owned
admission helper: a token bucket per key (rate plus burst) and an optional per-key
concurrency gate. It is creator-optional and replaceable. It installs no timer,
clock, socket, scheduler or global service, and nothing constructs it implicitly.
It contains no transport or game nouns: a key can be an intake connection handle,
a principal string or any other identity the creator chooses.

Ledger ID: NW-05 (proposal N2 of the scalability study). Status: implemented,
candidate (PR); see the [acceptance ledger](upgrade-acceptance-ledger.md).

## Requirement and seam

Hosts need per-peer frame/message limits. Before NW-05 the three reference hosts
(`tools/network-workbench`, `tools/replication-workbench`, `tools/authority-workbench`)
each hand-rolled a lazily anchored 1000 ms fixed window, with no shared tests, no
refuse-without-close option and up to a 2x burst at a window boundary. The network
intake deliberately does not rate-limit; this helper sits beside it in the adapter,
before intake admission, and does not change the intake contract.

## Inputs and outputs

```ts
import { createRateAdmission } from '@kits/network';

const frames = createRateAdmission({
  maxKeys: 8,            // tracked identities (positive safe integer)
  capacity: 32,          // burst size in tokens (positive safe integer)
  refillPerSecond: 32,   // sustained tokens per second (positive finite, at most 1e9)
  maxInFlight: 2,        // optional per-key concurrency bound
  maxKeyLength: 256,     // optional; UTF-16 length bound for string keys (default 256)
});

const r = frames.admit(peer, hostNow, 1); // cost defaults to 1, must be <= capacity
if (r.status !== 'admitted') closeOrRefuse(r);  // creator policy
try { await work(); } finally { r.lease?.release(); }
```

These values are examples, not required limits. Limits are captured at construction;
invalid configuration throws there (a programming error, not overload).

`admit(key, now, cost = 1)` returns a frozen result:

| Result | Meaning | State change |
| --- | --- | --- |
| `{status:'admitted', lease, remaining}` | Tokens consumed; `lease` is a slot when `maxInFlight` is set, else `null`; `remaining` is whole tokens left | Bucket advanced; slot held |
| `{status:'limited', reason:'rate', retryAfterMs}` | Not enough tokens; `retryAfterMs` is the wait until this cost would fit (ignoring other callers) | None |
| `{status:'limited', reason:'concurrency', retryAfterMs:null}` | `maxInFlight` slots held for this key | None (no tokens consumed) |
| `{status:'refused', reason}` | `key-capacity`, `invalid-key`, `invalid-time`, `invalid-cost` or `disposed` | None |

Other methods: `forget(key)` removes one key's state; `read(key, now?)` returns a
detached `{tokens, inFlight}` without advancing time; `stats()` returns counters
(`keys`, `inFlight`, `admitted`, `limitedRate`, `limitedConcurrency`,
`refusedKeyCapacity`, `reclaimed`, `clockRegressions`, `disposed`); `dispose()`.

## Owner

The host composition that owns the transport and intake owns one admission object
per policy (for example one for incoming frames). It calls `forget(peer)` when it
retires a peer and `dispose()` when it closes. The helper never closes anything:
on `limited` the caller chooses between refusing the unit of work and closing the
peer. The reference hosts keep their prior close-on-excess policy.

## Bounds

- **Keys:** at most `maxKeys` buckets. A new key at the bound examines only the
  least-recently-admitted key and reclaims it if, and only if, its bucket is full
  at the current time and it holds no lease. A full idle bucket is identical to a
  fresh one, so reclamation is lossless: key churn cannot reset anyone's limit.
  Otherwise the new key is refused with `key-capacity` (no eviction of active
  state). Strings must be nonempty and at most `maxKeyLength`; objects are compared
  by identity. Keys are held strongly until `forget` or `dispose`.
- **Time per call:** O(1). Each key stores one number (theoretical arrival time)
  and one in-flight count; there are no per-event arrays.
- **Burst:** at any instant at most `capacity` tokens are admitted; over any
  interval of length T, at most `capacity + refillPerSecond * T / 1000` tokens.
  There is no 2x boundary burst.

## Algorithm and time

The bucket uses the cell-rate (virtual scheduling) form: admitting `cost` advances
the key's theoretical arrival time by `cost * 1000 / refillPerSecond` ms, and
admission requires the resulting backlog to be at most `capacity` intervals. This
is equivalent to a token bucket and avoids per-call refill drift. A boundary
tolerance of 1e-6 ms absorbs floating-point rounding; a backlog within that
tolerance counts as empty, so rounding cannot accumulate across admissions.

Time is caller supplied (inject a fake clock in tests by passing numbers). It must
be finite and nonnegative, otherwise the call is refused `invalid-time`. Time is
the high-water mark of all readings: a reading earlier than the latest one is
counted in `clockRegressions` and grants no refill, so a backwards clock can only
make admission stricter, never looser, and never throws. Use a monotonic source
such as `performance.now()`; a wall clock that jumps forward grants at most a
full bucket.

## Overload, failure policy, cancellation and recovery

- **Overload** returns `limited` or `refused`; it never throws and never consumes
  tokens or slots. There is no internal queue and no fail-open path. (Some hosted
  services fail open when their limiter store is unavailable; this helper has no
  external store and is fail-closed and explicit.)
- **Concurrency release:** a lease's `release()` returns `true` only the first time
  and only while its key state is current. Double release, release after
  `forget`, and release after `dispose` return `false` and change nothing. Release
  in `finally` so failed work returns its slot.
- **Cancellation:** `forget(key)` on retirement makes that key's outstanding leases
  stale; a later key with the same identity starts fresh. `dispose()` is
  idempotent, clears all state and refuses further admission.
- **Recovery:** a limited key recovers by waiting (`retryAfterMs`). Refused
  `key-capacity` recovers when the owner forgets keys or an idle key refills.

## Reference-host migration (intended semantic change)

| Host | Before | After |
| --- | --- | --- |
| network-workbench | 32 frames per lazily anchored 1000 ms window; close `rate-capacity` | Bucket burst 32, refill 32/s; close `rate-capacity` |
| replication-workbench | 256 per window; close `frame-capacity` | Bucket burst 256, refill 256/s; close `frame-capacity` |
| authority-workbench | 128 per window; close `frame-limit` | Bucket burst 128, refill 128/s; close `frame-limit` |

Close reasons, frame-size checks and their order are unchanged; `maxKeys` is each
host's intake connection bound and peers are forgotten in the intake close port.
The change is explicit, not equivalent: the bucket's worst case is lower for every
interval length (it removes the 2x boundary burst), and the long-run rate is the
same. A particular sequence can still differ: a peer that idled part of a window
regains tokens before that window would have reset, so the bucket can admit a
frame that the old window would have closed, and vice versa. Host tests named
`NW05:` show that a capacity burst stays open and the next burst closes.

## Evidence

- `src/kits/network/rate-admission.test.ts`: capacity burst and retry hint; exact
  refill with a fake clock, fractional rates and a non-representable interval over
  30,000 refills; no 2x boundary burst and a randomized sliding-interval bound;
  agreement with an integer reference model over 20,000 random arrivals and costs;
  clock regression; key-cardinality bound, lossless reclamation and invalid keys;
  concurrency release on failed work; double release; stale leases after
  `forget`/`dispose`; invalid costs and limits.
- `tools/network-workbench/server.test.mjs` and
  `tools/authority-workbench/server.test.mjs`: real sockets, a capacity burst stays
  open, the next burst closes, a healthy peer is still served.

These are unit and loopback host tests. They do not establish behaviour under
measured network load, WAN conditions, physical devices or multiple processes.

## Limitations

- Single process only. Distributed or cross-process rate limiting (shared stores,
  central counters) is out of scope for the engine skeleton.
- It limits admission counts, not bytes, CPU time or socket buffers; use `cost`
  for coarse weighting.
- It does not identify clients. Per-connection keys do not stop many connections;
  the intake connection bound and any upstream limits remain necessary.
- Only the least-recently-admitted key is examined for reclamation, so a full table
  whose oldest key holds a lease refuses new keys even if another key is idle.
