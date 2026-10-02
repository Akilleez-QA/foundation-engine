# Procedural generation kit

Optional seeded generation helpers for games whose content is produced from a seed:
regions of an edited world, levels of a run, loot tables, scatter. Add `procgen()` to
the game's kits and import from `@kits/procgen`. It installs no systems, inputs,
save sections or frame work. The creator chooses the generators, the seed policy,
when work is requested and what a result means in the game.

```ts
import { deriveSeed, prepareCellularGrid, defineGenerationSeedSection } from '@kits/procgen';

export const runSeed = defineGenerationSeedSection('cavegame.run', { contentVersion: 1 }); // add to the game's defs

// at a visit boundary, outside the frame:
const record = ctx.save(runSeed).get();
const root = record.seed ?? Math.floor(ctx.random() * 2 ** 32); // pick once, then store it with its contentVersion
// one owner per visit (its signal ends with the visit), so its supersession-key history ends with it too
const result = await prepareCellularGrid(ctx.service('jobs'), { id: 'caves', signal: visit.signal }, {
  formatVersion: 1, generatorVersion: 1, id: `region:${cx},${cz}`, revision: 1,
  seed: deriveSeed(root, 'region', cx, cz),
  cellsX: 64, cellsY: 1, cellsZ: 64, parameters: '[0.45,4,5,4]',
}, signal);
if (result.status === 'done') { /* result.grid.values: Uint16Array, x fastest, then z, then y */ }
```

## Seed derivation (`deriveSeed`)

`deriveSeed(root, ...path)` lives in `src/core/rng.ts` beside the engine's single
mulberry32 generator (STD-SIM-9) and is re-exported here.

- **Input:** an unsigned 32-bit root and 0–32 path components. A component is a
  safe integer (negative allowed) or a string of at most 256 UTF-16 code units.
  Floats, `NaN`, unsafe integers, other types, longer strings and longer paths throw.
  Nothing is rounded.
- **Output:** an unsigned 32-bit seed for `createRng`, a generator recipe or a
  worker job. It is a pure function. It does not depend on call order, the wall
  clock, the scene's `ctx.random()` stream or any other stream, so a region or level
  regenerates identically whenever it is requested.
- **Arithmetic:** 32-bit integer operations (`Math.imul`, shifts, xor) through the
  public-domain lowbias32 mixer, plus one exact power-of-two division that splits
  integers wider than 32 bits. It uses no `Math.sin` and no rounding step, so results are
  bit-identical across engines, workers and the main thread. The core value-noise
  helpers (`sineHash2`) use `Math.sin`; this function does not.
- **Separation:** components are type-tagged and length-prefixed. `1` differs from
  `'1'`, `('ab')` from `('a','b')`, and `(3,4)` from `(4,3)`. Under one prefix,
  distinct signed 32-bit final components always give distinct seeds, because the
  absorb step is bijective. Larger integers use a separately tagged two-word encoding.
- **Limits:** seeds are 32 bits. Unrelated paths can collide; the birthday bound is
  near 2^16 paths. Use a derived seed as a stream seed, never as an identity or a
  save key.

## Grid generation jobs (`createGridGenerationJob`)

A creator registers a `GridGenerator`: a version, a `maxValue` (0–65535), an optional
`scratchBytesPerCell` accounting declaration (0–64), a parameter validator returning
literal `true`, an optional `slices(dimensions, parameters)` upper bound on its yields,
and a `generate(cells, context, parameters)` slice generator. The returned object has
`prepare(host, owner, recipe, signal, options?)` (`options` is `{urgency?, key?}` or an
urgency string), a worker
`module`, the shared `slices` fallback, the captured `limits`, a `reservation(recipe)`
preview and a synchronous `generateNow(recipe)` for tests and offline tools.

```ts
// src/kits/mygame/dungeon-job.ts (or a game-owned kit)
export const dungeonJob = createGridGenerationJob('job.kits.mygame.dungeon', myGenerator, { maxCells: 65536 });
// src/kits/mygame/workers/dungeon.job.ts
import { dungeonJob } from '../dungeon-job';
export default dungeonJob.module;
```

The worker row is found by file name (`src/kits/<kit>/workers/<name>.job.ts` is
`job.kits.<kit>.<name>`), so the job id and file name must agree. Executable
generator code is imported in both the worker and the caller. It is never serialized.

