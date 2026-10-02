# Optional command integrity (anti-cheat)

Ledger ID: SEC-01. Status: slice A implemented, candidate (PR #20); not integrated.
Slice B (verified runs) is planned and not built. See the
[acceptance ledger](upgrade-acceptance-ledger.md).

`createIntegrity` (exported by `src/kits/network`, `@kits/network`) lets a host judge
commands with creator rules against authoritative state, keep a bounded, decaying
violation score per player, and act on configured thresholds. It is optional, off
unless constructed, generic and replaceable. It installs no timer, clock, socket,
transport or telemetry; nothing it records leaves the host unless the creator sends it.

For a five-minute setup, read the [recipe](../recipes/add-command-integrity.md).

## Principles: where cheating is actually stopped

1. **Browser clients are untrusted.** Everything on the player's device belongs to the
   player: the JavaScript, WASM memory, timing APIs (`performance.now`, timers and
   animation frames can be rescaled by a speed-hack extension) and the WebSocket.
2. **Client-side anti-cheat is not a security boundary.** Obfuscation, bundle hashes,
   WASM or integrity checks in browser JavaScript run on the attacker's machine and
   can be removed; published userscripts defeat them for popular web games. Foundation
   ships no client-side anti-cheat and does not claim it would help.
3. **Real protection is architectural, on a host you run:**
   - **Server authority**: the host owns state; clients send inputs, not results.
   - **Validation**: the host checks every command against state it owns.
   - **Minimal disclosure**: the host sends each client only what it may know.
   - **Rate and clock limits**: the host bounds how fast commands arrive and how much
     simulated time they claim.
   - **Server-side verification**: claimed results are re-derived, never trusted.

A host can enforce only four things: what it accepts, how fast, what it discloses and
what it later re-verifies. Everything else, statistics included, is evidence for a
human, not proof.

## What existing protections stop, and what they do not

| Protection (owner) | Stops | Does not stop |
|---|---|---|
| Bounded intake ([network kit](../../src/kits/network/README.md)): byte, node, depth, pre-auth and queue bounds | Oversized, deep or malformed payloads; unauthenticated traffic; queue flooding | Well-formed but impossible commands; many accounts; bots within the rules |
| Current authorization (`authorize` port, rechecked at dispatch) | Acting on what the principal does not own; continuing after revocation | Plausible misuse of the principal's own objects |
| Scoped views (NW-02) | Reading hidden state from client memory, when the projection omits it (see [disclosure](#disclosure-as-anti-cheat)) | Anything the projection does send; inference from what is shown |
| Durable authority (NW-03) | Replayed or renumbered commands, forged retries, rollback within a lineage | Commands valid under the reducer's rules but implausible |
| Rate admission (NW-05) | Message floods and fast probing per key | Slow, careful cheating |
| Queue age / deadlines (NW-06) | Stale backlog applied long after it was sent | Anything about content |
| Close policy | Honest clients reconnect-spamming after a terminal refusal | A modified client ignoring it (the host must still refuse) |
| **Integrity validity rules (SEC-01)** | Implausible commands judged against authoritative state: too far per tick, out of range or set, out of order, inside a cooldown, claimed time outside a band | Anything the rules do not describe; aim assistance; play within disclosed information |
| **Integrity tick budget (SEC-01)** | Speed-ups: claiming more simulation ticks than host time allows, beyond one bounded catch-up | Slowed clients; cheats inside the tolerance |
| **Integrity scoring (SEC-01)** | Repeat offenders: throttle, then close with a terminal reason after windowed evidence | Multi-accounting; a careful cheater who stays below thresholds |
| Verified runs (SEC-01 slice B, planned) | Forged single-player results whose replay disagrees | Tool-assisted runs that replay honestly |

## The design: validity separate from policy

A command refused before the durable authority consumes its sequence leaves a gap:
every later command from that stream returns `gap`, and the client's prediction never
reconciles. One false positive would stall an honest player. Studied systems instead
make invalid input inert or set the player back to the last valid state. Foundation
does the same with existing machinery:

- **Validity** (`assess`) is pure and deterministic: rules see only `{command, state,
  tick}`. Run it **inside the authority reducer**. An invalid command is a domain
  rejection: unchanged state plus a terminal result (for example `{rejected: rule}`).
  The authority consumes the sequence and advances the revision; the client's
  prediction reconciles to the authoritative baseline, which *is* the set-back. Exact
  retries return the same receipt. The same rules can re-run in replay verification.
- **Policy** (`admit`, `record`) is local and not replayed: scores, decay, the tick
  budget, throttle and close, observe mode and the audit log.
- **`check`** = `admit` + `assess` + `record`, for **unsequenced** commands (chat, lobby,
  one-shot actions, the network workbench counters), where refusing leaves no gap.

Rule for creators: **a refused sequenced command must be consumed as a no-op or the
stream explicitly resynchronised.** `throttle` is a refusal the client retries (like
`busy`) and `close` is a terminal end, but a throttled sequenced command is not
consumed: commands the client already pipelined behind it would hit `gap` until it is
retried. While one sequence of a stream is throttled, the host must hold or refuse
(`busy`) that stream's later sequences without calling `admit` for them, and the client
resends the throttled one after `retryAfterMs`. An `admit` `reject` (`tick-claim`) can
never succeed on retry: consume that command as a no-op (or close).

## Inputs and outputs

```ts
import { createIntegrity, integrityRules, integrityOk, integrityFlag } from '@kits/network';

const integrity = createIntegrity<Command, View>({
  rules: [
    integrityRules.maxRateOfChange({ id: 'move-rate', perTick: 0.2, allowance: 0.002, maxElapsedTicks: 8,
      current: ({ state }) => state.position,                     // last authoritative value, or null
      proposed: ({ command }) => command.to,                       // value the command would produce
      elapsedTicks: ({ state, tick }) => tick === null || state.positionTick === null ? null : tick - state.positionTick }),
    integrityRules.valueInRange({ id: 'amount', min: 1, max: 5, integer: true, value: ({ command }) => command.amount }),
    { id: 'custom', mode: 'observe', check: ({ command, state }) => command.x <= state.limit ? integrityOk() : integrityFlag('custom', 1) },
  ],
  limits: { maxKeys: 256, maxHistoryPerKey: 8, maxAudit: 512 },
  decayPerSecond: 0.5,
  enforcement: 'observe',                                  // measure first; switch to 'enforce' later
  config: 'rules-v1',
  tickBudget: { ticksPerSecond: 60, maxCatchUpTicks: 8 },   // optional speed-up bound
  throttle: { score: 3, capacity: 2, refillPerSecond: 1 },  // optional
  close: { score: 6, requires: { violations: 5, withinMs: 10_000 } }, // optional
});
```

All values are examples, not recommendations.

### Rules

`{id, mode?, maxScore?, check(input)}`. `input` is frozen `{command, state, tick}`:
deterministic data only, no score, connection or host clock. `check` returns
`integrityOk()`, `integrityReject(reason, weight = 0, evidence?)` or
`integrityFlag(reason, weight = 1, evidence?)`. Ids and reasons are close-reason tokens
(1-64 of letters, digits and `._:-`). Weights are finite, 0 to 1e6. `evidence` is
optional JSON for reviewers, bounded by `limits.maxEvidenceBytes` (default 512); larger
evidence is dropped and counted, never truncated. `mode: 'observe'` audits the rule
without acting or scoring. `maxScore` caps the rule's decaying contribution per key.

### Methods

| Method | Mutates | Returns |
|---|---|---|
| `assess({command, state, tick})` | No key or score state (pure, deterministic) | `{verdict, wouldBe, rule, reason, findings}`. `verdict` is `ok`/`invalid` (always `ok` in owner observe mode; `wouldBe` keeps the enforced answer). Rules run in order: a flag continues, the first enforced reject or rule error decides. |
| `admit(key, now, {tick? \| ticks?, ref?})` | Key score, buckets, audit | `allow`, `throttle` (`throttled` or `tick-budget`, with `retryAfterMs`), `reject` (`tick-claim`, never retryable), `close` or `refused`. Call before dispatch or `submit`. |
| `record(key, assessment, now, ref?)` | Key score, audit | `allow` or `close` (or `refused` with `invalid-assessment` for a foreign, copied or already recorded assessment). Call once after the outcome is known. |
| `check(key, input, now, {ticks?, ref?})` | as above | `allow`, `reject`, `throttle`, `close` or `refused`. Unsequenced commands only. |
| `read(key, now?)`, `audit()`, `exportAudit()`, `stats()`, `forget(key)`, `dispose()` | | Inspection, local export, cleanup. |

`allow` carries `observed`: the action that observe mode suppressed (`reject`,
`throttle`, `close`) or null. `refused` reasons: `invalid-time`, `invalid-key`,
`invalid-assessment`, `busy`, `retired`, `disposed`. Do not dispatch on `refused`.

### Generic helpers (`integrityRules`)

Pure, tick-addressed, no game nouns. Common options: `id`, `violation: 'reject' | 'flag'`
(default reject), `weight` (default 1), `mode`, `maxScore`. The reason is the `id`.

| Helper | Passes when | Notes |
|---|---|---|
| `maxRateOfChange({current, proposed, elapsedTicks, perTick, allowance?, maxElapsedTicks?})` | distance <= `allowance + perTick * clamp(elapsedTicks, 1, maxElapsedTicks)` | Numbers or equal-length vectors (up to 16 dimensions). `current` or `elapsedTicks` null passes (no authoritative value yet). Evidence `{distance, allowed}`. |
| `valueInRange({value, min, max, integer?})` | finite number in [min, max] | |
| `valueInSet({value, allowed})` | strictly equal to one of at most 256 values | |
| `monotonic({value, previous, strict?, maxStep?})` | advances past `previous` by at most `maxStep` | `previous` null passes. |
| `cooldown({lastTick, cooldownTicks, tick?})` | `tick - lastTick >= cooldownTicks` | `lastTick` null passes; a missing current tick is a violation. |
| `claimedTickInBand({claimed, hostTick?, maxBehindTicks, maxAheadTicks, behindWeight?})` | claimed within the band around the host tick | Ahead of the band is scored with `weight`; behind it is invalid (a no-op) but scores `behindWeight` (default 0), because stale input after stalls, reconnects and jitter is normal for honest clients. Bounds latency compensation; the rewind itself is creator code. Evidence `{claimed, host}`. |

**Ticks, not arrival time.** Network jitter, batching and resumed background tabs
bunch honest commands; dividing by host arrival time turns that into false positives.
Use tick differences between the authoritative value and the command, and pair them
with the tick budget, which stops a client claiming more ticks than host time allows:
"no more than v per tick" is validity; "no more ticks than real time" is policy. Host
milliseconds can stand in for ticks (the network workbench does this), but that variant
is jitter-sensitive: give it a generous `allowance`, prefer `flag`, and observe first.

**Authoritative moves.** When the host itself moves a subject (respawn, impulse,
transfer), update the authoritative value and its tick in that same transaction, so the
next client command is measured from it and does not look like a jump.

### Tick budget (anti speed-up)

`tickBudget: {ticksPerSecond, maxCatchUpTicks, slack?, weight?, maxScore?, mode?}` gives each
key a token bucket (the existing [rate admission](rate-admission.md)) of
`maxCatchUpTicks`, refilled at `ticksPerSecond * (1 + slack)` of host time (`slack`
default 0.05, so an honest client playing at exactly the tick rate regains headroom
after a catch-up burst).

- **What is charged.** `admit(key, now, {tick})` charges the **claimed tick advance**
  since the key's last admitted tick, clamped to `[1, maxCatchUpTicks]` (a same-tick or
  backwards claim costs 1, matching `maxRateOfChange`, which treats elapsed 0 as 1).
  `{ticks: n}` charges an explicit positive integer instead. **The tick gap `admit`
  charges must be the tick gap your rules use**: rules measure elapsed ticks from the
  same claimed tick, and must clamp what one command may cover (`maxElapsedTicks`) to at
  most `maxCatchUpTicks`. Otherwise a client can claim `tick + 8` per command, pay for
  one tick and move eight. Also bound claims against the host's own tick with
  `claimedTickInBand`, so claims cannot run ahead of real time, and keep them moving
  forward with an unscored `monotonic` rule against the authoritative last tick. The
  owner charges the gap from the **last admitted claim** (not the highest claim ever),
  so one absurd claim cannot make later claims cheap. Every rule `allowance` is granted
  per command: keep it tiny, or a client gains `allowance / perTick` extra speed.
- **Throttle, not punishment.** Over budget returns `throttle` (`tick-budget`, with
  `retryAfterMs`): the command is not lost, it waits for real time. Only a retry that
  arrives **before** the previous `retryAfterMs` scores `weight` (and counts as a
  violation); a client that waits gains nothing and is never scored by the budget. Rules
  can still score: use unscored (weight 0) no-ops for conditions honest clients hit
  (stale claims behind the host, out-of-order claims), as the recipe does. The
  end-to-end probes below exercise stalls, reconnects and resync under jitter with the
  recipe's full rule set; that is test evidence for those modeled clients, not a
  guarantee for every client implementation.
- **Never fits.** A malformed claim (non-integer, negative) or `ticks` above
  `maxCatchUpTicks` returns `reject` (`tick-claim`) and scores `weight`: retrying cannot
  help. Ticks are integers of at least 1.
- **Sizing.** Set `maxCatchUpTicks` at least to the client's prediction `maxPending`, so
  inputs resent after a reconnect fit. Idle time is never banked beyond
  `maxCatchUpTicks`. A hidden tab stops animation frames; when the client resumes, it
  either continues from its paused tick or resynchronises with one jump (charged one
  full bucket). It detects fast clocks only.

## Scoring, thresholds and actions

- **Score**: findings add their weights when recorded (observed findings add nothing);
  the score decays linearly by `decayPerSecond` of host time, never below zero, capped
  at 1e9. `maxScore` per rule (and per tick budget) caps that source's own decaying
  contribution, so one noisy rule under a lag spike cannot reach `close` alone.
- **Throttle**: at or above `throttle.score`, `admit` passes the key through a token
  bucket; limited returns `throttle` (`throttled`) without running rules.
- **Close**: at or above `close.score`, and, when `close.requires` is set, with at least
  `violations` violations within `withinMs`, `admit` and `record` return `close`.
  Comparisons are `>=`: exactly the threshold triggers. A violation is one scored event:
  one recorded command with a scored finding (however many rules it trips) or one scored
  tick-budget refusal; unscored (weight 0) rejections are not violations. The
  window stops one heavy finding, or one command tripping several rules, from closing a
  player.
- **Observe mode**: `enforcement: 'observe'` computes everything (scores accumulate,
  every audit entry is written with `observed: true`, flags included) but `assess` returns `ok` and every
  decision is `allow` with `observed` naming the suppressed action. Stats count
  `wouldReject`, `wouldThrottle` and `wouldClose`. Rule-level `mode: 'observe'` shadows
  one rule entirely (no score, no action).
- **Terminal close reason**: default `integrity-violation` (`INTEGRITY_CLOSE_REASON`).
  The stock close policy is unchanged; opt in on the client:
  `createClosePolicy({ terminalReasons: [...DEFAULT_TERMINAL_CLOSE_REASONS, INTEGRITY_CLOSE_REASON] })`.
  A modified client can ignore this; the host's protection is that the key keeps its
  score, so it is closed again on its next command while the conditions hold.

**Recommended adoption order:** observe, then enforce validity (set-back), then the
tick budget and throttle, then close.

## Identity and bounds

- **Keys**: use the authenticated principal or the authority stream identity, never the
  connection handle, so reconnecting does not reset a score.
- **Key table**: at most `limits.maxKeys`. A new key at the bound evicts the
  least-recently-seen key (counted in `evicted`, and `evictedScored` when it still had a
  score). A new key is **never refused**, so offenders filling the table cannot lock
  honest players out. Size `maxKeys` well above the connection bound so live keys are
  not evicted; an evicted offender's memory is lost (fail open for that memory).
- **History and audit**: at most `maxHistoryPerKey` entries per key and `maxAudit`
  overall, oldest dropped first (`dropped` counts audit evictions).
- **Rules**: at most 32 per owner. **Window**: at most 64 violations.
- **Work**: `assess` runs each rule at most once. Rule CPU is not preemptible; from the
  intake `authorize` port, checks per pump are bounded by `maxPumpOperations`.

## Audit and review

Entries are frozen `{seq, at, subject, config, kind, rule, reason, weight, score,
observed, ref, evidence}`: a monotonic sequence, an exportable `subject` label
(`options.subject(key)`, default the string key or `anonymous`), the rule-set `config`,
the kind (`reject`, `flag`, `rule-error`, `tick-budget`, `throttle`, `close`), the weight
actually applied, an optional `ref` `{stream, sequence, tick}` and bounded evidence.
Scored entries are always audited. Unscored rows (weight-0 findings such as stale or
out-of-order no-ops, `throttle`, unscored `tick-budget`, repeated `close`) spend a per-key
allowance: a burst of
`maxHistoryPerKey`, refilled at `limits.auditRowsPerKeyPerSecond` (default 1); beyond it
they are counted in `stats().auditSuppressed`, so one key cannot flush others' evidence
by alternating clean and refused admits or by sending no-ops. A key's own history evicts
its oldest unscored row first, so its scored evidence is kept. Every recorded finding is still audited; a key
sending many invalid commands can still crowd the shared log, so size `maxAudit` and
review `dropped`.
`exportAudit()` returns deterministic JSON text (`format: 'foundation.integrity-audit'`,
`version: 1`, `config`, `enforcement`, `dropped`, `entries`) for local review; with
`ref` ticks a reviewer can open the matching replay. `onAudit(entry)` is a synchronous
local sink; its exceptions are swallowed and counted. Nothing is sent anywhere. In a
kid-safe game, do not profile player behaviour; collecting, exporting or analysing
player data is the creator's decision with its privacy and legal obligations.

## Time, failure, cancellation and recovery

- **Time** is caller supplied host time (monotonic, such as `performance.now()`), finite,
  nonnegative and at most `Number.MAX_SAFE_INTEGER`; a backwards reading is counted and
  grants no decay or refill. Invalid time is `refused`.
- **Fail closed**: a rule that throws, returns an unknown kind, a non-token reason or an
  invalid weight (or whose verdict getter throws) is a `rule-error` finding: an enforced
  one makes the command invalid (inside a reducer, a set-back, which is safe) and scores
  `ruleErrorWeight` (default 0, so a broken rule never closes a player); an observed one
  only audits.
- **Overload** never throws: decisions are explicit.
- **Reentrancy**: calling the owner from a rule or sink returns `busy`; `forget` of the
  current key during `check` yields `retired`, `dispose` yields `disposed`.
- **Records**: an assessment can be recorded once. After an authority `unknown` outcome,
  record only once settlement reveals the receipt; never record a `duplicate` again.
- **Cancellation**: `forget(key)` drops a key's score, history and buckets (do not call
  it on every disconnect). `dispose()` is idempotent.
- **Recovery**: scores decay and buckets refill with host time. State is in memory and
  single process: restart clears it. Durable sanctions belong in the creator's
  authoritative state (for example a field in the authority checkpoint).

## Disclosure as anti-cheat

Information leaks (seeing through walls, revealing hidden cards or future random
draws) are invisible to every host-side detector: a client can display anything it
receives. The only defence is not sending it. The view publisher's `project()` is
already per connection, and complete views drop anything omitted.

1. Project only what the observer's rules allow them to know.
2. To avoid pop-in, expand disclosure bounds by `speed x lookAhead`, with `lookAhead`
   at least RTT + projection interval + credit wait (one-credit acknowledgement makes
   cadence RTT-limited). Every unit of expansion is information a cheat can show.
3. Withhold presentation-only secrets: positions of unseen subjects, hidden contents,
   future random draws.
4. Disclosed information cannot be recalled; clearing a receiver does not make a
   remote observer forget.
5. Lockstep and full-state replication disclose everything by design.

Because leaks cannot be detected at runtime, test them: `assertDisclosure(projectJson,
allowed)` (and `findDisclosureLeaks`, at most 64 results) checks a projection against a
predicate `allowed(entityId, fieldPath)` (`''` for the entity itself; leaves and empty
containers are checked). Use it in creator tests for each observer role.

## Reference host example

`tools/network-workbench` (`startNetworkWorkbench({integrity: true})` or
`node --import tsx tools/network-workbench/server.mjs --integrity`) wires `check` in the
intake `authorize` port for its unsequenced counter commands: a counter may rise by at
most 20 units per second of host time (the host-time variant). Refusals disclose only
`integrity`; three violations within 5 s reaching a score of 2.5 close with 1008
`integrity-violation`; scores are keyed by principal and decay by 0.5 per second. Off by
default; without the option the host behaves exactly as before.

## Evidence

- `src/kits/network/integrity-probes.test.ts` (`SEC01 probe:`, 4 tests): the recipe's
  full rule set end to end (admit, reducer `assess`, record). Claim poisoning, ping-pong,
  same-tick spam, naive and band-capped claim inflation and impatient retries each gain
  at most 5% over honest distance; the owner alone (without the tick-order rule) keeps
  poisoning and ping-pong within 10%; modeled honest clients with 5-300 ms jitter, 1-10 s
  stalls (resync, catch-up, paused tick) and 0.2-5 s reconnect outages are never closed;
  a 20 s flood of unscored no-ops neither evicts another key's scored row nor its own.
- `src/kits/network/integrity.test.ts` (`SEC01:`, 23 tests): no effect without rules or
  thresholds; `assess` purity and single-use records; an invalid sequenced command
  consumed as a domain rejection inside `createDurableAuthority` so the next sequence
  commits and `createPrediction` reconciles (set-back), with the contrasting `gap` when
  refused before submit; fail-closed throwing/malformed rules and observed rule errors;
  owner observe mode; a slow rule bounded by `maxPumpOperations`; linear decay and clock
  regression; key churn never refusing honest keys; exact and windowed close thresholds;
  per-rule ceilings; tick budget (honest pace, bounded catch-up, headroom regained through
  slack, only early retries scored, impossible claims rejected, same-tick cost 1); the
  recipe's exact setup against an 8x tick-claim speed hack (a waiting cheater gains
  nothing, an impatient one is closed); honest reconnect with 24 pending inputs and a
  hidden-tab stall with jitter never closing; one key's refusal flood (including
  alternating clean and throttled admits) not evicting another key's evidence; scored
  refusals always audited; one command counting as one window violation; terminal close classification; bounded audit, evidence and export; reentry
  and disposal; configuration errors; every helper's boundaries; `assertDisclosure`.
