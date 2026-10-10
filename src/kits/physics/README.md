# kits/physics

An optional rigid-body physics adapter. Under it is one lazily loaded WebAssembly
library: Rapier's deterministic compat build, `@dimforge/rapier3d-deterministic-compat`
0.21.0, Apache-2.0, exact-pinned. The kit gives a game:

- rigid bodies and colliders as components;
- one fixed-step world per scene visit;
- a bounded, ordered collision event list per tick;
- ray, shape-cast and overlap queries returning entity ids;
- text snapshots for `@kits/rollback`;
- a character adapter composed with `@kits/character`;
- opt-in debug lines.

Core stays physics-free. A game that does not import this kit ships none of it. The
decision and the 20-option comparison are in [ADR 0121](../../../docs/adr/0121-optional-physics-adapter-kit.md)
and [the study](../../../docs/research/physics-middleware.md). The user guide is
[physics adapter](../../../docs/guides/physics-adapter.md).

## Creator requirement and seam

The creator authorised a maintained, permissively licensed WebAssembly rigid-body
library as an optional adapter. The requirements are fixed-step integration, a
deterministic mode, snapshot/restore for rollback, and composition with the query
and character kits. The kit reuses existing seams:

| Seam | Use |
|---|---|
| Fixed lane | 60 Hz; one tick per call |
| Scene `prepare(ctx, signal)` | Awaits the library load |
| Scene `exit` and the visit signal | Disposal |
| ECS world | Entities, `Transform` |
| `dmath` | Optional deterministic Euler conversions |
| Scene extensions (`sceneExtension`) | The debug draw |
| Rollback kit ports (text state) | Snapshots |
| Character kit | Inputs, `createMotion`, `turnToward` |

## Use

```ts
import { defineGame, defineScene, Transform } from '@engine';
import { physics, scenePhysics, RigidBody, Collider } from '@kits/physics';

const world = scenePhysics({ gravity: { x: 0, y: -9.81, z: 0 }, limits: { maxBodies: 256 } });
export const yard = defineScene({
  id: 'yard', title: 'Yard',
  prepare: (_ctx, signal) => world.prepare(signal),   // loads the library chunk once per page
  exit: ctx => world.exit(ctx),                       // frees the visit's library objects
  entities: [
    [Transform({ y: 3 }), RigidBody(), Collider({ shape: 'ball', radius: 0.5 })],
    [Transform(), Collider({ hx: 10, hy: 0.1, hz: 10 })],     // a static floor (no RigidBody)
  ],
  systems: [world.system /*, systems that read world.of(ctx)?.events() */],
});
export default defineGame({ id: 'g', title: 'G', version: '0.1.0', firstScene: 'yard', kits: [physics()] });
```

## Inputs and outputs

**Components** (read at admission):

- `RigidBody`: `kind` (`dynamic`, `kinematic` or `fixed`), damping, `gravityScale`, `ccd`, `lockRotations`, initial velocity.
- `Collider`: `shape` (`cuboid` takes `hx/hy/hz`; `ball` takes `radius`; `capsule` and `cylinder` take `radius` and `halfHeight`), friction, restitution, density, `sensor`, `events`.
- `PhysicsCharacter`: capsule size, speed, slopes, autostep, snap, and state fields `vx, vy, vz, grounded`.

Units are metres, seconds, kilograms and radians. Pose comes from `Transform`: Y-up,
Euler XYZ as the renderer applies it. `Transform.scale` is not applied to colliders.
In-place edits of shape or material fields are not observed; call `rebuild(entity)`.

**Authority over `Transform`:**

| Kind | Rule |
|---|---|
| Dynamic | The world writes position and Euler rotation back every tick. Those values are never read back, so a float round trip cannot diverge a replay. Use `teleport` to move one. |
| Kinematic | `Transform` drives the body (next-kinematic target). |
| Fixed and static colliders | `Transform` is read once, at admission. |
| Characters | The character system writes `Transform`; the world follows it. |

**Per tick** (`world.system`, fixed lane):

1. Sync:
   - remove the bodies of entities that are gone or no longer qualify;
   - admit new ones in a fixed order (characters, then bodies, then static colliders, each by ascending entity id);
   - push kinematic targets.
