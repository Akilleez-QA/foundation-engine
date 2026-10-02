# Recipe: generate seeded content off the frame

Use this recipe when a game builds content from a seed, for example terrain regions,
dungeon levels, cave masks or a run's layout, and that content must regenerate
identically. It uses the optional [procedural generation kit](../../src/kits/procgen/README.md).
The game still chooses the generator, the seed policy and what the result means.

## 1. Record the requirement and the seam

State the creator requirement first, e.g. "the same run seed reproduces level 3
exactly" or "region (4,-2) regenerates after reload". The seams this recipe uses:

| Concern | Existing owner |
|---|---|
| Seeds | `deriveSeed` beside the engine's single mulberry32 generator (`src/core/rng.ts`) |
| Scheduling, byte admission, cancellation, fallback | The application `WorkerHost` (`ctx.service('jobs')`) |
| Persistence | A save section holding the **root seed**, not the output |
| Publication | The game's own world owner (or the terrain owner for surfaces) |

## 2. Pick a root once, then derive one seed per piece of content

`SceneContext` exposes `ctx.random()`, not its seed. To start a run or a world, pick a
root once at that boundary, e.g. `Math.floor(ctx.random() * 2 ** 32)` (replayable under
`?seed=`), and store it (step 5). Reload the stored root afterwards; never re-pick it.

```ts
import { deriveSeed } from '@kits/procgen';
const regionSeed = deriveSeed(root, 'region', cx, cz);
const lootSeed = deriveSeed(root, 'level', depth, 'loot');
```

The path names the content, not the order in which it is requested. Beyond the one root pick, do not chain
`ctx.random()` draws into a generator's seed: that ties the content to visit history.
Integers must be safe integers, and floats are rejected; quantize coordinates yourself.

## 3. Write a generator as a slice generator

```ts
import { createGridGenerationJob, type GridGenerator } from '@kits/procgen';
const fillGenerator: GridGenerator = {
  version: 1, maxValue: 3,
  validate: p => Array.isArray(p) && p.length === 1 && typeof p[0] === 'number',
  *generate(cells, context, parameters) {
    for (let z = 0; z < cells.cellsZ; z++) {
      for (let x = 0; x < cells.cellsX; x++) cells.set(x, 0, z, context.random.int(0, 3));
      yield; // one bounded slice and a cancellation checkpoint
    }
  },
};
export const fillJob = createGridGenerationJob('job.kits.mykit.fill', fillGenerator);
```

Put the job in a kit (`src/kits/<kit>/`) and add `src/kits/<kit>/workers/fill.job.ts`
exporting `fillJob.module`. The file name is the row id. Rules for the generator:

- Yield every few thousand cell visits, not once per arbitrarily long row. Fallback
  runs one slice per page task, and a worker only sees `cancel` at a yield.
- Use only `context.random` and `context.derive`: no `Math.random`, time or module state.
- Declare `scratchBytesPerCell` if you allocate working buffers.

## 4. Request it at a boundary, keep the old content until it succeeds

```ts
// `visit` is an owner whose signal ends with this visit (or streaming epoch)
const result = await fillJob.prepare(ctx.service('jobs'), { id: 'fill', signal: visit.signal }, recipe, signal);
if (result.status === 'done') install(result.grid);
else if (result.status === 'saturated') retryLaterOrNewOwner();
// cancelled / superseded / preempted: nothing to install
```

A newer `revision` with the same key (default: the recipe `id`) supersedes older work.
The host remembers at most 4,096 distinct keys per owner lifetime, with no eviction.
Per-region ids under one long-lived owner eventually make every new key return
`saturated`, and retrying will not help. Give each visit or streaming epoch its own
owner, pass a bounded `key` (for example the resident slot), or pass `key: false` for
one-off requests.

Rejections are always `GridJobError`, and its `stage` says where the work failed:
- `recipe`: refused before admission;
- `execution`: a generator exception, the slice limit or a value above `maxValue`;
- `output`: a malformed result.

Keep the current content in each case. If the generator can declare `slices(dimensions,
parameters)`, have it do so. A request that is valid but too large is then refused
before any work runs, instead of failing near the end.

## 5. Save the root, not the result

```ts
export const runSeed = defineGenerationSeedSection('mygame.run', { contentVersion: 2 });
```

Bump `contentVersion` whenever the same seed would produce different content, and
write it with each new seed. On load, compare it with the current number: an older
save otherwise regenerates different content silently. A corrupt or unversioned stored
record is quarantined, and play continues from the initial value. Ending a
run and any permadeath policy are game decisions; clear the seed when your rules end it.

## 6. Evidence to add

- A test named after the success criterion that regenerates the same content twice and
  in a different request order. Compare it to an independent oracle where one exists.
- Cancellation, malformed-parameter and over-bound cases for your generator.
- Device timing on the creator's selected targets. A unit test is not that evidence.
