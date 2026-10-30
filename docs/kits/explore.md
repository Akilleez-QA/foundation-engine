# Recipe: use the explore kit

The explore kit is the move-and-interact pattern: the player walks up to things, sees a prompt, uses them, and goes through doors to other scenes. The explorer template (`templates/explorer`) is the worked example.

## 1. Choose the kits

```ts
// game/game.ts
import { ui } from '@kits/ui';
import { camera } from '@kits/camera';
import { character } from '@kits/character';
import { explore } from '@kits/explore';
export default defineGame({ …, kits: [ui(), camera(), character(), explore()] });
```

`explore` needs `ui` (for the prompt); `character` gives movement (`character-x`, `character-z` axes); `camera` keeps the player in view.

## 2. A scene to explore

```ts
import { defineScene, Name, Shape, Transform } from '@engine';
import { cameraSystem } from '@kits/camera';
import { Character, characterSystem, Solid, Walls } from '@kits/character';
import { exploreSystem, Interactable } from '@kits/explore';

export default defineScene({
  id: 'hall', title: 'Hall',
  entities: [
    [Walls({ minX: -5, maxX: 5, minZ: -5, maxZ: 5 })],
    [Name({ name: 'player' }), Transform({ y: 0.7 }), Shape({ kind: 'capsule', size: [0.6, 1.4, 0.6] }), Character()],
    [Transform({ x: 2 }), Shape({ kind: 'box' }), Solid(), Interactable({ id: 'chest', label: 'game.use.chest' })],
    [Transform({ z: 4.8 }), Interactable({ id: 'exit', label: 'game.use.exit', to: 'garden', toX: 0, toZ: -3 })],
  ],
  systems: [characterSystem(), exploreSystem(), cameraSystem('orbit', { distance: 10, pitch: 0.9 })],
});
```

- **Things**: `Interactable({ id, label, reach })`. `label` is a string key in `defineGame({ strings })`. The nearest thing in reach is prompted; `ctx.state.near` holds its id.
- **Doors**: `to` names another scene; `toX`/`toZ` are where the player arrives there (passed as scene parameters, so a link or a test can do the same: `#scene/shed?x=0&z=2.2`).
- **Reacting**: a use fires the world event `interact` `{ id }`. Read it in your own system: `ctx.world.read<{ id: string }>('interact')`.
- **Progress**: `explore.progress` (a save section) remembers every `scene/id` used and every scene visited; `usedCount(ctx, keys)` counts them. Uses never un-happen.

## 3. Test it

```ts
const t = await testScene(hall, { game });
const me = t.world.get(t.ctx.named('player')!, Transform)!; me.x = 1.2;
t.run(2 / 60);
assert.equal(t.ctx.state.near, 'chest');
t.press('explore-interact'); t.run(2 / 60);
```

In the browser, `npm run play:script -- templates/explorer/game/playtest/door.json` walks through a door and back with `teleport` and `press`.

## Budgets

Each explorable scene is a row in `budgets.json` with `"active": true`, so the bench also measures it while the player moves.
