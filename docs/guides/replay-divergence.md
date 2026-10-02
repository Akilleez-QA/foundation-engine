# Optional replay log and divergence detector (SIM-01)

This optional verification capability records what a deterministic run needs to
replay exactly, replays it, and finds the first tick at which two runs stop agreeing.
It is evidence for the determinism rule (STD-SIM-17: identical initial state, seed and
tick-addressed input yield identical state after N ticks) and for client prediction
agreeing with host reduction. It adds no runtime feature, clock, scheduler, storage
or network path. A creator may use it in tests, in the dev/test build's test API,
or not at all; a production build never contains the dev surface.

State: SIM-01 is integrated in v0.2.0 (PR #17). The creator-chosen replay digest and
divergence detail (SIM-02, [below](#choose-what-a-replay-must-reproduce-sim-02)) are
implemented on branch `feat/replay-custom-digest`, candidate (PR #58), not integrated.
Evidence and limits are listed below.

> **Frame-phase writes break the default digest.** The default digest hashes every
> entity's `Transform`. A purely visual `phase: 'frame'` system that moves anything
> (a bobbing pickup, a camera rig, particles) depends on the frame grouping, which is
> not in the log, so every replay of that scene reports `diverged`, usually from
> tick 0. Either move that motion to a fixed system, or give the scene a digest that
> leaves the cosmetic entities out (`replay: { digest: replayDigest({ exclude: [Cosmetic] }) }`,
> see [the recipe](../recipes/replay-with-your-own-digest.md)).

## Seams reused

| Need | Existing owner reused |
|---|---|
| The tick clock | The fixed-step host's `inputForTick(tick)` ([`domain/sim/host.ts`](../../src/domain/sim/host.ts)) and the scene system runner's fixed lane ([`core/ecs/systems.ts`](../../src/core/ecs/systems.ts)). No second clock: tick k is the k-th fixed step. |
| Seeded randomness | `?seed=` → `createRng(seed)` in the stock runtime, and the same mulberry32 stream in `testScene({seed})` (a test checks the two streams are equal). |
| Canonical data | The network kit's canonical JSON v1 (`captureJson`): bounded parse, sorted keys, normalised numbers. |
| Headless scene runs | `testScene`, which gained one option: `input`, a caller-owned `InputState`. |
| Prediction and authority | The network kit's `createPrediction` and `createDurableAuthority`, driven through their public operations. |
| Dev surface | The test API (`window.engine`), which loads `src/dev/replay.ts` on first use. |

## Inputs and outputs

All exports come from the optional `@kits/replay` (`src/kits/replay/`).

- **Recorder** `createReplayRecorder({header, limits})`. The header is
  `{build, config, seed, step}`. `build` and `config` are caller-chosen strings, compared
  exactly. The scene helpers and the dev surface use `<game id>@<version>` as the build,
  so a code change without a version bump is not detected. They use
  `scene:<id>;inputs:<sorted ids, ~ marks an axis>` as the configuration, which names no
  rules revision. A creator who needs one adds it to these strings when calling the kit
  directly.
  the unsigned 32-bit seed and the fixed step in seconds. `record(tick, inputJson)`
  takes one canonical JSON input per tick, ticks from 0 and contiguous. Identical
  consecutive inputs share a run (run-length encoding). Results: `recorded`,
  `truncated` (with `truncatedAt`) or `failed` (with `tick-order` or `input`).
  `export(digests?)` returns the log text.
- **Log text** (format `foundation.replay`, version 1): canonical JSON with a
  64-bit checksum over the canonical body, the header, the tick count, the runs, an
  optional truncation tick and an optional digest trace. The text is returned to the
  caller; nothing is stored, uploaded or sent.
- **Player** `openReplay(text, limits, expect)` returns `ready` with a player, or a
  refusal: `unsupported-version`, `corrupt` (with a reason such as `checksum`,
  `fields`, `tick-count`, `non-canonical-input`, `unreadable-or-over-limit`) or
  `incompatible` (field `build`, `config`, `step` or `seed`, expected and actual).
  The checks run in order: limits, format, version, checksum, structure, expectation.
  The player's `input(tick)` and `json(tick)` are O(1) for sequential reads and
  O(log runs) otherwise.
- **Digest trace** `createDigestTrace({identity, every, maxEntries, maxDigestLength, detail?})`.
  The creator supplies `digest()` over their own state; the trace calls it only on
  ticks divisible by `every`, keeps the newest `maxEntries` samples in a ring and
  counts evictions in `dropped`. An optional detail window keeps creator text for a
  tick range up to `maxChars` (the study's basic and detailed levels).
- **Comparator** `compareDigests(a, b, {through?})` returns:
  - `equal`: every sample matched over the same full range with nothing evicted;
  - `diverged`: the first differing retained sample `tick`, the last matching sample
    `after`, both digests, any detail text and `exact`. The true first divergent tick
    lies in (`after`, `tick`]. With `every: 1` and `exact: true` it is `tick`.
  - `inconclusive` (`history-dropped` or `range-differs`): matching overlap, but not a pass;
  - `incomparable` (`identity`, `cadence`, `failed` or `no-overlap`).
- **Scenes** `recordSceneRun` and `replaySceneLog` run a scene headlessly through
  `testScene`, one logged tick per run step. Each tick's entry is what fixed systems
  read through `ctx.input`: pressed and held actions, axis values and the pointer
  (`createSceneInputTap`, `encodeSceneTick`). `worldDigest(world)` is the default
  digest: entity count, the world's resources as JSON and every `Transform`. Creators
  pass their own `digest(ctx)` for other state.
- **Agreement** `checkPredictionAgreement({prediction, epoch, host, stream, inputs, maxInputs, state})`
  pushes each command once to the caller's prediction owner and submits the exact
  captured sequence and JSON to the caller's recovered authority. It digests the
  predicted state after sequence k beside the committed state after sequence k, then
  reconciles to that baseline. It returns `agree`, `diverged` (the first sequence where
  the reducers differ, with both states when `detailChars` is set) or `refused` (which
  side, which sequence, why), plus the number of visible corrections.
- **Dev/test API** `engine.replay.start({mode: 'record' | 'replay', log?, every?, maxTicks?, maxBytes?, maxDigests?, digest?, detail?})`
  re-enters the current scene and records or replays its fixed ticks from arrival.
  `engine.replay.read()` returns the status, tick counts, the local log text
  (record), the digests, the named digest in use (`digest`), and, once a replay
  completes, its comparison with the log and, when it diverged, a `divergence`
  report. `engine.replay.stop()` ends the session. `digest` and `detail` are below.

## Choose what a replay must reproduce (SIM-02)

Creator requirement (backlog W1-1): a game whose cosmetic presentation moves
entities must still be able to verify that its simulation replays exactly, and a
divergence must say what differed, not only when.

| Input | Where | Meaning |
|---|---|---|
| `replay: { digest }` on `defineScene` | Scene definition (`@engine`) | The scene's default replay digest: `{id, state(world)}`. `defineScene` refuses a missing `state` function or an id outside 1-128 of `A-Za-z0-9._:,;=+-`. |
| `replayDigest({components?, exclude?, resources?, count?, id?})` | `@kits/replay` | A digest over selected components (types or ids; default `[Transform]`), without entities that have any `exclude` component, with all, none or the listed resources and, optionally, `world.count`. The default id describes the selection (`select:c=transform,score;x=cosmetic;r=all`), or hashes it when it is long or has other characters. |
| `selectWorldState(world, selection)` | `@kits/replay` | The selected state as a plain value `{entities: [[id, {componentId: value}]...], resources?, count?}`, entities in id order. |
| `digest` on `engine.replay.start` | Dev/test API | The same digest, or a selection object with component ids (serialisable, so a browser driver can pass it). Takes precedence over the scene's. |
| `replayDigest` on `recordSceneRun` / `replaySceneLog` | `@kits/replay` | The same, headless. The existing `digest(ctx)` function option still takes precedence and keeps the old identity. |
| `detail: true \| {from?, to?, maxChars?}` on a record request | Dev/test API | Keep each sampled tick's canonical state text in the log for ticks `from`..`to` (default the whole run), up to `maxChars` (default 1 MiB). Headless runs use the trace's existing `detail` window. |
| `explainDivergence(tick, a, b, {limits?, maxValueChars?})` | `@kits/replay` | Names the first difference between two detail texts. |

How it works. A named digest is the 64-bit hash of the canonical JSON of
`state(world)` (the network kit's canonical v1, under `WORLD_DIGEST_LIMITS`), read
once per sampled tick after the tick's fixed systems. The canonical text is also the
tick's detail text, so the digest and the detail never disagree. The digest's id is
appended to the trace identity (`…|seed:7|digest:<id>`). Without a named digest the
identity and the digest are unchanged, so existing logs still replay.

Digests see JSON, not JavaScript. `state(world)` (and so every selected component
value and resource) goes through `JSON.stringify` before it is canonicalised: a `Map`
or `Set` becomes `{}`, `NaN` and `±Infinity` become `null`, `-0` becomes `0`, and
`undefined` fields, functions and symbols are dropped. State held that way is not
covered, and a change between two such values is invisible. Keep digested components
and resources JSON-plain (numbers, strings, booleans, arrays, plain objects), or
convert them in your own `state` function. A `state` result that is not JSON at
all (`undefined`, a cycle, a `BigInt`) fails the trace.

Coverage. For a selection digest, `coverage` (in `engine.replay.read()`, and on
`recordSceneRun` and `replaySceneLog` results) gives the listed entities and, per
selected component, how many of them had it at the first sample. `unmatched` lists
selected components that no listed entity had on any sample so far: a misspelt id
(`'scroe'`) or a component the scene never uses. Their part of the digest is
constant, so an `equal` says nothing about them. The run is not failed, because a
component may legitimately appear only later; check `unmatched` is empty before you
rely on an `equal`. A digest written as a function has `coverage: null`.

Outputs. On a diverged replay, `divergence` is either
`{status: 'found', tick, kind, path, entity, component, field, resource, a, b}` or
`{status: 'unavailable', tick, reason}`:
- the search is depth first in canonical order (sorted keys, entities by id) and stops
  at the first difference, so "first" means first in that order, not the most
  important;
- `kind` is `value`, `type`, `added` (only in the replay), `removed` (only in the
  log) or `entity-set` (an entity exists on one side only; `entity` names it);
- for the selection shape, `entity`, `component` and `field` are filled; for a
  resource, `resource` and `field`; for any other shape, only `path`;
- `a` (the log's value) and `b` (the replay's) are JSON previews of at most 160
  characters;
- `no-detail`: the log kept no detail for that tick (no `detail` window, outside it,
  or past `maxChars`); `detail-unreadable`: a detail text is over the parse limits
  (8 MiB, 2^20 nodes, depth 32) or malformed (the explainer never throws, and a
  replay's result survives any detail text); `no-difference`: the detail texts match
  although the digests differ. The built-in paths compute both from the same state
  (a named digest hashes its detail text; the default detail lists the same count,
  resources and transforms the default digest hashes), so this means a headless
  `detail(ctx)` that does not describe the `digest(ctx)` beside it, or a `state()`
  that is not a pure function of the world (it reads a clock, a counter or
  `Math.random`, so two calls in one tick differ).

Owner and bounds. The digest is creator code run by the caller's existing tick
owner: the dev tap after each fixed tick, or the headless `testScene` lane. Nothing
new is scheduled. Selections hold at most 64 components, 64 exclusions and 256
resource keys of at most 128 characters each. A record request's `detail.maxChars`
counts toward the log bound (6 bytes per character for escaping, plus one entry per
sample), so a request whose log could not be reopened is refused (`log-limit`). The
replay side keeps one state text only: the replayed state at the first sample that
differs from the log's.

Overload, failure and recovery. A digest that throws, returns `undefined`, is cyclic
or exceeds `WORLD_DIGEST_LIMITS` fails the trace (`digest-threw`); the recording or
replay ends `failed`. Detail past `maxChars` is dropped, and `detailTruncated` is
set in the log. A malformed digest or detail request is refused before re-entry
(`digest`, `detail`); `detail` on a replay request is refused too, because a replay
uses the detail its log was recorded with. An identity over 512 characters (a long
game id, scene id or digest id) is refused at the visit (`identity-too-long`), and
any other failure to set up the visit's tap is refused as `tap-setup-failed`, so a
session never stays armed. A log replayed under another digest is refused at the visit
(`incompatible-digest`), which leaves that visit untapped; headlessly the comparison
is `incomparable` (`identity`). Pass the same digest to the replay as to the
recording. A function digest cannot be carried in the log. Recovery is recording
again, with a wider `detail` window around the reported tick when the report was
`no-detail`.

Cost. One `state(world)` call, one canonical serialisation and one hash per sampled
tick: O(selected entities × selected components). Detail adds the retained text, up
to `maxChars`. Nothing runs when no replay session is active, and production builds
never call `replay.digest`. A scene definition's `replay` field and anything the game
imports from `@kits/replay` are game code and are bundled with it.

## Owner, bounds and overload

The caller owns recorders, traces, players and agreement checks. A test or tool
creates and drops them; nothing is global. In the dev surface, the test API owns one
replay session. Each scene visit owns its tap, and the visit's retirement ends it. The
stock runtime asks for a tap only when `TEST_API` is true
([`author/scene-tick-tap.ts`](../../src/author/scene-tick-tap.ts)).

| Bound | Where | Overload behaviour |
|---|---|---|
| `maxTicks`, `maxBytes` (each run's input bytes plus 24) | Recorder | Recording stops and the log is marked truncated at that tick. The prefix stays replayable, and replays report `truncatedAt`. The input log is a prefix, not a ring: inputs without a state checkpoint cannot be replayed from the middle. |
| Per-tick input JSON bytes, nodes, depth | Recorder, player | Over-limit or malformed input fails the recording, or makes the log `corrupt`. |
| `maxEntries` ring, `maxDigestLength` | Digest trace | Old samples are evicted and counted; comparisons become `inconclusive` or non-`exact`. A digest that is too long fails the trace. It is never cut. |
| `detail.maxChars` | Digest trace | Later detail is dropped and `detailTruncated` is set. |
| Log text bytes, nodes, depth | `openReplay` | Checked before parsing; over the limit means `corrupt`. |
| `maxInputs` | Agreement | Throws before any command is driven. Each owner's own limits still apply. |
| Dev defaults | `engine.replay` | 3,600 ticks, 256 KiB of input, 4 KiB per tick and an 8 MiB / 2^20-node log. A record request is refused (`log-limit`) when its worst-case export could exceed the limits the log is reopened under. A replay decodes every distinct logged input against the scene's declared actions at the visit and refuses the log (`invalid-tick-input-<tick>`) before any tick runs. An empty log completes as `incomparable` (`no-overlap`), never as `equal`. |

Digest cost is the creator's digest function, called once per sampled tick. The
default world digest serialises resources and transforms, so its cost grows with the
world. Use a coarser `every` for large worlds. No work happens when nothing is
recorded or replayed. The dev tap asks for one frame when a replay arrives and no
others, so render-on-change is unchanged.

## Cancellation and recovery

The library is synchronous apart from the agreement check, which awaits the caller's
authority between commands. That check owns no owners: to cancel, the caller retires
its prediction and authority, and the next operation reports a refusal. In the dev
surface, a visit's retirement ends its session (`stopped`, reason `visit-ended`).
`stop()` ends recording and keeps the log readable. A new `start` stops the previous
session. A request refused before re-entry (an invalid option, or an unreadable,
unsupported or corrupted log) arms nothing and does not re-enter the scene. A log
refused at the visit (a different build string, configuration, step or `?seed=`) leaves that
re-entered visit untapped, and `start` returns the refusal. A failed
recorder or trace stays failed. Recovery means recording again; there is no runtime
repair, because this is a verification tool.

The tap holds the visit's whole system runner, not only the fixed lane. While
held, fixed systems, frame-phase systems (a HUD, for example) and the per-frame
clearing of world events all stop; drawing continues. The runner is held:
- in a recording or replay, between program readiness and the scene's `enter`, so
  tick 0 is the first step after arrival;
- in a replay, once the log is spent. The scene then stays frozen until it is
  re-entered or `engine.replay.stop()` hands it back to live input.

Ticks already due in the final frame of a replay run with the last logged input
and are not observed. Unarmed visits are unchanged.

## Limitations (read before relying on a result)

- **Floating-point results are not guaranteed to match across devices, browsers,
  engines or builds.** Replays are exact for the same build in the same JavaScript
  engine, and the evidence below is same-browser and same-Node only. Transcendental
  functions (`Math.sin`, `Math.exp`, …) may differ between engines. A cross-device or
  cross-browser divergence is a finding about the platform or the simulation, not a
  failure of this tool. Cross-machine lockstep needs fixed-point or otherwise
  platform-independent arithmetic chosen by the creator.
- The log holds tick inputs, the seed and identities. It does not hold initial state.
  The replay must start from the same initial state, including save data a scene
  reads on entry (the arcade best score, for example), assets and parameters.
- Only fixed-lane systems are covered. Frame-phase systems, `ctx.time` (per frame),
  world events (cleared per frame), asynchronous asset or model readiness, audio and
  network I/O are outside the log. A fixed system that reads any of them can diverge,
  and the comparator will report where.
- In the stock runtime, `ctx.input.pressed` is per frame. Every fixed tick in a frame
  sees a press, and a press in a frame with zero fixed ticks is cleared unseen. The
  log records exactly what each tick observed, so replay is faithful to the recorded
  run, but this per-frame grouping is a pre-existing deviation from STD-SIM-12. It is
  noted here, not changed.
- The default world digest covers resources and `Transform` only. Other component
  state needs a creator digest. A named digest covers only what it selects: state
  left out (an excluded entity, an unselected component) can change without a
  divergence, and a fixed system that reads such cosmetic state can make the
  selected state diverge later, where it is reported.
- A divergence report names the first difference in canonical order at the first
  divergent sample. It is not a root cause: the cause may be earlier and elsewhere
  (outside the digest, or between samples when `every > 1`).
- The checksum and digests use a 64-bit non-cryptographic hash. They detect
  accidental corruption and change, not deliberate forgery, and a collision, though
  unlikely, would hide a difference.
- The recorder is a prefix, so the first divergence before an evicted digest sample
  cannot be located without re-running with a larger ring or `every: 1`. Because the
  replay is exact, re-running is the narrowing method.
- Agreement compares one stream, step by step, from one coherent baseline. It does
  not test reordered or delayed network delivery (the prediction guide's own tests
  do), multiple writers, or physical devices.

## Evidence (candidate, not integrated)

Implemented: `src/kits/replay/` (hash, log, digest, scene, agreement), the
`testScene({input})` option, the dev/test-only tick tap in `src/author/runtime.ts`
and `src/author/scene-tick-tap.ts`, `src/dev/replay.ts` and `engine.replay`.

Checked by focused tests (`src/kits/replay/*.test.ts`, `src/dev/replay.test.ts`,
`src/author/testing.test.ts`):

- exact headless replay of the stock arcade scene with a seed over 600 ticks;
- the `?seed=` stream equals the `testScene` seed stream;
- injected nondeterminism found at the exact tick (cadence 1) and bracketed at
  cadence 25, in both a scene and a fixed-step point-mass simulation, under a
  different frame grouping;
- ring eviction reported as inconclusive, never equal;
- tick and byte overflow, giving an explicit truncated prefix that replays;
- refusal of unsupported versions and of logs with a different build string, configuration,
  step or seed;
- refusal of corrupted logs (checksum, fields, tick count, unmerged or non-canonical
  runs, malformed input, over-limit text);
- prediction and authority agreement, and a forced host-rule mismatch reported at
  its first sequence;
- dev-surface record and replay across frame groupings, plus its refusals.

Browser regression `npm run test:replay-browser`
(`scripts/play/replay-check.mjs`, arcade template, desktop Chromium, software GL):

- the scene opened with `?seed=7` records real key input under a held clock;
- the browser replays it exactly with a different frame grouping;
- the same log replays exactly in the separate headless harness;
- a teleport between frames is reported at that exact tick;
- a corrupted log is refused without re-entering the scene;
- a log for another seed is refused at the visit.

SIM-02 (candidate, not integrated), focused tests (`src/kits/replay/state.test.ts`,
`src/dev/replay.test.ts`):

- the demo case: a cosmetic orb bobbed by a frame-phase system diverges under the
  default digest across frame groupings, and the report names the orb's entity,
  `transform` and `y`; the same run with a digest excluding the cosmetic tag
  replays exactly (dev surface and headless, from the request and from the scene
  definition);
- a gameplay fault under the named digest is still found and named (entity,
  `score`, `value`), at its exact tick;
- refusals: a log under another digest (`incompatible-digest`), malformed digests
  and detail windows, detail over the log bound; throwing, cyclic and `undefined`
  digests fail the session; a small detail budget truncates and reports
  `no-detail`;
- the explainer on values, types, added and removed components, entity sets,
  resources, other shapes, bounded previews, and over-limit or malformed detail;
- identities without a named digest are unchanged.

`npm run test:replay-browser` adds: a selected-component digest with detail names
the teleported player's entity and `transform` field at the exact tick; the log is
refused under the default digest; a creator digest function passed in the page
replays exactly.

Not established: physical devices, other browsers, production builds (which do not
contain the dev surface), multiplayer or WAN, and the creator's own simulations.