- **Owner:** the application's existing `WorkerHost` (`ctx.service('jobs')`) owns
  scheduling, byte admission, foreground/background classes, cancellation, supersession
  and main-thread fallback. This kit adds no scheduler, registry, cache or publication owner.
- **Input:** `GridRecipe {formatVersion: 1, generatorVersion, id, revision, seed,
  cellsX, cellsY, cellsZ, parameters}`. The recipe is validated and captured before
  admission, so later caller mutation cannot reach queued work. `id` (1–256 code units)
  is the default supersession key and `revision` (a nonnegative safe integer) its
  version: a newer revision supersedes an older one under the same owner. `seed` is
  unsigned 32-bit. `parameters` is JSON text. Its UTF-8 bytes are checked first, then
  node count, depth and finiteness after parsing. The parsed value is frozen. Parsing,
  the validator and the declared slice budget all run before admission (bounded by the
  parameter limits) and again inside the job.
- **Supersession keys and their limit:** the host keeps at most `maxKeysPerOwner`
  (default 4,096) distinct keys per owner lifetime and never evicts them. Once full, a
  request with a new key returns `saturated` for the rest of that lifetime, and
  retrying will not help. Per-region ids such as `region:${cx},${cz}` under one
  long-lived owner can exhaust it. Use one of:
  - an owner per visit or streaming epoch, so history ends with its signal;
  - a bounded key set, e.g. the resident slot, via `options.key`;
  - `key: false` for one-off requests, which then cannot be superseded.
- **Generator context:** `cells` (`values: Uint16Array`, `index`, `get`, and a checked
  `set`), `context.seed`, `context.random` (one mulberry32 stream from the seed) and
  `context.derive(...path)` for order-independent sub-streams.
- **Output:** `{status: 'done', grid}`. `grid` is a frozen `GeneratedGrid` with the
  recipe descriptor, `values` (caller-owned, transferred from the worker), `slices`
  used, `index` and `get`. Other outcomes are the host's named results:
  `cancelled`, `superseded`, `preempted`, `saturated` and `oversized`. A result never
  publishes itself; the creator installs it into its own world owner.
- **Bounds:** `maxCells` defaults to 262,144 and can be configured up to 4,194,304
  (8 MiB of Uint16 output). `maxSlices` defaults to 65,536, up to 2^24. Parameters
  default to 4,096 UTF-8 bytes, 256 nodes and depth 16. The reservation is declared
  before any payload exists:
  - input: parameter characters × 6 + 4 KiB;
  - output: cells × 2 + 4 KiB;
  - scratch: cells × (2 + `scratchBytesPerCell`) + 8 × the input allowance + 4 KiB.

  These are accounting allowances, not measured JavaScript heap.
- **Overload:** a recipe over its bounds, including a declared slice count above
  `maxSlices`, is refused before admission, so no worker spawns and nothing is reserved.
  `saturated` means either a full host (capacity may return: retry later) or a full key
  history (it will not: see above). The caller keeps its current content either way.
  A generator that yields more than its declared count, or than `maxSlices` when it
  declares none, fails with `slice limit exceeded`. This catches runaway retry loops
  (for example, restart-on-contradiction).
- **Slice size:** a slice is the work between two yields. Keep it to a few thousand cell
  visits. The fallback runs one slice per task on the page, and a worker sees `cancel`
  only at a yield, so long slices delay frames and can miss the 100 ms cancel deadline.
  The cellular example yields every 4,096 visits. The adapter's own value scan yields
  every 65,536 cells.
- **Cancellation:** every `yield` is a checkpoint. In a worker, `cancel` is honoured at
  the next checkpoint, and the host terminates the worker if the acknowledgement misses
  its 100 ms deadline. In fallback, the host stops scheduling slices. When the job stops
  at a checkpoint, the creator generator's `finally` runs exactly once through
  `return()`. A worker terminated after missing the deadline runs no `finally` at all,
  so a generator must not rely on `finally` for anything outside its own job. Owner
  abort and host disposal cancel queued and running work.