- `tools/network-workbench/server.test.mjs` (`SEC01:`): real sockets; without the
  option rapid commands are applied as before; with it, rapid commands are refused
  generically, the fourth closes with 1008 `integrity-violation`, the audit and export
  name the rule, and a paced peer is unaffected.

These are unit and loopback host tests. They establish no detection quality, measured
load, WAN, multi-process, physical-device or real-world cheat-resistance claim. No
browser composition of the integrity example is claimed, and the authority composition
is a unit test with in-memory storage, not a reference-host integration.

## What creators must know

- Nothing on the player's device is trustworthy. The integrity owner enforces *your*
  rules; it does not know your game and cannot invent rules for it.
- Rules that tolerate latency also tolerate cheats inside the tolerance. Tighter bounds
  mean more false positives on poor connections, phones and throttled background tabs.
  You choose the trade-off: measure it in observe mode first.
- False positives are your players. Prefer set-back over close; close only on
  sustained, windowed evidence; never wire automatic bans to statistical signals.
  Published detectors run at multi-percent false-positive rates; operators use human
  review and appeals.
- Out of scope for the engine: accounts and identity verification, ban persistence and
  appeals, multi-account detection, device fingerprinting, CAPTCHA and proof-of-work,
  distributed or address rate limiting, kernel anti-cheat and machine-learning detection.
