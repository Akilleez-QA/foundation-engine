# Resource-station consumer verification

2026-09-30 working tree. `GAME_DIR=templates/expedition/game npm run check` passes.

- `play:snap -- --scene field --mobile`: desktop and phone start screenshots inspected, no page errors. Its default arrow-key activity does not drive this guided scene; zero rendered samples are idle observations.
- `GAME_DIR=templates/expedition/game node templates/expedition/verification/resources/touch-reload.mjs`: isolated muted phone browser, actual touch buttons through all three stations, survey, finite extraction and crafting, then real browser reload. `touch-reload.json` records preserved ore 2, plate 1, reserve 4 and no page errors. The script includes the standard render probe and an actual walking measurement. Completion screenshots inspected on phone and desktop.
- `npm run bench -- --json templates/expedition/verification/resources/bench.json`: production startup 215KiB transferred JS, 3.6MiB settled heap, 14 budget checks pass. The default active driver does not start an expedition route; do not interpret its zero draws as the cost of rendering this scene.
- `S7` tests cancellation, scene exit during partial extraction, bounded resume, material conservation, derived properties and no duplicated output. Existing S1–S6 tests still pass.

Snapshots contain a coherent local production envelope. These checks do not establish distributed transactions, unavailable-storage durability, scientific geology, or unbounded offline manufacturing.

Checkpoint update: production snapshot v2 uses explicit epochs; harvest and craft commit epochs 1 and 2. The final phone touch flow/reload passed with ore 2, plate 1, reserve 4, no page errors, 6 draws/1,248 triangles while walking and zero idle renders. Production bundle-check measured 679.9 KiB raw first-load JavaScript; the 704 KiB app cap enforces the existing brief ceiling (the measured bundle is below it). This is distinct from compressed-transfer bench readings.
