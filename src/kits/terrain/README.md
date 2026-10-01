# Terrain kit

Optional pure fixed-grid surface generation, mesh extraction, contact sampling and touch-ray picking. Add `terrain()` to the game's kits and import `createSurface` from `@kits/terrain`. It installs no systems, inputs, save sections or frame work.

```ts
const surface = createSurface({
  id: 'workshop-ground', revision: 1,
  originX: -24, originZ: -24, spacing: 1, cellsX: 48, cellsZ: 48,
  seed: 42, baseHeight: 0,
  layers: [
    { kind: 'noise', amplitude: 0.5, frequency: 0.12 },
    { kind: 'radial', x: 8, z: 4, radius: 12, height: 3 },
  ],
  pads: [{ x: 0, z: 0, radius: 4, feather: 3, height: 0, material: 1, excluded: true }],
});
const geometry = surface.mesh();
const contact = surface.sample(2, 3);
const hit = surface.raycast({ x: 0, y: 20, z: 0 }, { x: 0, y: -1, z: 0 });
```

## Creator-produced samples

`createSampledSurface` accepts a creator's finite height data through the same
canonical surface owner. It does not choose the generator, units, content or game
rules. For example, a survey import or an authored mathematical surface can supply:

```ts
import { createSampledSurface } from '@kits/terrain';
const surface = createSampledSurface({
  id: 'survey-ground', revision: 1,
  originX: 0, originZ: 0, spacing: 1, cellsX: 1, cellsZ: 1,
  heights: [0, 2, 3, 9],
  materials: new Uint16Array([0, 1, 0, 1]), // optional; default zero
  exclusions: new Uint8Array([0, 0, 1, 0]), // optional; numeric 0/1
});
```

Each input has exactly `(cellsX + 1) * (cellsZ + 1)` numeric samples, ordered
`z * (cellsX + 1) + x`. Ordinary numeric arrays and numeric typed arrays are
accepted through `ArrayLike<number>`. Heights are copied and rounded to Float32;
nonfinite inputs or overflow after rounding throw. Materials must be integers
0–65535; exclusions must be 0 or 1. Missing optional fields default to zero.
Dimensions retain the existing 1–256 cell bounds; malformed lengths fail before
sample copying. Coordinates retain the same Float32 collapse checks.

The synchronous constructor copies all inputs into private storage and computes
canonical vertex normals. Input buffers are neither retained nor transferred;
creator-supplied normals and coordinate arrays are not accepted. Construction is
O(vertices + cells), with no scheduler, publication side effect or cancellation
point. A thrown validation error returns no surface. Inputs are trusted creator
objects, not a sandbox for getters/proxies. For asynchronous work, creators own
producer admission and cancellation before this intake; initial recipe worker
execution is not supplied by this API.

The result supports existing contact/rays, mesh chunks, patches, worker patching
and generation publication. Replacing live terrain still uses the existing terrain
owner. Sample intake alone adds no cross-region halo or streaming contract: equal
heights on separately created surface edges do not guarantee equal smooth normals.
Tests use an analytic plane and separately calculated nonplanar triangle equations,
plus mutation, malformed-input and existing-consumer interoperability checks.

## Contract

