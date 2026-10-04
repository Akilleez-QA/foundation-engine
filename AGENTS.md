# Operating manual

For any coding agent working here, and for people. [docs/STANDARD.md](docs/STANDARD.md) is the architecture standard; [docs/recipes/](docs/recipes/) shows how to add each kind of thing; [docs/guides/working-with-your-agent.md](docs/guides/working-with-your-agent.md) is the author's side of this manual.

## Making a game? Read this, skip that

Following every "read first" link literally costs about 28k tokens. For work only in `game/`, about 8k is enough before the task's own skill and recipe (sizes at ~4 bytes per token):

- **Read:** this file (17 KB, ~4.3k, already loaded), [getting started](docs/guides/getting-started.md) (9 KB, ~2.3k), your template's `templates/<name>/README.md` (1.5–2.3 KB, ~0.5k) and the [recipes index](docs/recipes/README.md) (3 KB, ~0.7k). Then only the skill (`.claude/skills/*/SKILL.md`, 1–3 KB) and the recipe for the task in hand.
- **Skip unless you change `src/`:** [STANDARD.md](docs/STANDARD.md) (65 KB, ~16k), [CREATOR-CONTRACT.md](docs/CREATOR-CONTRACT.md) (11 KB, ~2.7k), the status ledgers in `docs/guides/` (`composition-framework-status`, `framework-upgrade-status`, `upgrade-acceptance-ledger`; 49–91 KB each), and the sections below on the engine contract, capability documentation and worktree integration.
- **Read when it applies:** [DEVICE-EXPERIENCE.md](docs/policy/DEVICE-EXPERIENCE.md) (22 KB, ~5.4k) for UI, control, camera, framing or quality changes on the brief's devices; [KID-SAFE.md](docs/policy/KID-SAFE.md) when the brief sets `kids: true`; [make assets with Blender through MCP](docs/recipes/make-assets-with-blender-mcp.md) when you make a model. That recipe covers the contract first, a headless `export.py`, `npm run asset:verify`, and licence and provenance. Registering a Blender MCP server is the user's own opt-in; never add `.mcp.json` to the repository.
- **First commands:**

  ```sh
  npm ci
  npm run new-game -- --template <name> --id <game-id> --title "<Title>"
  git switch -c <game-id> && git add game GAME.md && git commit -m "Start <game-id>"
  npm run check
  npm run play:snap          # add -- --mobile when phones are targets
  ```

## Engine, creator and agent contract

Read [CREATOR-CONTRACT.md](docs/CREATOR-CONTRACT.md) before proposing or changing
an engine capability. Foundation is a skeleton of bounded extension contracts.
The creator chooses the game requirements and may use, configure, extend, replace
or omit frameworks. The engine supplies reusable ownership, validation, scheduling,
resource admission and verification mechanisms; an agent implements the creator's
direction, including deliberate changes to those mechanisms. These repository
workflow rules do not prescribe the design or tooling of every independent game.

- State the creator requirement and existing extension seam before coding. An
  absent gameplay feature is not, by itself, an engine defect or authorized work.
- For a new or extended framework, name its inputs/outputs, owner, configured
  bounds, overload behavior, cancellation, failure recovery and acceptance evidence.
  Reuse the existing scheduler, cache, registry and persistence owner unless a
  measured contract gap justifies another mechanism.
- Preserve creator-selected devices, quality floors, semantics and budgets until
  the creator directs a change. Make intended framework and constraint changes
  explicit and update their tests and evidence; do not disguise them as an unchanged
  passing contract. Existing authorization remains valid; do not ask again for
  changes already authorized by the creator. An available kit is an option, not
  a required game feature.
- Report runtime-enforced limits, build/gate checks and manual evidence separately.
  A passing declaration is not proof of acceptable experience or physical-device
  performance. Document unverified requirements and integration gaps honestly.
- Agent identity changes no runtime rule or budget. These are authority and workflow
  responsibilities, not a sandbox, permission system or authorship-dependent API.

