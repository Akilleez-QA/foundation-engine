# KTX2 model textures — 2026-10-03

PR #146 adds KTX2 (Basis Universal, `KHR_texture_basisu`) textures to the model library. This record lists what was
checked and what was not. The capability, its bounds and its failure behaviour are in the
[guide](../guides/compressed-textures.md).

## Fixture and its provenance

Neither KTX-Software (`ktx`, `toktx`) nor glTF-Transform was installed on the machine, and no Basis encoder was
available. The fixture is therefore generated, not encoded: `src/testing/ktx2-fixture.ts` packs a 64×64 UASTC KTX2
image from UASTC's solid-colour block mode (mode 8: the 5-bit code `0x17`, then 8-bit R, G, B, A), with a full
7-level mip chain, a basic data format descriptor (colour model `KHR_DF_MODEL_UASTC`, sRGB transfer, RGB channel) and
no supercompression. The mode code was found by trying every code against the real transcoder, then fixed in the
file. The image is four solid quadrants (red, green, blue, white); levels below 8×8 are one grey block. It is wrapped
in a 7,160-byte GLB: one unlit square (`KHR_materials_unlit`) whose base colour reads the image through a required
`KHR_texture_basisu`, as `gltf-transform` writes it. Nothing binary is committed; the check and the tests generate it.

`src/testing/ktx2-fixture.test.ts` decodes the image with the Basis transcoder vendored in three
(`examples/jsm/libs/basis/`, run in Node): every texel of all 7 levels matches in RGBA32, and level 0 also transcodes
to ASTC 4×4, BC7, ETC2, ETC1, BC1 and BC3 at the expected block sizes.

Not exercised: an ETC1S (BasisLZ) image, a Zstandard-supercompressed UASTC image, an image with alpha, a non-square or
non-power-of-two image, or a file written by a real encoder.

## Unit tests (Node 22.23.3)

`src/platform/assets/model-ktx2.test.ts`, 9 tests:

- A model without a KTX2 image, loaded twice through the default parser with three's real `KTX2Loader`, requests no
  transcoder file (`fetch` is recorded) and reports `transcoderLoads: 0`. A KTX2 model then requests
  `basis_transcoder.js` and `basis_transcoder.wasm` once each; a second KTX2 model requests nothing more. (Node has no
  `Worker`, so the transcode itself fails there; GLTFLoader keeps the model untextured, which the test asserts.)
- With a fake loader: `detectSupport` receives the bound renderer; the transcoded texture counts at its level bytes
  (5,488 B for BC7-sized levels), `residentMiB` is those plus the 92 B of geometry, and both return to 0 on release;
  one transcoder per library.
- Byte estimates: an RGBA8 image 21,845 B, BC7 levels 5,488 B, the RGBA8 fallback 21,844 B, a compressed cube 6×.
- Refusals before any loader exists: not Basis, layered, cube, a side of 32,768, too many levels, not KTX2, one byte
  over the worst-case admission (21,855 B; 21,856 B loads), no bound renderer, and a library without KTX2 enabled.
- Cancellation: an owner that leaves while the transcoder files arrive causes no transcode; a transcode that completes
  after its owner left is a late drop, and its texture is disposed.
- Disposal: the loader is disposed once, its later `init()` and worker posts reject with `transcoder disposed` and no
  worker is created; disposal during set-up retires the loader when its files arrive.
- Worker bounds: 0, 9 and 1.5 workers are refused.

`scripts/asset-verify.test.mjs`: a required KTX2 texture passes when its contract lists `KHR_texture_basisu`; it is
refused when the contract does not; non-Basis and cube KTX2 images are refused (79/79 in that file).

## Browser check

`npm run test:ktx2-browser` (`scripts/play/ktx2-model-check.mjs`) ran under
`flock ~/.cache/foundation-browser.lock`, niceness 15, with Chromium 152.0.7977.82 (isolated, muted, headless,
SwiftShader WebGL2), 800×600, on a shared 32-thread machine (load average about 20). Four phases, all passed:

| Phase | Result |
| --- | --- |
| Dev server, model without KTX2 | No request for `model-ktx2`, `KTX2Loader` or `basis_transcoder`; `transcoderLoads` 0; 0 transcoder workers |
| Dev server, KTX2 | Quadrants drawn exactly (230,40,40 / 40,200,60 / 40,80,230 / 245,245,245). detectSupport on the pooled renderer chose BC7 (`RGBA_BPTC_Format`, 36492): 7 levels, 5,488 B; `compressedTextureMiB` × 2²⁰ = 5,488; `residentMiB` × 2²⁰ = 5,580. Transcoder files fetched once each (200). 1 worker created |
| Cancel after transcode, 3 cycles | Each cycle: the candidate's transcode reply held (`loading`), candidate despawned, reply released: `lateDrops` +1, `disposed` +0, `compressedTextures` 1, `residentMiB` unchanged, `instances` unchanged, 3 of 3 late resources (geometry, material, compressed texture) disposed by identity. `quad-b.glb` fetched once (cycles 2 and 3 parse the retained bytes); no transcoder refetch |
| App disposal | Every transcoder worker terminated; `residentMiB` 0; `compressedTextures` 0; `cleanupFailures` 0 |
| Dev server, no compressed format (`?fallback=1` hides every compressed-texture extension) | RGBA8 fallback (`RGBAFormat`, 1023): 21,844 B; quadrants drawn exactly; disposal clean |
| Build `--base /sub/ktx2/`, served only under `/sub/ktx2/` | Transcoder fetched from `/sub/ktx2/assets/basis_transcoder-<hash>.js` and `.wasm`; no request outside the sub-path; no 4xx; BC7, 5,488 B; disposal clean |
| Build `--base ./`, served under `/any/folder/` | The same, from `/any/folder/assets/` |

The page reported no errors and no console errors in any phase. The check also runs in CI (`ci.yml`, browser job,
"KTX2 model texture browser regressions") with Playwright's Chromium. Screenshots and the JSON report are written to
`playtest/ktx2-model/` (not committed).

## Bundle

`npm run perf:bundle` and a reading of the Vite manifest, on `origin/main` (`8cfddac`) and on this branch:

| | `origin/main` | This branch |
| --- | --- | --- |
| `perf:bundle` | PASS · first-load JS 167.8 / 704 KiB · 0 chunks > 500 kB | PASS · first-load JS 168.1 / 704 KiB · 0 chunks > 500 kB |
| First-load JS (`index-*.js`) | 171,794 B (59,993 gzip) | 172,113 B (60,131 gzip): +319 B, the renderer binding |
| `models-*.js` (lazy) | 8,584 B (3,525 gzip) | 9,969 B (4,064 gzip) |
| A model without KTX2 (models, GLTFLoader, meshopt and their chunks, beyond first load) | 277,607 B (80,253 gzip) | 279,582 B (81,762 gzip): +1,975 B, part of it from three's loader classes now shared in separate chunks |
| Only for a KTX2 model: `model-ktx2-*.js` + `Data3DTexture-*.js` | — | 62,662 B (25,489 gzip) |
| Only for a KTX2 model: `basis_transcoder-*.js` / `.wasm` | — | 57,529 B (15,063 gzip) / 527,333 B (244,553 gzip) |
| `dist/assets` total | 1,041,163 B, 33 files | 1,690,864 B, 41 files (the transcoder files are emitted in every build; fetched only when used) |

gzip sizes are `gzip -9` of the built files, not a server's transfer.

## Not established

- No physical device or phone GPU: SwiftShader exposes BC formats, so ASTC and ETC2 uploads, their driver memory and
  transcode time on a phone are unmeasured. Device experience acceptance for KTX2 assets is unverified.
- Byte counts are the engine's estimates of uploaded level data, not driver or GPU-process memory.
- Only the first parse of each template was inspected for its GPU format; cube, array and HDR KTX2 images are refused
  by design rather than tested for rendering.
- The transcoder runs in three's own worker pool, an explicit exception to STD-RUN-35 (see the guide).
- No template or game uses KTX2; gates show only that existing templates are unchanged.

## Commands

```sh
nice -n 15 npm run check
nice -n 15 npx tsx --test src/platform/assets/model-ktx2.test.ts src/testing/ktx2-fixture.test.ts scripts/asset-verify.test.mjs
flock ~/.cache/foundation-browser.lock env ENGINE_CHROMIUM=<chromium> nice -n 15 npm run test:ktx2-browser
nice -n 15 npm run perf:bundle
```