- Input coordinates, heights and spacing are world-space. Mesh positions already include the origin: do not translate a mesh by the origin again. Use unit scale and identity placement for direct world-space queries.
- Construction samples a private Float32 grid once. Mesh extraction returns independent number arrays. Mutating options or returned mesh arrays cannot modify contact queries. To edit terrain, build and atomically replace the complete surface/mesh snapshot with a new revision.
- A cell uses triangles `(top-left,bottom-left,top-right)` and `(top-right,bottom-left,bottom-right)`, wound upward. `sample` computes barycentric height and the upward geometric normal on exactly these triangles, including the float32 vertex rounding used by rendering. It does not query the analytic generator again or use a bilinear approximation. Rendered smooth vertex normals may differ visually from this geometric contact normal.
- Boundaries are inclusive and based on float32 mesh coordinates. Queries outside return `null`; nonfinite coordinates throw. Very large origins or very small spacing that collapse adjacent float32 coordinates are rejected.
- Layers are ordered additive radial smooth hills/basins (negative height makes a basin) or seeded value noise evaluated at global coordinates. The explicit unsigned 32-bit seed determines the field independent of generation order; the game may derive it once from its seeded context and persist it. Noise is a deterministic coordinate hash, not a call to global random state.
- Pads apply after layers, in order. Radius is the flat core; feather is an additional smooth blend width. Pads operate on vertices, so boundaries and narrow pads are limited by grid resolution. Later pads win where they have nonzero influence. This first slice is not a continuous geometry cutter.
- Material is an unsigned 16-bit ID, default zero. A layer/pad with a material stamps affected vertices; `sample` selects the largest barycentric weight (deterministic tie order). Exclusion is true if any vertex contributing positive weight is excluded. These are discrete authoring metadata, not physical collision or a placement-permission system. No vertex palette is generated.
- `raycast` normalizes a finite nonzero direction and returns the nearest nonnegative intersection with the actual triangles, from either side. `maxDistance` is world-space, nonnegative, and defaults to infinity. No hit returns `null`. A ray lying entirely in a triangle plane has no unique crossing and returns no hit for that triangle. Use it on pointer actions; it is not intended as a per-frame general collision solver.

## Validation and cost

Each axis permits 1–256 cells; layers and pads each permit at most 64. IDs must be nonempty; revisions are nonnegative safe integers. Radii/frequencies/spacing are positive. All generated heights must fit finite float32 values. Invalid input throws instead of substituting zero terrain.

A grid has `(cellsX + 1) * (cellsZ + 1)` vertices and `2 * cellsX * cellsZ` triangles. Construction is O(vertices × (layers + pads)); mesh copying is O(vertices + triangles); contact lookup is O(log cellsX + log cellsZ) with constant interpolation; ray picking traverses only crossed XZ cells, bounded by O(cellsX + cellsZ), testing the two canonical triangles per cell. A 48×48 example has 2,401 vertices and 4,608 triangles. The consumer decides draw calls, materials, collision registration and lifetime. Generation and mesh copying must happen on scene construction or explicit revision changes, never each frame.

Private grid storage uses four bytes per height, two per material, one per exclusion, plus coordinate axes. Returned JS arrays and GPU buffers add separate memory costs. The 256×256 maximum produces vertex indices above 65535: renderer integration must support 32-bit element indices or reject/split oversized meshes explicitly.

Tests cover an independently calculated sloping triangle, the chosen diagonal, outer edges, ordered pads, neighboring chunk height seams, deterministic seeds, snapshot mutation isolation, rejected inputs and ray hits. Equal edge heights do not promise equal geometric normals across independently generated chunks. Caves/overhangs, water, walkability and physics are outside this surface representation.


## Finite mesh chunks and visual LOD

`buildSurfaceChunk(surface, { startX, startZ, cellsX, cellsZ, stride, maxError? })` extracts an in-bounds tile using integer lattice coordinates. Supported strides are 1, 2 and 4 and must divide tile dimensions. Every outer edge retains all canonical vertices; adjacent tiles share identical edge segments even with different strides. Stride 1 reproduces canonical triangles. Coarse blocks use center fans with finer perimeter segments at tile borders, without skirts or holes.

The returned `mesh`, world-space `bounds`, actual `stride`, and `maxError` describe the rendered geometry. The error is a conservative vertical bound: the smaller of a block height-range bound and an affine-plane residual bound over all canonical block vertices. For every coarse triangle, its plane minus canonical height is affine on each canonical triangle, so checking canonical extrema over the containing block also bounds their intersections. The bound can overestimate the actual error. If it exceeds the requested tolerance the whole tile falls back to exact stride 1. It is not a screen-space or geometric-normal guarantee.

Collision and picking continue using the canonical `Surface`; the consumer explicitly chooses acceptable visual deviation. Near interactive terrain can remain exact. A chunk build currently copies the entire canonical mesh and visits a bounded set of vertices per coarse block; prepare/cache variants at controlled boundaries, never rebuild every visible tile each frame. Returned mesh arrays are independent and caller-owned.

