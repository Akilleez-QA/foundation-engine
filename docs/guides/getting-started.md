# Getting started: your first game

```text
      [##]          FOUNDATION ENGINE
    [======]        =================
  [==][==][==]      STAGE 1: FIRST GAME
 [############]
```

From a fresh clone to a game you can share, by hand or with a coding agent. Each step says what you should see. You will run a lane-dodging game, change its player colour, check the change and build a static site. Download time depends on your connection; no paid tool or AI account is required.

## 1. Get the code and the tools

You need Git and Node.js 22.18 or newer (CI uses Node.js 22 and also runs the tests on the newest Node.js, 26; `node -v` prints your version). [nvm](https://github.com/nvm-sh/nvm), [fnm](https://github.com/Schniz/fnm) or [mise](https://mise.jdx.dev/) can install it next to other versions.

```
git clone https://github.com/Akilleez-QA/foundation-engine.git
cd foundation-engine
npm ci
```

`npm ci` installs exactly the versions in `package-lock.json`. Two dependencies are marked as having install scripts, and neither is needed: esbuild's `postinstall` only re-checks the native binary npm already installed as an optional dependency, and fsevents (macOS only) ships its binary prebuilt. `package.json` records that review as `"allowScripts": {"esbuild": false, "fsevents": false}`, so npm 12 and newer, which block dependency install scripts that `allowScripts` does not approve, skip them without a warning. Older npm versions ignore the field and run esbuild's check as before. Either way the tools work.

## 2. Prepare automated browser checks (optional for first play)

You can play in your ordinary browser in step 4. For step 7, `npm run play:snap`, scripted playtests, the bench and the gate drive a muted Chromium of their own. Install Playwright's copy once:

```
npx --no-install playwright-core install chromium
```

On Linux, add `--with-deps` if Chromium complains about missing libraries (it asks for administrator rights). To use a Chromium you already have, set `ENGINE_CHROMIUM=/path/to/chromium` instead. The test browsers always start muted and never touch your computer's sound settings.

## 3. Start your game from a template

```
npm run new-game -- --template arcade --id my-game --title "My game"
```

The id becomes the save namespace, so choose it once. The title goes into `game/game.ts` and becomes the first heading of `GAME.md`.

| Template | Start here if you want | Its README |
|---|---|---|
| `blank` | anything else: one scene, one cube, one action | [blank](../../templates/blank/README.md) |
| `arcade` | a score, a fail state and instant restart | [arcade](../../templates/arcade/README.md) |
| `explorer` | a character moving between areas, using things | [explorer](../../templates/explorer/README.md) |
| `learn` | a short interactive lesson (kid-safe) | [learn](../../templates/learn/README.md) |
| `terrain` | a character on hills and hollows | [terrain](../../templates/terrain/README.md) |
| `expedition` | routes, objectives, inventory: many kits together | [expedition](../../templates/expedition/README.md) |
| `mechanics` | riding, equipment, a loaded model: many kits together | [mechanics](../../templates/mechanics/README.md) |
| `showcase` | a good-looking start: palette, light presets, baked light, low-poly forms | [showcase](../../templates/showcase/README.md) |
| `shared-world` | two or more players in one world over a local host (LAN or this machine) | [shared-world](../../templates/shared-world/README.md) |

`--id` is your game's save namespace; choose it once. The command writes `game/` (with the template's scripted playtests in `game/playtest/`) and `GAME.md` into this checkout. Every command now builds your `game/` (without one, they build `templates/blank/game`).

If `game/` already exists, keep it and continue working there, or clone into a different empty directory to try another template. Do not use `--force` as a setup repair: it deletes the current game and brief.

Commit them on a branch of your own straight away:

```
git switch -c my-game
git add game GAME.md
git commit -m "Start my game from the arcade template"
```

Keep working in this checkout. A fresh `git worktree` made from `origin/main` would not contain your `game/` folder, and every command there would quietly build the blank template instead.

## 4. Play it

```
npm run play
```

It prints an address such as `http://127.0.0.1:5173/#scene/play`; open it in your browser. You should see a yellow ball on a dark lane, score and best-score counters, and a steering hint. Use ← / → or A / D to dodge blocks; after a hit, press Space or Enter to restart. Press `M` to mute.

Other templates open their own first scene (explorer: a garden; the address ends in `#scene/garden`); each template's README lists its scene IDs and controls. If 5173 is taken, run `PORT=5174 npm run play`.

Leave this terminal running while editing: changes in `game/` reload the page. Use a second terminal in this same checkout for checks, or stop the server with Ctrl+C before running the next command. The server command does not return until stopped.

