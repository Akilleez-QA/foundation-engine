# Recipe: add a scene

A scene is any state or world of a game: a level, a menu, a board, a cutscene. It is a small ECS world (entities made of components, driven by systems) with a view, reached at `#scene/<id>` (STD-RUN-10, ADR 0022). A body supplied through a dynamic import can load separately when the scene is entered; inline content and static dependencies remain eager.

## 1. Define it

In your game folder (`game/`, or the template you are working in), one file per scene:

```ts
// game/level.ts
import { defineScene, Name, Shape, Transform } from '@engine';
import { move } from './move';            // a system (recipes/add-a-system.md)

export default defineScene({
  id: 'level', title: 'Level', type: 'level',
  view: { camera: { position: [0, 10, 12], target: [0, 0, 0] }, background: 0x101820 },
  entities: [[Name({ name: 'player' }), Transform({ y: 0.5 }), Shape({ kind: 'sphere', size: [1, 1, 1], color: 0xffcc33 })]],
  systems: [move],
  enter(ctx) { ctx.state.score = 0; },
});
```

- **id**: kebab-case, never renamed. The scene's row is `scene.<id>` and its address `#scene/<id>`.
- **title**: English; it becomes the string key `game.scene.<id>.title`, so it can be translated.
- **type**: open (`level`, `menu`, `world`, …); tools and kits may read it.
- **body**: heavy content goes in `body: () => import('./level.body.mts')`, which loads with the scene, not with the game.
- **enter / exit**: once per visit, when the scene becomes active and when it is left.

Every `.ts` default export in the game folder is picked up (except tests, `build.brief.ts` and `game.ts`); nothing else needs editing.

### Optional lazy body scaffold

Run `npm run new -- scene level --lazy-body` to generate `level.ts`,
`level.body.mts`, the scene test, budget row and changelog entry. Without this flag,
the generator keeps its existing inline scene shape. The definition imports its
body dynamically through the existing `SceneBody` API; `.body.mts` is not a new
scene definition and is outside the existing `.ts` discovery scan.

Put body-only imports in the body file. Transitive helpers in ordinary `.ts` files
are still scanned by definition discovery, even when they are also imported by a
lazy body. Use non-discovered `.mts` helpers for body-only dependencies, and avoid
static imports of those helpers from eager definitions or shared barrels. Existing
`.ts` discovery remains unchanged. A dynamic import is a loading boundary, not a
claim of reduced bundle bytes: inspect emitted chunks and measure startup and first
entry before reporting savings.

## 2. Go there

From a system: `ctx.scene.goto('level', { difficulty: 'hard' })` (the parameters arrive as `ctx.scene.params`), or `ctx.scene.restart()`. From a link: `#scene/level?difficulty=hard`. The game opens on `defineGame({ firstScene })`, and an unknown address lands there too.

## 3. Budget and test

- Add the scene to the game's `budgets.json` ([add-a-budget](add-a-budget.md)); the gate benches every listed scene.
- Test its logic without a browser with `testScene` (see [add-a-system](add-a-system.md)), and look at it with `npm run play:snap -- --scene level`.


The expedition shelter demonstrates lazy lifecycle implementation as well as a lazy
body. Its discoverable `shelter.ts` retains identity and view metadata; `body` and
`prepare` load `shelter.body.mts`. The synchronous `enter` and `exit` hooks delegate
to that already-loaded module. Preparation checks visit cancellation after loading,
before acquiring resources. `SceneBody` itself still contains only entities and
systems; this pattern adds no engine API. Tests that exercise implementation helpers
import the body directly rather than re-exporting helpers from scene metadata.
This changes startup inclusion, not scene behavior, and makes no loading-latency claim.
