# Atomic cell edits and immutable occupancy

Use `createCellEdits` from `@kits/procgen` for sparse changes over a caller-owned
Uint16 baseline. Use `createOccupancy` from `@kits/spatial` for a detached binary
raster snapshot. They work without kit registration, a system, renderer or timer.
Creators choose material meaning, coordinates, outside behavior and publication.

```ts
const edits = createCellEdits(baseline, {maxBatch: 8192, limits: {maxEdits: 65536}});
const outcome = edits.batch(edits.revision, [
  {x: 1, y: 0, z: 2, value: 0},
  {x: 2, y: 0, z: 2, value: 0},
]);
if (outcome === 'changed') {
  const values = Uint8Array.from(edits.materialize(), value => Number(value !== 0));
  const field = createOccupancy({width: baseline.cellsX, height: baseline.cellsZ,
    values, revision: edits.revision, maxCells: 262144,
    maxCellsPerQuery: 8192, outside: 'blocked'});
  const contact = field.segment(1.5, 2.5, 20.5, 2.5);
  // Only 'clear' certifies a complete clear query. Refusal is not clear.
}
```

The example assumes `cellsY=1`. Storage is X-fastest, then Z, then Y; occupancy
calls its two cell axes X and Y. Map world coordinates to cell space explicitly.

## Storage boundary

`batch(expectedRevision, edits)` returns `changed`, `unchanged`, `full` or `stale`.
Invalid input throws before publication. A changed batch advances revision once;
empty or equal-value batches do not. Final sparse capacity includes all additions
and baseline reversions, independent of input order. Duplicate cell coordinates
are invalid. A failure leaves the sparse values, revision and dirty flag unchanged.

`maxBatch` defaults to 4096 and may be configured up to `CELL_BATCH_CEILING`
(1,048,576 records). This is separate from `maxEdits`. Batch input is a dense plain
array of own numeric data records, with no extra properties, accessors or custom
iterator. Reflection on a Proxy can execute its traps; nested `set`, `batch` and
`markSaved` are refused during admission. Unrelated trap side effects are outside
the contract. Baseline storage remains borrowed: never mutate it while edits use
it. Expected revision cannot detect external writes to that baseline.

Changed publication stages a new sparse map: O(existing edits + batch) work and
temporary entries, in addition to captured batch records. Full, stale and no-op
batches avoid the map clone. No callbacks run during publication. Allocation
failure during staging leaves prior state. This is synchronous in-memory
atomicity, not crash durability or a transaction spanning arbitrary observers.

Scalar `set` retains its existing outcomes. Both changed scalar and batch writes
now refuse exhausted safe-integer revisions before mutation; unchanged writes
still succeed. Existing binary encoding and saved revision semantics are unchanged.
Persist with the existing chunk store and call `markSaved` only for a successful
saved revision. A failed write must leave dirty state available for retry.

## Occupancy queries

Construction copies a Uint8Array containing only 0/1. Shared buffers are refused.
Dimensions and configured `maxCells` are positive integers; the checked product
cannot exceed `OCCUPANCY_MAX_CELLS` (4,194,304). The immutable snapshot retains one
byte per cell. No mask alias is exposed. Old and new snapshots coexist until their
creator drops references; budget that overlap. `revision` is caller-supplied
metadata, not a globally unique ownership token.

`point(x,y)` takes integer cell indices. `rectangle(minX,minY,maxX,maxY)` takes
half-open integer ranges; empty rectangles are clear. The rectangle preflights its
clipped cell area against `maxCellsPerQuery`, even if a hit might be found early.

`segment(x0,y0,x1,y1)` includes both endpoints and treats occupied cells as CLOSED
unit squares: touching an edge or corner counts. A line on a shared edge tests both
strips. Zero-length segments test every incident cell, so a corner probe differs
deliberately from integer `point`. Nearest contact wins, with row-major cell order
for true equal-time contacts. Hit results contain `cell` and `t`; outside hits
have no invented cell. Input must be finite; magnitudes above MAX_SAFE_INTEGER
return `numeric-refusal` rather than an unreliable contact.

The required outside policy is `clear`, `blocked` or `refuse`. For point/rectangle
it refers to valid cell indices/ranges. For segment geometry the grid rectangle is
closed: its outer boundary is not outside. `clear` clips to the grid; `refuse`
returns `outside` if either endpoint is outside. Under `blocked`, starting outside
hits at zero; exiting reports the exit fraction (the infimum of outside contact).
An occupied in-grid cell at that fraction takes precedence. An empty rectangle
remains clear even when its coordinates are outside.

Segment supercover traversal visits crossed cells, not its bounding-box area.
It processes tied contact groups completely before selecting a hit. Exhausting
`maxCellsPerQuery` returns `too-wide`, never a partial hit or false clear.
`cellsVisited` counts unique candidate cells actually examined. A Set retains at
most the query limit or grid cell count, whichever is smaller; event-local groups
contain at most four cells. Event count cannot exceed width + height + 3.

Crossing order and clipping use exact dyadic BigInt arithmetic for the admitted
IEEE inputs. Common coordinate scale needs at most 1074 fractional bits; bounded
coordinate magnitudes keep scaled coordinates below 1128 bits and intermediate
products below 4600 bits. Parameters are recomputed from integer boundaries, not
incrementally rounded. Returned `t` is rounded to Number only after selecting the
contact, so two different contacts can have indistinguishable reported fractions
without affecting selection. Zero/signed-zero directions and subnormals are
supported. No arbitrary epsilon expands a cell. Defensive arithmetic refusal is
`numeric-refusal`, distinct from clear.

These are logical work/storage bounds, not native heap measurements or CPU
deadlines. In one local Node diagnostic run, 100 empty 1024×1024 diagonals visited
3070 cells each in about 54 ms total; subnormal-origin diagonals took about 375 ms.
100 distant horizontal queries took about 46 ms, and 10,000 short queries about
59 ms. These single-run observations are not device benchmarks or guaranteed
throughput; subnormal BigInt costs are materially higher.

## Composition and evidence

The consumer tests build a roofed excavation cavity with atomic brush edits and
real chunk-store failed-write/reopen behavior, and a static material-classified
arena with placement/contact queries. An existing scene handover test refuses
failed or late derived-snapshot activation. Canonical edits and derived rendering
are separate commits: the helper does not roll back accepted edits when rendering
fails, nor provide GPU transactions, body collision, navigation rebuilding or
random spawn policy. Use existing preparation/lifetime owners when needed.

Tests compare traversal against 29,403 independent exhaustive rational cell cases,
explicit edge/corner/distant cases and a long diagonal work bound. No image,
browser, physical device, GPU or original-content fidelity acceptance is claimed.
