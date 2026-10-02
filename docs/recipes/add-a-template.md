# Recipe: add a template

A template is a complete, small game that a new project starts from (`npm run new-game -- --template <name>`). Each passes the gate on its own. Add one when a genre needs a different starting point than the existing ones; keep it minimal.

## The contract

```
templates/<name>/
  GAME.md                  the game's design document: the brief mirrored at the top, a milestone plan, a changelog
  game/
    build.brief.ts         defineBuild({ genre: '<name>', … }): the contract (goal, audience, devices, targets, success)
    game.ts                defineGame({ id, title, version, firstScene, kits })
    budgets.json           {schema, app, largeChunkAllow, scenes}: measured, per scene
    *.ts                   scenes, entities, components, systems, inputs, save sections
    *.test.ts              testScene tests for each success criterion marked `how: 'test'`
```

- The brief's `genre` is the template's name; `new-game` picks the template from it.
- Imports: `@engine`, `@kits/<name>`, own files, JSON (`npm run lint:layers`).
- `src/app/templates.test.ts` checks every template folder has these files, a valid brief whose genre matches, a first scene that exists and a budget row for every scene.

## Check it

```
npm run gate -- --game templates/<name>/game     # the full gate, on this template (or GAME_DIR=… in POSIX shells)
npm run play -- --game templates/<name>/game     # the dev server with the test API
```

Measure its budgets as in [add-a-budget](add-a-budget.md). The ratchet reads `templates/<name>/game/budgets.json` with trailer keys prefixed `<name>/`.
