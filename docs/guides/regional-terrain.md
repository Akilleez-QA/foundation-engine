# Regional terrain with canonical surfaces

The optional terrain kit can prepare finite neighboring regions from a creator-owned global sample source. Each region retains a one-cell private halo for smooth normals and exposes a canonical `Surface` for ordinary sampling, raycasts, chunks, LOD and generation ownership. The creator chooses the source, visible region set, error thresholds, device targets, request timing and publication policy.

```ts
import {
  createTerrainRegion, patchTerrainRegion, prepareTerrainGeneration,
} from '@kits/terrain';

const region = createTerrainRegion({
  id: 'west',
  lattice: { id: 'landscape', revision: 1, baseX: .1, baseZ: .2, spacing: .5 },
  startX: -8, startZ: 0, cellsX: 8, cellsZ: 8,
}, point => ({ height: point.x * .2 + point.z * .1 }));
const generation = prepareTerrainGeneration(region.surface, [
  { key: 'whole', startX: 0, startZ: 0, cellsX: 8, cellsZ: 8, stride: 2 },
]);
const candidate = patchTerrainRegion(region, 2, [
  { gx: -9, gz: 3, height: 2 }, // private halo: may change the visible edge normal
]);
```

Region dimensions are 1–254 cells per axis. This leaves room for the halo within the existing 256-cell sampled-grid limit. Sample indices and revisions are safe integers; revision is nonnegative and patches require a strictly newer revision. Identities are bounded to 256 characters. Coordinates, spacing, samples and derived Float32 axes must be finite and strictly representable. An invalid request throws without changing the previous region.

Global sample coordinates are rounded once from `base + globalIndex * spacing`. Do not recreate a region through `createSampledSurface` using its rounded `originX/originZ`; that can produce different axes and discards halo normals. Use the cached `region.surface`. Meshes and returned records cannot mutate its backing.

The surface covers only the visible core. `sample` and `raycast` do not hit the halo. Vertex/chunk normals are area-weighted smooth normals using incident halo triangles; contact samples report the actual triangle face normal. Exclusion is returned metadata under the ordinary Surface contract, not an automatic collision-hole rule. Creators decide how to apply it.

## Patches and neighbor responsibilities

`patchSurface(region.surface, revision, localCoreEdits)` and `prepareSurfacePatch(...)` support ordinary local core edits while retaining the halo. They return branded `SurfacePatch` values for `createTerrainGenerationBuilder(nextSurface, tiles, { previous, patch })`. This operation changes one canonical surface; it does not rewrite a previously returned region object or discover neighbors.

`patchTerrainRegion(previous, revision, globalEdits)` returns `{ region, patch }`. `prepareTerrainRegionPatch(host, owner, previous, revision, globalEdits, signal)` produces the same candidate through WorkerHost. Each global edit has `gx`, `gz`, and optional `height`, `material` or `excluded`; there are 1–4096 unique edited vertices per request. Edits outside the region's inclusive `dependency` rectangle are rejected. Material is an unsigned 16-bit integer; exclusion is a literal boolean. An empty-field edit can advance the revision without changing render data.

For a global source change, capture the edit once, update the creator-owned source, find every accepted region whose dependency intersects it, and route the relevant edits to each. A halo-only edit may change visible smooth normals without changing core heights. A private corner edit can have no visible effect. The patch's `dirty` bounds describe actual changed core render vertices; `null` means no core render changes. `bounds` remains a conservative core-projected edit bound; ordinary patches without `dirty` retain the existing one-vertex invalidation margin. Generation reuse uses `dirty` when supplied, so unchanged chunks remain reusable and changed edge normals rebuild.

A patch does not persist the source edit for regions generated later. Reconstructing from an unchanged source intentionally reconstructs its old samples. Save or version source changes according to the creator's own world model.

## Existing worker owner and registered evaluators

`prepareTerrainRegion(host, owner, recipe, signal, urgency?)` uses the optional built-in plane evaluator. Its recipe is:

```ts
const recipe = {
  formatVersion: 1 as const,
  evaluatorVersion: 1,
  region: {
    id: 'west',
    lattice: { id: 'landscape', revision: 3, baseX: .1, baseZ: .2, spacing: .5 },
    startX: -8, startZ: 0, cellsX: 8, cellsZ: 8,
  },
  seed: 42,
  parameters: '[0.2,0.1,0]', // x slope, z slope, offset
};
const result = await prepareTerrainRegion(host, owner, recipe, signal);
if (result.status === 'done') {
  // result.region is an uninstalled candidate. Build views and explicitly publish.
}
```

`createTerrainRegionJob(jobId, evaluator, limits?)` binds a creator-defined synchronous point evaluator to the same worker module and sliced fallback. The evaluator declares a version, a parameter validator returning literal `true`, and `evaluate(point, parameters)` returning `{height, material?, excluded?}`. `point` supplies world `x/z`, explicit global `gx/gz` and the unsigned 32-bit seed. Existing ordinary recipe operators retain local `ix/iz`; no meaning is silently changed.

Import the same evaluator definition in the lazy registered worker row and caller/fallback. Export the returned `.module` from a kit worker file following the existing job registry convention. The stock row is `job.kits.terrain.region`; patches reuse `job.kits.terrain.patch`. Executable callbacks are never serialized. Reusing a job id with different executable definitions is a creator registration error.

Default parameter limits are 4096 UTF-8 bytes, 256 JSON nodes and depth 16; creators can explicitly configure finite limits. Parameters are parsed and frozen before validation/evaluation. Callback behavior and cost remain trusted creator code; a bounded result schema does not sandbox callbacks or guarantee timing.

WorkerHost owns scheduling, memory admission, cancellation, overload and fallback. Metadata is captured before queuing; payload copies are materialized after admission. Reservations conservatively include padded samples, normals, core projection and adoption overlap. Generation accounting includes retained padded and core typed buffers. These are payload allowances, not exact JavaScript heap or GPU measurements.

`done` returns an immutable canonical candidate; other outcomes include cancellation, supersession, saturation, oversize and preemption under WorkerHost's contract. Execution/validation failures reject. Refusal never installs partial terrain. Decide retry/fallback policy in the consumer; the adapter creates no retry timer or scheduler. Request and owner signals are checked after asynchronous delivery, and adopted output must match the captured region/lattice/revision/topology. Worker normals are checked for finite upward unit vectors; registered evaluator semantics are established by independent tests, not inferred from valid array shapes.

## Coherent publication and evidence

One existing TerrainOwner publishes one complete Surface generation. To update a finite set of neighboring regions, a consumer may retain an accepted envelope containing render views and contact coverage, stage all required replacements, verify the desired revision and lifetime, and swap the envelope synchronously at its chosen boundary. Keep the old accepted render and contact data while work is pending or refused. A failed candidate/view preparation leaves that envelope unchanged and releases candidate resources. Do not report four independent swaps as an atomic neighbor update.

The supplied framework does not automatically load a planet, choose resident regions, move cameras, impose LOD thresholds or pick gameplay behavior for unavailable coverage. Shared-boundary coverage remains explicitly ambiguous unless the creator chooses a policy.

Focused tests compare fractional global coordinates, four nonplanar regions, halo/core edits, mixed-stride borders, normals and rays to a separate test-only triangle oracle. Job tests cover registered-module transfer, fallback, stale work, cancellation checkpoints, refusal before materialization, captured input, malformed output and retained old backing. The finite browser consumer is separate evidence for actual worker transport and publication. Automated geometry and reservation checks do not establish sustained performance or touch usability on physical phones, tablets or desktops; those require measurements for the creator's selected targets.
