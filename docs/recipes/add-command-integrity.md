# Recipe: add anti-cheat to your game in 5 minutes

This adds host-side command integrity (SEC-01) to a networked game with an
authoritative host built on the network kit (see `tools/network-workbench/server.mjs`
for a complete host). It is optional and off until you construct it. Background,
bounds and limits are in the [integrity guide](../guides/integrity.md).

**The rule that matters most:** the browser client is untrusted. Obfuscation or tamper
checks in client code are not anti-cheat; anyone can remove them. Protection lives on
the host: it owns the state, validates every command, limits how fast and how much
simulated time commands claim, and discloses only what each player may see.

## 1. Keep the facts a rule needs in authoritative state (1 minute)

Rules compare a command with **authoritative** state, never with what the client says
happened before. When you apply a command, record the value and the tick it applied at:

```ts
state.players[id].position = command.to;
state.players[id].positionTick = command.tick;
```

When the host itself moves something (respawn, impulse), update both in the same step.

## 2. Describe what is valid (2 minutes)

Use `integrityRules` helpers or plain functions. Rules see `{command, state, tick}` only,
must be pure, and measure **ticks**, not arrival time (network jitter and background
tabs bunch honest commands). The tick a command carries is the client's *claim*, so
three things must line up, or a client can claim `tick + 8`, pay for one tick and move
eight:

- `admit` charges the claimed tick gap (`{tick: command.tick}`), not a fixed 1;
- rules measure elapsed ticks from that same claimed tick, clamped by
  `maxElapsedTicks` to at most `maxCatchUpTicks`;
- `claimedTickInBand` keeps claims near the host's own tick, and a `monotonic` rule keeps
  them moving forward from the authoritative last tick (backwards claims would shrink
  cooldowns and let a client alternate claims to move further).

Stale or out-of-order claims are normal for honest clients (stalls, reconnects, jitter):
make them no-ops without score. `claimedTickInBand` scores only claims *ahead* of the
host (`behindWeight` defaults to 0), and the tick-order rule below uses `weight: 0`.

```ts
import { createIntegrity, integrityRules, integrityOk, integrityFlag, type IntegrityAssessment } from '@kits/network';

// `state` here is a view for one player: { me, limit, hostTick }.
const integrity = createIntegrity<Command, View>({
  rules: [
    // Claims may lag the host's tick (latency; unscored no-op when too stale) but never run ahead of it (scored).
    integrityRules.claimedTickInBand({ id: 'tick-band', maxBehindTicks: 30, maxAheadTicks: 2,
      claimed: ({ command }) => command.tick, hostTick: ({ state }) => state.hostTick }),
    // Claims only move forward from the authoritative last tick; anything else is an unscored no-op.
    integrityRules.monotonic({ id: 'tick-order', weight: 0, value: ({ command }) => command.tick,
      previous: ({ state }) => Math.max(state.me.positionTick, state.me.lastUseTick ?? -Infinity) }),
    // A selector returning null means "nothing to compare", so other actions pass this rule.
    // Keep `allowance` tiny: it is granted on every command, so 0.05 here would be a free 25% speed-up.
    integrityRules.maxRateOfChange({ id: 'move-rate', perTick: 0.2, allowance: 0.002, maxElapsedTicks: 8,
      current: ({ state, command }) => command.action === 'move' ? state.me.position : null,
      proposed: ({ command }) => command.to,
      elapsedTicks: ({ state, tick }) => tick === null ? null : tick - state.me.positionTick }),
    integrityRules.valueInSet({ id: 'action', allowed: ['move', 'use'], value: ({ command }) => command.action }),
    integrityRules.cooldown({ id: 'use-cooldown', cooldownTicks: 60,
      lastTick: ({ state, command }) => command.action === 'use' ? state.me.lastUseTick : null }),
    // The cooldown measures the same claimed tick, which the band and the tick budget bound.
    { id: 'custom', check: ({ command, state }) => command.amount <= state.limit ? integrityOk() : integrityFlag('custom', 2) },
  ],
  limits: { maxKeys: 256, maxHistoryPerKey: 8, maxAudit: 512 },
  decayPerSecond: 0.5,
  enforcement: 'observe',                                 // start by measuring false positives
  // No more ticks than real time. maxCatchUpTicks >= prediction maxPending, and >= maxElapsedTicks above.
  tickBudget: { ticksPerSecond: 60, maxCatchUpTicks: 16 },
  close: { score: 6, requires: { violations: 5, withinMs: 10_000 } },
});
```

The numbers are examples. Choose them from your own game and measure.

## 3. Wire it in (1 minute)

Key everything by the authenticated principal (or stream) so reconnecting does not
reset a score.

**Sequenced commands (durable authority):** refusing one before `submit` leaves a gap
and stalls the player. Validate **inside the reducer** instead, so an invalid command is
consumed as a no-op and the client's prediction snaps back:

