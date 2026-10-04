# KTX2 model textures (Basis Universal)

Status: implemented and checked in PR #146 (branch `feat/ktx2-textures`); integration is recorded in the
[upgrade acceptance ledger](upgrade-acceptance-ledger.md) once it merges. Evidence:
[ktx2-model-textures-20261003.md](../verification/ktx2-model-textures-20261003.md).

A GLB whose textures use `KHR_texture_basisu` (KTX2 with Basis Universal ETC1S or UASTC payloads) now loads through
the stock model path. Nothing changes for a game whose models have no KTX2 image: it downloads none of this.

## Requirement and existing seam

**Creator requirement.** On phones, a texture's GPU memory, not only its download, decides how much art fits. PNG,
JPEG and WebP shrink the download, but the GPU still holds every texel as RGBA8. A KTX2 texture is transcoded to a
block-compressed GPU format (BC7, ASTC, ETC2, …), which is typically 4 to 8 times smaller on the GPU. Before this
change, a GLB with a required KTX2 texture failed to load, because `models.ts` registered only the meshopt decoder.

**Seam.** The model library's default GLB parser (`src/platform/assets/models.ts`, `defaultParse`). No new cache,
scheduler or registry: KTX2 models are ordinary entries of the model library's `LeaseCache`, with the same admission,
residency, late-drop and disposal paths as every other model.

## Owner, inputs and outputs

| | |
|---|---|
| Owner | The model library (`createModelLibrary`), one per app through `platform.models`. Its KTX2 step lives in `src/platform/assets/model-ktx2.ts`, a lazy chunk. |
| Input | A GLB whose textures name an image through `KHR_texture_basisu` (or an image declaring `image/ktx2`); the renderer the scene runtime binds (`models.bindRenderer(renderer, visitSignal)`, the pooled world renderer of the visit). |
| Output | The parsed template, with each KTX2 texture a `THREE.CompressedTexture` in the GPU format `KTX2Loader.detectSupport(renderer)` chose, or RGBA8 when the renderer supports no compressed format. |
| Probe | `models` (`engine.probe('models')`, `models.stats()`): `compressedTextures`, `compressedTextureMiB` (transcoded bytes) and `transcoderLoads` (0 until a model has a KTX2 image). `residentMiB` includes the transcoded bytes. |
| Library option | `compressedTextures: { renderer(), workers?, createLoader? }` for a library created directly; `platform.models` supplies it. Without it, a KTX2 model is refused (`models: KTX2 textures are not enabled for this library`). |

### Lazy and opt-in

