- **Reader-first README and docs index.** The README now opens with what the engine is, why to use it, a diagram
  of how a game runs and a worked example (new game, code, test, headless playtest, screenshot); the
  [documentation index](docs/README.md) is ordered by reader task with the engineering records last.
  `npm run lint:trace` no longer link-checks the creator's own `game/` folder and root `GAME.md`, so
  `npm run check` passes right after `npm run new-game` from the blank, explorer or learn templates.