2. `substeps` library steps.
3. Write back dynamic poses.

`of(ctx).events()` then holds this tick's collisions until the next tick. Each is
`{a, b, started, sensor, substep}`, with `a < b` as entity ids. The list is sorted by
substep, `a`, `b`, then stopped before started. Past the bound, events are counted
in `dropped`; which events are kept follows the library's drain order. The library's
stop events for colliders removed by this tick's sync are counted in `unmapped`, not
listed, because their entity is gone. Removals run in ascending entity order, so slot
reuse never depends on the owner's internal map order.

An entity with `PhysicsCharacter` is always a character: a `RigidBody` or `Collider`
on it is ignored. `of(ctx)` creates the visit's world once the library is ready;
`current(ctx)` only looks it up.

**Queries** return entity ids. Non-finite input, positions or angles beyond
`maxCoordinate`, and out-of-range distances or hit counts are refused with
`{status: 'invalid'}`:

- `raycast` returns the nearest hit, with distance, point and normal.
- `raycastAll` examines every hit (up to an internal scan cap of 16,384,
  `QUERY_SCAN_CAP`), then returns the nearest `maxHits`, ties broken by entity id.
- `overlap(shape, pose)` examines the same way, then returns the lowest `maxHits` entity ids.
- In both, `truncated` is true when hits were left out, including when the scan cap
  itself was reached. The result never depends on the library's traversal order.
- `castShape(shape, pose, direction, maxDistance)` returns the first hit.

Options are `exclude` (an entity) and `sensors` (default false).

**Snapshots:**

- `snapshot()` returns `{text}`: JSON holding the library bytes in base64, the entity↔handle records and the tick.
- `restore(text)` validates the text and rebuilds atomically. It returns `restored`, `invalid {reason}` or `too-large`.
  Before committing, it checks every record against the decoded world:
  - each handle exists and appears in only one record;
  - object counts match;
  - each body's type matches its recorded kind;
  - each collider's sensor flag matches;
  - an attached collider's parent is its body, and a static collider has no parent;
  - gravity, step and solver iterations match the configuration.

  The parent check uses the library's raw parent query: in 0.21.0 a deserialised
  world's `Collider.parent()` wrapper was observed to report a body for a parentless
  collider.

## Owner, lifetime and cancellation

The scene's `scenePhysics` owns one physics world per visit, keyed by the visit's ECS
world. The world is created on the first fixed tick after the library is ready.

- **Disposal:** `exit(ctx)` or the visit's abort signal, whichever comes first. Disposal frees the character controllers, the event queue and the library world, each exactly once, and is idempotent. Afterwards every call returns `disposed` or null, and a retired visit never recreates its world.
- **Loading:** `loadPhysics(signal)` and `scenePhysics().prepare(signal)` share one load per page.
  - An abort settles that caller (`aborted`, or `prepare` rejects with the abort reason) and removes its listener.
  - The shared load keeps running and is cached.
  - A failed load is forgotten, so the next scene entry retries.
- **Replacement:** `createPhysicsLoader(source)` substitutes another build. A non-deterministic build voids the determinism evidence below.

## Bounds and overload

| Limit | Range (default) | Overload |
|---|---|---|
| `maxBodies` | 1–65,536 (1,024) | Entity refused (`limit-bodies`), counted, retried each tick |
| `maxColliders` | 1–131,072 (2,048) | Refused (`limit-colliders`) |
| `maxCharacters` | 0–256 (8) | Refused (`limit-characters`); the character system counts it `waiting` |
| `maxEventsPerStep` | 0–65,536 (256) | Events past the bound are not listed; `dropped` per tick and `droppedEvents` in total |
| `maxSnapshotBytes` | 1 KiB–64 MiB (4 MiB) | `snapshot` / `restore` return `too-large` |
| `maxQueryHits` | 1–4,096 (64) | Multi-hit queries stop and report `truncated` |
| `maxDebugVertices` | 2–1,048,576 (65,536) | Debug lines copy at most this many vertices; `truncated` is reported |
| `maxCoordinate` | 1–10,000,000 (1,000,000) | A non-finite or larger \|coordinate\| (m) or \|Euler angle\| (rad) refuses admission (`invalid-body`, `invalid-collider`, `invalid-character`), skips that tick's kinematic target (counted in `skippedPoses`; the body keeps its last valid target), refuses `teleport` (false) and refuses a query. A dynamic pose outside it is not written back to `Transform` (also counted). |
| `substeps` | 1–8 (1) | Library steps per engine tick: the step bound |
| `solverIterations` | 1–16 (4) | n/a |
| `timeScale` | (0, 4] (1) | Not 1 is a deliberate time-scale decision |
| gravity | each component in [-100, 100] (0, -9.81, 0) | n/a |