```ts
// One pending assessment per stream, kept until its outcome is known (including after an
// unknown outcome that settles as a duplicate), so scoring never silently fails open.
const pending = new Map<string, { sequence: number; assessment: IntegrityAssessment | null }>();
const voided = new Set<string>(); // `${stream}:${sequence}` consumed as a no-op (impossible tick claim)
const held = new Map<string, number>(); // stream -> throttled sequence awaiting its retry

const authority = createDurableAuthority({ /* ... */
  reduce({ stream, sequence, state, input }) {
    if (voided.has(`${stream}:${sequence}`))
      return { stateJson: JSON.stringify(state), resultJson: JSON.stringify({ rejected: 'tick-claim' }) };
    const assessment = integrity.assess({ command: input, state: viewFor(state, stream), tick: input.tick });
    pending.set(stream, { sequence, assessment });
    if (assessment.verdict === 'invalid')
      return { stateJson: JSON.stringify(state), resultJson: JSON.stringify({ rejected: assessment.rule }) };
    return applyCommand(state, input);
  },
});

// In the intake authorize port: policy only (close state, tick budget, throttle).
const blocked = held.get(stream);
if (blocked !== undefined && sequence !== blocked) { replyBusy(peer, command); return false; } // would gap
const gate = integrity.admit(principal.id, performance.now(), { tick: input.tick, ref: { stream, sequence } });
if (gate.action === 'close') { intake.close(peer, gate.reason); return false; }
if (gate.action === 'throttle') { held.set(stream, sequence); replyBusy(peer, command, gate.retryAfterMs); return false; }
if (gate.action === 'reject') voided.add(`${stream}:${sequence}`); // submit it anyway: consumed as a no-op
else if (gate.action !== 'allow') { replyBusy(peer, command); return false; }
held.delete(stream);

// After submit:
const out = await authority.submit({ stream, sequence, inputJson });
voided.delete(`${stream}:${sequence}`);
const entry = pending.get(stream);
if ((out.status === 'committed' || out.status === 'duplicate') && entry?.sequence === sequence) {
  pending.delete(stream);
  if (entry.assessment) {
    const decision = integrity.record(principal.id, entry.assessment, performance.now(), { stream, sequence, tick: input.tick });
    if (decision.action === 'close') intake.close(peer, decision.reason);
  }
} else if (out.status !== 'unknown') pending.delete(stream); // not consumed: nothing to score
```

`record` accepts each assessment once, so a later duplicate of an already scored
command is refused (`invalid-assessment`) rather than counted twice.

**Unsequenced commands** (chat, lobby, one-shot actions) can use `check` directly:

```ts
const decision = integrity.check(principal.id, { command, state: viewFor(state, principal.id), tick: null }, performance.now());
if (decision.action === 'allow') return true;
if (decision.action === 'close') intake.close(peer, decision.reason);
else reply(peer, { type: 'refused', reason: 'integrity', id: command.id }); // say little
return false;
```

Dispose with the host: `integrity.dispose()`.

## 4. Stop clients reconnect-spamming (30 seconds)

```ts
import { createClosePolicy, DEFAULT_TERMINAL_CLOSE_REASONS, INTEGRITY_CLOSE_REASON } from '@kits/network';
const closePolicy = createClosePolicy({ terminalReasons: [...DEFAULT_TERMINAL_CLOSE_REASONS, INTEGRITY_CLOSE_REASON] });
```

## 5. Measure, then enforce (30 seconds)

Play with `enforcement: 'observe'`. Read `integrity.stats()` (`wouldReject`,
`wouldThrottle`, `wouldClose`) and `integrity.exportAudit()` (local JSON text: rule,
evidence, stream/sequence/tick). When honest play stays clean, switch to `'enforce'`.
Nothing is sent anywhere unless you send it.

Also test what you **disclose**: a client can show anything it receives, and no host
check can see that. In your tests, call
`assertDisclosure(projectJson, (entityId, fieldPath) => mayKnow(observer, entityId, fieldPath))`.

## Pitfalls

- Under heavy jitter after a stall, an honest client sending one input per tick is
  paced by the tick budget and falls behind (probes measured 5-9% less distance). Batch
  on the client (one command covering several ticks, charged with `{ticks: n}` and
  validated with the same tick gap) or drop stale inputs instead of resending them all.

- Charge the claimed tick (`admit(..., {tick})`), never a fixed `{ticks: 1}`, when rules use claimed ticks.
- While a sequenced command is throttled, hold that stream's later sequences; they would gap.

- Never refuse a sequenced command for validity before `submit`; consume it as a no-op.
- A rule that throws makes the command invalid but scores nothing by default
  (`stats().ruleErrors` shows it).
- Rules tolerant of latency also tolerate cheats inside the tolerance; you choose.
- Close only on sustained, windowed evidence. Never auto-ban on statistics.
- Integrity rules do not detect bots, aim assistance or collusion; scores are in memory
  and a host restart forgets them.