- **Failure and recovery:** `prepare` rejects, and `generateNow` throws, only with
  `GridJobError`, and no partial grid is returned. Its `stage` names where it failed,
  and `cause` keeps the original error:
  - `recipe`: validation errors, rejected parameters or slice budgets, and invalid
    keys. Nothing is reserved.
  - `execution`: generator exceptions, `slice limit exceeded` and values above
    `maxValue`, including typed-array wraparound. For `prepare` the cause is the host's
    `WorkerJobError`.
  - `output`: adoption mismatches in descriptor, length, element type or slice count,
    or a backing buffer that is not an unshared `ArrayBuffer` of exactly cells × 2
    bytes at offset 0.

  Worker output is value-scanned once on the main thread, synchronously and in time
  linear in cells; at 4,194,304 cells that is one uninterrupted pass. Output from this
  module's own slices (fallback, `generateNow`) was already scanned while yielding and
  is not scanned again.

  The host releases the reservation in each case, and the previous accepted content
  stays with the creator's owner.

## Built-in example: cellular grid

`cellularGenerator` / `cellularGridJob` (`job.kits.procgen.cellular`) takes parameters
`[fill, steps, birth, survive]`. Each y layer gets a random fill from its own sub-stream
`derive('layer', y)`, then `steps` Moore-neighbourhood smoothing passes; cells outside
the grid count as solid. Values are 0 (open) and 1 (solid). It yields every 4,096 cell
visits and declares exactly `floor(cells × (1 + steps) / 4096)` slices. At most that is
17,408 slices at 4,194,304 cells, within the default ceiling, so a valid recipe never
fails late on its slice limit.
It is one familiar technique for cave-like or blob-like masks, not a required style.
A creator's BSP, drunkard's walk, template or constraint-solver generator plugs in the
same way.

## Seed save section

`defineGenerationSeedSection(id, {scope?, contentVersion?})` defines a strict
`{seed: number | null, contentVersion: number}` section. Store the root seed, not
generated output: generated content is re-derived from it.

The engine cannot tell when a generator changes. Bump `contentVersion` whenever the same
seed would produce different content (a new generator version, different parameters or
a different derivation path), and write it together with the seed. On load, compare
`record.contentVersion` with the current number, then decide whether to keep the old
content's generator, start fresh, or migrate. Without that comparison, an old save
regenerates different content silently.

A malformed stored value, including a record without `contentVersion`, fails `parse`.
The save store quarantines the bytes, and play continues from the initial value. Ending a run (`d.seed = null`) and any
permadeath policy are game decisions. Edited-world deltas are not stored here (see
limitations).

## Evidence

The focused tests are `src/core/rng.test.ts` (GEN-01 rows),
`src/kits/procgen/grid-job.test.ts` and `src/kits/procgen/seed-section.test.ts`. They
cover:

- **Seeds:** pinned seed values; order independence; type, order and grouping
  separation; 200,002 collision-free int32 siblings; avalanche and lag-1 checks; rejected
  inputs.
- **Generation:** an independent nested-array oracle of the cellular rule; identical
  output across repeated runs, main-thread fallback, the registered module across a
  structured-clone/transfer boundary and the real worker runtime; region results
  independent of request order; refusal before admission; runaway and out-of-range
  generators.
- **Cancellation, recovery and saves:**
  - cancellation mid-job in fallback, worker runtime and module checkpoints;
  - supersession, owner loss and captured queued input;
  - nine corrupt worker outputs, plus oversized, offset and shared backing buffers;
  - declared slice budgets (the 64³, 16-step example succeeds; over-budget declarations
    refuse before admission; under-declared generators fail);
  - unkeyed, slot-keyed and new-owner requests against a full key history;
  - typed `GridJobError` stages;
  - real SaveStore round trip with `contentVersion`, and quarantine of twelve corrupt or
    unversioned seed records.
- **Browser:** `scripts/play/procgen-worker-check.mjs` checks real worker transport.

## Limitations

- Generator code is trusted. A generator that does not yield blocks its worker until
  the cancel deadline terminates it. In main-thread fallback it blocks the page. Work
  between yields is not time-limited, and allocation is not sandboxed. Determinism
  holds only if the generator avoids `Math.random`, time and mutable outside state.
- Grids are dense `Uint16Array` values. This slice provides no chunk residency,
  streaming, runtime edit deltas, meshing (greedy or surface nets) or edited-world
  persistence. Save sections are capped at 256 k characters, so large edited worlds
  need a separate bounded delta store (research note, slice 2).
- Browser evidence is one desktop Chromium module-worker check
  (`scripts/play/procgen-worker-check.mjs`, part of `npm run test:framework-browser`).
  It shows that the discovered row loads, that worker, fallback and direct output are
  bit-identical, and that cancellation and stale outcomes are named. Physical-device
  timing and generation quality are not established.
