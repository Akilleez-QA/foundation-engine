# Recipe: add a kit

A kit is an optional genre pattern (a camera rig, a character controller, exploration with interactable things, a HUD, lessons) built on the same author API a game uses. The engine runs with no kit at all; a game chooses its kits in `defineGame({ kits })`. Growth is meant to be cheap: a new kit is one folder, and nothing in core, platform or the author layer changes. Candidates are listed in [ROADMAP.md](../ROADMAP.md).

Prove the pattern first in a [lab](../guides/labs.md) (`npm run new-lab -- <id>`): a small isolated game that answers one question. A kit is what a lab graduates into once the answer is in and another game would want it; the lab's tests and measurements become the kit's tests and acceptance evidence, and the lab is rebuilt on the kit as its reference scene.

## The contract

Use the [engine/creator/agent contract](../CREATOR-CONTRACT.md). Before adding code,
record the authorized requirement, existing extension seam, inputs/outputs, owner,
configured work and retention bounds, overload behavior, cancellation, recovery and
acceptance evidence. A missing game mechanic does not justify a new engine kit by
itself. The creator supplies game semantics; this kit exposes a reusable contract.

```
src/kits/<name>/
  index.ts          the public surface: components, systems, helpers, and a `<name>()` function returning defineKit(...)
  *.ts              the implementation
  *.test.ts         unit tests (testScene, or plain functions)
  README.md         its scope, components/systems, inputs/outputs, owner, bounds, failure behavior and evidence
```

```ts
// src/kits/scoreboard/index.ts
import { defineComponent, defineKit, defineSystem, type KitDefinition } from '../../author';

export const Score = defineComponent('score', { points: 0 });
export const tally = defineSystem({ id: 'scoreboard-tally', run(ctx) { /* … */ } });

/** The kit, configured by the game: `kits: [scoreboard({ target: 10 })]`. */
export function scoreboard(o: { target?: number } = {}): KitDefinition {
  return defineKit({ id: 'scoreboard', requires: [], defs: [], modules: [] });
}
```

- **Imports**: a kit may import the author API (`src/author`), core, platform, domain and the kits it declares in `requires`. It never imports a feature, a pack, the app, dev or a game. Core, platform and the author layer never import a kit (`npm run lint:layers`: `author-knows-no-kit`, `platform-knows-no-game`, `core-is-bottom`).
- **Declared dependencies**: `requires: ['camera']` names the kits this one needs. `defineGame` refuses a game that lists a kit without its dependencies, and the frozen `kits` registry re-checks it at boot.
- **Contributions**: `defs` are ordinary definitions (inputs, save sections, scenes, modes) the kit adds to every game that uses it; `modules` are engine modules for registries or services a kit needs (rare: prefer components and systems).
- **Ids**: prefix the kit's system, input and save-section ids with its name (`scoreboard-tally`, `scoreboard.best`) so two kits never collide.
- **Genre words** belong here, not in core: the genericity check (`npm run lint:generic`) scans core, platform, author and the engine docs, not `src/kits/` or `docs/kits/`.

## Using it from a game

```ts
// game/game.ts
import { defineGame } from '@engine';
import { scoreboard } from '@kits/scoreboard';
export default defineGame({ id: 'my-game', title: 'My game', version: '0.1.0', firstScene: 'main', kits: [scoreboard({ target: 10 })] });
```

Game code imports only `@engine` and `@kits/<name>` (`game-imports-engine-only`).

## Budgets and tests

- A kit has no budget of its own; the scenes that use it do. State a kit's typical cost (draws, triangles, per-frame work) in its README so authors can plan.
- Test systems with `testScene` and pure helpers directly. `npm test` picks up `src/kits/**/*.test.ts`.
- A kit that a template uses is exercised by that template's play:snap and gate run.

## Generator

`npm run new -- kit <name>` writes `src/kits/<name>/` with an index, a README and a test (only when the author asks to extend the engine).
