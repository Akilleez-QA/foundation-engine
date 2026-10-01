# Optional model diagnostics

The stock dev/test scene handle exposes `window.engine.model({entity,
expectedEpoch, sockets, clipOffset, clipLimit, maxNodes, maxLabelLength})`. Obtain the
current epoch from `engine.state().scene.epoch` and a local entity ID through the
entity metadata inspector. Entity IDs belong to that scene visit. This is a pull
snapshot, not a model editor or a stable authored identity service. Creators can
omit or replace the optional handle. `createSceneModels` defaults inspection off;
the stock runtime enables it only under `TEST_API`.

Requested asset/clip/playback settings are separate from the currently adopted
lease's asset ID, path, format and optional hash. `playback.appliedRestartRevision`
identifies the revision applied to the actual animation action; it is not an
authored document revision. The returned clip page is capped at 64 items, socket
queries at 32, labels at 256 characters and the geometry traversal at 4096 nodes.
Defaults are smaller. Socket states distinguish not-ready, absent, ambiguous and
ready. Returned matrices are cached world matrices, not newly evaluated poses.
Pose completeness compares supported scalar overrides with the applied signature;
oversized signatures are conservatively incomplete.

Bounds have the explicit basis `cached-geometry-and-world-matrices`. The traversal uses
existing geometry boxes and matrices only. It does not call `setFromObject`,
compute geometry boxes, traverse vertices, skin geometry or evaluate morphs.
Instanced meshes use the cached object-level instance box, never the base geometry
box or a new per-instance traversal. Missing instance caches, skinned, morphed,
uncomputed or nonfinite geometry are counted as skipped. Covered
rigid geometry may be `partial`; no covered geometry is `unavailable`. Neither is
an animated silhouette bound. The owner retains no inspection history or extra
leases. Once a failed slot is removed, inspection does not invent a retained
failure record.

## Browser workflow

Run this separate regression command:

```sh
node -r ./scripts/silent-browser.cjs scripts/play/model-inspect-check.mjs /tmp/foundation-model-inspect-browser
```

The runner starts an isolated, muted 1280×800 Chromium with the existing helper.
Its custom diagnostic page imports the stock app composition and authored runtime.
Both registered asset paths serve the repository's original
`public/models/mechanics/beacon.glb` through the real asset service and GLB parser;
the second HTTP path deliberately contains identical bytes. No loader is mocked,
and changing variants is not claimed to change the picture.

Native buttons drive play, pause, keyboard restart, pose/clear and replacement.
The handwritten oracle checks actual pulse time and socket displacement, pending
requested/adopted divergence, adopted path replacement, incomplete geometry,
unchanged model-probe statistics after inspection, stale scene epoch and retired
handle rejection. This all-skinned fixture must return `unavailable` bounds;
focused unit tests cover mixed rigid/skinned `partial` bounds and ambiguous nodes.
The runner writes `report.json`, detached `snapshots.json` and `adopted.png` in the
output directory. Inspect that image after execution. The Chromium workflow passed after correcting clock sequencing during scene
replacement: replacement activation needs rendered frames, so the runner resumes
the clock until a new ready epoch appears, then holds it again. Physical devices, sustained timing,
visual fidelity and full accessibility are not certified by this test.

## Production omission and physical byte comparison

The diagnostic fixture is reachable only from its runner's middleware page. The
ordinary production entry does not import it. Runtime feature omission is separate
from physical code elimination: the optional owner accepts a runtime option, so
bundling may retain inspection bodies even when the stock production caller passes
false. Do not claim zero bytes or zero overhead from the disabled bridge alone.

Compare the parent commit and the completed candidate in separate
checkouts with identical dependencies and the same `GAME_DIR`. After generating
each checkout's source as usual, run these commands in the indicated checkouts:

```sh
# Parent checkout
./node_modules/.bin/vite build --manifest --outDir /tmp/model-before-production
# Candidate checkout
./node_modules/.bin/vite build --manifest --outDir /tmp/model-after-production
./node_modules/.bin/vite build --mode test --manifest --outDir /tmp/model-after-test
./node_modules/.bin/tsx scripts/perf/bundle-check.ts --dir /tmp/model-before-production --json
./node_modules/.bin/tsx scripts/perf/bundle-check.ts --dir /tmp/model-after-production --json
```

Search emitted JavaScript, not source maps, for these exact stable string markers:

- Bridge body: `model inspection: invalid scene epoch`.
- Inspection body: `model inspection: invalid bounds` and
  `cached-geometry-and-world-matrices`.
- Fixture-only UI/body: `Original beacon · cached model diagnostics` and
  `__model-inspect/beacon.glb`.

```sh
rg -l --glob '*.js' 'model inspection: invalid scene epoch|model inspection: invalid bounds|cached-geometry-and-world-matrices|Original beacon · cached model diagnostics|__model-inspect/beacon.glb' /tmp/model-after-production /tmp/model-after-test
```

The test build should retain the bridge/body markers; the production bridge and
fixture should be absent. Report inspection-body hits honestly, including when
the stock bridge is omitted. Absence of strings alone is not a byte comparison:
record the two manifest first-load reports and raw/gzip totals of emitted JS under
the same settings, then inspect changed chunks. Production comparison was executed against parent `d5ced54`, using the expedition
configuration and identical dependencies. First-load JS remained 249.6 KiB. Total
emitted production JavaScript changed from 1,050,785 to 1,050,832 raw bytes (+47),
and per-file gzip sum from 315,404 to 315,485 bytes (+81). Both builds passed the
bundle check. All three inspection markers were absent in production and present
in the test build; fixture markers were absent in both stock builds. This establishes
omission for this stock configuration, not arbitrary creator bundles or zero cost.
