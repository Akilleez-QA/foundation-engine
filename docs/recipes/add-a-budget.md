# Recipe: add a budget

Every scene declares measured budgets. The gate enforces them, and they only fall (STD-PRF-1, STD-PRF-3 to STD-PRF-5). Budgets are data in the game's `budgets.json`, next to its code, so the ratchet compares them across revisions without running anything.

## 1. Add the scene to the bench

In the game's `budgets.json`, under `scenes`:

```json
"level": { "scene": "scene.level", "route": "#scene/level", "active": true, "budget": {} }
```

- The key (`level`) is the sample id. The first row is where the app starts.
- `active: true` adds an active window (input held) to the idle window. The bench holds the arrow keys (ArrowUp, then ArrowLeft) unless the row names its own: `"activeKeys": ["KeyW", "KeyD"]` (browser key names, held one after the other).
- An active window that draws no frame is refused as `inconclusive` (the scene probably ended) when its held keys drive the scene: the row names them in `activeKeys`, or they press one of the game's own inputs (`defineInput`, kit inputs). Keys that press nothing in the game cannot change the picture, so such a window counts as a still window, like an idle one. Name `activeKeys` when your scene moves on other keys than the arrows.
- For a scene with a terminal state and an existing restart input, an optional `activeRestart` declares bounded setup before **each** active attempt, including retries:

  ```json
  "activeRestart": { "when": ".hud-banner:not([hidden])", "key": "Space", "timeoutMs": 30000 }
  ```

  `when` is a CSS selector inside that scene's mount. The bench waits for this visible terminal-state marker, presses the existing key, then requires the old marker to detach and the same scene to become active. The total wait deadline is 100–30000 ms; an unavailable marker or failed restart fails the run. Use a marker owned by the departing visit, not persistent shell UI. This does not change authored gameplay rules, force a redraw or exempt any count budget. Setup runs outside the timed window, is recorded per attempt, and changes the experiment/cache identity. It drives the page only through page evaluation and keyboard input: Playwright locators would inject a selector engine of about 600 KB into the page, and the `heapMiB` read after the window counts the whole page heap, so a restarted scene would report about 1 MiB of harness memory as its own. The measured window can still end or exceed a budget. One preparation per active attempt adds at most its declared timeout (up to four attempts); omit it for scenes that need no restart.
- `npm run new -- scene <id>` writes this row for you, with the brief's per-scene ceilings and an `unmeasured` provenance. It leaves `loadMiB` out, because the bench cannot measure the entry cost of a scene that becomes the start scene; add `loadMiB` from step 2 for any other scene (adding a metric is not a raise).

## 2. Measure

```
npm run bench -- --only main,level --no-check      # the start scene must stay in the route
npm run perf:derive -- perf/runs/<run>.json
```

The bench is headless, muted and isolated. By default it uses software GL at 1280×800 with `?quality=reference`. `perf:derive` prints, per scene, the worst of its windows plus 10 % headroom, rounded up to a readable step (8 MiB for `textureMiB`, 10 for `draws`). The fixed counts the gate checks with no noise allowance (`contexts`, `postDraws`, `shadowPasses`) are copied exactly as measured, with no headroom: a scene that measured 0 shadow passes derives 0, and the sun alone 1.

The brief's per-scene ceilings (`brief.performance.perScene`, derived from the minimum device; `TIER` in `src/author/build.ts`) are the most a budget may ever be, and `npm run new -- scene` writes them as an unmeasured row: `draws`, `postDraws`, `triangles`, `shadowCasters`, `shadowPasses`, `textureMiB` and `heapMiB`. They are the engine's provisional defaults, not device evidence (minimum devices are pending creator selection, DV-01); a brief lowers them with `performance.perScene`. For a phone minimum the defaults are 100 draws, 150 000 triangles, 64 MiB of textures, 32 MiB of heap and 100 shadow casters. `postDraws` (10) and `shadowPasses` (25: the sun plus four shadowed point lights) are the reference preset's own maximum on every device class: budgets are measured at the reference preset, and a phone's lighter tier already draws fewer (record those with `ports`). `lint:brief` fails a row above a ceiling.

