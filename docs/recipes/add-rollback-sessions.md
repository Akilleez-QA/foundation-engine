# Recipe: add rollback sessions

Use the optional `@kits/rollback` kit when peers share one deterministic
fixed-step simulation. Each peer applies its own input at once, predicts remote
input, and corrects by rolling back and resimulating. It suits games where every
peer runs the whole simulation. For server-authoritative state, use
[prediction](../guides/prediction.md) instead. Read the
[kit README](../../src/kits/rollback/README.md) for the full contract, bounds and
evidence.

## 1. Record the requirement

In GAME.md, record:

- the requirement and the success criterion it serves, for example "two peers end every match in identical state";
- the supported link (the session needs a reliable, ordered transport);
- the chosen `maxPredictionFrames` and `inputDelay`;
- what happens on a stall or a desync.

These are creator choices, not engine defaults.

## 2. Make the simulation a value with three ports

Keep the simulated state in one object you can encode as text. Prefer integers or
fixed-point numbers: `JSON.stringify` turns `-0` into `0` and `NaN`/`Infinity`
into `null`. The checksum is taken over that text, so a value that does not round-trip
makes a peer that loaded a snapshot differ from one that did not. Randomness must
be part of that state too. `ctx.random()` keeps its generator state where a save
cannot reach it, so use `createSaveableRng(seed)` from `@engine`. Its whole state
is one 32-bit word: save `rng.state()` and call `rng.restore(word)` on load. Its
draws are exactly those of `createRng` for the same seed. A frame-exact
[input history](add-input-history.md) belongs in the saved state as well.

```ts
import { createSaveableRng } from '@engine';

const rng = createSaveableRng(matchSeed);
const ports = {
  save: () => JSON.stringify({ sim, rng: rng.state() }),   // complete state, stable key order
  load: (text: string) => { const s = JSON.parse(text); sim = s.sim; rng.restore(s.rng); },
  step: (inputs: readonly string[], frame: number) => stepSim(sim, rng, inputs, frame),
};
```

Prove the ports deterministic before adding a network:

```ts
import { createRollbackSyncTest } from '@kits/rollback';

test('S3: the simulation resimulates identically', () => {
  const sync = createRollbackSyncTest({ checkDistance: 8, players: 2, maxStateBytes: 65536, maxInputBytes: 16, ports });
  for (let f = 0; f < 600; f++) assert.equal(sync.advance(scriptedInputs(f)).status, 'checked');
});
```

## 3. Drive the session from a fixed system

```ts
import { createRollbackSession } from '@kits/rollback';

const session = createRollbackSession({ local, neutralInput: '0', limits, ports, signal });
let carried = 0;          // edge bits (presses) not yet accepted by local()
let theirAdvantage = 0;   // the peer's last reported frameAdvantage for us
export const netplay = defineSystem({ id: 'my-game-netplay', run(ctx) {
  for (const m of transport.drain()) {   // creator's reliable, ordered link
    if (m.kind === 'input') session.remote(m.player, m.frame, m.input);
    else if (m.kind === 'advantage') theirAdvantage = m.value;
    else session.remoteChecksum(m.player, m.frame, m.checksum);
  }
  carried |= pressBits(ctx.input);       // a press must survive a tick where local() is full
  // Pacing: skip ticks while clearly ahead, using half the exchanged difference (removes link latency).
  const mine = session.read().frameAdvantage[1 - local];
  if ((mine - theirAdvantage) / 2 > 2) return;   // threshold is a creator choice
  const queued = session.local(encodeInput(heldBits(ctx.input) | carried));
  if (queued.status === 'queued') {
    carried = 0;
    transport.send({ kind: 'input', player: local, frame: queued.frame, input: queued.input });
  }
  if (ctx.time.frame % 30 === 0) transport.send({ kind: 'advantage', value: mine });
  const r = session.advance();
  if ('checksums' in r) for (const c of r.checksums) transport.send({ kind: 'checksum', player: local, ...c });
  if (r.status === 'desynced' || r.status === 'failed') ctx.scene.goto('my-game-lobby');
} });
```

- Encode actions read through `ctx.input`, never raw keys. Prefer held state (buttons down, directions). `local()` accepts one input per frame and returns `full` while stalled, without keeping the input, so carry any edge (a press) forward until an input is queued, as above.
- Without pacing, a peer that starts late or hitches leaves the other peer a full prediction window ahead for good. That peer then makes deep rollbacks on every late input and stalls often. The fixed-step runner drops ticks beyond `maxSteps`, so a long hitch is not caught up.
- Presentation systems (`phase: 'frame'`) read `sim` after the fixed lane. They must accept that a rollback can correct it.
- Pass the scene visit's signal so the session retires with the visit.

## 4. Handshake and recovery

Before the first frame, exchange `session.read().config` and refuse to start on a
mismatch. After `desynced` or `failed`, build a new session from an agreed
`confirmedState()`; never keep stepping the old one.

## 5. Check

Run `npm run check`. A test named after the success criterion should cover:

- a seeded two-peer run over delayed links that ends in identical confirmed checksums;
- your stall and desync handling.

These are finite headless checks. Network conditions, physical devices and
floating-point agreement across browsers need their own recorded evidence.

Peers on different browsers run the same `step` in different JavaScript engines.
`+ − × ÷` and `Math.sqrt` agree everywhere, but `Math.sin`, `cos`, `atan2`, `exp`,
`log`, `pow` and `hypot` do not, and one ulp is enough to fail a confirmed-state
checksum. Use `dmath` from `@engine` for those functions in `step`, and pass
`math: 'deterministic'` to the character, locomotion and root-motion kits if the
simulation uses them. See [deterministic maths](../guides/deterministic-math.md).
