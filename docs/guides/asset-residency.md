# Bounded asset residency (RES-01)

Status: integrated in v0.2.0 (PR #22, merged to `main` at `9913019`). A creator may opt in to keeping released texture
and model assets resident between uses, within budgets chosen per quality preset,
with named critical assets pinned. Nothing changes for a game that does not set
`defineGame({ residency })`: released assets are disposed at once, as before.

## Design

### Requirement and existing seams

The creator requirement is a bounded trade between memory and repeat preparation:
a scene that returns, or an entity that reappears, should not fetch, decode and
parse the same asset again when the creator has allowed memory for it, and a
pinned critical asset should never need that fetch, decode or parse again after
its first preparation (its GPU upload and program link still repeat on the next
draw in a new renderer lease or after parking). The
existing owners already provide most of the mechanism:

| Responsibility | Existing owner | Residency extension |
|---|---|---|
| Shared asset identity, reference counts, deduplicated loads, late-result discard | `LeaseCache` (`src/platform/assets/lease-cache.ts`) | Unchanged |
| Released-asset retention and its disposal | `LeaseCache` warm LRU, bounded by `warmBytes` (hard-coded to 0 by both app libraries) | Configurable per preset; optional total ceiling; pinning; parking; counters; pressure report |
| Texture and model GPU release | Library `dispose` loaders (`textures.ts`, `models.ts`) | A `park` hook that drops per-renderer GPU copies of a retained asset through three's public `dispose()` event while keeping its decoded source |
| Model live admission | `createModelLibrary` `maxResidentBytes` (rejects) | Still the hard limit; retained unpinned models are evicted (LRU) to admit a new one first; pinned models count against it |
| Per-visit GPU objects and programs | Renderer pool (fresh renderer per lease; release scrubs every GL object) | Unchanged; residency never keeps GPU objects across a lease |
| Preparation before activation | Author runtime compile, `programsReady`, initial draw, `frameReady` | Unchanged; a re-acquired asset is uploaded by the same initial draw |
| Diagnostics | Library `stats()`, `EngineProbes` | Residency counters in `stats()`; a `textures` probe when configured (the `models` probe already exists) |

No second scheduler, cache or registry is introduced. The measured gap is in the
existing owner: both app libraries construct their caches with `warmBytes: 0`, no
creator setting reaches them, there is no pinning or total ceiling, and a retained
three.js resource would keep a `dispose` listener (and through it a released
renderer) from every visit that drew it. A focused test shows the cost: without
retention a second acquisition of a released key performs a second fetch and
upload (`loads === 2`); with a pin it is a hit (`loads === 1`).

### Inputs and outputs

Input: `defineGame({ residency })`, validated by `defineGame`:

```ts
residency: {
  textures: { residentBytes: 96 * MiB, warmBytes: 32 * MiB, ports: { low: { residentBytes: 32 * MiB, warmBytes: 0 } } },
  models: { residentBytes: 64 * MiB, warmBytes: 16 * MiB },
  pinned: ['hero-albedo', 'hero-model'],      // registered asset ids
  onPressure(report) { /* creator hook: lower content, show a notice, log */ },
}
```

Budgets use the existing `Ported<T>` shape: flat values are the reference preset,
`ports` override them for lighter presets. The quality service's current preset
selects the active row and a preset change applies the new row to the loaded
library. Every number is a nonnegative safe integer of estimated bytes.

Output: retention and eviction inside the existing caches; library `stats()` gain
`pinnedMiB`, `evictions` (retained assets later disposed for a budget; disposal at
release is not counted), `reloads` (loads of a recently evicted key: the repeat
preparation cost), `pressure` and `cleanupFailures`. When configured, the dev/test
probes report them as `textures` and (always present) `models`; production builds
read the same values through `assets.stats()` and `models.stats()`.
`onPressure` receives `{ kind, preset, residentBytes, limitBytes, liveBytes, pinnedBytes, warmBytes }`.

### Owner and lifetime

Each `LeaseCache` owns its entries. `platform.assets` and `platform.models`
resolve the budget for the current preset and apply it to their library. A pin
retains an asset after its last lease; module disposal (app teardown) retires
every retained entry, pinned or not, through the library `dispose` path.

### Bounds

- `warmBytes`: unpinned released bytes kept for a quick return (LRU).
- `residentBytes`: optional ceiling on all bytes the cache owns (live leases,
  pinned and unpinned retained entries). Exceeding it evicts unpinned retained
  entries, least recently used first, until it fits or none remain.
- Live leases and pins are never evicted for a budget. Pending loads hold no
  bytes and are never evicted; their publication re-checks the ceiling.
- Recent eviction memory for the `reloads` counter is bounded to 1024 keys.
- Bytes are logical estimates (the sum of integer mip-level dimensions × 4 for
  an ordinary 2D RGBA8 image; the transcoded level bytes for a compressed KTX2
  model texture, see [KTX2 model textures](compressed-textures.md); vertex, index
  and morph buffers plus textures and animation tracks for a model). They are not measured driver or browser memory.
  The existing model estimate counts each attribute's array, so attributes that
  share one interleaved buffer are over-counted (conservative).

Ordinary images are charged a complete mip chain, halving each dimension with
integer floor and clamping each axis to one until the final 1×1 level. A 512×1
image therefore costs 4092 bytes; 64×64 costs 21844 bytes. This replaces the
four-thirds approximation, which undercharged thin images. The full-chain charge
remains even when a sampler disables mipmaps: it is a conservative image policy,
not an exact forecast of each descriptor's allocation. These numbers exclude
driver padding/copies and decoded CPU image storage.

General texture descriptors remain an accounting limitation. Ordinary cube faces,
array layers, volume depth, authored mip layouts and non-RGBA8 types require
separate support; the image formula may undercount them, including a zero estimate
for an ordinary cube. A custom model parser can supply these descriptors, so its
`maxResidentBytes` check must not be treated as a complete bound for those formats.
Compressed level-byte accounting is unchanged. Correcting ordinary 2D mip sums
does not resolve these broader descriptor cases.

Headless regressions cover thin, square and odd dimensions, compressed payloads,
and real model admission at a 3000-byte ceiling: the 4092-byte image is refused,
its resources retire once, and a subsequent 2044-byte model loads successfully.
Texture residency still reports pressure and preserves live leases; hard model
admission is a separate existing policy. This correction adds no browser or
physical-device allocation evidence.

### Overload

When live and pinned bytes alone exceed `residentBytes`, nothing further can be
evicted. The cache keeps every in-use and pinned asset, stays usable, increments
`pressure` once per transition into that state and calls `onPressure` (and logs
a warning) once per transition. It does not refuse loads, evict a pinned asset,
retry or loop. Leaving and re-entering the over-budget state reports again.
Model live admission (`maxResidentBytes`, default 128 MiB) remains a separate
hard limit that counts every template the library owns, retained ones included.
Before refusing, the model library evicts unpinned retained templates (least
recently used) until the new one fits (`LeaseCache.makeSpace`). Pinned models are
never evicted for it, so they reduce admission headroom: a new model that does not
fit beside live and pinned ones is refused with `models: resident budget exceeded`,
as an over-limit model always was. Keep pinned model bytes well below
`maxResidentBytes`, or unpin through a preset row, to leave room for live loads.

### Cancellation

A requester abort releases its lease as before. A pending load whose requesters
all left is aborted and its late data discarded; a budget change during a pending
load does not touch it. A released resource is parked (GPU copies dropped) only
if it is still retained after trimming, so an evicted one is disposed exactly once.

### Failure and recovery

Disposal and park failures are collected and rethrown as before when they happen
during a release; evictions triggered by a publication or by a budget change are
counted in `cleanupFailures` and reported to the module log so they never fail an
unrelated load. A throwing `onPressure` hook is caught and logged. On WebGL context
loss, retained assets keep their decoded sources; three re-uploads them on the next
draw after restoration, and a recreated context starts a new renderer that does the
same. Re-preparation therefore uses the existing scene preparation and recovery
paths; residency adds no restoration step of its own.

### Limitations

- Retention saves fetch, decode and (for models) parse. It does not keep GPU
  uploads across renderer leases: the renderer pool scrubs every GL object at
  release, and a parked resource is uploaded again by its next draw.
- Budgets are per library (textures, models). There is no combined cross-library
  ceiling, no program-count budget (programs belong to each renderer lease and
  are freed with it), and no speculative prefetch.
- Pinning applies once the asset has been acquired; it does not load an asset
  ahead of its first use. A pinned id that is not a registered texture or model
  is logged as an error at boot, not refused.
- Budgets apply when the library is loaded and on each preset change; a lowered
  budget evicts retained assets at once and never touches live leases.
- A decoded `ImageBitmap` may itself occupy GPU-process memory in some browsers;
  the estimate does not measure that.
- Painted surfaces, cube backgrounds, terrain and tile streams keep their own
  owners and limits.

### Acceptance evidence

Focused tests (`lease-cache-residency.test.ts`, `residency.test.ts`) cover:
the ceiling exactly at the boundary, everything pinned (explicit pressure, no
eviction, no repeated report), a budget change during a pending load, parking and
listener release that simulates a renderer, scene exit releasing every unpinned
entry, estimate formulas, alternating access without reloads when it fits, a
retained model evicted to admit another under `maxResidentBytes`, the explicit
refusal while a pinned model holds that headroom, and a throwing cleanup reporter
that cannot unwind a publication's accounting.
An opt-in native browser fixture compares the estimate with the uploaded texture
dimensions and `renderer.info.memory` counts, and exercises actual context loss
and restoration:

```sh
ENGINE_CHROMIUM=<chromium> node -r ./scripts/silent-browser.cjs scripts/play/asset-residency-check.mjs /tmp/asset-residency
```

It is not part of a default gate. Its [retained result](../verification/asset-residency-20261002/README.md)
(SwiftShader WebGL2 in isolated Chromium) observed: estimates within 0.05% of the
exact uploaded mip chain for 256², 512² and 300×200 RGBA8; three live uploads
counted by `renderer.info.memory.textures`; zero textures on the GPU after scene
exit with the pinned texture retained CPU-side; re-acquisition without a fetch or
decode; and a red pixel after an actual loss and restoration, again without a
reload. These are software-renderer results, not physical-device memory, driver
allocation or traversal performance evidence, and no template configures
residency, so gates and snapshots only show that the default is unchanged.