Invalid options throw a `RangeError` naming the field, at `scenePhysics(...)` or
`createPhysicsWorld(...)` time. Invalid component data refuses that entity
(`invalid-body`, `invalid-collider` or `invalid-character`). Sizes are in (0, 10⁴] m.
A count limit is not a CPU deadline.

## Recovery

- A refused restore leaves the live world untouched. A decoded candidate world that fails validation is freed.
- A restore clears the current refusals; they are re-evaluated against the restored mapping at the next sync.
- After a restore, events are empty until the next step.
- Snapshot entities that the game no longer has are removed at the next sync, and current entities the snapshot did not know are admitted.
- Restore the ECS state first, then the physics snapshot.
- Character planar velocity lives in `PhysicsCharacter`, so restoring the component resumes the character kit's acceleration ramp.

## Character adapter

`physicsCharacterSystem(physics, options)` takes its intent from `@kits/character`:

- the `character-x` / `character-z` axes;
- camera-relative or world mapping;
- the kit's `createMotion` acceleration and stop ramp;
- `turnToward` facing;
- an optional `pointerTarget`.

It resolves `{planar step, vy·dt}` through the library's kinematic character controller.

Differences from the stock `characterSystem`:

- **Added:** slopes up to `maxSlope`, sliding above `minSlide`, autostep, snap-to-ground, gravity and fall speed (`maxFallSpeed`, default 50 m/s), and collision with every collider.
- **Not used:** `Walls`, `Solid` and the `ground` callback.
- **Pointer:** pointer movement needs an explicit `pointerTarget`.

List it before the step system. Add `physics({ characters: true })` and
`character()` to the game's kits, because the adapter reads the character kit's axes.

An entity with both `Character` and `PhysicsCharacter` is refused and counted as
`conflicts`, because the stock system would move it too. The refusal is only the
adapter's movement: the physics world still admits the entity as a character, a
kinematic capsule that follows `Transform` (moved by the stock system), blocks other
bodies and emits collision events. The capsule is upright.
`Transform.ry` is facing only. Pushing dynamic bodies is off.

The one change to the character kit is additive: `createMotion({velocity})` starts the
integrator at a saved velocity. The adapter needs it to restore after rollback or a
reload. Without the option, behaviour is unchanged.

## Debug draw

`physicsDebugDraw(physics, { maxVertices?, enabled? })` is a scene extension, and it
is off unless the scene lists it. It allocates one line buffer at the first enabled
frame, capped at the world's `maxDebugVertices`, and refreshes it once per physics
tick from the library's debug renderer, up to the bound. Only the copy into the GPU
buffer is bounded: each refresh, the library's `debugRender()` produces and copies its
whole line buffer (proportional to every collider) into JavaScript before the kit takes
its bounded slice. It removes and disposes its geometry and material with the visit. Its cost
is one draw call.

## Determinism

The deterministic build's upstream contract: the same sequence of operations on the
same inputs gives bit-identical results across platforms. The adapter keeps its own
operations in a fixed order:

- admission by kind, then ascending entity id;
- events sorted by entity pair;
- no wall clock;
- Euler conversions through `dmath` with `math: 'deterministic'`.

Not covered:

- a different insertion order (for example, spawning in another order);
- float inputs computed by non-deterministic upstream code (`Math.sin` in a game system, camera-relative input from a platform-math camera);
- configuration changes;
- a different library build;
- presentation that reads wall-clock time.

## Cost

Measured in Node 26.8 on an AMD Ryzen 9 7950X under `nice -n 15`, on a shared
machine. These are not budgets or device results.

