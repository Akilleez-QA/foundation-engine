# Canonical terrain attributes and shared-worker evidence

`worker-smoke.mjs` launches isolated muted desktop and phone browsers, reaches revision 2 through the real R input, verifies the application worker executed the patch, captures before/after images, moves the actor and measures idle rendering. Both screenshot sets were visually inspected: smooth shared shading, the authored pad, sparse excluded scatter and actor contact remain coherent after the finite ridge edit.

Both devices: one worker, peak one running job, 212,888 reserved payload bytes, zero reservations after completion; contact/render/navigation epoch 2. Fourteen eligible seeded scatter candidates share one mesh. Active samples: 7 draws, 5,092 triangles, 60 fps, 16.7–16.8 ms p95. Idle samples render zero frames. No page errors.

Production `bench.json` passes 14 reference checks under unchanged scene budgets. Settled active heap is 5.4 MiB against the 5 MiB reference: an 8% warning inside the existing tolerance, not a raised budget. Browser smoke heap includes development tooling and is not substituted for this production reading. Software rendering is diagnostic rather than a claim about physical phone performance.

Unit coverage includes canonical mixed-LOD normals, material-boundary exact fallback, local-edit dependency margins and unchanged chunk identity, forged patch rejection, deterministic scatter partitions and exclusions, camera/resolution error projection and hysteresis, worker/fallback parity, cancellation, result topology/normal/bounds validation and owned output arrays. The app worker service is lazy and disposed with the application.

Final first-load bundle: 665.7 KiB / 704 KiB, PASS after shared runtime import splitting. The complete lazy-host desktop/phone flow was rerun successfully.