`perf:derive` only derives from evidence. It prints no row for a scene with a rejected or non-comparable window, names the scene and the reason on stderr, and exits 1. The common case is a scene that has ended before its active window: an idle player is hit, the run freezes, and the active window renders no frame (`inconclusive: the active window drew no frame`). Make the bench meet the scene in play: declare an existing restart interaction with `activeRestart`, or start the app on a title/menu scene and verify that the later active window remains playable. Then bench again. The gate also reports such a window as INCONCLUSIVE, never as a pass. A still scene whose windows draw nothing keeps its other metrics, with `draws` and `triangles` left unmeasured.

## 3. Write the budget

Paste the derived numbers into the scene's `budget`, and add provenance:

```json
"budget": { "draws": 30, "triangles": 10000, "shadowCasters": 10, "shadowPasses": 1, "textureMiB": 8, "canvasMiB": 4, "heapMiB": 10, "contexts": 1, "loadMiB": 1 },
"provenance": { "measured": "<commit> swiftshader@1280x800", "run": "perf/runs/<file>.json" }
```

- A missing metric is unmeasured, and the checker skips it.
- `draws` counts the scene's own draws, shadow passes included. A scene with post-processing (`view.post`) also
  gets `postDraws`, its fullscreen post passes per rendered frame, counted apart and exact per tier: 10 at `full`
  (reference, high), 1 at `basic` (medium), 0 at `off` (low). Write it with ports:
  `"postDraws": 10, "ports": {"medium": {"postDraws": 1}, "low": {"postDraws": 0}}`
  ([post-processing](../guides/post-processing.md)).
- `shadowPasses` counts shadow-map renders in the busiest frame (the sun or a spot light 1, a point light 6). It has
  no noise allowance, and `perf:derive` copies it exactly (no headroom); `shadowCasters` counts their draws. See
  [Cost per light and per shadow](../guides/scene-look.md#cost-per-light-and-per-shadow).
- The start scene has no entry cost, so leave `loadMiB` and `loadMs` out of its row.

## 4. Gate

`npm run gate` benches every scene and fails when a count breaches its budget on two consecutive runs. Frame time is advisory in software GL.

## Raising a budget

A raise is an exception, and a reviewed one:

```
git commit -m "Level: add the fountain" -m "Perf-Budget: level.draws 30 -> 36: the fountain adds 6 draws; batched already"
```

`npm run lint:budgets` compares every game's `budgets.json` (`game/` and each `templates/<name>/game/`) with `origin/main`. Template keys carry the template's name (`blank/main.draws`). It fails any raise that no `Perf-Budget: <key> <old> -> <new>: <reason>` trailer on the branch names exactly. A raise that is not yet committed always fails. Lowering a number needs nothing: that is the ratchet.

Git reads trailers only from the **last paragraph** of the message. Put every `Perf-Budget:` line in the same final
paragraph as any other trailer (`Co-Authored-By:`, `Signed-off-by:`), with no blank line between them; a `Perf-Budget:`
paragraph followed by a separate `Co-Authored-By:` paragraph is not read, and the raise fails as if it had no trailer.
Check with `git log -1 --format='%(trailers:key=Perf-Budget)'`.

In a game started from a template, `lint:budgets` compares `game/budgets.json` with the same file on `origin/main`. In
an engine checkout, `origin/main` has no `game/`, so every number of a new game counts as new and nothing is compared
until the game's own `main` holds the file. The template's numbers are still the game's starting budgets: compare
against the commit that started the game with `npm run lint:budgets -- --base <start-commit>` (the art-direction
recipe's [template notes](art-direction.md#making-a-different-game-from-the-showcase) say when a redesign needs a
trailer).

Before raising, try in order: simplify, instance (one draw for many copies: a `Scatter` of a `Shape` or `Mesh`, see [scatter grass and rocks](scatter-grass-and-rocks.md); particles for small moving copies), bake (merge static meshes per material, or static copies into one `Mesh` with `defineMesh` and vertex colours: [art direction](art-direction.md), section 5), LOD. Raise only with the author's agreement.

A scatter is counted honestly: one draw per scatter, and its triangles are the copies drawn times the triangles of one
copy, so `draws` falls when copies are instanced while `triangles` does not. The quality knob `effects.scatter-density`
draws fewer copies on lighter presets, but budgets are measured at the reference preset, where every copy is drawn.
