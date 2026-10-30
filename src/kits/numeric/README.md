# Optional strict numeric modes

`@kits/numeric` gives a deterministic simulation number formats whose every result
is fixed by an exact rule, so lockstep peers, rollback sessions and replays agree
across engines and devices:

- **Fixed point** (`createFixed`, `createWideFixed`): signed words of 2–32 bits in a
  `number`, or 2–128 bits in a `bigint` (Q32.32, Q64.64), with a creator-chosen
  rounding and overflow policy.
- **Binary-angle trigonometry** (`createFixedTrig`): integer `sin`, `cos` and
  `atan2` on angles counted in 1/2^n of a turn, returning fixed-point raw values.
- **Strict reduced-precision floating point** (`createPrecision`, `f32`, `pc24`):
  IEEE binary32 arithmetic, or p-bit significands with the double's exponent range
  (`pc24` behaves as an x87 FPU with its precision-control field set to single).

The engine's [`dmath`](../../../docs/guides/deterministic-math.md) already makes
double-precision transcendental functions identical in every engine. This kit is
for creators who need more than that: integer state that another language can
reproduce bit for bit, a faithful recreation of a fixed-point or single-precision
original, compact integer snapshots, or wrap/saturate semantics. It reuses `dmath`
to build its tables and float helpers; it does not reimplement it.

It owns no clock, loop, timer, storage, transport or registration, and a game can
omit it. `numeric()` declares it in `defineGame({ kits })`; importing the
functions is enough.

## Creator requirement and seam

The creator needs a simulation whose numbers are part of its definition (STD-SIM-10,
STD-SIM-17): the same initial state, seed and tick inputs give the same state on
every machine. The seams it composes with:

- The fixed-step lane: call these functions from fixed systems only.
- `@kits/rollback`: `save` stores raw integers (or `encode`d bigints) as text;
  `load` restores them; nothing else is needed. The lockstep test runs a fixed-point
  simulation through `createRollbackSyncTest` with a 7-frame check distance.
- `@kits/replay`: digest the saved state with `createDigestTrace`; two runs compare
  `equal` with `compareDigests`.
- Save sections: raw `number` values are JSON-safe; wide values go through
  `encode`/`decode` (decimal text).

## Inputs and outputs

```ts
import { createFixed, createWideFixed, createFixedTrig, createPrecision, f32, pc24 } from '@kits/numeric';

const q = createFixed({ wordBits: 32, fracBits: 16 });            // Q16.16, nearest, throw on overflow
const trig = createFixedTrig(q);                                  // 65,536 angle units per turn
const step = q.mul(trig.cos(heading), speed);                     // raw integers in, raw integer out

const legacy = createFixed({ wordBits: 16, fracBits: 12, rounding: 'floor', overflow: 'wrap' }); // a 4.12 word
const wide = createWideFixed({ wordBits: 64, fracBits: 32 });    // Q32.32 in bigint; wide.encode(x) for JSON

const half = createPrecision({ significandBits: 11 });            // 11-bit significands, double exponent range
const v = f32.mulAdd(a, b, c);                                     // round(round(a·b) + c) in binary32
```

| Option | Values | Default | Meaning |
|---|---|---|---|
| `wordBits` | 2–32 (`createFixed`), 2–128 (`createWideFixed`) | required | Signed word width |
| `fracBits` | 0 … `wordBits − 1` | required | Fraction bits; `one` is 2^fracBits |
| `rounding` | `'nearest'`, `'floor'`, `'trunc'` | `'nearest'` | Nearest rounds an exact half toward +∞ (the `(x + half) >> f` idiom); floor is an arithmetic shift; trunc is C integer division |
| `overflow` | `'throw'`, `'wrap'`, `'saturate'` | `'throw'` | `RangeError`, two's-complement wrap, or clamp to `min`/`max` |
| `turnBits` (trig) | 4–16 | 16 | Angle units per turn = 2^turnBits; the format needs at least 2 integer bits |
| `significandBits` | 2–25 | required | Precision of `createPrecision`, including the implicit bit |
| `exponent` | `'double'`, `'binary32'` | `'double'` | `'binary32'` needs 24 bits and is exactly `Math.fround` |

These are mechanism options, not recommended game settings.

Fixed-point operations: `fromNumber`, `fromInt`, `toNumber`, `isRaw`, `add`, `sub`,
`neg`, `abs`, `mul`, `mulAdd` (product rounded, then exact add), `div`, `sqrt`,
`lerp`, `clamp`, `floor`, `fract`, `convert` (between formats); wide formats add
`encode`/`decode`. Trig: `sin`, `cos`, `atan2` (range (−turn/2, turn/2], measured
like `Math.atan2(y, x)`), `wrap`, `fromRadians`, `toRadians`. Precision: `round`,
`add`, `sub`, `mul`, `div`, `sqrt`, `mulAdd`, `isExact`, and `math` (a `ScalarMath`).

## Exactness and accuracy