| Bodies (boxes on a floor) | Tick p50 | Tick p95 | Snapshot text | Snapshot time | Restore time |
|---|---|---|---|---|---|
| 14 | 0.04 ms | 0.09 ms | 41.6 KB | 2.5 ms | 8.5 ms (first call) |
| 100 | 0.09 ms | 0.17 ms | 285 KB | 7.3 ms | 1.7 ms |
| 500 | 0.31 ms | 0.56 ms | 1.76 MB | 37.6 ms | 8.3 ms |

The 100- and 500-body piles settle and sleep, so these timings are optimistic for active stacks.

**Bundle:**

- Stock first-load JS is 175.6 KiB with or without this kit in the tree.
- A fixture game importing the kit has 202.1 KiB first-load JS, which includes the kit code. The library is not in it.
  The kit index statically imports the character adapter, which imports `@kits/character`. The character kit's
  module-level definitions (its move inputs) were present in that fixture's first-load chunk even though the fixture
  used no character, so the figure includes them. A separate entry point would avoid it; the `@kits/<name>` alias
  supports one entry per kit.
- The library is one dynamically imported chunk: 4,366,824 bytes, 1,658,896 bytes with `gzip -9`. It exceeds the 500 kB large-chunk rule, so a game using the kit must list `rapier` in its own `largeChunkAllow`. That is the creator's budget decision.

## Evidence

**Checked: unit and consumer tests** (`src/kits/physics/*.test.ts`, Node):

- the loader: once per page, abort during load, failure and retry, wrong module;
- config refusals;
- dispose exactly once, counted on the library prototypes;
- a `testScene` visit: load in `prepare`, 60 ticks per second, exit disposes;
- abort-signal disposal;
- limit refusals and retry;
- despawn removal and handle generation;
- event order, the bound and drops, and sensor events;
- stop events of a despawned entity counted as `unmapped`;
- the four queries and invalid input;
- nearest-first `raycastAll` and lowest-id `overlap` past `maxHits` (40 boxes, `maxHits` 3, giving [1, 2, 3]);
- NaN, 1e39, 1e300 and out-of-bound `Transform` values refused at admission, kinematic targets skipped and counted, teleports refused, no NaN written back;
- the debug bound;
- `rebuild`;
- kinematic and fixed authority;
- byte-identical snapshots from two worlds after 180 ticks;
- snapshot at tick 40, then restore and replay to 150, equal to the uninterrupted run byte for byte, poses included. The replay includes a tick that despawns a static collider and three bodies and spawns a ball; Map-order removal fails this test;
- invalid, foreign and oversized restores refused with the world untouched;
- forged snapshots refused with the world untouched: swapped body kinds, flipped sensor flags, a static record pointing at an attached collider, duplicate body and collider handles;
- refusals re-evaluated after a restore; exit removes the visit abort listener;
- stale entities after restore;
- `createRollbackSyncTest` at distance 8 for 90 frames;
- two `createRollbackSession` peers on a delayed link ending with equal confirmed checksums after rollbacks;
- character gravity, a 20° climb, a 60° block, autostep on and off, refusal of an entity that also has `Character`, the character limit and controller frees, and an exact character replay after restore;
- the debug-draw extension: off, bounded, refreshed per tick, disposed once.

**Checked: browser emulation.** A temporary fixture game was not committed. In Vite's
dev server with headless Chromium on software GL (`play:snap`), the library loaded
through `prepare`, the ball fell and rested on the floor, and there were no page
errors. The scene used 2 draws and 722 triangles. The first attempt failed with
the dev server's "504 Outdated Optimize Dep": the server pre-bundled the library when
it discovered the lazy import, mid-load. `vite.config.ts` now excludes the package from
dependency optimisation. The package is a self-contained ES module, so it is served
as is, and games without the kit are unaffected.

**Not established:**

- cross-browser, cross-platform or physical-device bit identity (the upstream claim is unverified here);
- GPU or physical-device performance and memory;
- a WebAssembly memory high-water mark (it never shrinks after `dispose`);
- library panics other than corrupt snapshot bytes, which returned null;
- joints, contact-force events, collision groups, compound or mesh colliders, heightfields and soft bodies, which the adapter does not expose;
- worker hosting;
- hosted CI.
