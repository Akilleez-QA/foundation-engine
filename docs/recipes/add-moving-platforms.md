# Recipe: add moving platforms

Use this when the creator wants actors to ride surfaces that move: lifts, conveyors
of floating blocks, swinging decks. The locomotion kit supplies the mechanism (MV-02,
candidate). The creator chooses every path, size and leave policy. Full contract:
[locomotion kit](../../src/kits/locomotion/README.md#moving-platforms-mv-02).

## 1. Record the requirement

In GAME.md, state:
- what moves and how fast;
- whether a jump from a moving platform keeps its speed;
- whether one-way platforms may pick actors up from below.

Add a checkable success criterion, for example "a jump from the moving deck lands back on
it".

## 2. Describe platforms as functions of time

```ts
import { createPlatforms } from '@kits/locomotion';

export const platforms = createPlatforms({ maxPlatforms: 16, maxSpeed: 20 });
platforms.add('lift', { halfX: 1, halfZ: 1, path: t => ({ x: 4, y: 1 + Math.sin(t), z: 0 }) });
platforms.add('ferry', { halfX: 1.5, halfZ: 1, path: t => ({ x: 3 * Math.sin(0.5 * t), y: 2, z: -3 }) });
```

`path(t)` returns the top-centre pose at simulation time `t`. A path that jumps
discontinuously needs `platforms.cut(id)` before the jump. Otherwise the speed check
refuses the step. Riders of a cut platform detach; they do not jump with it.

A registry created at module level keeps its time across scene visits. Restart it when
the scene is entered, so every visit and every `?seed=` replay starts from the same poses:

```ts
defineScene({ id: 'lifts', /* … */ enter() { platforms.restart(); } });
```

## 3. Systems, in this order

`platformSystem` must run once per fixed tick before `jumpSystem`. If it runs after,
riding lags one tick. If it is missing or stops, riders stay put on the frozen
platforms.

```ts
import { jumpSystem, platformSystem } from '@kits/locomotion';
import { characterSystem } from '@kits/character';

systems: [
  platformSystem(platforms, { bind: { lift: 'lift-mesh', ferry: 'ferry-mesh' } }),   // moves, then publishes poses
  characterSystem(),                                                                  // horizontal input
  jumpSystem({ action: 'jump', config: { height: 2, timeToApex: 0.4 }, ground: floor, platforms, onLeave: 'add-velocity' }),
]
```

Model each bound mesh with its top surface at local y = 0. Do not give platforms a
`Solid`: they support actors from above and do not block them sideways.

## 4. Choose the leave policy

| `onLeave` | Feels like |
|---|---|
| `'add-velocity'` (default) | Momentum is kept: a jump from a fast ferry carries forward |
| `'add-upward'` | Only a rising lift adds height to a jump |
| `'none'` | Jumps are relative to the ground, not the platform |

## 5. Reset and remove

- `platforms.restart()` restarts every path at t = 0 without motion. Riders of a platform
  that moved detach.
- `platforms.remove(id)` drops riders with no velocity.
- `resetJump(world, entity)` clears what an actor carried after a teleport or control change.

## 6. Test it

Run the fixed lane at more than one rate. The ride is exact at any tick rate. Assert
that the actor's position stays a constant offset from `platforms.pose(id)` while
riding. Then `npm run play:snap` and play it on each supported device. Unit tests do
not prove that the motion reads well on screen.