### Without a browser window (coding agents, CI)

You do not need to open a window to check that the game plays. Development and test builds expose a test API on `window.engine`: `state()` (the scene, world state and named entities' positions), `key(key, ms)`, `goto(scene)`, `teleport(x, z)` and more ([AGENTS.md](../../AGENTS.md#commands), source in `src/dev/test-api.ts`). Production builds do not contain it. The quickest headless check needs no code: a scripted playtest drives the same API in a muted, isolated browser and exits 1 when an expectation fails.

```sh
npm run play:script -- game/playtest/restart.json
```

The format (keys, presses, `waitUntil`, `expect`, snaps, reload) is in [write a playtest script](../recipes/write-a-playtest-script.md); add your own scripts to `game/playtest/`. For a driver of your own, launch the browser through `launch()` in `scripts/perf/bench-browser.mjs`. It always passes `--mute-audio`, uses a throwaway profile and honours `ENGINE_CHROMIUM`. Open the game with `?flags=dev.silent` (the Playwright `page` is `b.page`):

```js
// drive.mjs, run with `node drive.mjs` while `npm run play` is running
import {launch} from './scripts/perf/bench-browser.mjs';
const b = await launch();
await b.page.goto('http://127.0.0.1:5173/?flags=dev.silent#scene/play');
await b.wait(`window.engine?.state().scene?.state === 'active'`);
await b.evaluate(`window.engine.key('ArrowLeft', 600)`);
console.log(await b.evaluate('window.engine.state().world.named.player'), b.errors);
await b.close();
```

`scripts/silent-browser.cjs` does not mute a browser that your own script launches: it only adds `--mute-audio` to `AGENT_BROWSER_ARGS` (read by agent-browser tools) and turns off the file watcher. Pass `--mute-audio` yourself, or use `launch()` as above.

## 5. Change something

For the arcade template, open `game/components.ts`. In the `ball` definition, replace `color: 0xffcc33` with `color: 0x66ddff`. Save the file: the ball should turn cyan, while movement and scoring keep working. This edits your game; no engine change is needed.

Every template's README has a **First steps** section with its own first edit and what you should see, for example recolouring the bench in the explorer garden. It also lists the template's scene IDs, its test command and test count, and any scene that is already at its draw budget, where one more visible thing goes over. The README also lists other changes to try. The [cookbook](../recipes/README.md) has recipes for models, HUD and buttons, collision and picking, camera and lighting, and sharing your build.

The rules that keep a game healthy are short (all in [AGENTS.md](../../AGENTS.md)): game code imports only `@engine`, `@kits/<name>`, its own files and JSON; systems read actions, never keys; words go in string keys; randomness is `ctx.random()`.

Your own models, textures and sounds go in `game/public/` (`game/public/models/ship.glb` is the URL `/models/ship.glb`), and a script that makes them (an asset generator, a converter) goes in `game/tools/`, where it may use Node modules; game code never imports it. A build ships `game/public/` and nothing from other templates. See [where your game's files go](../recipes/your-game-files.md).

## 6. Check it

```
npm run check
```

This checks types, lints and the brief, and selects tests affected by uncommitted changes. The colour edit should select the game test file. It ends with `check: PASS` or the first problem to fix. A clean committed checkout can select **zero tests**; a passing check then does not mean tests ran.

Run the arcade tests explicitly, including after a commit:

```sh
node --import tsx --test game/play.test.ts
```

Expect five passing tests: steering, collision/restart, saved best score, best score after a reload and deterministic replay. Other templates have different test files and counts: the template README's **First steps** gives the exact command and count (explorer: `node --import tsx --test game/garden.test.ts`, three tests).

## 7. Look at it

```
npm run play:snap
npm run play:snap -- --scene play --mobile
```

`--scene` takes a scene ID: `play` is the arcade's only scene. Use your template's IDs from its README (explorer: `garden` or `shed`); without `--scene`, play:snap opens the first scene. Screenshots and `probe.json` land in `playtest/latest/`: open the pictures, and read the summary or the probe for page errors, draws and triangles against your budget. `play:snap` fails on page errors or an over-budget scene. It judges the budget after the scene settles (its per-frame draws and triangles stop changing, within a bounded wait): a scene that draws more on its first frames, while programs compile or extra passes start, prints that as a `warm-up` line beside the settled numbers, so you can see both. The frame rate it prints is advisory: it comes from software rendering in an emulated viewport, varies with the machine's load and is never judged; it is not phone evidence. Some mistakes only show up here, such as a scene that draws too much or a page error in a system the tests do not reach. Two actions bound to the same key are caught earlier: `npm run check` fails at `lint:brief` with the clash (`inputActions: key Space: game.restart (global) and game.steer.pos (global) overlap`) and a fix hint (give the game's `defineInput` another key or pad button); a dev or test boot stops with the same message.

For arcade, also exercise the copied restart scenario:

```sh
npm run play:script -- game/playtest/restart.json
```

It steers, waits for a collision, restarts and checks score/best state. Evidence goes to `playtest/latest/restart/`. `game/playtest/best-reload.json` also reloads the page and checks that the best score is still there. The step format is in [write a playtest script](../recipes/write-a-playtest-script.md). The mobile command above emulates a phone viewport; it does not establish physical-phone acceptance. Other templates have their own scripts in `game/playtest/` (explorer: `door.json`), listed in their README.

To see every success criterion in your brief at once, run:

```sh
npm run play:criteria
```

It runs each criterion's test or playtest and prints a table. A criterion whose brief entry says `how: 'gate'` shows `NOT RUN` (arcade and explorer: `S5`, the scenes' budgets), because only the integration gate checks it: the gate builds the game and benchmarks every scene, which takes minutes. `npm run play:criteria -- --gate` runs `npm run gate` for those rows. `NOT RUN` is neither a failure nor a pass. A `manual` criterion is listed for you to judge.

