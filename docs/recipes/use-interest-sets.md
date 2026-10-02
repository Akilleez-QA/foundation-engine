# Recipe: per-observer interest sets and scoped views

Use the optional `spatial` kit's interest sets when each observer (a network connection,
a team, a sensor) should see only the entities near it, ranked and capped, with enter and
leave changes. Contract: [kit README](../../src/kits/spatial/README.md#interest-sets-sc-02);
evidence: [guide](../guides/interest-sets.md). Start from the
[spatial index recipe](use-a-spatial-index.md): the interest sets read the same grid.

## 1. Record the requirement and pick limits

In GAME.md or the application record, write what "relevant" means and what an observer may
learn. Then choose:

- `enterRadius` and `exitRadius`: the band between them stops flicker at the edge. Keep
  `exitRadius` within the grid's per-query bound; construction tells you when it is not.
- `holdUpdates`: extra updates a member beyond `exitRadius` stays (0 for none).
- `maxRelevant`: the send budget per observer. For NW-02 views keep it `<=` the view
  `maxEntities`.
- `maxCandidates`: larger than the busiest observer's neighbourhood; a fuller scan is
  `incomplete` and fails closed.
- `maxObservers`, `maxPrioritized`: table sizes.

## 2. Update observers from the owner of the grid

```ts
const interest = createInterestSets(grid, limits);
const out = createInterestResult(limits);
interest.addObserver(conn, x, y, avatar);
// Each server tick, after moving entities in the grid:
interest.moveObserver(conn, x, y);
const r = interest.update(conn, out);
// memberChanged: your own check, e.g. a per-entity revision newer than this connection's last check.
if (r.enteredCount || r.leftCount || memberChanged(out, r.relevantCount)) publisher.markDirty();
publisher.pump();
```

`project()` for that connection lists `interest.members(conn, buffer)` only, with an
incarnation per id (see `tools/interest-host/host.mjs`).

## 3. Keep disclosure closed

- Mark a view dirty only for membership changes and changes to members. Never for changes
  elsewhere, and do not put a global counter in the frame: both reveal hidden activity.
- Treat `incomplete` as fail closed (the sets already admit nothing new) and investigate
  `maxCandidates`; treat `over-budget` as a design signal (tighter radius, tiers, or a larger
  budget the creator agrees to).
- Remove an entity from the grid when it despawns or leaves the grid rectangle; it leaves
  every set at the next update.
- Call `removeObserver` when a connection closes, and retire its view.

## 4. Test and measure

- Test the composition with real `createViewReceiver`s, as `tools/interest-host/host.test.mjs`
  does: per-connection contents, no frames for hidden activity, hysteresis, budget, despawn.
- Measure with `npm run bench:spatial` (interest cases at 1,000 and 10,000 entities).
