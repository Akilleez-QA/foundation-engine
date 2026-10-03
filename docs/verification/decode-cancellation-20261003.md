# Model cancellation after decode — 2026-10-03

The model-preview consumer (`npm run test:model-preview-browser`) now runs three
browser cycles that cancel a model candidate after its response has fully arrived
and its embedded image has been decoded, but before the decoded model can attach.
Until now, this path (#78) had only unit evidence
(`cancelled decoders retain pending admission until actual settlement`, `model
cleanup closes each shared decoded bitmap once on normal, late and rejected loads`).
No runtime behaviour, budget or shared asset changed.

## The cycle

The check derives a textured variant (`decoded.glb`, 3,516 bytes) from the
mechanics beacon fixture at run time. The variant adds UVs and an embedded 8×8 PNG
used as the base colour texture. Each cycle then runs these steps:

1. Arm a test-only `createImageBitmap` wrapper. While armed, the browser's real
   `createImageBitmap` decodes the image, but the wrapper holds back the resulting
   `ImageBitmap` until the test releases it. This makes `GLTFLoader`'s parse wait
   with the image already decoded.
2. Preview the `decoded` candidate. In the first cycle the exact browser request is
   correlated with its terminal event, and it must be `requestfinished` with no
   error, not `ERR_ABORTED`. The fixture serves this file immediately, so the full
   body is delivered. Cycles 2 and 3 decode the library's retained file bytes, so
   they make no new request; the fetch count must stay at 1.
3. Wait until the 8×8 bitmap has decoded and is held. The candidate must still be
   `loading` and invisible, and the accepted entity must be unchanged.
4. Cancel. The candidate entity is despawned. The scene's model owner retires that
   entity's slot, aborting its lease, at its next frame sync, so the test waits
   two animation frames.
5. Release the held bitmap. The parse finishes after cancellation, and the library
   must discard the result (`models.lateDrops` +1) instead of uploading it.

## Assertions, per cycle

- `models` probe: `lateDrops` +1, `parses` +1, `disposed` unchanged (no uploaded
  template existed to dispose), `instances` 1, `residentMiB` unchanged and not above
  the baseline, `cleanupFailures` 0.
- Nothing attaches: the candidate is absent; the accepted entity, adopted asset
  (`second`) and selection are unchanged; the world holds 1 entity.
- Every decoded resource is released, counted by identity. The fixture wraps
  `GLTFLoader.prototype.parseAsync` and records the geometry, materials, textures
  and `ImageBitmap`s in the parse result. It wraps `dispose` on `BufferGeometry`,
  `Material` and `Texture` to record which of them were disposed. A closed bitmap
  reports 0×0. Each cycle must release every one: 1 geometry, 1 material,
  1 texture and 1 bitmap. The released bitmap must be the same object that was
  decoded before cancellation.
- Repeated cycles stay bounded: after three cycles, `residentMiB` and `instances`
  equal the baseline and `lateDrops` is baseline + 3. The library keeps the file
  bytes it fetched for the session in a bounded LRU (`bytesKeptMiB`). The cancelled
  file's 3,516 bytes are kept once, not once per cycle: `bytesKeptMiB` goes from
  0.00283 MiB to 0.00619 MiB in cycle 1 and stays there. This is the documented
  byte cache, not decoded ownership. The existing disposal step afterwards still
  requires 0 retained bytes.

The existing three transport-cancellation cycles, unavailable-asset reports and
final disposal are unchanged. The test still allows only the four expected
injected error reports, and no page errors.

## Evidence

Passed twice on a clean checkout of this branch at `fb3956c` (script SHA-256 `b78c48e793eb81464bf3880eb429e6c97dbba9f7c01a8b5ad44f4a70be017217`, fixture `5a2e26d077a91067bc4a86ed4324670ba28d334719b543729813c3866759e4d0`) with Node 22.23.3 and Chromium 152.0.7977.82
(isolated, muted, headless, SwiftShader software GL), 1440×960, niceness 15.
Each run produced identical counts:

| | Baseline | Each cycle | After 3 cycles |
| --- | --- | --- | --- |
| `lateDrops` | 0 | +1 | 3 |
| `parses` | 5 | +1 | 8 |
| `disposed` | 4 | +0 | 4 |
| `instances` | 1 | 1 | 1 |
| `residentMiB` | 0.000916 | 0.000916 | 0.000916 |
| `bytesKeptMiB` | 0.002834 | 0.006187 (cycle 1 onward) | 0.006187 |
| `decoded.glb` fetches | 0 | 1 (cycle 1 only) | 1 |
| Decoded geometry / material / texture / bitmap released | — | 1/1, 1/1, 1/1, 1/1 | — |

To check that the test can fail, the runtime's `image.close()` call in
`src/platform/assets/models.ts` was temporarily disabled locally. The check then
failed with `every decoded bitmap released`. The change was reverted and is not
part of this branch. Also, without the two-frame wait, a release that lands before
the owner's frame sync publishes the template to the lease cache, which disposes it
on the following release (`disposed` +1). No instance is created and residency
returns to baseline, but it is not the late-drop path, so the check waits for the
owner's sync.

## Boundary

- The hold point is inside parsing: the image has decoded, but geometry and
  material creation and the end of the parse come after cancellation. The step
  between a finished parse and the lease cache's upload is a single microtask,
  which a browser test cannot interpose without a runtime seam. That step is
  covered by the unit tests named above.
- One model library path is covered. The texture library's worker decoder
  (`decode-image.ts`) is not exercised here.
- The probes report ownership estimates and counts. They do not measure driver
  memory and do not audit the whole heap or every listener. No physical device,
  phone or full integration gate is claimed.

## Commands

```sh
nice -n 15 npm run test:model-preview-browser
```
