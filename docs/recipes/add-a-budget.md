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

The bench is headless, muted and isolated. By default it uses software GL at 1280×800 with `?quality=reference`. `perf:derive` prints, per scene, the worst of its windows plus 10 % headroom, rounded up to a readable step. The brief's per-scene ceilings (`brief.performance.perScene`, derived from the minimum device) are the most a budget may ever be.

`perf:derive` only derives from evidence. It prints no row for a scene with a rejected or non-comparable window, names the scene and the reason on stderr, and exits 1. The common case is a scene that has ended before its active window: an idle player is hit, the run freezes, and the active window renders no frame (`inconclusive: the active window drew no frame`). Make the bench meet the scene in play: declare an existing restart interaction with `activeRestart`, or start the app on a title/menu scene and verify that the later active window remains playable. Then bench again. The gate also reports such a window as INCONCLUSIVE, never as a pass. A still scene whose windows draw nothing keeps its other metrics, with `draws` and `triangles` left unmeasured.

## 3. Write the budget

Paste the derived numbers into the scene's `budget`, and add provenance:

```json
"budget": { "draws": 30, "triangles": 10000, "shadowCasters": 10, "textureMiB": 8, "canvasMiB": 4, "heapMiB": 10, "contexts": 1, "loadMiB": 1 },
"provenance": { "measured": "<commit> swiftshader@1280x800", "run": "perf/runs/<file>.json" }
```

- A missing metric is unmeasured, and the checker skips it.
- `draws` counts the scene's own draws, shadow passes included. A scene with post-processing (`view.post`) also
  gets `postDraws`, its fullscreen post passes per rendered frame, counted apart and exact per tier: 10 at `full`
  (reference, high), 1 at `basic` (medium), 0 at `off` (low). Write it with ports:
  `"postDraws": 10, "ports": {"medium": {"postDraws": 1}, "low": {"postDraws": 0}}`
  ([post-processing](../guides/post-processing.md)).
- The start scene has no entry cost, so leave `loadMiB` and `loadMs` out of its row.

## 4. Gate

`npm run gate` benches every scene and fails when a count breaches its budget on two consecutive runs. Frame time is advisory in software GL.

## Raising a budget

A raise is an exception, and a reviewed one:

```
git commit -m "Level: add the fountain" -m "Perf-Budget: level.draws 30 -> 36: the fountain adds 6 draws; batched already"
```

`npm run lint:budgets` compares every game's `budgets.json` (`game/` and each `templates/<name>/game/`) with `origin/main`. Template keys carry the template's name (`blank/main.draws`). It fails any raise that no `Perf-Budget: <key> <old> -> <new>: <reason>` trailer on the branch names exactly. A raise that is not yet committed always fails. Lowering a number needs nothing: that is the ratchet.

Before raising, try in order: simplify, instance (one draw for many copies), bake (merge static meshes per material), LOD. Raise only with the author's agreement.

The author API has no instancing yet (an instanced scatter API is planned, not landed). Until it lands, bake static copies into one `Mesh` with `defineMesh` and vertex colours ([art direction](art-direction.md), section 5: a hundred rocks are one draw), and draw small moving copies as particles (one draw per emitter).