Commit when it looks right:

```
git add game GAME.md
git commit -m "Give the player a cyan colour"
```

(`playtest/latest/` is ignored by Git.)

## 8. Build and share

```
npm run build
npm run preview
```

Open the URL printed by preview and play again. Stop it with Ctrl+C. Preview listens on 4173; if that port is taken it moves to the next free one and prints it. To choose the port, run `PORT=4174 npm run preview`, which stops instead if that port is taken (or pass Vite's own `-- --port 4174`). `dist/` is a static website; the default build expects the root of a domain or subdomain.

For a known folder, such as a GitHub Pages project site, rebuild and preview with the same base:

```sh
npm run build -- --base /my-game/
npm run preview -- --base /my-game/
```

Open the printed origin followed by `/my-game/` (keep the trailing slash), then check that the scene and controls still work. For a build that can live in any folder, use `npm run build -- --base ./` instead. Upload the **contents** of `dist/` and provide the corresponding source and license notices; [share your build](../recipes/share-your-build.md) covers hosting and licensing details. `npm run deploy:production` is the engine repository's release guard, not the route for sharing your game.

## With a coding agent

Run Claude Code, Codex or another agent in the repository folder. It reads [AGENTS.md](../../AGENTS.md) (Claude Code through `CLAUDE.md`) and the skills in `.claude/skills/`. Say what you want to make; the **new-game** skill interviews you, fills the brief and plans a small first slice. [Working with your agent](working-with-your-agent.md) explains the rounds. For a game of your own, the agent works on your branch in this checkout; the worktree, gate and release rules in AGENTS.md are for contributions to the engine itself.

## When something goes wrong

| You see | Try |
|---|---|
| odd errors from `npm ci`, `npm run check` or the tests | `node -v`: use Node.js 22.18 or newer |
| `play:snap` cannot start a browser | step 2, or set `ENGINE_CHROMIUM` |
| the page stays empty and the console shows `boot failed` | read the listed problems; overlapping key or pad bindings are the usual cause, and `npm run check` names them too |
| commands show the blue cube, not your game | there is no `game/` folder in this checkout (see step 3) |
| `play:snap` says OVER BUDGET | the scene draws more than `game/budgets.json` allows; see the fix-budget skill |
| `npm run play: port 5173 is busy; try PORT=5174 npm run play` | another server (often an earlier `npm run play`) has 5173: stop it, or run the suggested command |
| `Port 4174 is already in use` from `PORT=4174 npm run preview` | choose another port, or run `npm run preview` without `PORT` to take the next free one |
| `play:script … FAIL` with `undefined` values just after a restart or scene change | the script read the new scene before its `enter()` ran: use `waitUntil` instead of a fixed `wait` ([timing](../recipes/write-a-playtest-script.md#4-timing)) |
| `play:criteria` shows `NOT RUN` for one criterion | it is checked by the gate: `npm run play:criteria -- --gate` (see step 7) |
| `./game already exists` | continue that game, or use a separate clone to try a template; do not overwrite existing work |
| `git commit` asks who you are | configure your Git name/email following its message, then retry the commit |
