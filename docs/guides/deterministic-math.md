# Optional deterministic scalar maths (`dmath`)

`dmath` is a small set of scalar functions (`sin`, `cos`, `atan`, `atan2`, `exp`, `log`,
`pow`, `sqrt`, `hypot`) whose results are the same bits in every conforming
JavaScript engine. Use it in fixed-step simulation code that must give identical
results in different engines. For example, a log recorded in a browser can then be
re-simulated in Node (SIM-01 replay, SEC-01 verified runs), and rollback peers
(RB-01) on different browsers stay in agreement. Nothing uses it unless a creator
opts in. Rendering, cameras, audio and other presentation code keep using `Math`.

State (2026-10-03): integrated through batch PR #64 (`main` `3b449fa`; PR #60 merge `ca972b3`).
It was implemented on branch `feat/deterministic-math` as a candidate; see the
[acceptance ledger](upgrade-acceptance-ledger.md#deterministic-scalar-maths-w1-2--integrated).
Backlog item W1-2.

## Why it exists

ECMAScript requires `+`, `−`, `×` and `÷` to be correctly rounded IEEE-754 double
operations, so they give the same bits everywhere. It leaves `Math.sin`, `cos`,
`atan2`, `exp`, `log`, `pow`, `hypot` and the other transcendental functions
*implementation-approximated*, and engines do differ. On 20,000 sample inputs in
an engine study (2026-10-02), Chromium 152's V8 and Node 22's V8 12.4 differed in
686 `sin`, 672 `cos`, 3,148 `atan2`, 1,950 `exp` and 1,883 `pow` results. A
browser-recorded replay of a scene whose fixed systems used `Math.atan2` diverged
at tick 56 when re-simulated in Node. The stock character kit calls `Math.atan2`
for camera-relative input and facing.

On this module's own golden inputs, the browser check below found the same kind of
difference: 5 `sin`, 6 `cos`, 3 `atan`, 14 `atan2`, 11 `exp`, 2 `log` and 10 `pow`
results out of 1,075 vectors, and the seeded character workload's digest under
`Math` differed between the two engines. Under `dmath` both were identical.

## Inputs, outputs and owner

From `@engine` (implemented in [`src/core/dmath.ts`](../../src/core/dmath.ts), pure,
no imports):

| Export | What it is |
|---|---|
| `dmath` | A frozen `ScalarMath` of the deterministic functions. |
| `platformMath` | The same interface over the engine's own `Math` (fast, implementation-approximated). |
| `ScalarMath` | The interface: `sin, cos, atan, atan2, exp, log, pow, sqrt, hypot(x, y)`, with `Math`'s signatures. |
| `scalarMath(mode)` | `undefined` or `'platform'` → `platformMath`; `'deterministic'` → `dmath`; any other value throws `RangeError`. |
| `ScalarMathMode` | `'platform' \| 'deterministic'`: the type of a kit's `math` option. |

```ts
import { dmath } from '@engine';
const yaw = dmath.atan2(dx, dz);          // same bits in Chromium, Firefox, Safari, Node …
```

Each function is built only from correctly rounded basic operations, exact
operations (comparisons, `Math.abs`, `Math.round`, integer bit tests, power-of-two
scaling through a typed-array view of the bits, `BigInt` integer arithmetic) and
`Math.sqrt`. Each uses fixed range reduction and a fixed polynomial:

- **sin, cos**: Cody–Waite reduction by π/2 in three parts for |x| < 1.6·10⁶.
  Larger arguments, and arguments within 2⁻³⁰ of a multiple of π/2, use an exact
  integer reduction against 1,280 stored bits of 2/π. Degree-15 (sin) and degree-14
  (cos) kernels on [−π/4, π/4].
- **atan, atan2**: reduction to |t| ≤ 7/16 through atan(½), atan(1), atan(3⁄2) and
  π/2, then a degree-25 odd kernel. Every special value ECMAScript fixes (signed
  zeros, infinities, NaN) is reproduced.
- **exp**: reduction by n·ln 2 (two-part constant), a rational kernel and exact
  scaling by 2ⁿ, including subnormal results.
- **log**: decomposition into 2ᵏ·m with m in [√½, √2), and an atanh-series kernel.
- **pow**: log|x| in double-double precision, its product with y, then the exp kernel.
  This gives full accuracy across the whole result range. Exact shortcuts:
  y = 1, 2, −1 and ½ (√x, except at −0 and −∞).
- **sqrt** is `Math.sqrt`. The specification text also calls it
  implementation-approximated, but every engine compiles it to the IEEE-754 square
  root, which is correctly rounded. The unit tests prove correct rounding on the
  golden inputs in exact integer arithmetic, and the browser check compares its bits.
- **hypot(x, y)** (two arguments): the rounded root plus one correction from the
  exact residual, with power-of-two scaling against overflow and underflow.
  `Math.hypot` is implementation-approximated too.

The coefficients were fitted for this module (Chebyshev fits in 60-digit arithmetic,
rounded to double). No third-party code was ported.

## Accuracy

Maximum error against the exact value (computed with 1,400-bit arithmetic), on
20,000 seeded inputs per range, measured in Node 22.23.3 (V8 12.4). `dmath` gives
these same bits in every engine. The `Math` column is this V8 only.

| Range | dmath max error (ulp) | V8 `Math` max error (ulp) | dmath not correctly rounded | V8 `Math` not correctly rounded |
|---|---:|---:|---:|---:|
| sin, [−10, 10] | 0.742 | 0.786 | 2.79% | 3.29% |
| sin, [−10⁵, 10⁵] | 0.721 | 0.789 | 3.13% | 3.37% |
| sin, ±10^[6, 308] | 0.726 | 0.764 | 3.00% | 3.33% |
| cos, [−10, 10] | 0.745 | 0.794 | 2.99% | 3.17% |
| cos, [−10⁵, 10⁵] | 0.714 | 0.778 | 3.23% | 3.58% |
| cos, ±10^[6, 308] | 0.707 | 0.813 | 2.93% | 3.19% |
| atan, [−100, 100] | 0.700 | 0.700 | 1.42% | 1.42% |
| atan2, [−50, 50]² | 1.265 | 1.265 | 17.49% | 17.57% |
| atan2, log-scaled 10^±10 | 1.147 | 1.147 | 16.00% | 15.76% |
| exp, [−50, 50] | 0.829 | 0.829 | 9.70% | 9.71% |
| exp, [−708, 709] | 0.801 | 0.801 | 9.64% | 9.65% |
| log, (0, 10] | 0.735 | 0.753 | 6.76% | 6.74% |
| log, 10^[−300, 300] | 0.621 | 0.734 | 0.10% | 0.10% |
| pow, (0, 50] × [−4, 4] | 0.837 | 0.909 | 9.62% | 9.71% |
| pow, (0, 2] × [−300, 300] | 0.829 | 0.899 | 9.99% | 10.11% |
| hypot, [−10³, 10³]² | 0.500 | 1.785 | 0.00% | 35.33% |

Against this V8's `Math`, `dmath` is at most **1 ulp** apart for `sin`, `cos`, `atan`,
`atan2`, `exp`, `log` and `pow` over the tested domains. `src/core/dmath.test.ts`
asserts this on 20,000 inputs per range in the ordinary test run. `hypot` is
within one ulp of the exact root, which the tests check in integers, and is
correctly rounded on more than 99% of samples. `atan2`'s error above 1 ulp comes
from rounding the quotient y/x, as in V8.

Documented domains: any finite input. Results that over- or underflow return ±∞ or
±0, as `Math` does. Subnormal results of `exp` and `pow` are rounded once, so they
are deterministic, but their relative error grows as precision is lost, as with any
implementation.

## Cost

Nanoseconds per call (best of three rounds of 400,000 calls through the
`ScalarMath` interface). The machine was loaded at `nice 15`, so treat the ratios,
not the absolute values, as the result. Reproduce the Node figures with
`npm run bench:dmath`; the browser check records both engines in its report.

| Function | Node 22 dmath | Node 22 Math | ratio | Chromium 152 dmath | Chromium 152 Math | ratio |
|---|---:|---:|---:|---:|---:|---:|
| sin | 41.6 | 20.3 | 2.05 | 45.0 | 30.3 | 1.49 |
| cos | 38.8 | 28.0 | 1.38 | 39.0 | 29.3 | 1.33 |
| atan2 | 32.7 | 30.7 | 1.07 | 33.8 | 35.0 | 0.96 |
| exp | 25.5 | 21.3 | 1.20 | 24.3 | 19.3 | 1.26 |
| log | 42.9 | 17.9 | 2.39 | 45.3 | 18.0 | 2.51 |
| pow | 90.1 | 62.1 | 1.45 | 89.8 | 22.5 | 3.99 |
| hypot | 23.2 | 29.6 | 0.79 | 27.0 | 20.5 | 1.32 |
| sqrt | 10.4 | 10.6 | 0.98 | 10.5 | 10.8 | 0.98 |

Roughly 1–2.5× `Math` per call, up to 4× for `pow` in Chromium, where `Math.pow` is
unusually fast. That is tens of nanoseconds. A fixed step that makes a few hundred
such calls adds microseconds.

Allocation: the fast paths create no objects or arrays. Intermediate pairs pass
through one module-level `Float64Array`, not module-level variables, which V8
would box on every store. V8 may still box a returned double in a heap number
when it does not inline the call. Measured with `node --trace-gc` on Node 22.23.3
(V8 12.4), 2·10⁷ calls with arguments in [−10, 10] (positive for `log` and
`pow`), calling through a variable: about 323 minor GCs for `sin` and `cos`
(609 before the scratch array), 310 for `exp`, `log` and `hypot`, and 621 for
`pow`, against 0 for `Math.sin`, `Math.exp`, `Math.log` and `Math.pow`. That is
one 16-byte heap number per call (two for `pow`): short-lived garbage that the
young-generation collector reclaims, not retained memory. The exact reduction
for |x| ≥ 1.6·10⁶ (or within 2⁻³⁰ of a multiple of π/2) also allocates a few
`BigInt`s and costs a few microseconds. Keep simulation angles small, for example by wrapping
headings, if that matters.

## Bounds, overload, cancellation and recovery

These are pure functions. There is no state between calls, no queue, nothing to
cancel and nothing to recover. Inputs outside the accurate domain do not exist:
every double gives a defined, deterministic result. `scalarMath` and every kit
`math` option validate the mode when the system or helper is created and throw
`RangeError` for an unknown value. The contract is the committed golden file. A
change to any function changes bits that existing replay logs depend on, so it is
a deliberate, reviewed change: run `npm run dmath:golden -- --write`, and record
the change in the changelog.

## Stricter modes: fixed point and reduced precision (optional kit)

`dmath` keeps doubles. When a creator needs integer state that another language can
reproduce exactly, a faithful fixed-point or single-precision recreation, compact
integer snapshots, or wrap/saturate semantics, the optional
[`@kits/numeric`](../../src/kits/numeric/README.md) adds fixed-point words (2–32 bits
in a `number`, up to 128 bits in a `bigint`), binary-angle `sin`/`cos`/`atan2` tables
built from `dmath`, and strict reduced-precision float (`f32`, and `pc24`: 24-bit
significands with the double exponent range). Its golden vectors run in the same
browser check (`npm run test:dmath-browser`). See [ADR 0099](../adr/0099-strict-numeric-modes.md).

## Kits that use it (creator option)

Default behaviour is unchanged. Each option below defaults to `'platform'`, which is
exactly the previous `Math` arithmetic.

| Kit call | Option | Simulation-path functions switched |
|---|---|---|
| `characterSystem(o)` | `math: 'deterministic'` | camera-relative yaw (`atan2`, `cos`, `sin`); pointer distance, speed and integration (`hypot`); facing (`turnToward`: `atan2`, `sin`, `cos`, `hypot`); rotated box and polygon solids (`cos`, `sin`) and circle solids (`hypot`) through `areaOf`/`slide` |
| `createMotion(o)`, `turnToward(…, rate, math)`, `followHeading(…, omega, math)`, `insideSolid(…, inflate, math)`, `areaOf(world, body, math)` | a `ScalarMath` (`dmath`) | the same functions, for creators who compose the pure helpers |
| `applyRootMotion(ctx, e, delta, o)` (locomotion) | `math: 'deterministic'` | heading rotation (`cos`, `sin`), step count (`hypot`), collision area |
| `createRootMotion(clip, loop, o)` (animation) | `math: 'deterministic'` | clip composition and inversion (`cos`, `sin`) |

**Why not on by default.** With the option on, the kit's results stay within its
tolerance: positions and headings agree with `Math` to 10⁻⁹ over the test paths,
and deterministic runs repeat exactly. But the bits change by an ulp here and
there. A default switch would silently change every existing recorded run, test
golden value and replay log for games that never needed cross-engine agreement,
and add per-call cost to all of them. Creators who replay or verify across engines
opt in with one option. The option is a game rule, so keep it the same for
recording and replay.

Transcendental calls on other paths, not switched:

- **Camera kit** (`src/kits/camera`): view poses and smoothing (`sin`, `cos`, `exp`,
  `hypot`) are presentation. But `characterSystem`'s default camera-relative mode
  reads `ctx.view.camera` inside a fixed step. For cross-engine replays, use
  `relative: 'world'`, or a camera pose that is itself fixed-step state.
- **Pointer picking** (`pointerOnGround` in `src/author/view-math.ts`, `Math.tan`,
  `Math.atan`, `Math.hypot`): the character kit's default pointer target. For
  cross-engine replays, pass `pointerTarget` (computed with `dmath`) or `pointer: false`.
- **Core helpers** `wrapAngle` and `damp` (`src/core/math.ts`) and `sineHash2` /
  `valueNoise2` (`src/core/noise.ts`) keep `Math`. Changing them would change existing
  generated content. Use `dmath` directly in new fixed-step code.
- **Space, terrain, chalkboard, navigation and camera-clearance kits**: star fields,
  level-of-detail and drawing are presentation. Terrain normals and region weights
  use `Math.hypot`, and navigation followers use `Math.hypot`. If a ground query or
  route feeds a cross-engine replay, verify those values separately.
- **Pose layers and pose clips** (`animation/pose-layers.ts`, `pose-clip.ts`) use
  `Math.hypot` for quaternion validation and normalisation of presentation poses.

## Evidence (recorded on the candidate; integrated through batch PR #64)

Implemented: `src/core/dmath.ts`, `src/core/dmath-vectors.ts`, the golden file
`src/core/dmath.golden.json` (1,075 vectors as 16-digit hex bits; `sin` and `cos`
each include 6381956970095103·2^797, the double nearest a multiple of π/2, its
negation, and 20 seeded log-uniform arguments from about 10⁶ to 10³⁰⁸) and the kit options
above.

Checked by focused tests:

- `src/core/dmath.test.ts`: the golden vectors are recomputed bit for bit;
  `Math.sqrt` is proved correctly rounded on the golden inputs in exact integer
  arithmetic; `hypot` is checked within one ulp of the exact root on about 4,100
  inputs; special results (NaN, signed zeros, infinities) match `Math` exactly over
  a 15 × 15 grid of special and small arguments; there is at most one ulp to V8's
  `Math` over 16 ranges, including ±10^308 arguments, and on large and
  ill-conditioned arguments such as 6381956970095103·2^797; `scalarMath` refuses unknown modes.
- Character, motion, locomotion and root-motion tests: the option agrees with
  `Math` to 10⁻⁹, repeats exactly, defaults to `'platform'`, and refuses unknown modes.
- `npm run dmath:golden` re-checks the golden file in the current Node.

Browser check `npm run test:dmath-browser` (`scripts/play/dmath-check.mjs`, desktop
headless Chromium 152.0.7977.82 against Node 22.23.3):

- all 1,075 golden vectors computed in Chromium equal the committed hex and Node's;
- a 3,000-tick seeded workload has an identical per-tick digest in both engines.
  It runs through the character kit's motion, facing, rotated solids and
  camera-relative yaw, plus root motion and `exp`/`log`/`pow`. The same workload
  under `Math` gave different digests;
- the report (`playtest/dmath/report.json`) records how many `Math` results differ
  between the two engines, and the timings above.

## Limitations

- Evidence covers one Chromium build and one Node. Firefox, WebKit, other runtimes
  and physical devices are not run. The construction (correctly rounded operations
  only) is the reason to expect agreement there, and the golden file is the way to
  check it.
- The check exercises the kit modules directly. It does not run a browser-recorded
  stock-scene replay of a character game in Node; the camera and pointer paths above
  must also be deterministic for that.
- Determinism also needs the rest of the simulation to be deterministic. That means
  no `Math.*` transcendental functions elsewhere in fixed systems, no frame-phase
  reads, and seeded randomness only (see [replay](replay-divergence.md)). It also
  assumes engines evaluate each operation in double precision without fused
  multiply-add or extended precision, which ECMAScript requires.
- `dmath` does not make `Math` deterministic. Code that still calls `Math.sin` in
  a fixed system remains engine-dependent.