The terrain template uses four 24×24-cell tiles, exact meshes, stride-2 candidate meshes and a 0.35m conservative physical error limit. Camera-projected error selects detail with 3px refinement / 2px coarsening hysteresis. Initial exact coverage is complete; at most one candidate is built or one LOD replacement published per frame. Material transitions force exact tile fallback. At most eight mesh variants are retained per visit, with candidate attributes; scene exit clears them. This finite diagnostic does not claim unbounded-world streaming or a millisecond deadline.

## Coherent revisions and navigation invalidation

`createTerrainGenerationBuilder(surface, tiles)` validates 1–64 uniquely named, nonoverlapping tiles that cover every canonical cell. `step(maxChunks)` builds at most that many finite chunks, then exposes an immutable `TerrainGeneration` containing the canonical surface, all chunks and their common `epoch` (the surface revision). `prepareTerrainGeneration` is the synchronous preparation shortcut. Generation mesh arrays are frozen; clone them for a mutable author mesh. Cost per chunk still depends on its explicitly bounded grid size; this API promises a chunk-count budget, not a millisecond deadline.

`createTerrainOwner(initial, {maxBytes,release?})` retains the previous complete generation while an abort-aware adapter prepares its replacement. `request(epoch, reservedBytes, build)` uses the existing residency admission mechanism: one pending generation, declared byte reservation and no slot reuse until cancelled running work actually settles. A newer request invalidates older pending work immediately, but can return `saturated` while that old execution retires; retry the new request afterward. An invalid generation, wrong revision, wrong surface identity or oversized result cannot publish. Adapters may delegate to the existing worker host; this kit does not create a worker pool.

`publish(apply)` installs one complete generation at a frame boundary. The synchronous adapter must replace **all** rendered tiles or leave them unchanged and return false. Prepare resources before this callback; arbitrary partial external mutations cannot be rolled back by this helper. Only after successful installation does `owner.current` switch and each subscriber receive one new epoch. Contact/picking must read that same `owner.current.surface`. Listeners can cancel pending navigation and invalidate cached routes; the engine does not guess walkability from heights. A listener failure is counted without undoing an already-published generation. Old generations and late cancelled output release once; closing aborts pending work and releases the current generation.

The byte field is a conservative payload accounting estimate, **not measured total JS/GPU memory**. GPU views, colors, transient worker serialization and renderer allocations need their own budget. `stats()` reports current plus admitted payload reservations and callback failures. The finite terrain template demonstrates revision 1→2 with `R` / pad `Y`: one tile is prepared per frame while the old view remains complete, then four tiles and actor/pad contact swap synchronously. Its tests attach a live path request to the revision listener and verify cancellation at the same epoch. Unbounded-world streaming, navigation graph regeneration and arbitrary topology changes remain separate work.


## Canonical attributes, local edits and camera detail

`surface.vertex(ix,iz)` returns immutable canonical position, material, exclusion and a globally area-weighted incident-triangle normal. Chunk construction reads only its finite tile lattice. Explicit normals survive `defineMesh`; matching canonical vertices share lighting across mixed LOD seams. `sample().normal` remains the actual contact triangle normal, deliberately separate from smoothed shading.

Chunks containing different material IDs fall back to exact stride one. This preserves authored boundaries without internal T-junctions; it is conservative whole-tile refinement, not per-block adaptive triangulation. Homogeneous adjacent tiles can still simplify. The terrain template no longer hardcodes an exact pad tile.

