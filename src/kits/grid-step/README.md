# Grid-step movement

`@kits/grid-step` moves actors tile by tile, in the style of tile-based adventure and puzzle games. An actor stands
on an integer tile and faces north, east, south or west. Each move is one tile, or a two-tile jump over a ledge,
and takes a fixed number of ticks. Every request is classified before anything moves. While moving, an actor
holds both its source and its destination tile, so two actors never claim the same tile. Followers step into the
tile their leader just left, in the same tick, which forms lines of actors.

The creator supplies the tile rules (a deterministic function) and calls `step()` once per fixed tick. The kit
owns only its actors. It has no clock, renderer or registration.

```ts
import { createGridStepper, directionBit, HANDHELD_TILE_PRESET } from '@kits/grid-step';

const grid = createGridStepper({
  width: 40, height: 30, maxActors: 64, ...HANDHELD_TILE_PRESET,
  tile: (x, y) => rules[y][x],            // { passable?, classes?, blockEnter?, blockLeave?, ledge?, forced?, elevation? }
});
grid.add(PLAYER, { x: 5, y: 5, facing: 'south' });
grid.add(PARTNER, { x: 5, y: 4 });
grid.follow(PARTNER, PLAYER);
grid.add(GUARD, { x: 12, y: 8, leash: { x: 12, y: 8, rangeX: 2, rangeY: 0 } });
// fixed-step system:
const r = grid.move(PLAYER, heldDirection);    // 'started' | 'jumped' | 'turned' | 'bumped' (+ reason)
for (const e of grid.step()) { /* 'arrived' (step triggers), 'forced', 'followed' */ }
// drawing: lerp from (x, y) to (toX, toY) by elapsed / duration
```

## Rules

A move from tile A in direction `d` is checked in this order. The first failure is the reason it is refused:

1. **`busy`:** the actor is already moving.
2. **`outside-range`:** the destination is outside the actor's home leash. A range of 0 on an axis means unlimited.
3. **`impassable`:**
   - A's `blockLeave` contains `d`.
   - The destination is off the map, `passable: false`, or its `blockEnter` contains `d`.
   - The destination shares no class bit with the actor's `classes`.
   - The destination is a ledge facing another way. A ledge facing `d` is jumped over instead, landing one tile beyond.
4. **`elevation`:** the destination's elevation differs from the actor's. Undefined is compatible with everything.
5. **`occupied`:** another actor with a compatible elevation holds the destination, either standing or moving.

Other behaviour:

- **Bumping.** A refused move still turns the actor to face the obstacle. With `turnBeforeMove` (the default), a
  request in a new direction only turns the actor; the next request moves it.
- **Flags.** `ignoreTiles` skips the tile rules and `ignoreActors` skips other actors. Use them for ghosts,
  cutscene actors or noclip.
- **Arrival.** An actor takes the tile's elevation when it has one. A `forced` tile then starts another move: a
  fixed direction (conveyor) or `'continue'` (ice). Forced moves chain until a move is refused, bounded by
  `maxForcedChain`.
- **Followers.** When a leader starts a move, each standing follower adjacent to the leader starts a move into the
  leader's source tile. Followers move in id order, recursively down the chain. Cycles are refused.
- **Order.** `step()` advances moving actors in id order and returns frozen events in that order.

## Owner, bounds and failure

- **Limits.**
  - Map sides: 1–65536.
  - Actors: 1–4096.
  - Step and jump ticks: 1–65536.
  - Forced chain: 0–4096 moves.
- **Cost.**
  - A request costs a constant number of tile lookups, plus a scan of that tile's claimants.
  - `step()` is O(moving actors) plus followers.
- **Reentrancy.** A tile function that calls back into the stepper throws. Malformed input throws `RangeError`
  before any change.
- **Saving and restoring.** `snapshot()` is plain data. `restore(snapshot)` validates every actor: move geometry,
  leaders, cycles and tile claims. A follower may share only the tile its moving leader is leaving. A refused
  restore leaves the stepper unchanged.

## Presets

`HANDHELD_TILE_PRESET` gives 16-tick walks (16-pixel tiles at one pixel per tick), 8-tick runs (`runTicks`, which
you apply per actor through `stepTicks`), 32-tick ledge jumps and turn-before-move. These are tunable defaults
modelled on classic handheld tile games, not a claim of frame-exact fidelity.

## Limits

- Four directions only, with no diagonal steps.
- Tile rules are read when a move is checked. A rule that changes while an actor is moving does not cancel
  the move.
- There is no pathfinding. Compose with `@kits/navigation` over the same tiles, or with the raster occupancy
  helpers in `@kits/spatial` for static terrain.
- Drawing and animation are the creator's. `elapsed / duration` is the interpolation fraction.

## Evidence

`grid-step.test.ts` covers:

- tick timing and reservations;
- turn-before-move and bumps;
- the refusal order, including leashes, classes, swimmers and elevation;
- one-way tiles, ledges and arriving elevations;
- conveyors and ice, including a bounded forced loop;
- follower lines and cycle refusal;
- snapshot round-trip, deterministic replay and refused inconsistent snapshots;
- validation and reentrancy.

These are headless tests only. No template uses the kit yet.