- The KTX2 chunk (header checks, three's `KTX2Loader`, ktx-parse, zstddec) is imported only when a parsed GLB has a
  KTX2 image. The Basis transcoder (`basis_transcoder.js`, 57,529 B, and `basis_transcoder.wasm`, 527,333 B;
  Apache-2.0, vendored in three) is fetched only by the first such model's set-up, once per library.
- A model without a KTX2 image never imports the chunk or fetches the transcoder. The browser check asserts no request
  for `model-ktx2`, `KTX2Loader` or `basis_transcoder` and `transcoderLoads: 0`.
- What a game without KTX2 still pays: 319 B of first-load JS (138 B gzip) for the renderer binding, and 1,385 B
  (539 B gzip) in the lazy `models` chunk for detection and accounting. Measured with `npm run perf:bundle` and a
  reading of the Vite manifest; see the [evidence](../verification/ktx2-model-textures-20261003.md#bundle).

### Serving the transcoder

three's `KTX2Loader` names the transcoder files with `new URL('../libs/basis/…', import.meta.url)`. Vite serves them
from `node_modules` in dev and emits them as hashed build assets (`assets/basis_transcoder-<hash>.js|.wasm`) that
follow the build's `--base`: `/sub/game/assets/…` for `--base /sub/game/`, a path relative to the chunk for
`--base ./`. They are not public files, so they never collide with a game's own `public/` folder and need no copy
step. Every build that includes the model library emits the two files (584,862 B in `dist/assets`); a page fetches
them only for a KTX2 model.

## Bounds

| Bound | Value | Where |
|---|---|---|
| Image kind | Basis Universal only (vkFormat UNDEFINED: ETC1S or UASTC), one 2D image: no depth, layers or cube faces, as `KHR_texture_basisu` requires | `readKtx2Header` |
| Image side | At most 16,384 texels | `MAX_KTX2_SIDE` |
| Admission before transcoding | The GLB's KTX2 images' worst case (per level, the larger of RGBA8 and one byte per texel in whole 4×4 blocks) must fit `maxResidentBytes` (default 128 MiB) before the transcoder is fetched or a transcode starts | `ktx2WorstBytes` |
| Admission after transcoding | The transcoded level bytes (the GPU size) count toward `maxResidentBytes` like any model bytes, with the RES-01 eviction of retained templates first | `modelBytes`, `texture-bytes.ts` |
| Workers | 2 per library by default (`compressedTextures.workers`, 1 to 8) | `KTX2Loader.setWorkerLimit` |
| Transcoder set-ups | One per library; a failed set-up is retried by the next KTX2 model | `createKtx2Host` |
| Concurrent loads | Unchanged: `maxPending` (16) model loads hold work slots until their parse settles, transcodes included | `createModelLibrary` |

**Byte accounting.** `textureBytes` (shared by the texture and model libraries) counts a compressed texture as the sum
of its levels' bytes. That is exact for what three uploads: 5,488 B for the 64×64 UASTC fixture transcoded to BC7, and
21,844 B for the same image in the RGBA8 fallback (an image texture of that size is estimated at 21,845 B). These are
the engine's estimates of uploaded data, not measured driver memory; a driver may pad. The CPU copy of the transcoded
levels stays with the template (as decoded images did), so a parked template uploads again without transcoding.

## Overload, cancellation and failure

- **Overload.** A GLB whose worst case exceeds `maxResidentBytes` is refused with `models: resident budget exceeded`
  before any transcode. Other overload follows the model library: pending loads beyond `maxPending` are refused,
  residency evicts unpinned retained templates before refusing.
- **Cancellation.** A requester that leaves while the transcoder files are still arriving costs no transcode: the parse
  checks the load's signal once the transcoder is ready. A transcode cannot be stopped once posted to a worker; its
  result is dropped on arrival (`lateDrops`) and every resource the late parse made is disposed, never published. The
  work slot is held until the transcode settles, as for every decoder (`cancelled decoders retain pending admission`).
  The browser check repeats the #116 cancel-after-decode cycle with the transcode reply held: three cycles, one late
  drop each, all resources disposed, resident bytes unchanged.
- **Disposal.** Library disposal (app teardown) retires the transcoder: `KTX2Loader.dispose()` terminates its workers
  and revokes the worker script, and the loader is made to reject any later work rather than let three's worker pool
  start a new worker. A set-up in flight at disposal retires its own loader once its files arrive. A transcode in flight
  at disposal never settles; its requester was already rejected with `AbortError`.
- **Failure.** A refused header (not Basis, layered, cube, too large, malformed) rejects the model before the transcoder
  loads. A missing renderer binding rejects with `models: KTX2 textures need a bound renderer`. A transcoder file that
  fails to load rejects that model; the next KTX2 model retries the set-up. A single texture that fails to transcode is
  handled as GLTFLoader handles any texture that fails to decode: it logs `Couldn't load texture` and the model loads
  without it. The scene draws its existing fallback for a failed model.

## The uncompressed fallback

`KTX2Loader.detectSupport` reads the renderer's compressed-texture extensions. When none applies, the worker transcodes
to RGBA8, which uploads as an ordinary texture. Nothing is refused: the model draws, and its bytes are the RGBA8 size. The browser check forces this by hiding
every compressed-texture extension before boot and checks the drawn colours and the 21,844 B count.

## Workers and STD-RUN-35

The transcoder runs in three's own `WorkerPool` (classic workers started from a blob script), not in the engine's
worker host. That is an explicit exception to STD-RUN-35 ("the workers system MUST be the only code that creates
threads"), taken because the Basis transcoder is an Emscripten classic script with per-worker WASM state and three's
loader owns its transcode protocol. The exception is bounded: at most `workers` threads (default 2) per library, owned
by the model library, terminated with it. Moving transcoding into a worker-host job kind is a separate, unscheduled
change; until then the pool does not share the host's concurrency budget or memory admission.

## WebGPU backend (ADR 0078)

The binding is WebGL-backend compatible today: the scene runtime binds the pooled `WebGLRenderer`, and
`TextureFormatRenderer` already admits a WebGPU renderer's shape (`isWebGPURenderer`, `hasFeature`). When the WebGPU
backend exists it will need to:

- bind the `WebGPURenderer` only after `await renderer.init()`, because `detectSupport` reads device features;
- request the `texture-compression-bc`, `-etc2` and `-astc` features when it creates the device (three's backend asks
  for every available feature by default; an engine-chosen feature list must keep these);
- keep one backend per app: the transcode target is chosen once per library, so templates are only valid for renderers
  with the same formats (true today, since the pool uses one backend per app);
- count texture memory itself: WebGPU has no `renderer.info.memory` equivalent of the WebGL audit, and the estimate
  here stays the transcoded level bytes.

## Limitations

- Model textures only. Standalone texture assets (`platform.assets`, `defineAsset({ type: 'texture' })`) do not
  transcode KTX2: the texture library's variant chooser skips `ktx2` variants, because no format check is wired to it.
- Evidence is desktop Chromium with SwiftShader: the chosen format there is BC7. No phone GPU, ASTC/ETC2 upload,
  driver memory, transcode time or thermal measurement is claimed. Mark device acceptance unverified until measured.
- The fixture is hand-packed UASTC solid-colour blocks (see `src/testing/ktx2-fixture.ts`); no ETC1S (BasisLZ) or
  Zstandard-supercompressed file was exercised, because no encoder was available when it was made.
- `npm run asset:verify` accepts `KHR_texture_basisu` when a model's contract lists it and applies the same header
  rules; it does not transcode.
- No template ships a KTX2 model.

## Producing KTX2 models

See [load a model](../recipes/load-a-model.md#ktx2-textures-for-phones). In short: with KTX-Software 4.4 or later on
`PATH`, `gltf-transform uastc` (normal maps, ORM) and `gltf-transform etc1s` (colour) write `KHR_texture_basisu`
textures; keep each side a multiple of 4. When this capability is available, `npm run asset:optimize` can switch its
texture step from WebP to KTX2 for phone targets; the optimiser has its own owner and is not changed here.