`patchSurface(previous,revision,edits)` validates 1–4,096 unique lattice edits and returns a branded immutable patch with ancestry and changed-vertex bounds. `createTerrainGenerationBuilder(surface,layout,{previous,patch})` reuses unchanged immutable chunk objects only when ancestry/layout/error policy match and their inclusive footprint does not intersect the change bounds expanded by one lattice cell. That margin covers incident-triangle vertex normals; material changes use the same conservative range. The synchronous patch API is available for offline construction. Runtime `prepareSurfacePatch` instead copies input only after shared WorkerHost admission, validates vertices in groups of 256 and recomputes normals one lattice row per slice. The same generator runs inside a worker or yields through the host’s main-thread fallback. Outputs never detach live canonical arrays. The application owns one lazy host; each scene request has an abortable lifetime. Tile generation remains bounded by `step(maxChunks)`. The owner publishes contact/render/navigation together. Consumers sharing reused payloads must not dispose them while another generation retains them.

`createSurfaceScatter` enumerates at most 4,096 world cells, seeded by cell/layer identity independently of LOD, visit order and surface revision. Each cell owns one jittered candidate. `step(maxCandidates,currentRevision)` bounds candidate work and rejects stale revisions; returned points preserve identity while resampling height, slope and exclusions. Candidate center exclusion is supported; object-footprint clearance and persistent harvested-instance state remain game policy. The yard uses sixteen candidates in one low-poly mesh and rebuilds it only on generation publication.

`projectedSurfaceError(chunk,projection)` uses vertical FOV, viewport height and camera-space bounds, including perspective-denominator variation. Near-plane intersections force refinement. `selectSurfaceLod` applies separate refine/coarsen pixel thresholds. The yard derives effective portrait FOV from the same camera policy as rendering, keeps the 0.35m physical tolerance, prepares at most one candidate tile per frame and publishes at most one LOD replacement per frame. It retains canonical contact regardless of visual detail.

## Optional on-demand inspection

`inspectTerrain(owner, {expectedEpoch, offset?, limit?, maxLabelLength?, sample?, displayed?})`
reads the existing terrain owner without retaining it, subscribing, scheduling or
requesting terrain. Results are detached scalar metadata; no live mesh or lattice
arrays leave the helper. `expectedEpoch` is required. Closed owners return `closed`,
a mismatched generation returns `stale`, and consumer display metadata for another
epoch returns `stale-display`. Reacquire the epoch explicitly after publication.
`desiredEpoch` comes from the owner's actual admission statistics; it does not
imply that requested work was admitted, is ready or will eventually publish: a
new desired epoch may still encounter saturation. `releaseErrors` sums the
residency and owner release-callback error counters. Closing may leave cancelled
work counted until its execution actually settles; inspection does not hide it.

Ready results contain current reservation/callback statistics, finite surface
metadata, a tile page, and an optional canonical contact sample. `offset` defaults
to zero, `limit` to 16 (1–64, matching the existing maximum generation size), and
`maxLabelLength` to 120 code units. The latter may be configured to any positive
safe integer. Tile keys/surface IDs are truncated and flagged; identity is the
requested epoch plus tile index, not a potentially truncated label. `nextOffset`
is null at the end. Page results do not pin a generation across requests. An
outside-surface contact sample is null. Display validation visits at most the
existing generation's tile count; snapshot work visits only the selected page and
at most one contact point. Byte statistics remain conservative payload reservation
estimates, not measured JavaScript heap or GPU memory.

`displayed: {epoch, tiles: [{index, stride, vertices, triangles}]}` is optional and
explicitly **consumer-reported**, never inferred from canonical topology or called
a GPU measurement. Indices must be unique and in the generation; counts must be
nonnegative safe integers, and stride must be 1, 2 or 4. Missing display rows return
null. The helper does not verify that a supplied view was actually rendered.
Creators own selected variants and their quality policies. Prepared chunk stride,
error and counts are reported separately. Inputs are ordinary trusted framework
objects; this API is not a sandbox for hostile getters/proxies.

The browser diagnostic in `scripts/play/terrain-inspect-check.mjs` draws an actual
finite wireframe using its consumer-selected coarse/exact variants. It records
pending replacement with old contact still authoritative, coherent publication,
stale generation/display rejection, and closed ownership with no reservations.
Repeated inspection does not initiate additional builds or draws. The existing
serial `test:diagnostics-browser` command runs it in CI. This proves the diagnostic
composition, not an application renderer, terrain quality certification or a
finished editor. Painting, export/reload, inspector cameras that request residency,
seam visualization and navigation generation remain separate proposals.

