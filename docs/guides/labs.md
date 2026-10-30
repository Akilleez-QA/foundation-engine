# Labs: prove one system before building a world

A lab is a small, isolated game in `labs/<id>/` that exists to answer one question: does this mechanic feel right,
can this kit carry a crowd, does this rendering technique hold up, does this pipeline step produce clean assets. You
refine it quickly, with nothing else in the way, until the answer is clear. What it proves graduates into the engine
(`src/`), a kit (`src/kits/<name>`) or a tool (`tools/<name>`), and only then does a full game build on it.

```text
  lab (labs/<id>)  ──graduate──▶  engine, kit or tool  ──use──▶  game (game/, templates/<name>/game)
  fast, one question              contract, bounds, tests,        imports only @engine and @kits,
  may use @kits/three             guide, status records           never lab code
```

A full game is the hardest setting in which to discover how a system should work: every change competes with scenes, saves,
balance and content, and a workaround written there stays there. A lab keeps the experiment small and makes the
graduation step explicit, so what a game needed becomes something every game can use.

## Start a lab

```sh
npm run new-lab -- <id> [--template <name>] [--kit <name>]... [--question "<text>"] [--title "<Title>"]
```

- `--template` picks the starting game (`blank` by default). Use the template closest to the question: `arcade` for
  a mechanic with a score, `explorer` or `showcase` for a character moving through a scene, `blank` for rendering or a single system.
- `--kit` (repeatable) registers a kit in `defineGame({ kits })`, together with the kits it requires, so you can try a
  kit on its own in a minute. A library kit (one with no factory, such as `replay`) is reported and imported directly.
- `--question` writes the lab card's question. Write it before the first line of code.

`npm run new-lab` with no id lists the templates and kits. The generator copies the template to `labs/<id>/game`, names
the game `lab-<id>` (its save namespace), writes `labs/<id>/README.md` (the lab card) and a `tsconfig.json`, and runs the
brief check: when a template and a kit bind the same key or button it says so at once, before the first boot.

## Work in a lab

```sh
npm run lab                    # every lab with its status and question
npm run lab -- <id>            # the dev server for that lab
npm run lab -- <id> snap       # play:snap (add --mobile, --scene <id> after it)
npm run lab -- <id> check      # typecheck, lints, brief and the lab's tests
npm run lab -- <id> criteria   # the lab brief's success criteria
npm run lab -- <id> bench      # measure its scenes
```

Each runs the ordinary command with `GAME_DIR=labs/<id>/game`; the loop in [AGENTS.md](../../AGENTS.md) applies as for
any game: smallest change, `check`, `snap`, look at the pictures, record what changed.

What is different in a lab:

- **One question, one system.** Add only what the question needs. A lab that grows a second question becomes two labs.
- **Speed over polish.** A lab may use `@kits/three` and raw three.js to try something the engine cannot say yet, keep
  rough UI, and declare budgets that are measurements rather than promises (the budget ratchet covers `./game` and the
  templates, not labs). Game rules still apply: `ctx.random()`, string keys, actions not keys, `npm run lint:layers`.
- **Findings are written down.** The lab card's findings table records each answer with its evidence (a test named
  after a criterion id, a snapshot, a measurement). A finding without evidence is a hunch.
- **Labs are checked.** `npm test` runs every lab's tests, and the lints, the typecheck and `asset:verify` see every lab
  (as they see the templates and the tool fixture games), so a lab cannot quietly rot.

## Graduating a system

A lab system graduates when its question is answered and another game would want the result. Graduation is its own
change, in its own worktree, and moves the system out of the lab:

1. **Name the home.** Core capability (`src/author`, `src/platform`), an optional kit (`src/kits/<name>`, with the
   [add-a-kit recipe](../recipes/add-a-kit.md)), a pipeline tool (`tools/<name>`), or a game's own code when it is
   content rather than a reusable system. Genre words stay out of core (`npm run lint:generic`).
2. **State the contract** from [CREATOR-CONTRACT.md](../CREATOR-CONTRACT.md): inputs and outputs, owner, configured
   bounds, overload behaviour, cancellation, failure recovery and acceptance evidence. Reuse the existing scheduler,
   cache, registry and persistence owner unless the lab measured a gap.
3. **Port the tests and evidence.** The lab's tests move with the system; its measurements become the acceptance
   evidence in the guide.
4. **Rebuild the lab on the graduated API** in the same change. The lab then proves the API, and anything it can no
   longer do is a gap the graduation left open, recorded honestly rather than hidden.
5. **Document and record.** A guide or kit README, a recipe when a game author needs one, and the status records
   named in AGENTS.md (implemented, checked and integrated are different claims).
6. **Update the lab card**: `Status: graduated → <where>` with the PR, or `Status: retired` with the reason.

A game never imports lab code. When a game needs something a lab built, graduate it first.

## Lab status

The first line after the lab card's heading is its status; `npm run lab` lists it.

| Status | Meaning |
|---|---|
| `exploring` | The question is open. |
| `graduating` | The answer is in; a change is moving the system to its home. |
| `graduated → <where>` | The system lives in the engine, a kit or a tool; the lab is its reference scene. |
| `retired` | The question was answered "no" or replaced; the card says why. Delete the lab when nothing refers to it. |

## Labs, templates and tool fixtures

| | Folder | Purpose |
|---|---|---|
| Lab | `labs/<id>/game` | Answer one question quickly; the source of new systems. |
| Template | `templates/<name>/game` | A starting game for authors (`npm run new-game`); ratcheted budgets. |
| Tool fixture | `tools/<name>/game` | The test game of a pipeline tool or diagnostic (pose-to-pose, blender-export). |
| Game | `game/` | The author's game; uses only what graduated. |

## Lessons from labs

What a lab learns is worth keeping even when nothing graduates. Practices learned in labs, written generically with
what the engine does and does not provide:

- [Character pipeline lessons](character-pipeline-lessons.md): retargeting, foot contact, skin weights and LOD,
  resampling and loops, clip QA.
- [Crowd and night rendering lessons](crowd-and-night-rendering-lessons.md): what a character costs, animation
  cadence, inertialized transitions, wet and graded night looks, measuring.
