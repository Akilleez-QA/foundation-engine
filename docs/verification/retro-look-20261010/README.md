# Retro look on the showcase courtyard (2026-10-10)

Evidence for `@kits/retro` ([ADR 0132](../../adr/0132-optional-retro-look.md)). The courtyard was changed for the
measurement only, not committed: `three()` and `retro()` were added to `templates/showcase/game/game.ts`, and the
courtyard scene got `extensions: [sceneRetro({width: 320, palette: SIXTEEN, dither: 'bayer4'})]` with a generic
16-colour palette (black, three greys, white, and dark, mid and light steps of red, green and blue, plus brown,
yellow and cyan).

## Picture

`GAME_DIR=templates/showcase/game npm run play:snap -- --scene courtyard` (software GL, desktop viewport):
[courtyard-retro-desktop.png](courtyard-retro-desktop.png). The courtyard reads at 320 columns with dithered shading;
the lanterns, fountain and planters stay distinct. Budget counts in that run: 41/46 draws, 0/10 post draws,
27,196/31,000 triangles, 7/10 shadow casters, 1/1 shadow passes, 40.3/47 MiB textures, within budget.

An earlier version rendered the scene into an off-screen target; the bench counted that pass as a shadow pass (41
"casters", 2 passes, over budget). The kit now draws the scene into a low-res viewport of the canvas and copies it, so
the scene pass is the main pass and the counters keep their meaning.

## Cost (GPU bench, 4K)

`npx tsx scripts/perf/bench.mjs --gpu --viewport 4k --only courtyard --no-check` on an RTX 4080 (ANGLE, Chromium 141,
3840×2160, reference preset; the retro run's tree is marked dirty because of the measurement-only scene change; load average 6.9 for the baseline run and 4.6 for the retro run):

| Window | Baseline (built-in post) | With the retro look |
|---|---|---|
| courtyard (steady) | 34 draws + 10 post, 115.2 MiB textures, task 0.60 ms/frame, p95 16.8 ms | 35 draws + 0 post, 94.8 MiB textures, task 1.14 ms/frame, p95 16.7 ms |
| courtyard:active | 38 draws + 10 post, task 0.64 ms/frame, p95 16.7 ms | 39 draws + 0 post, task 0.88 ms/frame, p95 16.8 ms |

Raw runs: [baseline](bench-courtyard-baseline-gpu-4k.json), [retro](bench-courtyard-retro-gpu-4k.json). Both are
display-paced; GPU time is not visible in these numbers (the bench has no GPU timer). Main-thread task time is a mean
that includes the bench's instrumentation, and the runs were taken with other work on the machine, so the 0.2–0.5 ms
difference is not separated from run-to-run noise and is not claimed as the look's cost. The 20 MiB texture drop is
only the bloom chain: the scene kept `view.post`, whose full-resolution target (about 62 MiB at this size) is still
allocated during preparation although the look replaces the draw; a scene using the look should remove `view.post`.
No GPU time, quality-guard comparison, phone, tablet or physical-device measurement.

## Phone-sized viewport (emulated)

`play:snap -- --scene courtyard --mobile` (software GL, emulated phone viewport, not a device):
[courtyard-retro-phone-emulated.png](courtyard-retro-phone-emulated.png); 41/46 draws, 0/1 post draws, 26,192/31,000
triangles, 7/10 shadow casters, 1/1 shadow passes, 35.9/47 MiB textures, within budget. The probe JSON of the snap
runs was not kept; the counts above are from the snap output.

## Shader against the reference

An independent reviewer bundled the kit into headless Chromium (software GL), drew known colours, and compared every
device pixel of the output with `retroReference`: nine configurations, zero mismatching pixels. The harness was not
committed; it certifies software GL only.