## Ordered pointwise recipes

`evaluateTerrainRecipe(recipe, operators, limits?)` lets creators supply executable
operators separately from serializable recipe data. It returns a canonical `Surface`
through the sample intake above. No registry, job, publication or frame work is installed.

```ts
import { evaluateTerrainRecipe, type TerrainOperator } from '@kits/terrain';
const plane: TerrainOperator = {
  id: 'plane', version: 1, reads: [], writes: ['height'],
  validate: parameters => parameters === null,
  evaluate: point => ({ height: 2 * point.x - 3 * point.z + 5 }),
};
const ground = evaluateTerrainRecipe({
  formatVersion: 1, id: 'custom-ground', revision: 1, seed: 7,
  originX: 0, originZ: 0, spacing: 1, cellsX: 16, cellsZ: 16,
  steps: [{ operator: 'plane', version: 1, parameters: 'null' }],
}, [plane]);
```

The recipe names operator ID/version pairs and contains JSON text parameters. No
functions enter its payload. Creators supply versions and migrations; no digest or
automatic executable equivalence check is implied. IDs are nonblank and at most
256 code units; versions and revisions are nonnegative safe integers; seed is an
unsigned 32-bit integer. At most 64 ordered steps and 64 executable definitions are
accepted. Definitions with duplicate ID/version pairs and unknown requested versions
are rejected. The grid retains the existing finite bounds.

Each point starts at height/material/exclusion zero. Steps run in declared order,
reading earlier results at the same point. `reads` selects the only own fields exposed
in a frozen input record; an undeclared field is absent (`undefined`), not a trapped
property access. This is data exposure, not a sandbox around arbitrary creator code.
An operator returns a plain record of field changes; omitted fields retain their
values. Every own output key must be declared in `writes`. Heights must be finite;
materials are integers 0–65535; exclusion is numeric 0/1. Heights retain JavaScript
number precision between operators and round to Float32 only after the final step,
preserving the existing procedural constructor's rounding convention. Float32
height overflow rejects the candidate.

The frozen point supplies canonical Float32 world `x/z`, local integer `ix/iz`, and
seed. Parameters are parsed into privately owned, recursively frozen JSON values;
nonfinite numeric JSON is rejected. Definitions, channel lists and all step parameters
are captured before creator validators run. Changes to the caller's recipe or operator
objects afterward do not replace the captured values/functions. Closure state remains
the creator's responsibility: deterministic operators must not depend on invocation
order, mutable external state, time, or unseeded randomness. There are no neighbor
reads, normal/slope input fields or cross-region halo guarantees in this evaluator.

Optional limits default to 4096 UTF-8 parameter bytes, 256 value nodes and depth 16
**per step**. Byte/node bounds are positive safe integers; depth may be zero. Byte
admission precedes JSON parsing; structural limits follow parsing. They do not bound
parser transient allocation or arbitrary creator callbacks. Validation errors,
exceptions, promises/class instances returned as results, undeclared writes and
invalid fields throw without returning a partial surface. External callback effects
are not rolled back. Callbacks are trusted synchronous code, not CPU-budgeted code.

`terrainRecipeSlices(recipe, operators, limits?)` captures and validates inputs
synchronously, then returns a generator. Each yield completes one grid row, at most
257 points × 64 operator calls. The return value owns row-major sample buffers
suitable for `createSampledSurface`. Calling `return()` abandons remaining evaluation;
there is no partial public result. This is a work-count boundary, not a time deadline.
The synchronous convenience function drains those slices and then calls canonical
intake. Final intake, copying and normal construction are still synchronous; worker
execution and sliced finalization are separate integration work. Call this during
preparation, not each frame. The existing terrain owner remains responsible for
replacing any live generation.

Tests use the independently calculated plane `4x − 6z + 11`, reversed operation
order, material-driven exclusions, frozen input capture, cancellation, invalid
payloads/outputs, and a rounding case that distinguishes final from per-step Float32
conversion. These establish the finite evaluator contract, not terrain aesthetics,
physical-device timings or replay safety of arbitrary custom operators.