- What is a cheat is a game-design decision. Unit tests and emulated browsers do not
  certify detection quality, multiplayer behaviour at scale or device timing.

## Slice B: verified runs (planned, not built)

Builds on the replay kit from SIM-01 (public PR #17, merged to `main` at `49047ae`).
Nothing below is implemented in this slice.

**Purpose**: verify single-player or asynchronous results (a score, a completion time)
submitted to a host instead of trusting them.

**Design** (a host-side `createRunVerifier` owner):

1. The host issues a run token `{build, config, seed, step, issuedAt, session}`, where
   `config` names the integrity rule set and its `enforcement` setting, so a replay
   judges the run under the same rules; the
   client never chooses the seed, so it cannot search seeds offline.
2. The client records the run with the SIM-01 recorder and submits the claimed result
   plus the exported log text.
3. The verifier checks size and tick limits before parsing, opens the log with
   `openReplay` and the token as `expect`, re-simulates it in bounded slices on the
   host's own build, runs the **same `assess` validity rules** per tick, checks wall-clock
   plausibility (`ticks x step <= submittedAt - issuedAt + slack`), compares digests and
   derives the result. Outcomes: `verified`, `invalid(rule, tick)`, `diverged(tick)`,
   `inconclusive`, `refused`, `expired`. Limits: `maxTicks`, `ticksPerPump`, `maxPending`,
   `deadlineMs`; `cancel(id)` and `dispose`.

**Limits to design for**:

- **Floating-point determinism**: basic arithmetic and `sqrt` are correctly rounded
  everywhere, but `Math.sin`, `exp`, `pow` and similar are implementation-approximated
  and may differ across engines. Verify on the host's engine and keep simulation math
  deterministic (avoid those functions or use a pure-JS implementation); treat a
  cross-engine difference as a determinism bug, not a tolerance to widen silently.
- **Replay cost**: about one full simulation per verification. Bound ticks per pump,
  total ticks, pending verifications and deadlines, with per-principal rate admission.
- **Log size**: cap bytes, ticks and runs before parsing (`openReplay` limits and intake
  byte bounds).
- **What it cannot prove**: consistency, not humanity. A tool-assisted run, or one
  recorded with the game slowed, replays correctly. Logs can be withheld or chosen as
  the best of many attempts.