- **Fixed point** is exact integer arithmetic followed by one rounding. A double
  holds every integer below 2^53, so the `number` path is exact while products and
  shifted dividends stay below 2^53 − 2^33 (so a `mulAdd`/`lerp` addend or a wrapped
  result is exact too); above that the operation takes a `BigInt` path (for `fracBits`
  above 21, for `fracBits` 0 with large operands, or for results that overflow). Tests
  compare every operation with an independent rational `BigInt` oracle:
  exhaustively for an 8-bit Q4.4 word under all nine rounding/overflow pairs, and
  on seeded inputs for 32-bit words with 0–30 fraction bits and for 48-, 64- and
  128-bit wide words.
- **Trig** tables are built on first use from `dmath.sin` and `dmath.atan` and
  rounded to the format, so they are the same integers in every engine. `sin`/`cos`
  are within half a quantum of the exact value at every angle (tested over
  ±70,000 units). `atan2` interpolates a 4,097-entry octant table with a 16-bit
  ratio; the test bound is 1.5 angle units at 16 turn bits (the review measured at
  most 0.96 over its sweep).
- **Reduced precision** computes the double result and rounds it once, ties to
  even. For +, −, × and ÷ this equals the correctly rounded p-bit result because
  53 ≥ 2p + 2 (double rounding is then innocuous; √ likewise), which is why p is
  capped at 25. Below 2^-1021 a double is subnormal and too narrow for that argument,
  so products and quotients that land there are recomputed scaled by 2^600 and
  rounded once (sums that small are already exact). Tests compare `round`, `add`,
  `mul` and `div` with an exact `BigInt` oracle for p = 8–25, including results in
  the subnormal range, and `f32` with `Math.fround`. The
  `math` helpers round the arguments, evaluate `dmath` in double and round the
  result: deterministic, but not always the correctly rounded p-bit value.
- `pc24` keeps the double's exponent range. A real x87 register has a wider
  exponent still, so values beyond the double range (overflow above ~1.8·10^308,
  results below 2^-1022) differ from that hardware; `f32` overflows and goes
  subnormal exactly like binary32.

## Bounds, overload, cancellation and recovery

- Bounds: every call is O(1) except `createWideFixed` operations (O(word size)
  `BigInt` arithmetic) and the one-time tables: 2^(turnBits−2)+1 sin entries
  (16,385 at 16 bits, 64 KiB) and 4,097 atan entries (32 KiB) per `createFixedTrig`.
- Overload: overflow follows the format's policy; division by zero always throws.
- Cancellation: none needed; there is no pending work.
- Recovery: malformed formats, non-integer or out-of-range raw values, NaN and
  infinite inputs throw `RangeError` before any result is produced. Every returned
  object is frozen. The kit holds no state except the lazily built tables.

## Cost

Best of three rounds of 2·10⁶ calls in Node 26 (V8 14.6) on a loaded 32-thread
desktop, one local run; treat as order of magnitude only: Q16.16 `mul` 8.7 ns,
`div` 12 ns, `sqrt` 11 ns, trig `sin` 6.6 ns, `atan2` 14 ns; `f32.mul` 6.1 ns
(a plain double multiply measured 5.5 ns in the same loop); `pc24.mul` 59 ns
(the general rounding reads the exponent bits); Q32.32 `mul` 77 ns (`BigInt`,
allocates). The fast fixed-point paths allocate nothing; V8 may box a returned
double.

## Evidence

- `fixed.test.ts`, `precision.test.ts`: the oracle comparisons above.
- `lockstep.test.ts`: the committed `numeric.golden.json` (704 vectors over eleven
  formats and operations, including `mulAdd`, `lerp`, `fromNumber`, `convert`,
  12-bit turns and subnormal-range float results, plus three lockstep workload
  digests) equals what this engine computes. The vectors come from the code under
  test: they catch differences between engines, the oracle tests catch errors;
  a fixed-point simulation passes the rollback sync test for 240 frames and two
  runs give `equal` replay digests.
- `npm run test:dmath-browser` (in CI): the same vectors and workload digests are
  identical in the test Chromium and in Node. Local run 2026-10-09: Chromium 141
  against Node 26.8.1, PASS.
- An independent adversarial review found a `mulAdd`/`lerp` rounding error for
  `fracBits` 0 with `wrap` near 2^53, incorrect rounding of `pc24` products below
  2^-1021, `cos` refusing angles within a quarter turn of 2^53, `fromRadians`
  failing on huge inputs and `clamp` passing −0 through. Each is fixed with a
  regression test. The f32 and pc24 workload digests are equal because that
  workload never leaves the binary32 range; the vectors exercise the difference.
- `npm run numeric:golden` compares the committed file with this engine; `-- --write`
  rewrites it, which deliberately changes the contract every peer must reproduce.

Not claimed: Firefox, WebKit, other runtimes, physical devices, a playable template
consumer, or equivalence with any particular original hardware beyond the rules
stated above. Formats and rounding rules are inputs: matching an original system is
the creator's choice of `wordBits`, `fracBits`, `rounding`, `overflow` and
`significandBits`, checked against that system's own reference cases.