## Admitted recipe preparation

`prepareTerrainRecipe(host, owner, recipe, signal, urgency?)` submits to the existing
WorkerHost as `job.kits.terrain.recipe`. The optional built-in definitions are
`plane` version 1, parameters `[xSlope, zSlope, offset]`, and `height-scale` version
1, parameters `[scale, offset]`. These are examples of pointwise operators, not a
required terrain style. The default urgency is foreground; creators select policy.
A successful result is `{ status: 'done', surface }`; refusal, cancellation and
supersession are named host outcomes. Failures reject. Keep the current terrain
and optionally retry recoverable refusals. A returned surface never publishes
itself: assemble a candidate with the existing generation builder, then explicitly
publish through the terrain owner, retaining its epoch/version checks.

The adapter captures bounded metadata and at most 64 small step records before
admission. Only dispatch materializes the copied serializable payload. JSON parsing,
creator callbacks and sample allocation occur within admitted work. Output and
scratch reservations conservatively allow simultaneous samples, canonical buffers,
normal accumulation and ownership copies; these are payload accounting allowances,
not measurements of JavaScript heap overhead or callback allocation. The worker
transfers only job-owned buffers. Sampling and canonical intake yield each row;
normal preparation uses the existing row/vector slices. Cancellation abandons the
candidate at checkpoints. Trusted callbacks can still exceed a slice's time or
allocate additional memory; this mechanism does not sandbox executable code.

Main-thread fallback runs exactly the same generator. After delivery, adoption
validates topology, lengths, finite samples and unit upward normals, then copies
into the private canonical Surface. That final bounded **synchronous** validation
and copy is linear in the grid size (at most 257² vertices). It does not recompute
normals or prove the mathematics of an arbitrary custom worker; the registered
shared implementation and independent oracle tests supply that evidence. Host
reservation ends at delivery, so creators must account for retained candidate/live
surfaces through their generation lifecycle. There is no public sample-intake
normal override. `createSampledSurface` and `evaluateTerrainRecipe` remain synchronous
conveniences; use preparation jobs for larger candidates.

For creator operators, define executable functions in a shared module, then bind
that module to both fallback and a discovered worker entry. For example, inside
an optional kit `src/kits/myterrain/`:

```ts
// generation-job.ts
import { createTerrainRecipeJob } from '../terrain';
import { operators } from './operators';
export const generationJob = createTerrainRecipeJob(
  'job.kits.myterrain.generate', operators,
);
// workers/generate.job.ts
import { generationJob } from '../generation-job';
export default generationJob.module;
// The caller uses generationJob.prepare(host, owner, recipe, signal).
```

The existing lazy worker discovery owns registration; filenames and job IDs must
agree. Executable callbacks are imported code, never structured-cloned payloads.
Game code uses kit exports rather than importing worker/platform internals. No
second registry or scheduler is introduced. Custom worker and fallback modules
must import the same definitions and parameter limits. Initial generation remains
pointwise: shared region lattices, neighbor reads and halo-derived edge normals
are not promised by this API.

Focused tests cover an independently calculated plane and normal, actual module
execution plus a structured-clone/transfer boundary, shared fallback, refused
materialization, queued recipe mutation, cancellation during all three phases,
stale revisions, owner disposal, callback failure, malformed output and retained
live surface buffers. Browser worker bundling and device timings require separate
evidence; Node doubles do not establish those properties.
## Independent regions on a shared lattice

`createTerrainRegion(options, source)` is an optional, distinct regional contract.
It does not change ordinary `Surface` coordinates, patches or boundary normals.
The creator supplies a lattice `{ id, revision, baseX, baseZ, spacing }`, a core
`{ startX, startZ, cellsX, cellsZ }` in **global integer sample indices**, and a
trusted pointwise sample function. Indices may be negative; the base and positive
spacing may be fractional. Each world coordinate is calculated directly as
`Math.fround(base + globalIndex * spacing)`, never by adding a local offset to an
already rounded region origin. Collapsed, nonfinite or unsafe-index grids reject.
The source receives frozen `{ gx, gz, x, z }` and returns `{ height, material?,
excluded? }`. Heights round once to Float32; materials default to zero and exclusions
to false. Deterministic source/version management belongs to the creator: closures,
unseeded random values, time and invocation order are not made deterministic by the
engine. Metadata is captured before the first callback; sample buffers remain private.

