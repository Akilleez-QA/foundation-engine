# Getting started: your first game

From a fresh clone to a game you can share, by hand or with a coding agent. Each step says what you should see. Allow about half an hour, most of it downloads.

## 1. Get the code and the tools

You need Git and Node.js 22.18 or newer (CI uses Node.js 22; `node -v` prints your version). [nvm](https://github.com/nvm-sh/nvm), [fnm](https://github.com/Schniz/fnm) or [mise](https://mise.jdx.dev/) can install it next to other versions.

```
git clone https://github.com/Akilleez-QA/foundation-engine.git
cd foundation-engine
npm ci
```

`npm ci` installs exactly the versions in `package-lock.json`.

## 2. Install the test browser

`npm run play:snap`, the bench and the gate drive a muted Chromium of their own. Install Playwright's copy once:

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

`--id` is your game's save namespace; choose it once. The command writes `game/` (with the template's scripted playtests in `game/playtest/`) and `GAME.md` into this checkout. Every command now builds your `game/` (without one, they build `templates/blank/game`).

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

It prints an address such as `http://127.0.0.1:5173/#scene/play`; open it in your browser. Edits to files in `game/` reload the page. Press `M` to mute. Stop the server with Ctrl+C.

## 5. Change something

Open `game/` and change one thing: a colour in a `Shape`, a speed, a word in `game/game.ts`. Each template's README lists what to change first. The [cookbook](../recipes/README.md) has recipes for models, HUD and buttons, collision and picking, camera and lighting, and sharing your build.

The rules that keep a game healthy are short (all in [AGENTS.md](../../AGENTS.md)): game code imports only `@engine`, `@kits/<name>`, its own files and JSON; systems read actions, never keys; words go in string keys; randomness is `ctx.random()`.

## 6. Check it

```
npm run check
```

Types, lints, the brief and the tests your change affects. It ends with `check: PASS` or the first problem to fix.

## 7. Look at it

```
npm run play:snap
npm run play:snap -- --scene <id> --mobile
```

Screenshots and `probe.json` land in `playtest/latest/`: open the pictures, and read the probe for page errors, frame rate, draws and triangles against your budget. `play:snap` fails on page errors or an over-budget scene. Some mistakes only show up here: for example, two actions bound to the same key stop the game at boot (`inputActions: … overlap`), while `npm run check` still passes.

Commit when it looks right:

```
git add game GAME.md
git commit -m "Faster blocks"
```

(`playtest/latest/` is ignored by Git.)

## 8. Build and share

```
npm run build
npm run preview
```

`dist/` is a static website. Upload it to a static host; [share your build](../recipes/share-your-build.md) explains which hosts work as built today (the root of a domain or subdomain) and what happens under a sub-path.

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
| `npm run play` says the port is in use | another server has 5173: `PORT=5174 npm run play` |
| `./game already exists` | you already started a game; `--force` replaces it, so commit or copy it first |