## Contribution language

Follow [Describe systems and patterns](CONTRIBUTING.md#describe-systems-and-patterns)
for all repository contributions and submissions. Use system and pattern names
instead of external game names, their acronyms, or references to their source projects, including
in goals, proposals, comments and examples. Explain the behavior, contract and
acceptance evidence directly. Do not publish proprietary source or private study
notes. Independently implemented mechanics need no inspiration credits under this
repository rule. Preserve required attribution and license notices for third-party
material actually included or adapted, plus accurate dependency and reproduction
identifiers. Changing languages alone does not establish independent implementation.

## Building your own game (solo or build day)

Most people clone this repository to make a game, not to change the engine. Then:

- **Work in the checkout you cloned, on a branch of your own.** `npm run new-game` writes `game/` (its scripted playtests in `game/playtest/`) and `GAME.md` into the current checkout, untracked. Right after it, `git switch -c <game-id>` and commit `game/` and `GAME.md` there (`git add game GAME.md`); commit each step that passes `npm run check`.
- **Do not start game work in a new worktree from `origin/main`.** It has no `game/`, so every command silently builds `templates/blank/game`. If you want worktrees for your game, branch them from your game branch.
- **The loop, the brief, the short rules, the teaching rules and device acceptance all apply.** `npm run gate` is recommended before sharing a build; it is not a merge requirement for a game branch.
- **Worktree per task, serial integration into `main` and `npm run deploy:production` are for contributions to this engine repository.** A game branch is not merged into this repository's `main`, and the production guard (which requires a clean `main` equal to `origin/main` and a provider hook) is not how a game is shared. Build with `npm run build` and upload `dist/` to any static host ([share your build](docs/recipes/share-your-build.md)).
- **Never delete, move or `--force`-replace an existing `game/`** without the author's explicit request; it may hold uncommitted work.
- Start with [getting started](docs/guides/getting-started.md), each template's README, and the [cookbook](docs/recipes/README.md).

## The loop

Every request from the author goes round this loop, in small steps:

1. **Idea**: restate it in one sentence. Which success criterion in the brief does it serve? If none, propose one.
2. **GAME.md**: record it: a milestone step, or a brief change (with a changelog row).
3. **Smallest change**: the least code that shows the idea. Use the generators (`npm run new -- <kind> <id>`).
4. **`npm run check`**: typecheck, lints, the brief, the affected tests. Green before presenting a change as ready; failed checks may be reported honestly while work continues.
5. **`npm run play:snap`** (add `--mobile` when phones are targets): look at the screenshots yourself first.
6. **Show**: the pictures, what changed, the criteria it moves (`npm run play:criteria`), fps / draws / triangles against the budget.
7. **Continue or clarify**: continue work already authorized. Ask only when a material requirement or decision is missing; do not expand scope or require repeated approval of settled decisions.

## Keep capability documentation current

For an engine capability change, update its guide and relevant status/acceptance
records in the same worktree. Explain the public inputs, owner, configured bounds,
overload, cancellation, recovery and actual limitations. Update examples when APIs
change. Before integration, reconcile `docs/guides/composition-framework-status.md`,
`docs/guides/framework-upgrade-status.md` and
`docs/guides/upgrade-acceptance-ledger.md` where the change affects their claims.
Distinguish implemented, checked and integrated work; cite the relevant revision or
PR and verification scope. Preserve failed or missing acceptance honestly. A passing
unit test or browser emulation never certifies physical devices or multiplayer.
Research and future plans are not completed capabilities. Keep proprietary study
notes outside publishable documentation.

## The brief is the contract

- `game/build.brief.ts` (`defineBuild`) holds the goal, audience, genre, devices, quality, performance targets, modes, constraints and checkable success criteria. `GAME.md` mirrors it at the top; `npm run lint:brief` keeps them in step.
- Change the brief only with the author. Record every change in GAME.md's changelog. A change of minimum device re-derives every per-scene ceiling.
- **Retiring a success criterion** is a brief change: only with the author. Remove it from the brief and from GAME.md's mirror, delete or rename its `S<n>:` test, and give the reason in a changelog row. Never reuse a retired id; new criteria continue the numbering. A test may be re-measured (for example sampling the peak instead of a fixed time after a deliberate retune) only if the criterion's text and threshold stay the same; say so in the commit.
- Budgets only fall. A raise needs the author's agreement and a `Perf-Budget: <key> <old> -> <new>: <reason>` commit trailer.
- The audience is neutral by default. `kids: true` (the learn template sets it) turns on [the kid-safe profile](docs/policy/KID-SAFE.md); follow it.

## Where code goes

- **Game code only in the game folder** (`game/`, or the folder `GAME_DIR` names; the engine's own templates live in `templates/<name>/game`). It imports only `@engine`, `@kits/<name>`, its own files and JSON (`npm run lint:layers`).
- **A game's other files stay in its folder too** ([recipe](docs/recipes/your-game-files.md)): static files it serves in `game/public/` (built with that game only), build-time Node scripts such as asset generators in `game/tools/` (may import `node:`; game code never imports them). The root `public/` is used only by a game without its own `game/public/`; keep it empty.
- **The engine (`src/`) is read-only** unless the author asks to extend it. An engine change follows the STANDARD and its recipe, and keeps genre words out of core, platform and author (`npm run lint:generic`).
- **Looks**: for colour, light, haze, camera framing, forms and the look checklist, follow the [art-direction recipe](docs/recipes/art-direction.md) ([skill](.claude/skills/art-direction/SKILL.md)); the `showcase` template is its worked example. Visuals are `@engine` data (environment, materials, meshes, particles), never direct three.js.
- A genre pattern more than one game would want is a kit (`src/kits/<name>`, [recipe](docs/recipes/add-a-kit.md)); a starting game is a template ([recipe](docs/recipes/add-a-template.md)).

## Short rules

- One scene at a time; a vertical slice before breadth.
- Systems read actions (`ctx.input`), never keys or devices. Every action has a key and a pad binding; touch players get a tap or a drag.
- State that must survive a reload is a save section; never rename its id.
- Text is string keys (`defineGame({ strings })`, `ctx.text`); no literal UI text in systems (`npm run lint:game`).
- Randomness is `ctx.random()`; with `?seed=` a run replays exactly (`npm run lint:game`; `<game>/tools/` and tests are exempt; a rare exception needs `// lint-game-allow <rule>: <reason>`).
- Nothing redraws when nothing changed: only touch what moved.
- Each success criterion checked by a test has a test named after its id (`test('S2: …')`).
- Never delete or weaken a test, a budget or a tolerance to make a check pass.
- No `any`: use a real type, `unknown` with narrowing, or a generic. No `as unknown as` outside tests; an unavoidable cast lives in one typed helper with `// lint:allow-unknown-cast <reason>` (`npm run lint:types`).
- Run `npm run format` (Prettier) before committing; CI checks it (`format:check`, part of `lint` and `check`). Markdown is not formatted.

## Teaching (learn mode)

When the game teaches ([learn mode](docs/guides/learn-mode.md)), these rules hold and `npm run check` checks them:

- Outline first: objectives, then ordered scenes; every objective is taught by a scene and checked (a question, a sim check, a found part, a milestone).
- The learner acts at least every `brief.pedagogy.maxPassiveActions` (default 3) steps: add a `wait-for`, a question or an interaction.
- Hints before answers; feedback is kind; a wrong answer never costs anything.
- Say it and show it (multimodal); state the objectives at the start; keep scenes short for the age band.
- In a kid-safe game, anything a discuss provider says passes the kid-safe check; there is no runtime language model by default.

## When a check fails

- **Reading `npm run check`**: one line per step (`ok  <step> (N s)` or `FAIL <step>` followed by the last 40 lines of its output), then `check: PASS` or `check: FAIL (<steps>)`. The tests line counts files, not tests (`tests (2 file(s))`), and it selects only tests affected by uncommitted changes, so after a commit it can say `tests (nothing changed that has tests)`. To see each test and the counts, run `npx tsx --test "game/**/*.test.ts"` (`# tests`, `# pass`, `# fail` at the end).
- **`npm run check` fails**: fix the first error; re-run. A layer error in game code means an import from outside `@engine` / `@kits`: use the author API instead.
- **play:snap shows page errors**: they are bugs; fix them before showing anything.
- **Over budget** (play:snap or the gate): recover in order: simplify, instance (not in the author API yet: bake copies into one mesh), bake, LOD ([fix-budget skill](.claude/skills/fix-budget/SKILL.md)). Measure again. Only if that is not enough, explain the cost to the author and ask; never raise a number on your own.
- **The gate fails on perf and you believe it is noise**: the gate already re-runs and blocks only on two consecutive breaches. Treat a block as real.

## Commands

| Command | What it does |
|---|---|
| `npm run new-game -- --template <name>` | Start a game from a template (blank, arcade, explorer, learn, terrain, expedition, mechanics, showcase); then commit `game/` on your own branch. `--force` removes the existing `game/` and `GAME.md` first |
| `npm run new -- <kind> <id>` | Generators: scene, entity, component, system, input, save-section, kit; interactable, area (explore); lesson (learn) |
| `npm run play [-- --host] [--game <dir>]` | Dev server with the test API; prints the URL (`--host`: also on the local network, for a phone) |
| `npm run check` | Focused check: typecheck, lints, brief, affected tests; duration depends on the checkout and hardware |
| `npm run play:snap [-- --scene <id>] [--mobile]` | Muted, isolated browser: screenshots and `playtest/latest/probe.json`; the budget verdict is judged on rendered frames (a still scene is redrawn on request) and says `not measured` when none rendered |
| `npm run play:script -- <file.json>` | A scripted playtest (goto, key, press, teleport, wait, snap, expect, waitUntil, reload; [format](docs/recipes/write-a-playtest-script.md), checked before the browser starts); a game keeps its scripts in `game/playtest/`, evidence goes to `playtest/latest/` |
| `npm run play:criteria [-- --gate]` | The brief's success criteria, checked and tabled |
| `npm run asset:verify -- <model.glb>` | Check a model against its `<name>.contract.json`: size, pivot, triangle/vertex/material/texture limits, bytes, material properties, provenance ([model contracts](docs/guides/model-contracts.md)); `check` runs it for every contracted GLB |
| `npm run disclosure [-- --strict]` | Steam and itch.io AI-disclosure draft from the asset provenance records ([guide](docs/guides/asset-provenance.md)) |
| `npm run asset:optimize -- <in.glb> --out <out.glb>` | Meshopt-compress a model and re-encode its textures as WebP at the contract's texture size (`--ktx2` waits for engine KTX2 support), keeping named nodes; checks the contract before and after ([model contracts](docs/guides/model-contracts.md#optimise)) |
| `npm test` / `npm run lint` | All tests / all lints (format, layers, game, arch, css, generic, brief, budgets, provenance) |
| `npm run format` / `npm run format:check` | Format code with Prettier / check it (Markdown excluded) |
| `npm run gate` / `npm run gate:templates` | The integration gate for this game / for every template |
| `npm run gate:ci [-- --from <step> \| --only <step> \| --list]` | Every checking `run:` step of `.github/workflows/ci.yml`, with its env; reproduces all work jobs serially and derives the final aggregate. Partial selections are not full CI acceptance |
| `npm run bench`, `npm run perf:derive` | Measure scenes; derive budgets |
| `npm run quality:guard` | Picture comparison of two builds |
| `npm run deploy:production` | The only production release path for this repository's `main` (a game is shared with `npm run build` and static hosting) |

The dev and test builds expose `window.engine` (src/dev/test-api.ts): `state()`, `goto(scene, params)`, `teleport(x, z, name)`, `key(key, ms)`, `clock.hold/step/resume`, `loop()`, `redraw()`, `probe(name)`, `events(fn)`. Production builds never contain it.

## Worktree per task, gate before integration, production only from a clean main

These rules govern contributions to this engine repository. For a game of your own, see [Building your own game](#building-your-own-game-solo-or-build-day).

- **One task, one worktree.** `origin` names canonical upstream in the [contributor setup](CONTRIBUTING.md#set-up); personal pushes use a separate `fork` remote. Start each independent task from the current `origin/main`, in its own named branch and worktree (`git worktree add ../<repo>-<task> -b <task> origin/main`). Never edit the shared main checkout, reuse another task's worktree, or run two tasks in one checkout.
- **Commit and validate in that worktree.** Before integrating, fetch and rebase onto the current `origin/main`. Keep other tasks' changes; never overwrite them.
- **Full evidence before merging to main.** Engine changes require the complete repository CI workflow on the reviewed candidate, including browser suites, template gates and phone smoke. A successful hosted run supplies this evidence; local duplication on a constrained machine is optional. `npm run gate:ci` reproduces the workflow on a suitable runner after dependency/browser installation. An affected-template gate or focused test pass alone is not complete engine acceptance. Record the checked head/base, commands, results and missing physical-device evidence. Local candidate assembly is staging until reviewed and fully validated.
- **Integrate serially through pull requests.** One coordinator integrates one ready change at a time. Recheck the combined candidate after base changes; do not force-push shared main or skip required CI. Use the normal protected review path, or the explicitly authorized, documented [sole-maintainer exception](GOVERNANCE.md#review-and-integration). Self-review is not independent review. Publication and production deployment remain separate actions.
- **Production only from a clean main**, through `npm run deploy:production` (branch, cleanliness and sync checks, an exclusive release lock, the bundle check). Never bypass it with a direct provider command; never deploy a feature worktree, a detached checkout, a dirty tree or an old snapshot. Feature worktrees may make explicitly authorised preview deployments.
- After a production deploy, confirm the live commit and assets through the public UI. If another release is active or `main` has moved, reconcile before releasing.

## Device experience acceptance

For UI, control, camera, framing or quality changes, follow
[DEVICE-EXPERIENCE.md](docs/policy/DEVICE-EXPERIENCE.md) and record every affected
supported profile. Phone, tablet, laptop and desktop have separate acceptance;
layout, input and graphics quality are separate dimensions. The author chooses
supported targets and editions; do not impose phone constraints on tablet or
desktop-only builds. Record intentional cross-platform tradeoffs and unsupported
combinations instead of assuming every build targets every device. Protect the playable
world and critical subjects before adding persistent UI. A desktop layout shrunk
to phone size, or a passing screenshot without interaction, is not acceptance.

Report manual device evidence, emulated browser evidence and automated budget
results separately. Mark missing device evidence unverified. Do not claim existing
phone smoke covers tablet, landscape, occlusion, simultaneous touch or thermal
performance. Standards-only edits do not certify existing template experiences.

## Test browsers

Test browsers are isolated and muted. Never change the user's system or application audio. The bench, play scripts and quality guard always launch a fresh Chromium with `--mute-audio` and open the game with `?flags=dev.silent`. A driver of your own launches through `launch()` in `scripts/perf/bench-browser.mjs` (muted, throwaway profile, `ENGINE_CHROMIUM`) or passes `--mute-audio` itself ([getting started](docs/guides/getting-started.md#without-a-browser-window-coding-agents-ci)). Preloading `scripts/silent-browser.cjs` does not mute a browser your script launches: it only adds `--mute-audio` to `AGENT_BROWSER_ARGS`, for agent-browser tools that read it, and turns off the file watcher.