Each core retains one cell of halo on all four sides. The core is bounded to 254
cells per axis so the padded grid remains at most the existing 256-cell ceiling.
This is a separate bound, not a raise of ordinary Surface limits. Backing typed
storage is at most `257² * 31 + 2 * 257 * 4` bytes (height, material, exclusion,
three Float64 normal components and two coordinate axes), excluding object/runtime
overhead and caller-created meshes. Source code can allocate outside this allowance.
`terrainRegionSlices` provides row checkpoints during sample evaluation, triangle
normal accumulation and normalization. Calling `return()` abandons a candidate.
The convenience function drains synchronously; no host admission, asynchronous
worker adapter or cancellation signal is implicit. Creators can drive the slices
through the existing preparation infrastructure; callbacks cannot be serialized.
No new scheduler, cache or publication owner is created.

Area-weighted normals include every incident halo triangle, using the same upward
canonical diagonal as finite surfaces. Independently generated regions from the
same accepted source/lattice therefore share vertex positions, heights and normals,
including corners. `vertex()` and `mesh()` expose only the core. `query()` returns
`covered` with the canonical triangle height, face normal and discrete fields, or
`outside`; halo samples never count as visible coverage. Vertex/mesh smooth normals
and query face normals intentionally serve different purposes, as on finite surfaces.
A query at a core maximum selects the triangle inside that core; an adjacent core
may select a different face normal at that same edge. Smooth vertex normals still
agree. Coverage reports the shared edge as ambiguous so face ownership is explicit.
Meshes are detached copies; this distinct object does not masquerade as a branded
Surface. Ordinary `patchSurface`, generation builders, raycasts and chunk LOD are
not automatically regional APIs. Those adapters need separate integration evidence.

`dependency` is the inclusive rectangle of **global sample indices** consumed by
that region, including its halo. After an edit, the creator must rebuild every
region whose dependency rectangle intersects changed samples, using the same new
source revision, then publish a coherent accepted set. Rebuilding only the visible
core can leave neighbor normals stale. This API exposes dependencies but does not
perform automatic invalidation, residency or publication. The immutable previous
region remains valid until its owner replaces it. A revision identifier does not
verify that independently supplied callbacks implement the same source.

The focused oracle compares four independently prepared cores to a monolith and to
an ordinary canonical Surface, checks fractional coordinates and negative indices,
and verifies the edited paraboloid corner normal `(-2/3, 2/3, -1/3)` independently.
These checks cover normal equality, not merely coincident edge positions. They do
not establish worker packaging, cross-device timings or aesthetics.

## Explicit finite coverage snapshots

`createTerrainCoverage(entries, maxEntries = 64)` is an optional immutable lookup
snapshot, not a world loader. The configurable count must be 1–64; entries are
captured by bounded indexed copy. A `ready` entry references a canonical region.
`pending`, `unavailable` and `failed` entries name a world-coordinate rectangle and
identity. Query results distinguish `covered`, those three missing states, and
`outside` (no declared extent). No missing state supplies a fabricated flat height.
Overlapping closed bounds, including shared edges, return `ambiguous` with bounded
matching IDs. The creator explicitly chooses precedence, edge ownership, fallback,
waiting, retries and collision policy; the engine does not silently select one.

A new snapshot records changed coverage; mutations to caller records cannot update
an existing one. Duplicate identities, forged regions, malformed bounds, nonfinite
queries and oversized tables reject. This small lookup intentionally does not add
a spatial tree, streaming scheduler, unbounded world history or residency manager.
For worlds needing more than 64 simultaneous entries, partition lookup using the
creator's existing spatial owner or deliberately extend this bounded contract with
appropriate evidence.
