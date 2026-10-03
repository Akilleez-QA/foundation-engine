# Getting started: your first game

```text
      [##]          FOUNDATION ENGINE
    [======]        =================
  [==][==][==]      STAGE 1: FIRST GAME
 [############]
```

From a fresh clone to a game you can share, by hand or with a coding agent. Each step says what you should see. You will run a lane-dodging game, change its player colour, check the change and build a static site. Download time depends on your connection; no paid tool or AI account is required.

## 1. Get the code and the tools

You need Git and Node.js 22.18 or newer (CI uses Node.js 22; `node -v` prints your version). [nvm](https://github.com/nvm-sh/nvm), [fnm](https://github.com/Schniz/fnm) or [mise](https://mise.jdx.dev/) can install it next to other versions.

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

Leave this terminal running while editing: changes in `game/` reload the page. Use a second terminal in this same checkout for checks, or stop the server with Ctrl+C before running the next command. The server command does not return until stopped.

## 5. Change something

For the arcade template, open `game/components.ts`. In the `ball` definition, replace `color: 0xffcc33` with `color: 0x66ddff`. Save the file: the ball should turn cyan, while movement and scoring keep working. This edits your game; no engine change is needed. Each template's README lists other changes to try. The [cookbook](../recipes/README.md) has recipes for models, HUD and buttons, collision and picking, camera and lighting, and sharing your build.

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

Expect four passing tests: steering, collision/restart, saved best score and deterministic replay. Other templates have different test files and counts; consult their README.

## 7. Look at it

```
npm run play:snap
npm run play:snap -- --scene play --mobile
```

Screenshots and `probe.json` land in `playtest/latest/`: open the pictures, and read the probe for page errors, frame rate, draws and triangles against your budget. `play:snap` fails on page errors or an over-budget scene. Some mistakes only show up here: for example, two actions bound to the same key stop the game at boot (`inputActions: … overlap`), while `npm run check` still passes.

For arcade, also exercise the copied restart scenario:

```sh
npm run play:script -- game/playtest/restart.json
```

It steers, waits for a collision, restarts and checks score/best state. Evidence goes to `playtest/latest/restart/`. `game/playtest/best-reload.json` also reloads the page and checks that the best score is still there. The step format is in [write a playtest script](../recipes/write-a-playtest-script.md). The mobile command above emulates a phone viewport; it does not establish physical-phone acceptance. Other templates use their own scene IDs and scripts.

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

Open the URL printed by preview and play again. Stop it with Ctrl+C. `dist/` is a static website; the default build expects the root of a domain or subdomain.

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
| the page stays empty and the console shows `boot failed` | read the listed problems; overlapping key or pad bindings are the usual cause |
| commands show the blue cube, not your game | there is no `game/` folder in this checkout (see step 3) |
| `play:snap` says OVER BUDGET | the scene draws more than `game/budgets.json` allows; see the fix-budget skill |
| `npm run play: port 5173 is busy; try PORT=5174 npm run play` | another server (often an earlier `npm run play`) has 5173: stop it, or run the suggested command |
| `./game already exists` | continue that game, or use a separate clone to try a template; do not overwrite existing work |
| `git commit` asks who you are | configure your Git name/email following its message, then retry the commit |
