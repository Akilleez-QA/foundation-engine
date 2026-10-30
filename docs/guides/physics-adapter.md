# Physics adapter (optional kit)

`@kits/physics` adds rigid bodies, colliders, collision events, physics queries,
rollback snapshots and a slope-and-step character controller. It does this through one
lazily loaded WebAssembly library: Rapier's deterministic compat build, Apache-2.0,
exact-pinned at 0.21.0. Core stays physics-free. A game that never imports the kit
ships none of it. The full contract (bounds table, authority rules, evidence) is the
[kit README](../../src/kits/physics/README.md); the decision is
[ADR 0121](../adr/0121-optional-physics-adapter-kit.md), with
[20 options compared](../research/physics-middleware.md).

Use it when the game needs bodies that fall, stack, bounce or push. The lighter
[collision and picking](../recipes/collision-and-picking.md) recipe and the character
kit's `Walls`/`Solid` blocking remain the zero-cost path for ground-plane games.

## 1. Opt in

```ts
// game/game.ts
import { defineGame } from '@engine';
import { physics } from '@kits/physics';
export default defineGame({ id: 'g', title: 'G', version: '0.1.0', firstScene: 'arena', kits: [physics()] });
```

Use `physics({ characters: true })` together with `character()` from `@kits/character`
when the scene uses `physicsCharacterSystem`, which reads that kit's move axes.

## 2. A scene with a world

```ts
// game/arena.ts
import { defineScene, defineSystem, Transform, Shape } from '@engine';
import { scenePhysics, RigidBody, Collider } from '@kits/physics';

const world = scenePhysics({ limits: { maxBodies: 128, maxEventsPerStep: 64 } });

const hits = defineSystem({
  id: 'arena-hits',
  run(ctx) {
    for (const e of world.of(ctx)?.events().list ?? []) if (e.started) ctx.state.hits = Number(ctx.state.hits ?? 0) + 1;
  },
});

export default defineScene({
  id: 'arena',
  title: 'Arena',
  prepare: (_ctx, signal) => world.prepare(signal), // fetch and initialise the library before entry
  exit: ctx => world.exit(ctx),                     // free this visit's library objects
  entities: [
    [Transform({ y: 4 }), Shape({ kind: 'sphere', size: [1, 1, 1], color: 0x4f8cff }), RigidBody(), Collider({ shape: 'ball', radius: 0.5, restitution: 0.4 })],
    [Transform(), Shape({ kind: 'plane', size: [10, 0, 10], color: 0x2a3342 }), Collider({ hx: 5, hy: 0.05, hz: 5 })],
  ],
  systems: [world.system, hits], // the step first, then systems that read this tick's events
});
```

The order of systems matters:

1. systems that move kinematic bodies or characters;
2. `world.system`;
3. systems that read `events()` or query the world.

## 3. Budget: the library chunk

The library is a single chunk of about 4.4 MB: 4,366,824 bytes, 1,658,896 bytes with
`gzip -9`, because the compat build inlines its WebAssembly as base64. It is fetched
only when `prepare` runs. It exceeds the 500 kB large-chunk rule, so `npm run
perf:bundle` fails until the creator accepts the cost by listing the chunk:

```json
// game/budgets.json (excerpt)
"largeChunkAllow": ["index", "rapier"]
```

That entry is a creator budget decision. Record it in GAME.md's changelog. On
phones, also check load time and memory on the supported devices: this guide has no
device evidence.

## 4. Rollback and save

`world.of(ctx).snapshot()` returns `{status: 'ok', text}`. It holds the library world
(base64), the entity↔handle records and the tick, bounded by `maxSnapshotBytes`.
`restore(text)` validates the text first, then swaps atomically. To plug it into
`@kits/rollback`:

```ts
ports: {
  save: () => JSON.stringify({ ecs: saveMyComponents(), physics: physicsSave() }),
  load: text => { const s = JSON.parse(text); loadMyComponents(s.ecs); physicsRestore(s.physics); },
  step: (inputs, frame) => { applyInputs(inputs); tickEverythingOnce(); },
}
```

- Restore your own ECS state first, then the physics text.
- `PhysicsCharacter` holds the character's velocities, so include it in your ECS state.
- Run `createRollbackSyncTest` in a test before any network, as the kit's own tests do.
- Snapshot text grows with the world: 41.6 KB for 14 boxes, 285 KB for 100. A rollback window multiplies that per tick, so measure before choosing the window.

A restore cross-checks every record against the decoded library world: handles,
counts, body types, sensor flags, collider parents and the configuration. Any mismatch
is refused, and the live world is left as it was.

## 5. Determinism checklist

The deterministic build guarantees identical results for an identical sequence of
operations; the kit keeps its own order fixed. Your part:

- spawn and despawn in the same order on every run;
- feed only deterministic floats into physics (`dmath` from `@engine`, `math: 'deterministic'` in `scenePhysics` and `physicsCharacterSystem`, `relative: 'world'` or a deterministic camera);
- never read the wall clock in simulation;
- keep `substeps`, `timeScale`, `solverIterations` and gravity identical on every peer and replay (they are game rules, STD-SIM-10, never quality presets).

Same-process determinism is tested. Browser-to-browser and device-to-device identity
are not established.

## 6. Debug lines

`extensions: [physicsDebugDraw(world, { enabled: () => devToggle })]` draws collider
outlines as one line draw, bounded by `maxVertices`. It is off unless the scene lists
it, and is disposed with the visit.

## 7. Replacing the library build

`scenePhysics({ loader: createPhysicsLoader(() => import('…')) })` substitutes another
build of the same API, for example the SIMD build for speed. Doing so voids the
determinism and snapshot evidence: record that in the game's acceptance notes.

## Bounds worth knowing

- `limits.maxCoordinate` (default 1,000,000) bounds every position and Euler angle
  entering the library.
  - A non-finite or larger `Transform` refuses admission and skips that tick's kinematic target.
  - Such a pose also refuses `teleport` and queries.
  - Skips are counted in `status().skippedPoses`.
- Multi-hit queries examine all hits, up to an internal scan cap, before keeping the
  nearest (`raycastAll`) or the lowest entity ids (`overlap`). `truncated` says when
  anything was left out.
- Debug lines: the GPU copy is bounded, but the library builds its whole debug buffer
  on each refresh.

## Limitations

The adapter does not expose:

- joints;
- contact-force events;
- collision groups;
- compound, mesh or heightfield colliders;
- soft bodies.

Colliders ignore `Transform.scale`. WebAssembly memory does not shrink after a
visit ends. There is no hosted CI, GPU or physical-device evidence. See the kit
README's evidence section.
